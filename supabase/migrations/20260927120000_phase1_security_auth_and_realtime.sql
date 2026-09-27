-- Replace permissive/anonymous access with application-role policies, remove
-- first-user administrator bootstrap, and publish the tables consumed by the UI.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Administrators are provisioned explicitly after an invited user exists.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lab_manager')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Historical hardening revoked PUBLIC execution on has_role but did not grant
-- it back to authenticated. RLS policies execute as the caller and require it.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Remove every historical policy on the tables that were previously opened by
-- unconditional policies. Recreate only the reviewed role matrix below.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'batch_student_uploads',
        'batch_allocation_outputs',
        'batch_resolution_requests',
        'user_request_notifications',
        'audit_logs',
        'role_navigation_permissions',
        'batch_group_classifications',
        'batch_mega_groups'
      ])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END;
$$;

REVOKE ALL ON public.batch_student_uploads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.batch_allocation_outputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.batch_resolution_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_request_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.role_navigation_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.batch_group_classifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.batch_mega_groups FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_student_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_allocation_outputs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_resolution_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_request_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_navigation_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_group_classifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_mega_groups TO authenticated;

GRANT ALL ON public.batch_student_uploads TO service_role;
GRANT ALL ON public.batch_allocation_outputs TO service_role;
GRANT ALL ON public.batch_resolution_requests TO service_role;
GRANT ALL ON public.user_request_notifications TO service_role;
GRANT ALL ON public.audit_logs TO service_role;
GRANT ALL ON public.role_navigation_permissions TO service_role;
GRANT ALL ON public.batch_group_classifications TO service_role;
GRANT ALL ON public.batch_mega_groups TO service_role;

CREATE POLICY batch_student_uploads_read_roles ON public.batch_student_uploads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_student_uploads_write_roles ON public.batch_student_uploads
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

CREATE POLICY batch_allocation_outputs_read_roles ON public.batch_allocation_outputs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_allocation_outputs_insert_ops ON public.batch_allocation_outputs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_allocation_outputs_update_ops ON public.batch_allocation_outputs
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_allocation_outputs_delete_ops ON public.batch_allocation_outputs
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

CREATE POLICY batch_resolution_requests_read_roles ON public.batch_resolution_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_resolution_requests_create_ops ON public.batch_resolution_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_resolution_requests_review_roles ON public.batch_resolution_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_resolution_requests_delete_admin ON public.batch_resolution_requests
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administration'));

CREATE OR REPLACE FUNCTION public.enforce_resolution_request_responsibilities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR public.has_role(auth.uid(), 'administration') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_role(auth.uid(), 'operations') THEN
      RAISE EXCEPTION 'Operations permission is required to create resolution requests'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Resolution requests must be reviewed after creation'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'lab_manager') THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'operations') THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Lab Manager/Event Team or administrator approval is required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Resolution request permission is required' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_resolution_request_responsibilities ON public.batch_resolution_requests;
CREATE TRIGGER trg_resolution_request_responsibilities
BEFORE INSERT OR UPDATE ON public.batch_resolution_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_resolution_request_responsibilities();
REVOKE EXECUTE ON FUNCTION public.enforce_resolution_request_responsibilities()
  FROM PUBLIC, anon, authenticated;

CREATE POLICY user_request_notifications_own ON public.user_request_notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'administration'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'administration'));

CREATE POLICY audit_logs_read_reviewers ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY audit_logs_insert_own ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY audit_logs_update_admin ON public.audit_logs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administration'))
  WITH CHECK (public.has_role(auth.uid(), 'administration'));
CREATE POLICY audit_logs_delete_admin ON public.audit_logs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administration'));

CREATE POLICY role_navigation_permissions_read_authenticated ON public.role_navigation_permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY role_navigation_permissions_write_admin ON public.role_navigation_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'administration'))
  WITH CHECK (public.has_role(auth.uid(), 'administration'));

CREATE POLICY batch_group_classifications_read_roles ON public.batch_group_classifications
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_group_classifications_write_ops ON public.batch_group_classifications
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

CREATE POLICY batch_mega_groups_read_roles ON public.batch_mega_groups
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );
CREATE POLICY batch_mega_groups_write_ops ON public.batch_mega_groups
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  );

-- The catering table already has the correct Operations/Finance/Admin RLS
-- policy; its missing table privileges made that policy unreachable.
REVOKE ALL ON public.catering_providers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_providers TO authenticated;
GRANT ALL ON public.catering_providers TO service_role;

-- Storage follows the same role boundaries as its metadata tables.
DROP POLICY IF EXISTS "Authenticated users read project student rosters" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users create project student rosters" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users delete project student rosters" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role read project student rosters" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role create project student rosters" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role delete project student rosters" ON storage.objects;

CREATE POLICY "Phase 1 role read project student rosters"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-student-rosters'
  AND (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);
CREATE POLICY "Phase 1 role create project student rosters"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-student-rosters'
  AND (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);
CREATE POLICY "Phase 1 role delete project student rosters"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-student-rosters'
  AND (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);

DROP POLICY IF EXISTS "Authenticated users read allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users create allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users update allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users delete allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role read allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role create allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role update allocation results" ON storage.objects;
DROP POLICY IF EXISTS "Phase 1 role delete allocation results" ON storage.objects;

CREATE POLICY "Phase 1 role read allocation results"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'allocation-results'
  AND (
    public.has_role(auth.uid(), 'lab_manager')
    OR public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);
CREATE POLICY "Phase 1 role create allocation results"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'allocation-results'
  AND (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);
CREATE POLICY "Phase 1 role update allocation results"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'allocation-results'
  AND (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
)
WITH CHECK (
  bucket_id = 'allocation-results'
  AND (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);
CREATE POLICY "Phase 1 role delete allocation results"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'allocation-results'
  AND (
    public.has_role(auth.uid(), 'operations')
    OR public.has_role(auth.uid(), 'administration')
  )
);

DO $$
DECLARE
  table_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'CREATE PUBLICATION supabase_realtime';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'batch_resolution_requests',
    'audit_logs',
    'role_navigation_permissions',
    'batch_allocation_outputs'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
