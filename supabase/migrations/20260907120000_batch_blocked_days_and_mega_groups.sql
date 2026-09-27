-- ============================================================================
-- Migration: 20260907120000_batch_blocked_days_and_mega_groups.sql
-- Description: Adds blocked_days, mega_groups, and group_distribution_mode to batches
-- ============================================================================

-- 1. Alter batches table with new columns
ALTER TABLE public.batches 
  ADD COLUMN IF NOT EXISTS group_distribution_mode TEXT NOT NULL DEFAULT 'single_session',
  ADD COLUMN IF NOT EXISTS blocked_days text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS mega_groups jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.batches.group_distribution_mode IS 'Batch-level group type: single_session or multi_session';
COMMENT ON COLUMN public.batches.blocked_days IS 'Specific calendar dates (YYYY-MM-DD) or day names excluded entirely from scheduling for this batch';
COMMENT ON COLUMN public.batches.mega_groups IS 'Array of mega-group sub-batch definitions with their own time windows and student assignments';

-- 2. Optional relational table for normalized mega-group sub-batches
CREATE TABLE IF NOT EXISTS public.batch_mega_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  dates TEXT[] DEFAULT '{}'::TEXT[],
  time_slots TEXT[] DEFAULT '{}'::TEXT[],
  target_grades INT[] DEFAULT '{}'::INT[],
  target_areas TEXT[] DEFAULT '{}'::TEXT[],
  student_ids TEXT[] DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_mega_groups_batch_id 
  ON public.batch_mega_groups(batch_id);

ALTER TABLE public.batch_mega_groups ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.batch_mega_groups TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Allow all access to batch_mega_groups" ON public.batch_mega_groups;
CREATE POLICY "Allow all access to batch_mega_groups"
  ON public.batch_mega_groups FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
