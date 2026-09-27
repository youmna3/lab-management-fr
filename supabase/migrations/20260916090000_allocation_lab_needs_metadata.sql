-- Allocation-backed operational lab needs reuse the existing needs, assignments,
-- and normalized assignment session tables. Manual rows remain the default.

ALTER TABLE public.batch_needs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS allocation_run_id text,
  ADD COLUMN IF NOT EXISTS is_current_allocation boolean NOT NULL DEFAULT false;

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS allocation_run_id text,
  ADD COLUMN IF NOT EXISTS is_current_allocation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS replaces_assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS batch_needs_allocation_current_idx
  ON public.batch_needs (batch_id, is_current_allocation)
  WHERE source = 'allocation';

CREATE INDEX IF NOT EXISTS assignments_allocation_current_idx
  ON public.assignments (batch_id, is_current_allocation)
  WHERE source = 'allocation';

ALTER TABLE public.assignment_sessions
  DROP CONSTRAINT IF EXISTS assignment_sessions_source_check;
ALTER TABLE public.assignment_sessions
  ADD CONSTRAINT assignment_sessions_source_check
  CHECK (source IN ('manual', 'import', 'allocation', 'replacement'));
