-- ============================================================================
-- Migration: 20260901190000_user_request_notifications.sql
-- Description: Stores per-user notification read/seen states for Operation Requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_request_notifications (
  user_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  seen_status TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_user_request_notifications_user_id ON public.user_request_notifications(user_id);

ALTER TABLE public.user_request_notifications ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.user_request_notifications TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Allow all access to user_request_notifications" ON public.user_request_notifications;
CREATE POLICY "Allow all access to user_request_notifications"
  ON public.user_request_notifications FOR ALL
  USING (true)
  WITH CHECK (true);
