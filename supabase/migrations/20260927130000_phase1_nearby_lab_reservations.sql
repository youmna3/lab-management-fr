-- Make nearby-lab approval reserve only the requested physical slots. The
-- request identifier makes reversal precise even when an existing assignment
-- is reused.

ALTER TABLE public.assignment_sessions
  ADD COLUMN IF NOT EXISTS reservation_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assignment_sessions'::regclass
      AND conname = 'assignment_sessions_reservation_request_id_fkey'
  ) THEN
    ALTER TABLE public.assignment_sessions
      ADD CONSTRAINT assignment_sessions_reservation_request_id_fkey
      FOREIGN KEY (reservation_request_id)
      REFERENCES public.batch_resolution_requests(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS assignment_sessions_reservation_request_idx
  ON public.assignment_sessions (reservation_request_id)
  WHERE reservation_request_id IS NOT NULL;

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
  v_assignment_status text;
  v_dedicated_assignment boolean := false;
  v_session jsonb;
  v_history jsonb;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'administration')
  ) THEN
    RAISE EXCEPTION 'Event Team/Lab Manager or administrator permission is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Nearby lab decisions must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.batch_resolution_requests
  WHERE id = p_request_id
    AND type = 'nearby_lab'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nearby lab request not found' USING ERRCODE = 'P0002';
  END IF;

  -- batch_id is UUID on a clean replay. The text cast also makes the check safe
  -- on a historical database whose duplicate migration left a text column.
  IF v_request.batch_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Nearby lab reservations require a persisted UUID batch' USING ERRCODE = '22023';
  END IF;
  v_batch_id := v_request.batch_id::text::uuid;

  v_lab_id := COALESCE(
    CASE
      WHEN COALESCE(v_request.nearby_lab_metadata->>'lab_uuid', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (v_request.nearby_lab_metadata->>'lab_uuid')::uuid
      ELSE NULL
    END,
    (SELECT id
     FROM public.labs
     WHERE id::text = v_request.lab_id OR lab_code = v_request.lab_id
     LIMIT 1)
  );
  IF v_lab_id IS NULL THEN
    RAISE EXCEPTION 'Requested lab could not be resolved' USING ERRCODE = '23503';
  END IF;

  IF COALESCE(jsonb_typeof(v_request.nearby_lab_metadata->'required_sessions'), 'null') <> 'array' THEN
    RAISE EXCEPTION 'The nearby lab request schedule must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Consistent lock ordering serializes requests competing for the same lab slot.
  FOR v_session IN
    SELECT value
    FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions')
    ORDER BY value->>'date', lower(BTRIM(value->>'time'))
  LOOP
    IF NULLIF(BTRIM(v_session->>'date'), '') IS NULL
       OR NULLIF(BTRIM(v_session->>'time'), '') IS NULL THEN
      RAISE EXCEPTION 'Every nearby lab session requires a date and time' USING ERRCODE = '22023';
    END IF;
    -- Force date validation before any reservation is written.
    PERFORM (v_session->>'date')::date;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_lab_id::text || '|' || (v_session->>'date') || '|' || lower(BTRIM(v_session->>'time')),
      0
    ));
  END LOOP;

  IF p_status = 'approved' THEN
    IF jsonb_array_length(v_request.nearby_lab_metadata->'required_sessions') = 0 THEN
      RAISE EXCEPTION 'The nearby lab request has no required schedule' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions') requested
      JOIN public.assignment_sessions s
        ON s.lab_id = v_lab_id
       AND s.session_date = (requested->>'date')::date
       AND lower(BTRIM(s.session_time)) = lower(BTRIM(requested->>'time'))
      JOIN public.assignments a ON a.id = s.assignment_id
      WHERE a.status::text IN ('pending', 'confirmed')
        AND s.reservation_request_id IS DISTINCT FROM v_request.id
    ) THEN
      RAISE EXCEPTION 'This lab is no longer available for one or more requested sessions.'
        USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.batch_resolution_requests other
      CROSS JOIN jsonb_array_elements(COALESCE(other.nearby_lab_metadata->'required_sessions', '[]'::jsonb)) theirs
      CROSS JOIN jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions') ours
      WHERE other.id <> v_request.id
        AND other.type = 'nearby_lab'
        AND other.status = 'approved'
        AND COALESCE(other.nearby_lab_metadata->>'lab_uuid', other.lab_id) = v_lab_id::text
        AND theirs->>'date' = ours->>'date'
        AND lower(BTRIM(theirs->>'time')) = lower(BTRIM(ours->>'time'))
    ) THEN
      RAISE EXCEPTION 'This lab is no longer available for one or more requested sessions.'
        USING ERRCODE = '23P01';
    END IF;

    SELECT id, status::text, notes = 'nearby_lab_request:' || v_request.id::text
    INTO v_assignment_id, v_assignment_status, v_dedicated_assignment
    FROM public.assignments
    WHERE batch_id = v_batch_id
      AND lab_id = v_lab_id;

    IF v_assignment_id IS NULL THEN
      -- Zero legacy values make trg_seed_assignment_schedule return without
      -- inventing batch dates or time slots before the exact rows are inserted.
      INSERT INTO public.assignments (
        batch_id, lab_id, status, sessions_per_day, days, time_slots, notes, source
      ) VALUES (
        v_batch_id, v_lab_id, 'pending', 0, 0, '{}'::text[],
        'nearby_lab_request:' || v_request.id::text, 'manual'
      )
      RETURNING id INTO v_assignment_id;
      v_assignment_status := 'pending';
      v_dedicated_assignment := true;
    ELSIF v_assignment_status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'The existing batch/lab assignment is not active and cannot receive reservations'
        USING ERRCODE = '23514';
    END IF;

    -- Clean up rows generated by the old trigger implementation when the same
    -- request is re-approved. Never touch schedules on a shared assignment.
    IF v_dedicated_assignment THEN
      DELETE FROM public.assignment_sessions
      WHERE assignment_id = v_assignment_id;
    ELSE
      DELETE FROM public.assignment_sessions
      WHERE reservation_request_id = v_request.id;
    END IF;

    FOR v_session IN
      SELECT value
      FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions')
    LOOP
      INSERT INTO public.assignment_sessions (
        assignment_id,
        batch_id,
        lab_id,
        session_date,
        session_time,
        source,
        reservation_request_id
      ) VALUES (
        v_assignment_id,
        v_batch_id,
        v_lab_id,
        (v_session->>'date')::date,
        BTRIM(v_session->>'time'),
        'manual',
        v_request.id
      )
      ON CONFLICT (batch_id, lab_id, session_date, session_time) DO NOTHING;
    END LOOP;

    -- DO NOTHING above supports harmless duplicate entries in one request, but
    -- approval must fail if any requested slot belongs to a different schedule.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_request.nearby_lab_metadata->'required_sessions') requested
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.assignment_sessions s
        WHERE s.assignment_id = v_assignment_id
          AND s.batch_id = v_batch_id
          AND s.lab_id = v_lab_id
          AND s.session_date = (requested->>'date')::date
          AND lower(BTRIM(s.session_time)) = lower(BTRIM(requested->>'time'))
          AND s.reservation_request_id = v_request.id
      )
    ) THEN
      RAISE EXCEPTION 'Could not reserve every exact nearby lab session; approval was rolled back'
        USING ERRCODE = '23P01';
    END IF;

    PERFORM public.sync_assignment_schedule_legacy_fields(v_assignment_id);
  ELSE
    IF COALESCE(v_request.nearby_lab_metadata->>'reservation_assignment_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_assignment_id := (v_request.nearby_lab_metadata->>'reservation_assignment_id')::uuid;
    ELSE
      SELECT id INTO v_assignment_id
      FROM public.assignments
      WHERE batch_id = v_batch_id
        AND lab_id = v_lab_id
        AND notes = 'nearby_lab_request:' || v_request.id::text;
    END IF;

    DELETE FROM public.assignment_sessions
    WHERE reservation_request_id = v_request.id;

    IF v_assignment_id IS NOT NULL THEN
      SELECT notes = 'nearby_lab_request:' || v_request.id::text
      INTO v_dedicated_assignment
      FROM public.assignments
      WHERE id = v_assignment_id;

      IF v_dedicated_assignment
         AND NOT EXISTS (
           SELECT 1 FROM public.assignment_sessions WHERE assignment_id = v_assignment_id
         ) THEN
        DELETE FROM public.assignments WHERE id = v_assignment_id;
        v_assignment_id := NULL;
      ELSE
        PERFORM public.sync_assignment_schedule_legacy_fields(v_assignment_id);
      END IF;
    END IF;
  END IF;

  v_history := COALESCE(v_request.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'action', p_status,
    'by_name', p_reviewer_name,
    'by_role', p_reviewer_role,
    'timestamp', now(),
    'comment', p_comment,
    'is_override', v_request.status <> 'pending' AND v_request.status <> p_status
  ));

  UPDATE public.batch_resolution_requests
  SET status = p_status,
      reviewed_by_name = p_reviewer_name,
      reviewed_by_role = p_reviewer_role,
      reviewer_comment = p_comment,
      history = v_history,
      nearby_lab_metadata = COALESCE(nearby_lab_metadata, '{}'::jsonb)
        || jsonb_build_object('reservation_assignment_id', v_assignment_id),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_nearby_lab_request(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_nearby_lab_request(uuid, text, text, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
