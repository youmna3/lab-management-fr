-- Normalized per-session schedules for lab assignments.

ALTER TABLE public.batches
ADD COLUMN IF NOT EXISTS expected_sessions_per_group int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'batches_expected_sessions_per_group_check'
  ) THEN
    ALTER TABLE public.batches
      ADD CONSTRAINT batches_expected_sessions_per_group_check
      CHECK (expected_sessions_per_group IS NULL OR expected_sessions_per_group > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schedule_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  import_mode text NOT NULL CHECK (import_mode IN ('merge', 'replace')),
  source text NOT NULL DEFAULT 'lab_data',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_target_assignments int NOT NULL DEFAULT 0,
  total_session_rows int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_import_batches_batch_idx
  ON public.schedule_import_batches (batch_id, created_at DESC);

GRANT SELECT, INSERT ON public.schedule_import_batches TO authenticated;
GRANT ALL ON public.schedule_import_batches TO service_role;

ALTER TABLE public.schedule_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sib_select ON public.schedule_import_batches;
CREATE POLICY sib_select ON public.schedule_import_batches
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS sib_insert ON public.schedule_import_batches;
CREATE POLICY sib_insert ON public.schedule_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

CREATE TABLE IF NOT EXISTS public.assignment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  session_time text NOT NULL,
  session_group_id text,
  session_group_key text GENERATED ALWAYS AS (COALESCE(session_group_id, '')) STORED,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_batch_id uuid REFERENCES public.schedule_import_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, lab_id, session_date, session_time)
);

CREATE INDEX IF NOT EXISTS assignment_sessions_assignment_idx
  ON public.assignment_sessions (assignment_id, session_date);
CREATE INDEX IF NOT EXISTS assignment_sessions_batch_idx
  ON public.assignment_sessions (batch_id, session_date);
CREATE INDEX IF NOT EXISTS assignment_sessions_lab_idx
  ON public.assignment_sessions (lab_id, session_date);
CREATE UNIQUE INDEX IF NOT EXISTS assignment_sessions_group_slot_idx
  ON public.assignment_sessions (batch_id, session_date, session_time, session_group_key)
  WHERE session_group_key <> '';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_sessions TO authenticated;
GRANT ALL ON public.assignment_sessions TO service_role;

ALTER TABLE public.assignment_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asg_sessions_select ON public.assignment_sessions;
CREATE POLICY asg_sessions_select ON public.assignment_sessions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS asg_sessions_write ON public.assignment_sessions;
CREATE POLICY asg_sessions_write ON public.assignment_sessions
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

