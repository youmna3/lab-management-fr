-- Allocation metadata, monotonic revisions, optimistic-concurrency RPC, and
-- persistence-only VP state. No allocation or VP business rule is evaluated here.

ALTER TABLE public.batch_allocation_outputs
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS allocation_owner uuid,
  ADD COLUMN IF NOT EXISTS allocation_owner_email text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.batch_allocation_outputs'::regclass
      AND conname = 'batch_allocation_outputs_allocation_owner_fkey'
  ) THEN
    ALTER TABLE public.batch_allocation_outputs
      ADD CONSTRAINT batch_allocation_outputs_allocation_owner_fkey
      FOREIGN KEY (allocation_owner) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.batch_allocation_outputs'::regclass
      AND conname = 'batch_allocation_outputs_created_by_fkey'
  ) THEN
    ALTER TABLE public.batch_allocation_outputs
      ADD CONSTRAINT batch_allocation_outputs_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_batch_allocation_output_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision := GREATEST(COALESCE(NEW.revision, 1), 1);
    NEW.allocation_owner := COALESCE(NEW.allocation_owner, auth.uid());
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    NEW.allocation_owner_email := COALESCE(
      NEW.allocation_owner_email,
      NULLIF(auth.jwt()->>'email', '')
    );
  ELSE
    NEW.revision := OLD.revision + 1;
    -- Ownership records who first established the shared allocation. It is
    -- audit metadata, not an authorization boundary.
    NEW.allocation_owner := COALESCE(OLD.allocation_owner, NEW.allocation_owner, auth.uid());
    NEW.allocation_owner_email := COALESCE(
      OLD.allocation_owner_email,
      NEW.allocation_owner_email,
      NULLIF(auth.jwt()->>'email', '')
    );
    NEW.created_by := COALESCE(OLD.created_by, NEW.created_by, auth.uid());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_allocation_output_revision ON public.batch_allocation_outputs;
CREATE TRIGGER trg_batch_allocation_output_revision
BEFORE INSERT OR UPDATE ON public.batch_allocation_outputs
FOR EACH ROW EXECUTE FUNCTION public.prepare_batch_allocation_output_revision();

REVOKE EXECUTE ON FUNCTION public.prepare_batch_allocation_output_revision() FROM PUBLIC, anon, authenticated;

-- Forward-compatible compare-and-swap save. The current frontend still uses a
-- direct upsert, so it receives automatic revision increments but cannot reject
-- a stale browser save until it is changed to call this RPC with the revision it
-- originally loaded.
CREATE OR REPLACE FUNCTION public.save_batch_allocation_output_if_revision(
  p_batch_id uuid,
  p_project_id uuid,
  p_summary jsonb,
  p_preferences_applied jsonb,
  p_allocation_storage_path text,
  p_run_id text,
  p_expected_revision bigint,
  p_updated_by text
)
RETURNS public.batch_allocation_outputs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.batch_allocation_outputs%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  ) THEN
    RAISE EXCEPTION 'Operations or administrator permission is required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_summary), 'null') <> 'object'
     OR COALESCE(jsonb_typeof(p_preferences_applied), 'null') <> 'object' THEN
    RAISE EXCEPTION 'Allocation summary and preferences must be JSON objects' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision must be zero for create or the loaded positive revision for update'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    BEGIN
      INSERT INTO public.batch_allocation_outputs (
        batch_id,
        project_id,
        summary,
        preferences_applied,
        allocation_storage_path,
        run_id,
        updated_by,
        allocation_owner,
        allocation_owner_email,
        created_by
      ) VALUES (
        p_batch_id,
        p_project_id,
        p_summary,
        p_preferences_applied,
        p_allocation_storage_path,
        p_run_id,
        p_updated_by,
        auth.uid(),
        NULLIF(auth.jwt()->>'email', ''),
        auth.uid()
      )
      RETURNING * INTO v_result;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Allocation changed since it was loaded; reload before saving'
        USING ERRCODE = '40001';
    END;
  ELSE
    UPDATE public.batch_allocation_outputs
    SET project_id = p_project_id,
        summary = p_summary,
        preferences_applied = p_preferences_applied,
        allocation_storage_path = p_allocation_storage_path,
        run_id = p_run_id,
        updated_by = p_updated_by
    WHERE batch_id = p_batch_id
      AND revision = p_expected_revision
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Allocation changed since it was loaded; reload before saving'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_batch_allocation_output_if_revision(uuid, uuid, jsonb, jsonb, text, text, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_batch_allocation_output_if_revision(uuid, uuid, jsonb, jsonb, text, text, bigint, text)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.batch_vp_state (
  batch_id uuid PRIMARY KEY REFERENCES public.batches(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_students jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_vp_state_recommendations_array CHECK (jsonb_typeof(recommendations) = 'array'),
  CONSTRAINT batch_vp_state_sessions_array CHECK (jsonb_typeof(sessions) = 'array'),
  CONSTRAINT batch_vp_state_session_students_array CHECK (jsonb_typeof(session_students) = 'array'),
  CONSTRAINT batch_vp_state_summary_object CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT batch_vp_state_decisions_object CHECK (jsonb_typeof(decisions) = 'object')
);

