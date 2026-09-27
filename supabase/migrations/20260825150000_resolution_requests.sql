-- Migration: Batch Resolution Requests (Event Team & CS Team Requests)
-- Supports Overfill Requests, New Lab Requests, and CS Student Outreach

CREATE TABLE IF NOT EXISTS public.batch_resolution_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for instant batch queries
CREATE INDEX IF NOT EXISTS idx_batch_resolution_requests_batch_id ON public.batch_resolution_requests(batch_id);

-- Enable RLS
ALTER TABLE public.batch_resolution_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'batch_resolution_requests' AND policyname = 'Allow all access to batch_resolution_requests'
  ) THEN
    CREATE POLICY "Allow all access to batch_resolution_requests"
      ON public.batch_resolution_requests
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
