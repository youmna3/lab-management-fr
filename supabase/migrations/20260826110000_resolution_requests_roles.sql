-- Migration: Add Submitter & Reviewer Tracking to Batch Resolution Requests
-- Enables role-gated audit trails for Fair Overfill, New Lab, and CS Outreach requests

ALTER TABLE public.batch_resolution_requests 
ADD COLUMN IF NOT EXISTS submitted_by_name TEXT,
ADD COLUMN IF NOT EXISTS submitted_by_role TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by_role TEXT,
ADD COLUMN IF NOT EXISTS solver_rerun_at TIMESTAMPTZ;
