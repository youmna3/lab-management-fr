-- Existing-lab shortfall requests and transactionally safe schedule reservations.

ALTER TABLE public.batch_resolution_requests
  ADD COLUMN IF NOT EXISTS nearby_lab_metadata jsonb;

ALTER TABLE public.batch_resolution_requests
  DROP CONSTRAINT IF EXISTS batch_resolution_requests_type_check;
ALTER TABLE public.batch_resolution_requests
  ADD CONSTRAINT batch_resolution_requests_type_check
  CHECK (type IN ('overfill', 'nearby_lab', 'new_lab', 'cs_outreach', 'cs_reallocation'));

CREATE INDEX IF NOT EXISTS batch_resolution_requests_nearby_active_idx
  ON public.batch_resolution_requests (status, lab_id)
  WHERE type = 'nearby_lab' AND status IN ('pending', 'approved');

CREATE OR REPLACE FUNCTION public.decide_nearby_lab_request(
  p_request_id uuid,
  p_status text,
  p_reviewer_name text,
  p_reviewer_role text,
  p_comment text DEFAULT NULL
)
RETURNS public.batch_resolution_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.batch_resolution_requests%ROWTYPE;
  v_lab_id uuid;
  v_batch_id uuid;
  v_assignment_id uuid;
  v_session jsonb;
  v_history jsonb;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'administration')
  ) THEN
    RAISE EXCEPTION 'Event Team or administrator permission is required';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Nearby lab decisions must be approved or rejected';
  END IF;

  SELECT * INTO v_request
  FROM public.batch_resolution_requests
  WHERE id = p_request_id AND type = 'nearby_lab'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nearby lab request not found'; END IF;

  IF v_request.batch_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Nearby lab reservations require a persisted UUID batch';
  END IF;
  v_batch_id := v_request.batch_id::uuid;

  v_lab_id := COALESCE(
    CASE WHEN COALESCE(v_request.nearby_lab_metadata->>'lab_uuid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (v_request.nearby_lab_metadata->>'lab_uuid')::uuid ELSE NULL END,
    (SELECT id FROM public.labs WHERE id::text = v_request.lab_id OR lab_code = v_request.lab_id LIMIT 1)
  );
  IF v_lab_id IS NULL THEN RAISE EXCEPTION 'Requested lab could not be resolved'; END IF;

  -- Serialize competing approvals for every requested physical slot.
  FOR v_session IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_request.nearby_lab_metadata->'required_sessions', '[]'::jsonb))
    ORDER BY value->>'date', lower(trim(value->>'time'))
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lab_id::text || '|' || (v_session->>'date') || '|' || (v_session->>'time'), 0));
  END LOOP;

  IF p_status = 'approved' THEN
    IF jsonb_array_length(COALESCE(v_request.nearby_lab_metadata->'required_sessions', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'The nearby lab request has no required schedule';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions') requested
      JOIN public.assignment_sessions s
        ON s.lab_id = v_lab_id
       AND s.session_date = (requested->>'date')::date
       AND lower(trim(s.session_time)) = lower(trim(requested->>'time'))
      JOIN public.assignments a ON a.id = s.assignment_id
      WHERE a.status::text IN ('pending', 'confirmed', 'replacement_pending')
        AND a.notes IS DISTINCT FROM 'nearby_lab_request:' || v_request.id::text
    ) THEN
      RAISE EXCEPTION 'This lab is no longer available for one or more requested sessions.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.batch_resolution_requests other
      CROSS JOIN jsonb_array_elements(COALESCE(other.nearby_lab_metadata->'required_sessions', '[]'::jsonb)) theirs
      CROSS JOIN jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions') ours
      WHERE other.id <> v_request.id AND other.type = 'nearby_lab' AND other.status = 'approved'
        AND COALESCE(other.nearby_lab_metadata->>'lab_uuid', other.lab_id) = v_lab_id::text
        AND theirs->>'date' = ours->>'date'
        AND lower(trim(theirs->>'time')) = lower(trim(ours->>'time'))
    ) THEN
      RAISE EXCEPTION 'This lab is no longer available for one or more requested sessions.';
    END IF;

    SELECT id INTO v_assignment_id FROM public.assignments
    WHERE batch_id = v_batch_id AND lab_id = v_lab_id;
    IF v_assignment_id IS NULL THEN
      INSERT INTO public.assignments (batch_id, lab_id, status, sessions_per_day, days, time_slots, notes, source)
      VALUES (
        v_batch_id, v_lab_id, 'pending', 1,
        (SELECT count(DISTINCT value->>'date') FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions')),
        ARRAY(SELECT DISTINCT value->>'time' FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions')),
        'nearby_lab_request:' || v_request.id::text, 'manual'
      ) RETURNING id INTO v_assignment_id;
    END IF;

    FOR v_session IN SELECT value FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions')
    LOOP
      INSERT INTO public.assignment_sessions (assignment_id, batch_id, lab_id, session_date, session_time, source)
      VALUES (v_assignment_id, v_batch_id, v_lab_id, (v_session->>'date')::date, v_session->>'time', 'manual')
      ON CONFLICT (batch_id, lab_id, session_date, session_time) DO NOTHING;
    END LOOP;
  ELSE
    SELECT id INTO v_assignment_id FROM public.assignments
    WHERE batch_id = v_batch_id AND lab_id = v_lab_id AND notes = 'nearby_lab_request:' || v_request.id::text;
    IF v_assignment_id IS NOT NULL THEN DELETE FROM public.assignments WHERE id = v_assignment_id; END IF;
  END IF;

  v_history := COALESCE(v_request.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'action', p_status, 'by_name', p_reviewer_name, 'by_role', p_reviewer_role,
    'timestamp', now(), 'comment', p_comment,
    'is_override', v_request.status <> 'pending' AND v_request.status <> p_status
  ));

  UPDATE public.batch_resolution_requests
  SET status = p_status,
      reviewed_by_name = p_reviewer_name,
      reviewed_by_role = p_reviewer_role,
      reviewer_comment = p_comment,
      history = v_history,
      nearby_lab_metadata = nearby_lab_metadata || jsonb_build_object('reservation_assignment_id', v_assignment_id),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;
  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_nearby_lab_request(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_nearby_lab_request(uuid, text, text, text, text) TO authenticated;
