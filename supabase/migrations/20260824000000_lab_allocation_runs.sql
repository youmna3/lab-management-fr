-- =====================================================================
-- Lab Allocation Runs — persist allocation runs, metrics, and summaries
-- Additive + idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lab_allocation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  file_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  unallocated_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lab_allocation_runs_created_at_idx
  ON public.lab_allocation_runs (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_allocation_runs TO authenticated;
GRANT ALL ON public.lab_allocation_runs TO service_role;

ALTER TABLE public.lab_allocation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lar_select ON public.lab_allocation_runs;
CREATE POLICY lar_select ON public.lab_allocation_runs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS lar_write ON public.lab_allocation_runs;
CREATE POLICY lar_write ON public.lab_allocation_runs
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
