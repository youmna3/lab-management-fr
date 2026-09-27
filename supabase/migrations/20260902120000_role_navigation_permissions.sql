-- ============================================================================
-- Migration: 20260902120000_role_navigation_permissions.sql
-- Description: Dynamic Role-Based Navigation & Route Access Control Matrix
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.role_navigation_permissions (
  role TEXT NOT NULL, -- 'lab_manager', 'operations', 'finance', 'administration'
  tab_key TEXT NOT NULL, -- '/dashboard', '/lab-data', '/lab-allocation', '/operation-requests', '/quality', '/projects', '/exports', '/timeline', '/catering', '/budget', '/users'
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'System',
  PRIMARY KEY (role, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_role_nav_permissions_role ON public.role_navigation_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_nav_permissions_tab ON public.role_navigation_permissions(tab_key);

ALTER TABLE public.role_navigation_permissions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.role_navigation_permissions TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Allow all access to role_navigation_permissions" ON public.role_navigation_permissions;
CREATE POLICY "Allow all access to role_navigation_permissions"
  ON public.role_navigation_permissions FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed Default Baseline Permissions Matrix
-- (Explicitly: lab_manager has /lab-allocation DISABLED by default)
INSERT INTO public.role_navigation_permissions (role, tab_key, is_enabled, updated_by)
VALUES
  -- 1. Administration (Full Access)
  ('administration', '/dashboard', true, 'System Seed'),
  ('administration', '/lab-data', true, 'System Seed'),
  ('administration', '/lab-allocation', true, 'System Seed'),
  ('administration', '/operation-requests', true, 'System Seed'),
  ('administration', '/quality', true, 'System Seed'),
  ('administration', '/projects', true, 'System Seed'),
  ('administration', '/exports', true, 'System Seed'),
  ('administration', '/timeline', true, 'System Seed'),
  ('administration', '/catering', true, 'System Seed'),
  ('administration', '/budget', true, 'System Seed'),
  ('administration', '/users', true, 'System Seed'),

  -- 2. Operations
  ('operations', '/dashboard', true, 'System Seed'),
  ('operations', '/lab-data', false, 'System Seed'),
  ('operations', '/lab-allocation', true, 'System Seed'),
  ('operations', '/operation-requests', true, 'System Seed'),
  ('operations', '/quality', true, 'System Seed'),
  ('operations', '/projects', true, 'System Seed'),
  ('operations', '/exports', true, 'System Seed'),
  ('operations', '/timeline', true, 'System Seed'),
  ('operations', '/catering', true, 'System Seed'),
  ('operations', '/budget', false, 'System Seed'),
  ('operations', '/users', false, 'System Seed'),

  -- 3. Lab Manager (RESTRICTED FROM LAB ALLOCATION)
  ('lab_manager', '/dashboard', true, 'System Seed'),
  ('lab_manager', '/lab-data', true, 'System Seed'),
  ('lab_manager', '/lab-allocation', false, 'System Seed'), -- STRICTLY RESTRICTED BY DEFAULT
  ('lab_manager', '/operation-requests', true, 'System Seed'),
  ('lab_manager', '/quality', true, 'System Seed'),
  ('lab_manager', '/projects', true, 'System Seed'),
  ('lab_manager', '/exports', true, 'System Seed'),
  ('lab_manager', '/timeline', true, 'System Seed'),
  ('lab_manager', '/catering', false, 'System Seed'),
  ('lab_manager', '/budget', false, 'System Seed'),
  ('lab_manager', '/users', false, 'System Seed'),

  -- 4. Finance
  ('finance', '/dashboard', true, 'System Seed'),
  ('finance', '/lab-data', false, 'System Seed'),
  ('finance', '/lab-allocation', false, 'System Seed'),
  ('finance', '/operation-requests', false, 'System Seed'),
  ('finance', '/quality', true, 'System Seed'),
  ('finance', '/projects', false, 'System Seed'),
  ('finance', '/exports', true, 'System Seed'),
  ('finance', '/timeline', true, 'System Seed'),
  ('finance', '/catering', true, 'System Seed'),
  ('finance', '/budget', true, 'System Seed'),
  ('finance', '/users', false, 'System Seed')
ON CONFLICT (role, tab_key) DO UPDATE
SET is_enabled = EXCLUDED.is_enabled,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by;
