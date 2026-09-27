-- =====================================================================
-- Add score_history JSONB column to public.lab_quality
-- Tracks historical technical audit scores: [{ score, assessed_at, assessed_by, notes }]
-- =====================================================================
ALTER TABLE public.lab_quality
  ADD COLUMN IF NOT EXISTS score_history jsonb NOT NULL DEFAULT '[]'::jsonb;