DROP TRIGGER IF EXISTS trg_assignment_sessions_updated ON public.assignment_sessions;
CREATE TRIGGER trg_assignment_sessions_updated
BEFORE UPDATE ON public.assignment_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_assignment_schedule_legacy_fields(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_days int := 0;
  v_peak_sessions int := 0;
  v_time_slots text[] := '{}'::text[];
BEGIN
  WITH per_day AS (
    SELECT session_date, COUNT(*)::int AS sessions_count
    FROM public.assignment_sessions
    WHERE assignment_id = _assignment_id
    GROUP BY session_date
  ),
  slot_list AS (
    SELECT COALESCE(array_agg(session_time ORDER BY session_time), '{}'::text[]) AS slots
    FROM (
      SELECT DISTINCT session_time
      FROM public.assignment_sessions
      WHERE assignment_id = _assignment_id
    ) deduped
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM per_day), 0),
    COALESCE((SELECT MAX(sessions_count) FROM per_day), 0),
    COALESCE((SELECT slots FROM slot_list), '{}'::text[])
  INTO v_days, v_peak_sessions, v_time_slots;

  UPDATE public.assignments
  SET
    days = v_days,
    sessions_per_day = v_peak_sessions,
    time_slots = v_time_slots
  WHERE id = _assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_assignment_schedule(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_assignment record;
  v_day_idx int;
  v_session_idx int;
  v_batch_dates date[];
  v_batch_slots text[];
  v_dates_count int;
  v_last_date date;
  v_target_date date;
  v_target_slot text;
BEGIN
  SELECT
    a.id,
    a.batch_id,
    a.lab_id,
    GREATEST(COALESCE(a.days, 0), 0) AS legacy_days,
    GREATEST(COALESCE(a.sessions_per_day, 0), 0) AS legacy_sessions,
    b.dates,
    b.time_slots
  INTO v_assignment
  FROM public.assignments a
  JOIN public.batches b ON b.id = a.batch_id
  WHERE a.id = _assignment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignment_sessions
    WHERE assignment_id = _assignment_id
  ) THEN
    RETURN;
  END IF;

  IF v_assignment.legacy_days = 0 OR v_assignment.legacy_sessions = 0 THEN
    PERFORM public.sync_assignment_schedule_legacy_fields(_assignment_id);
    RETURN;
  END IF;

  v_batch_dates := COALESCE(v_assignment.dates, '{}'::date[]);
  v_batch_slots := COALESCE(v_assignment.time_slots, '{}'::text[]);
  v_dates_count := COALESCE(array_length(v_batch_dates, 1), 0);
  v_last_date := COALESCE(v_batch_dates[v_dates_count], CURRENT_DATE);

  FOR v_day_idx IN 1..v_assignment.legacy_days LOOP
    IF v_day_idx <= v_dates_count THEN
      v_target_date := v_batch_dates[v_day_idx];
    ELSE
      v_target_date := v_last_date + (v_day_idx - v_dates_count);
    END IF;

    FOR v_session_idx IN 1..v_assignment.legacy_sessions LOOP
      v_target_slot := COALESCE(v_batch_slots[v_session_idx], format('Session %s', v_session_idx));

      INSERT INTO public.assignment_sessions (
        assignment_id,
        batch_id,
        lab_id,
        session_date,
        session_time,
        source
      )
      VALUES (
        v_assignment.id,
        v_assignment.batch_id,
        v_assignment.lab_id,
        v_target_date,
        v_target_slot,
        'manual'
      )
      ON CONFLICT (batch_id, lab_id, session_date, session_time) DO NOTHING;
    END LOOP;
  END LOOP;

  PERFORM public.sync_assignment_schedule_legacy_fields(_assignment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_seed_assignment_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.seed_assignment_schedule(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_assignment_schedule ON public.assignments;
CREATE TRIGGER trg_seed_assignment_schedule
AFTER INSERT ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_assignment_schedule();

CREATE OR REPLACE FUNCTION public.replace_assignment_schedule(
  _assignment_id uuid,
  _sessions jsonb,
  _source text DEFAULT 'manual',
  _import_batch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _source NOT IN ('manual', 'import') THEN
    RAISE EXCEPTION 'Unsupported session source: %', _source;
  END IF;

  IF COALESCE(jsonb_typeof(_sessions), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Schedule payload must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.assignments
    WHERE id = _assignment_id
  ) THEN
    RAISE EXCEPTION 'Assignment % not found', _assignment_id;
  END IF;

  DELETE FROM public.assignment_sessions
  WHERE assignment_id = _assignment_id;

  INSERT INTO public.assignment_sessions (
    assignment_id,
    batch_id,
    lab_id,
    session_date,
    session_time,
    session_group_id,
    source,
    import_batch_id
  )
  SELECT
    a.id,
    a.batch_id,
    a.lab_id,
    (item->>'session_date')::date,
    NULLIF(BTRIM(item->>'session_time'), ''),
    NULLIF(BTRIM(item->>'session_group_id'), ''),
    _source,
    _import_batch_id
  FROM public.assignments a
  CROSS JOIN LATERAL jsonb_array_elements(_sessions) AS item
  WHERE a.id = _assignment_id;

  PERFORM public.sync_assignment_schedule_legacy_fields(_assignment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_assignment_sessions(
  _batch_id uuid,
  _file_name text,
  _import_mode text,
  _target_assignment_ids uuid[],
  _sessions jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_import_batch_id uuid;
  v_assignment_id uuid;
  v_target_ids uuid[] := COALESCE(_target_assignment_ids, '{}'::uuid[]);
BEGIN
  IF _import_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Unsupported import mode: %', _import_mode;
  END IF;

  IF COALESCE(jsonb_typeof(_sessions), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Import payload must be a JSON array';
  END IF;

  INSERT INTO public.schedule_import_batches (
    batch_id,
    file_name,
    import_mode,
    source,
    created_by,
    total_target_assignments,
    total_session_rows
  )
  VALUES (
    _batch_id,
    _file_name,
    _import_mode,
    'lab_data',
    auth.uid(),
    COALESCE(array_length(v_target_ids, 1), 0),
    jsonb_array_length(_sessions)
  )
  RETURNING id INTO v_import_batch_id;

  IF _import_mode = 'replace' AND COALESCE(array_length(v_target_ids, 1), 0) > 0 THEN
    DELETE FROM public.assignment_sessions
    WHERE batch_id = _batch_id
      AND assignment_id = ANY (v_target_ids);
  END IF;

  IF jsonb_array_length(_sessions) > 0 THEN
    IF _import_mode = 'merge' THEN
      INSERT INTO public.assignment_sessions (
        assignment_id,
        batch_id,
        lab_id,
        session_date,
        session_time,
        session_group_id,
        source,
        import_batch_id
      )
      SELECT
        (item->>'assignment_id')::uuid,
        (item->>'batch_id')::uuid,
        (item->>'lab_id')::uuid,
        (item->>'session_date')::date,
        NULLIF(BTRIM(item->>'session_time'), ''),
        NULLIF(BTRIM(item->>'session_group_id'), ''),
        'import',
        v_import_batch_id
      FROM jsonb_array_elements(_sessions) AS item
      ON CONFLICT (batch_id, lab_id, session_date, session_time) DO NOTHING;
    ELSE
      INSERT INTO public.assignment_sessions (
        assignment_id,
        batch_id,
        lab_id,
        session_date,
        session_time,
        session_group_id,
        source,
        import_batch_id
      )
      SELECT
        (item->>'assignment_id')::uuid,
        (item->>'batch_id')::uuid,
        (item->>'lab_id')::uuid,
        (item->>'session_date')::date,
        NULLIF(BTRIM(item->>'session_time'), ''),
        NULLIF(BTRIM(item->>'session_group_id'), ''),
        'import',
        v_import_batch_id
      FROM jsonb_array_elements(_sessions) AS item;
    END IF;
  END IF;

  FOREACH v_assignment_id IN ARRAY v_target_ids LOOP
    PERFORM public.sync_assignment_schedule_legacy_fields(v_assignment_id);
  END LOOP;

  RETURN v_import_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_assignment_schedule_legacy_fields(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_assignment_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_assignment_schedule(uuid, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_assignment_sessions(uuid, text, text, uuid[], jsonb) TO authenticated;

DO $$
DECLARE
  v_assignment_id uuid;
BEGIN
  FOR v_assignment_id IN
    SELECT id
    FROM public.assignments
  LOOP
    PERFORM public.seed_assignment_schedule(v_assignment_id);
  END LOOP;
END $$;

DROP VIEW IF EXISTS public.intake_budget_view;
DROP VIEW IF EXISTS public.batch_budget_view;
DROP VIEW IF EXISTS public.project_budget_view;

CREATE VIEW public.batch_budget_view WITH (security_invoker = true) AS
WITH schedule_totals AS (
  SELECT assignment_id, COUNT(*)::numeric AS total_sessions
  FROM public.assignment_sessions
  GROUP BY assignment_id
),
lab AS (
  SELECT
    a.batch_id,
    COALESCE(
      SUM(
        COALESCE(a.confirmed_price, 0)
        * COALESCE(schedule_totals.total_sessions, GREATEST(a.days, 0) * GREATEST(a.sessions_per_day, 0))
      ),
      0
    ) AS lab_cost
  FROM public.assignments a
  LEFT JOIN schedule_totals ON schedule_totals.assignment_id = a.id
  WHERE a.status = 'confirmed'
  GROUP BY a.batch_id
),
cat AS (
  SELECT a.batch_id,
         COALESCE(SUM(CASE WHEN cl.type = 'sandwich' THEN cl.lab_total ELSE 0 END), 0) AS sandwich_cost,
         COALESCE(SUM(CASE WHEN cl.type = 'water' THEN cl.lab_total ELSE 0 END), 0) AS water_cost
  FROM public.catering_lines cl
  JOIN public.assignments a ON a.id = cl.assignment_id
  GROUP BY a.batch_id
)
SELECT
  b.id AS batch_id,
  b.project_id,
  b.name AS batch_name,
  b.status,
  COALESCE(l.lab_cost, 0) AS lab_cost,
  COALESCE(c.sandwich_cost, 0) AS sandwich_cost,
  COALESCE(c.water_cost, 0) AS water_cost,
  COALESCE(c.sandwich_cost, 0) + COALESCE(c.water_cost, 0) AS catering_cost,
  COALESCE(l.lab_cost, 0) + COALESCE(c.sandwich_cost, 0) + COALESCE(c.water_cost, 0) AS total_cost
FROM public.batches b
LEFT JOIN lab l ON l.batch_id = b.id
LEFT JOIN cat c ON c.batch_id = b.id;

GRANT SELECT ON public.batch_budget_view TO authenticated;

CREATE VIEW public.project_budget_view WITH (security_invoker = true) AS
WITH schedule_totals AS (
  SELECT assignment_id, COUNT(*)::numeric AS total_sessions
  FROM public.assignment_sessions
  GROUP BY assignment_id
),
lab AS (
  SELECT
    b.project_id,
    COALESCE(
      SUM(
        COALESCE(a.confirmed_price, 0)
        * COALESCE(schedule_totals.total_sessions, GREATEST(a.days, 0) * GREATEST(a.sessions_per_day, 0))
      ),
      0
    ) AS lab_cost
  FROM public.assignments a
  JOIN public.batches b ON b.id = a.batch_id
  LEFT JOIN schedule_totals ON schedule_totals.assignment_id = a.id
  WHERE a.status = 'confirmed'
  GROUP BY b.project_id
),
cat AS (
  SELECT
    b.project_id,
    COALESCE(SUM(CASE WHEN cl.type = 'sandwich' THEN cl.lab_total ELSE 0 END), 0) AS sandwich_cost,
    COALESCE(SUM(CASE WHEN cl.type = 'water' THEN cl.lab_total ELSE 0 END), 0) AS water_cost
  FROM public.catering_lines cl
  JOIN public.assignments a ON a.id = cl.assignment_id
  JOIN public.batches b ON b.id = a.batch_id
  GROUP BY b.project_id
),
extras AS (
  SELECT project_id, COALESCE(SUM(amount), 0) AS extras_cost
  FROM public.project_extra_costs
  GROUP BY project_id
)
SELECT
  p.id AS project_id,
  p.name,
  p.client,
  p.status,
  p.program,
  p.intake_label,
  COALESCE(l.lab_cost, 0) AS lab_cost,
  COALESCE(c.sandwich_cost, 0) AS sandwich_cost,
  COALESCE(c.water_cost, 0) AS water_cost,
  COALESCE(c.sandwich_cost, 0) + COALESCE(c.water_cost, 0) AS catering_cost,
  COALESCE(e.extras_cost, 0) AS extras_cost,
  COALESCE(l.lab_cost, 0) + COALESCE(c.sandwich_cost, 0) + COALESCE(c.water_cost, 0) + COALESCE(e.extras_cost, 0) AS total_cost
FROM public.projects p
LEFT JOIN lab l ON l.project_id = p.id
LEFT JOIN cat c ON c.project_id = p.id
LEFT JOIN extras e ON e.project_id = p.id;

GRANT SELECT ON public.project_budget_view TO authenticated;

CREATE VIEW public.intake_budget_view WITH (security_invoker = true) AS
SELECT
  COALESCE(program::text, 'Unassigned') AS intake,
  SUM(lab_cost) AS lab_cost,
  SUM(sandwich_cost) AS sandwich_cost,
  SUM(water_cost) AS water_cost,
  SUM(catering_cost) AS catering_cost,
  SUM(extras_cost) AS extras_cost,
  SUM(total_cost) AS total_cost
FROM public.project_budget_view
GROUP BY COALESCE(program::text, 'Unassigned');

GRANT SELECT ON public.intake_budget_view TO authenticated;
