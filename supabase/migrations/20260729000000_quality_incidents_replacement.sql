-- =====================================================================
-- iSchool B2G — Quality, Lab Incidents, Post-Usage Surveys & Lab Replacement
-- Additive + Idempotent Schema Migration
-- =====================================================================

-- 1. Extend labs table with status and replacement columns
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS replaced_by_lab_id uuid REFERENCES public.labs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labs_status_chk') THEN
    ALTER TABLE public.labs
      ADD CONSTRAINT labs_status_chk CHECK (status IN ('active','suspended','deactivated','replaced'));
  END IF;
END $$;

-- 2. Create lab_incidents table
CREATE TABLE IF NOT EXISTS public.lab_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('pc','internet','ac','cleanliness','facility','supervisor','other')),
  description text,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lab_incidents_lab_idx ON public.lab_incidents (lab_id);
CREATE INDEX IF NOT EXISTS lab_incidents_batch_idx ON public.lab_incidents (batch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_incidents TO authenticated;
GRANT ALL ON public.lab_incidents TO service_role;
ALTER TABLE public.lab_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS li_select ON public.lab_incidents;
CREATE POLICY li_select ON public.lab_incidents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS li_write ON public.lab_incidents;
CREATE POLICY li_write ON public.lab_incidents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));

-- 3. Create lab_post_surveys table
CREATE TABLE IF NOT EXISTS public.lab_post_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  overall_rating smallint NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  pc_rating smallint CHECK (pc_rating BETWEEN 1 AND 5),
  internet_rating smallint CHECK (internet_rating BETWEEN 1 AND 5),
  cleanliness_rating smallint CHECK (cleanliness_rating BETWEEN 1 AND 5),
  facilities_rating smallint CHECK (facilities_rating BETWEEN 1 AND 5),
  feedback text,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lab_post_surveys_lab_idx ON public.lab_post_surveys (lab_id);
CREATE INDEX IF NOT EXISTS lab_post_surveys_batch_idx ON public.lab_post_surveys (batch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_post_surveys TO authenticated;
GRANT ALL ON public.lab_post_surveys TO service_role;
ALTER TABLE public.lab_post_surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lps_select ON public.lab_post_surveys;
CREATE POLICY lps_select ON public.lab_post_surveys FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS lps_write ON public.lab_post_surveys;
CREATE POLICY lps_write ON public.lab_post_surveys FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
