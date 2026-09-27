-- Migration: Persist Batch Student Uploads and Allocation Outputs
-- Designed for production on Lovable Cloud / Supabase

-- 1. batch_student_uploads table
CREATE TABLE IF NOT EXISTS public.batch_student_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL UNIQUE REFERENCES public.batches(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  student_count INT NOT NULL DEFAULT 0,
  students JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. batch_allocation_outputs table
CREATE TABLE IF NOT EXISTS public.batch_allocation_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL UNIQUE REFERENCES public.batches(id) ON DELETE CASCADE,
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

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_batch_student_uploads_batch_id ON public.batch_student_uploads(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_allocation_outputs_batch_id ON public.batch_allocation_outputs(batch_id);

-- Enable RLS
ALTER TABLE public.batch_student_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_allocation_outputs ENABLE ROW LEVEL SECURITY;

-- Policies for batch_student_uploads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'batch_student_uploads' AND policyname = 'Allow all access to batch_student_uploads'
  ) THEN
    CREATE POLICY "Allow all access to batch_student_uploads"
      ON public.batch_student_uploads
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Policies for batch_allocation_outputs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'batch_allocation_outputs' AND policyname = 'Allow all access to batch_allocation_outputs'
  ) THEN
    CREATE POLICY "Allow all access to batch_allocation_outputs"
      ON public.batch_allocation_outputs
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
