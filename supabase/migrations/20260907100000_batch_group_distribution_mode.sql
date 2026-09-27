-- ============================================================================
-- Migration: 20260907100000_batch_group_distribution_mode.sql
-- Description: Adds group_distribution_mode to batches for Multi-Session Weekly Distribution
-- ============================================================================

ALTER TABLE public.batches 
  ADD COLUMN IF NOT EXISTS group_distribution_mode TEXT NOT NULL DEFAULT 'single_session';

-- Add comment describing valid values ('single_session', 'multi_session')
COMMENT ON COLUMN public.batches.group_distribution_mode IS 'Batch-level group type: single_session (Single-Session Group / SG) or multi_session (Multi-Session Weekly Distribution)';
