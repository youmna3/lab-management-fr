-- ============================================================================
-- Migration: 20260902180000_batch_group_classifications.sql
-- Description: Stores Group ID classifications (Single-Visit vs Multi-Visit) per batch
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.batch_group_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL,
  project_id TEXT,
  group_id TEXT NOT NULL,
  visit_type TEXT NOT NULL DEFAULT 'single_visit' CHECK (visit_type IN ('single_visit', 'multi_visit')),
  repeat_count INT NOT NULL DEFAULT 1 CHECK (repeat_count >= 1),
  area TEXT,
  grade TEXT,
  student_count INT DEFAULT 0,
  lab_id TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_name TEXT,
  CONSTRAINT uq_batch_group_classification UNIQUE (batch_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_group_classifications_batch_id 
  ON public.batch_group_classifications(batch_id);

CREATE INDEX IF NOT EXISTS idx_batch_group_classifications_project_id 
  ON public.batch_group_classifications(project_id);

ALTER TABLE public.batch_group_classifications ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.batch_group_classifications TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Allow all access to batch_group_classifications" ON public.batch_group_classifications;
CREATE POLICY "Allow all access to batch_group_classifications"
  ON public.batch_group_classifications FOR ALL
  USING (true)
  WITH CHECK (true);
