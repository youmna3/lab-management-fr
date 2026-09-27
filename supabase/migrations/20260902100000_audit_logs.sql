-- ============================================================================
-- Migration: 20260902100000_audit_logs.sql
-- Description: Centralized Audit Trail / Activity Logging across entire dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID,
  user_name TEXT NOT NULL DEFAULT 'System',
  user_email TEXT,
  user_role TEXT NOT NULL DEFAULT 'User',
  tab TEXT NOT NULL,
  section TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'ALLOCATION_RUN', 'RESTORE', 'APPROVE', 'REJECT', 'RESOLVE', 'OUTREACH'
  action_title TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'student', 'resolution_request', 'batch', 'project', 'lab', 'incident', 'survey', 'allocation_run', 'vendor'
  entity_id TEXT NOT NULL,
  project_id TEXT,
  batch_id TEXT,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_restorable BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tab ON public.audit_logs(tab);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON public.audit_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_batch_id ON public.audit_logs(batch_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.audit_logs TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Allow all access to audit_logs" ON public.audit_logs;
CREATE POLICY "Allow all access to audit_logs"
  ON public.audit_logs FOR ALL
  USING (true)
  WITH CHECK (true);
