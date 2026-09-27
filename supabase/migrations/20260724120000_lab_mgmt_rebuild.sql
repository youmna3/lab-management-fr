-- =====================================================================
-- iSchool B2G — Lab Management System — schema rebuild (v2.1)
-- Additive + idempotent. Safe to run multiple times in the SQL editor.
-- Implements: Lab Data (gov/area/vendor/session price + quality),
-- Projects (batches, needs, assignments), Catering (sandwich/water lines),
-- Budget roll-ups, Timeline overrides. Currency = EGP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUMS (guarded)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'program') THEN
    CREATE TYPE public.program AS ENUM ('DECI','DEMI');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE public.batch_status AS ENUM ('draft','assigning','confirming','ready','exported');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE public.assignment_status AS ENUM ('pending','confirmed','denied');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'catering_type') THEN
    CREATE TYPE public.catering_type AS ENUM ('sandwich','water');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ac_quality') THEN
    CREATE TYPE public.ac_quality AS ENUM ('yes','no','partial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'date_mode') THEN
    CREATE TYPE public.date_mode AS ENUM ('range','custom');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. LABS — add real columns (keep legacy city/hourly_price/quality_rating)
-- ---------------------------------------------------------------------
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS lab_code          text,
  ADD COLUMN IF NOT EXISTS gov               text,
  ADD COLUMN IF NOT EXISTS area              text,
  ADD COLUMN IF NOT EXISTS center_name       text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS maps_url          text,
  ADD COLUMN IF NOT EXISTS lat               numeric,
  ADD COLUMN IF NOT EXISTS lng               numeric,
  ADD COLUMN IF NOT EXISTS vendor_name       text,
  ADD COLUMN IF NOT EXISTS session_price     numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supervisor_name   text,
  ADD COLUMN IF NOT EXISTS supervisor_phone  text,
  ADD COLUMN IF NOT EXISTS facilitator_name  text,
  ADD COLUMN IF NOT EXISTS facilitator_phone text,
  ADD COLUMN IF NOT EXISTS students_count    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'ok';

-- Keep validation_status constrained to known values
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labs_validation_status_chk') THEN
    ALTER TABLE public.labs
      ADD CONSTRAINT labs_validation_status_chk CHECK (validation_status IN ('ok','issues'));
  END IF;
END $$;

-- Gentle backfill from legacy columns (no-op if empty)
UPDATE public.labs SET area = COALESCE(area, city) WHERE area IS NULL;
UPDATE public.labs SET address = COALESCE(address, location_address) WHERE address IS NULL;
UPDATE public.labs SET session_price = hourly_price WHERE session_price = 0 AND hourly_price > 0;

-- Unique lab_code (enables CSV upsert by Lab ID); NULLs allowed
CREATE UNIQUE INDEX IF NOT EXISTS labs_lab_code_key ON public.labs (lab_code);
CREATE INDEX IF NOT EXISTS labs_gov_area_idx ON public.labs (gov, area);

-- ---------------------------------------------------------------------
-- 3. LAB QUALITY (one row per lab; weighted score computed in the app)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lab_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL UNIQUE REFERENCES public.labs(id) ON DELETE CASCADE,
  bathroom_boys   boolean NOT NULL DEFAULT false,
  bathroom_girls  boolean NOT NULL DEFAULT false,
  pc_quality       smallint CHECK (pc_quality BETWEEN 1 AND 5),
  internet_quality smallint CHECK (internet_quality BETWEEN 1 AND 5),
  chairs_quality   smallint CHECK (chairs_quality BETWEEN 1 AND 5),
  street_view      smallint CHECK (street_view BETWEEN 1 AND 5),
  cleanliness      smallint CHECK (cleanliness BETWEEN 1 AND 5),
  ac public.ac_quality NOT NULL DEFAULT 'no',
  projector boolean NOT NULL DEFAULT false,
  security  boolean NOT NULL DEFAULT false,
  extra_activities int NOT NULL DEFAULT 0,
  quality_score numeric(6,2) NOT NULL DEFAULT 0,
  notes text,
  assessed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_quality TO authenticated;
GRANT ALL ON public.lab_quality TO service_role;
ALTER TABLE public.lab_quality ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lq_select ON public.lab_quality;
CREATE POLICY lq_select ON public.lab_quality FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS lq_write ON public.lab_quality;
CREATE POLICY lq_write ON public.lab_quality FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'));
DROP TRIGGER IF EXISTS trg_lq_updated ON public.lab_quality;
CREATE TRIGGER trg_lq_updated BEFORE UPDATE ON public.lab_quality
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 4. PROJECTS — add program + code, then seed the 4 projects
-- ---------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS program public.program,
  ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_code_key ON public.projects (code);

INSERT INTO public.projects (name, code, program, intake_label) VALUES
  ('DECI Batch 4 — 2025/26', 'DECI4',       'DECI', '2025/26'),
  ('DEMI Batch 3 — 2025/26', 'DEMI3',       'DEMI', '2025/26'),
  ('DECI Summer 2026',       'DECI-SUM-26', 'DECI', 'Summer 2026'),
  ('DEMI Summer 2026',       'DEMI-SUM-26', 'DEMI', 'Summer 2026')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. BATCHES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  date_mode public.date_mode NOT NULL DEFAULT 'range',
  dates date[] NOT NULL DEFAULT '{}',
  time_slots text[] NOT NULL DEFAULT ARRAY['9 AM','12 PM','3 PM','6 PM'],
  status public.batch_status NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_project_idx ON public.batches (project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT ALL ON public.batches TO service_role;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS batches_select ON public.batches;
CREATE POLICY batches_select ON public.batches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS batches_write ON public.batches;
CREATE POLICY batches_write ON public.batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
DROP TRIGGER IF EXISTS trg_batches_updated ON public.batches;
CREATE TRIGGER trg_batches_updated BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 6. BATCH NEEDS (imported requirements: gov/area/count)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batch_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  gov text NOT NULL,
  area text NOT NULL,
  labs_required int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batch_needs_batch_idx ON public.batch_needs (batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_needs TO authenticated;
GRANT ALL ON public.batch_needs TO service_role;
ALTER TABLE public.batch_needs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bn_select ON public.batch_needs;
CREATE POLICY bn_select ON public.batch_needs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bn_write ON public.batch_needs;
CREATE POLICY bn_write ON public.batch_needs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));

-- ---------------------------------------------------------------------
-- 7. ASSIGNMENTS (lab ⇄ batch, with confirm/deny + Ops schedule)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  need_id uuid REFERENCES public.batch_needs(id) ON DELETE SET NULL,
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  status public.assignment_status NOT NULL DEFAULT 'pending',
  confirmed_price numeric(10,2),
  sessions_per_day int NOT NULL DEFAULT 1,
  days int NOT NULL DEFAULT 1,
  time_slots text[] NOT NULL DEFAULT '{}',
  denied_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, lab_id)
);
CREATE INDEX IF NOT EXISTS assignments_batch_idx ON public.assignments (batch_id);
CREATE INDEX IF NOT EXISTS assignments_lab_idx ON public.assignments (lab_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
GRANT ALL ON public.assignments TO service_role;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asg_select ON public.assignments;
CREATE POLICY asg_select ON public.assignments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS asg_write ON public.assignments;
CREATE POLICY asg_write ON public.assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
DROP TRIGGER IF EXISTS trg_asg_updated ON public.assignments;
CREATE TRIGGER trg_asg_updated BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reservation helper: is a lab already held (pending/confirmed) on any of these dates?
CREATE OR REPLACE FUNCTION public.lab_is_reserved(_lab_id uuid, _dates date[], _exclude_batch uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.batches b ON b.id = a.batch_id
    WHERE a.lab_id = _lab_id
      AND a.status IN ('pending','confirmed')
      AND (_exclude_batch IS NULL OR b.id <> _exclude_batch)
      AND b.dates && _dates            -- array overlap
  );
$$;

-- ---------------------------------------------------------------------
-- 8. CATERING LINES (one sandwich + one water row per assignment)
--    lab_total is computed: ((students + 3) * sessions + extra_qty) * unit_price + extra_fee
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catering_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  type public.catering_type NOT NULL,
  provider text,
  students int NOT NULL DEFAULT 0,
  sessions int NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  extra_qty int NOT NULL DEFAULT 0,
  extra_fee numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  lab_total numeric(12,2) GENERATED ALWAYS AS
    (((students + 3) * sessions + extra_qty) * unit_price + extra_fee) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, type)
);
CREATE INDEX IF NOT EXISTS catering_lines_assignment_idx ON public.catering_lines (assignment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_lines TO authenticated;
GRANT ALL ON public.catering_lines TO service_role;
ALTER TABLE public.catering_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cl_select ON public.catering_lines;
CREATE POLICY cl_select ON public.catering_lines FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS cl_write ON public.catering_lines;
CREATE POLICY cl_write ON public.catering_lines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
DROP TRIGGER IF EXISTS trg_cl_updated ON public.catering_lines;
CREATE TRIGGER trg_cl_updated BEFORE UPDATE ON public.catering_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 9. TIMELINE OVERRIDES (manual edits that win over auto-derived dates)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timeline_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id) ON DELETE CASCADE,
  label text,
  event_date date NOT NULL,
  kind text NOT NULL DEFAULT 'physical',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_overrides_project_idx ON public.timeline_overrides (project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeline_overrides TO authenticated;
GRANT ALL ON public.timeline_overrides TO service_role;
ALTER TABLE public.timeline_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS to_select ON public.timeline_overrides;
CREATE POLICY to_select ON public.timeline_overrides FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS to_write ON public.timeline_overrides;
CREATE POLICY to_write ON public.timeline_overrides FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
DROP TRIGGER IF EXISTS trg_to_updated ON public.timeline_overrides;
CREATE TRIGGER trg_to_updated BEFORE UPDATE ON public.timeline_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 10. BUDGET VIEWS (EGP) — per batch, per project, per intake
--     lab_cost   = Σ confirmed assignments: confirmed_price × sessions_per_day × days
--     catering   = Σ catering_lines.lab_total (split sandwich/water)
-- ---------------------------------------------------------------------
-- Drop dependents first (intake depends on project) so re-runs are safe
DROP VIEW IF EXISTS public.intake_budget_view;
DROP VIEW IF EXISTS public.batch_budget_view;
DROP VIEW IF EXISTS public.project_budget_view;

CREATE VIEW public.batch_budget_view WITH (security_invoker = true) AS
WITH lab AS (
  SELECT a.batch_id,
         COALESCE(SUM(COALESCE(a.confirmed_price,0) * a.sessions_per_day * a.days),0) AS lab_cost
  FROM public.assignments a
  WHERE a.status = 'confirmed'
  GROUP BY a.batch_id
),
cat AS (
  SELECT a.batch_id,
         COALESCE(SUM(CASE WHEN cl.type='sandwich' THEN cl.lab_total ELSE 0 END),0) AS sandwich_cost,
         COALESCE(SUM(CASE WHEN cl.type='water'    THEN cl.lab_total ELSE 0 END),0) AS water_cost
  FROM public.catering_lines cl
  JOIN public.assignments a ON a.id = cl.assignment_id
  GROUP BY a.batch_id
)
SELECT b.id AS batch_id,
       b.project_id,
       b.name AS batch_name,
       b.status,
       COALESCE(l.lab_cost,0)       AS lab_cost,
       COALESCE(c.sandwich_cost,0)  AS sandwich_cost,
       COALESCE(c.water_cost,0)     AS water_cost,
       COALESCE(c.sandwich_cost,0) + COALESCE(c.water_cost,0) AS catering_cost,
       COALESCE(l.lab_cost,0) + COALESCE(c.sandwich_cost,0) + COALESCE(c.water_cost,0) AS total_cost
FROM public.batches b
LEFT JOIN lab l ON l.batch_id = b.id
LEFT JOIN cat c ON c.batch_id = b.id;
GRANT SELECT ON public.batch_budget_view TO authenticated;

CREATE VIEW public.project_budget_view WITH (security_invoker = true) AS
WITH lab AS (
  SELECT b.project_id,
         COALESCE(SUM(COALESCE(a.confirmed_price,0) * a.sessions_per_day * a.days),0) AS lab_cost
  FROM public.assignments a
  JOIN public.batches b ON b.id = a.batch_id
  WHERE a.status = 'confirmed'
  GROUP BY b.project_id
),
cat AS (
  SELECT b.project_id,
         COALESCE(SUM(CASE WHEN cl.type='sandwich' THEN cl.lab_total ELSE 0 END),0) AS sandwich_cost,
         COALESCE(SUM(CASE WHEN cl.type='water'    THEN cl.lab_total ELSE 0 END),0) AS water_cost
  FROM public.catering_lines cl
  JOIN public.assignments a ON a.id = cl.assignment_id
  JOIN public.batches b ON b.id = a.batch_id
  GROUP BY b.project_id
),
extras AS (
  SELECT project_id, COALESCE(SUM(amount),0) AS extras_cost
  FROM public.project_extra_costs
  GROUP BY project_id
)
SELECT p.id AS project_id,
       p.name,
       p.client,
       p.status,
       p.program,
       p.intake_label,
       COALESCE(l.lab_cost,0)                                   AS lab_cost,
       COALESCE(c.sandwich_cost,0)                              AS sandwich_cost,
       COALESCE(c.water_cost,0)                                 AS water_cost,
       COALESCE(c.sandwich_cost,0) + COALESCE(c.water_cost,0)   AS catering_cost,
       COALESCE(e.extras_cost,0)                                AS extras_cost,
       COALESCE(l.lab_cost,0) + COALESCE(c.sandwich_cost,0) + COALESCE(c.water_cost,0) + COALESCE(e.extras_cost,0) AS total_cost
FROM public.projects p
LEFT JOIN lab l    ON l.project_id = p.id
LEFT JOIN cat c    ON c.project_id = p.id
LEFT JOIN extras e ON e.project_id = p.id;
GRANT SELECT ON public.project_budget_view TO authenticated;

CREATE VIEW public.intake_budget_view WITH (security_invoker = true) AS
SELECT COALESCE(program::text, 'Unassigned') AS intake,
       SUM(lab_cost)      AS lab_cost,
       SUM(sandwich_cost) AS sandwich_cost,
       SUM(water_cost)    AS water_cost,
       SUM(catering_cost) AS catering_cost,
       SUM(extras_cost)   AS extras_cost,
       SUM(total_cost)    AS total_cost
FROM public.project_budget_view
GROUP BY COALESCE(program::text, 'Unassigned');
GRANT SELECT ON public.intake_budget_view TO authenticated;

-- =====================================================================
-- End of migration.
-- =====================================================================
