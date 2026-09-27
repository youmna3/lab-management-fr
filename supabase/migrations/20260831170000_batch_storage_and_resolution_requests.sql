-- =============================================================================
-- Migration: Batch Student Uploads, Allocation Outputs & Operation Requests
-- Purpose: Provides shared, multi-user cloud persistence in Supabase
-- Target Tables: batch_student_uploads, batch_allocation_outputs, batch_resolution_requests
-- =============================================================================

-- 1. Table: batch_student_uploads
-- Stores the uploaded student roster per batch (shared across all users)
CREATE TABLE IF NOT EXISTS public.batch_student_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  batch_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  student_count INT NOT NULL DEFAULT 0,
  students JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table: batch_allocation_outputs
-- Stores the optimization solver results, master allocations, and visual metrics
CREATE TABLE IF NOT EXISTS public.batch_allocation_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  batch_id TEXT NOT NULL UNIQUE,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  dashboard_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  area_grade_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  master_allocation JSONB NOT NULL DEFAULT '[]'::jsonb,
  lab_pivot JSONB NOT NULL DEFAULT '[]'::jsonb,
  lab_allocation JSONB NOT NULL DEFAULT '[]'::jsonb,
  unassigned_students JSONB NOT NULL DEFAULT '[]'::jsonb,
  shortfall_math JSONB NOT NULL DEFAULT '[]'::jsonb,
  overfill_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  shortfall_text TEXT DEFAULT '',
  preferences_applied JSONB NOT NULL DEFAULT '{"overfillRules":[],"preferredLabRules":[],"extraLabs":[]}'::jsonb,
  logs TEXT[] NOT NULL DEFAULT '{}'::text[],
  generated_files JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Table: batch_resolution_requests
-- Stores operational tickets, approvals, and solver re-run audits
CREATE TABLE IF NOT EXISTS public.batch_resolution_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  batch_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('overfill', 'new_lab', 'cs_outreach')),
  target_team TEXT NOT NULL CHECK (target_team IN ('Event Team', 'CS Team')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'in_progress', 'contacted', 'resolved')),
  area TEXT NOT NULL,
  grades INT[] NOT NULL DEFAULT '{4,5,6}'::int[],
  unassigned_count INT DEFAULT 0,
  lab_id TEXT,
  max_overfill_per_lab INT DEFAULT 2,
  requested_capacity INT,
  time_slot_num INT,
  reason TEXT,
  suggested_nearest_lab TEXT,
  suggested_nearest_area TEXT,
  notes TEXT,
  submitted_by_name TEXT,
  submitted_by_role TEXT,
  reviewed_by_name TEXT,
  reviewed_by_role TEXT,
  solver_rerun_at TIMESTAMPTZ,
  reviewer_comment TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure columns exist if table was already created
ALTER TABLE public.batch_resolution_requests ADD COLUMN IF NOT EXISTS reviewer_comment TEXT;
ALTER TABLE public.batch_resolution_requests ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Drop strict foreign key constraints if present to allow standalone & dynamic batches
ALTER TABLE public.batch_student_uploads DROP CONSTRAINT IF EXISTS batch_student_uploads_batch_id_fkey;
ALTER TABLE public.batch_student_uploads DROP CONSTRAINT IF EXISTS batch_student_uploads_project_id_fkey;
ALTER TABLE public.batch_allocation_outputs DROP CONSTRAINT IF EXISTS batch_allocation_outputs_batch_id_fkey;
ALTER TABLE public.batch_allocation_outputs DROP CONSTRAINT IF EXISTS batch_allocation_outputs_project_id_fkey;
ALTER TABLE public.batch_resolution_requests DROP CONSTRAINT IF EXISTS batch_resolution_requests_batch_id_fkey;
ALTER TABLE public.batch_resolution_requests DROP CONSTRAINT IF EXISTS batch_resolution_requests_project_id_fkey;

-- 4. Fast Query Indexes
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_batch_id ON public.batch_student_uploads(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_project_id ON public.batch_student_uploads(project_id);
CREATE INDEX IF NOT EXISTS idx_batch_allocation_outputs_batch_id ON public.batch_allocation_outputs(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_allocation_outputs_project_id ON public.batch_allocation_outputs(project_id);
CREATE INDEX IF NOT EXISTS idx_batch_resolution_requests_batch_id ON public.batch_resolution_requests(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_resolution_requests_status ON public.batch_resolution_requests(status);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.batch_student_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_allocation_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_resolution_requests ENABLE ROW LEVEL SECURITY;

-- 6. Role Grants
GRANT ALL ON public.batch_student_uploads TO authenticated, anon, service_role;
GRANT ALL ON public.batch_allocation_outputs TO authenticated, anon, service_role;
GRANT ALL ON public.batch_resolution_requests TO authenticated, anon, service_role;

-- 7. Policies: Allow access for all authenticated & authorized users
DROP POLICY IF EXISTS "Allow all access to batch_student_uploads" ON public.batch_student_uploads;
CREATE POLICY "Allow all access to batch_student_uploads"
  ON public.batch_student_uploads FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to batch_allocation_outputs" ON public.batch_allocation_outputs;
CREATE POLICY "Allow all access to batch_allocation_outputs"
  ON public.batch_allocation_outputs FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to batch_resolution_requests" ON public.batch_resolution_requests;
CREATE POLICY "Allow all access to batch_resolution_requests"
  ON public.batch_resolution_requests FOR ALL
  USING (true)
  WITH CHECK (true);