ALTER TABLE public.batch_vp_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.batch_vp_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.batch_vp_state TO service_role;

CREATE OR REPLACE FUNCTION public.get_batch_vp_state(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.batch_vp_state%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  ) THEN
    RAISE EXCEPTION 'Authenticated allocation access is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_state
  FROM public.batch_vp_state
  WHERE batch_id = p_batch_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'batch_id', p_batch_id,
      'project_id', NULL,
      'recommendations', '[]'::jsonb,
      'sessions', '[]'::jsonb,
      'session_students', '[]'::jsonb,
      'summary', '{}'::jsonb,
      'decisions', '{}'::jsonb,
      'revision', 0,
      'updated_by', NULL,
      'updated_at', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_state.batch_id,
    'project_id', v_state.project_id,
    'recommendations', v_state.recommendations,
    'sessions', v_state.sessions,
    'session_students', v_state.session_students,
    'summary', v_state.summary,
    'decisions', v_state.decisions,
    'revision', v_state.revision,
    'updated_by', v_state.updated_by,
    'updated_at', v_state.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_update_batch_vp_state(
  p_batch_id uuid,
  p_project_id uuid,
  p_recommendations jsonb,
  p_sessions jsonb,
  p_session_students jsonb,
  p_summary jsonb,
  p_decisions jsonb,
  p_updated_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_project_id uuid;
  v_state public.batch_vp_state%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  ) THEN
    RAISE EXCEPTION 'Operations or administrator permission is required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_typeof(p_recommendations), 'null') <> 'array'
     OR COALESCE(jsonb_typeof(p_sessions), 'null') <> 'array'
     OR COALESCE(jsonb_typeof(p_session_students), 'null') <> 'array'
     OR COALESCE(jsonb_typeof(p_summary), 'null') <> 'object'
     OR COALESCE(jsonb_typeof(p_decisions), 'null') <> 'object' THEN
    RAISE EXCEPTION 'VP recommendations, sessions and session_students must be arrays; summary and decisions must be objects'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_session_students) item
    WHERE jsonb_typeof(item) <> 'object'
       OR NULLIF(BTRIM(item->>'session_id'), '') IS NULL
       OR NULLIF(BTRIM(item->>'student_id'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Each VP session_students entry requires non-empty session_id and student_id strings'
      USING ERRCODE = '22023';
  END IF;

  SELECT project_id INTO v_batch_project_id
  FROM public.batches
  WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % does not exist', p_batch_id USING ERRCODE = '23503';
  END IF;

  IF p_project_id IS NOT NULL AND p_project_id IS DISTINCT FROM v_batch_project_id THEN
    RAISE EXCEPTION 'VP project does not match the batch project' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.batch_vp_state (
    batch_id,
    project_id,
    recommendations,
    sessions,
    session_students,
    summary,
    decisions,
    revision,
    updated_by,
    updated_by_user_id,
    updated_at
  ) VALUES (
    p_batch_id,
    COALESCE(p_project_id, v_batch_project_id),
    p_recommendations,
    p_sessions,
    p_session_students,
    p_summary,
    p_decisions,
    1,
    COALESCE(NULLIF(p_updated_by, ''), NULLIF(auth.jwt()->>'email', '')),
    auth.uid(),
    now()
  )
  ON CONFLICT (batch_id) DO UPDATE
  SET project_id = EXCLUDED.project_id,
      recommendations = EXCLUDED.recommendations,
      sessions = EXCLUDED.sessions,
      session_students = EXCLUDED.session_students,
      summary = EXCLUDED.summary,
      decisions = EXCLUDED.decisions,
      revision = public.batch_vp_state.revision + 1,
      updated_by = EXCLUDED.updated_by,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
  RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'batch_id', v_state.batch_id,
    'project_id', v_state.project_id,
    'recommendations', v_state.recommendations,
    'sessions', v_state.sessions,
    'session_students', v_state.session_students,
    'summary', v_state.summary,
    'decisions', v_state.decisions,
    'revision', v_state.revision,
    'updated_by', v_state.updated_by,
    'updated_at', v_state.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_batch_vp_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_update_batch_vp_state(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_batch_vp_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_batch_vp_state(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  TO authenticated;
