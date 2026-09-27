-- Run after a clean local migration replay:
--   supabase db reset
--   supabase test db supabase/tests/phase1_database_repair.sql
-- The entire test is rolled back and leaves no fixtures behind.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', message;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- Schema, grants, functions, migration convergence, and Realtime.
-- --------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  (SELECT count(*) = 6
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'batch_allocation_outputs'
     AND column_name = ANY (ARRAY[
       'run_id', 'revision', 'updated_by', 'allocation_owner',
       'allocation_owner_email', 'created_by'
     ])),
  'all six allocation metadata columns must exist'
);

SELECT pg_temp.assert_true(
  (SELECT column_default LIKE '%1%'
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'batch_allocation_outputs'
     AND column_name = 'revision'),
  'allocation revision must default to 1'
);

SELECT pg_temp.assert_true(to_regclass('public.batch_vp_state') IS NOT NULL, 'batch_vp_state must exist');
SELECT pg_temp.assert_true(to_regprocedure('public.get_batch_vp_state(uuid)') IS NOT NULL, 'VP read RPC must exist');
SELECT pg_temp.assert_true(
  to_regprocedure('public.bulk_update_batch_vp_state(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL,
  'VP bulk update RPC must exist'
);
SELECT pg_temp.assert_true(
  to_regprocedure('public.save_batch_allocation_output_if_revision(uuid,uuid,jsonb,jsonb,text,text,bigint,text)') IS NOT NULL,
  'optimistic allocation save RPC must exist'
);
SELECT pg_temp.assert_true(
  to_regprocedure('public.decide_nearby_lab_request(uuid,text,text,text,text)') IS NOT NULL,
  'nearby decision RPC must exist'
);
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'batch_student_uploads' AND column_name = 'storage_path'),
  'duplicate-history reconciliation must include roster metadata'
);
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'batch_resolution_requests' AND column_name = 'nearby_lab_metadata'),
  'duplicate-history reconciliation must include nearby metadata'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.batch_allocation_outputs', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.batch_resolution_requests', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.audit_logs', 'SELECT'),
  'anonymous table access must be revoked'
);
SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.catering_providers', 'SELECT')
  AND has_table_privilege('authenticated', 'public.catering_providers', 'INSERT')
  AND has_table_privilege('authenticated', 'public.catering_providers', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.catering_providers', 'DELETE'),
  'authenticated must have table grants needed for catering RLS'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 4
   FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename = ANY (ARRAY[
       'batch_resolution_requests', 'audit_logs',
       'role_navigation_permissions', 'batch_allocation_outputs'
     ])),
  'all four frontend Realtime tables must be published'
);

-- The new-user trigger must not contain an automatic administration grant.
SELECT pg_temp.assert_true(
  position('VALUES (NEW.id, ''administration'')' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0,
  'new-user trigger must not bootstrap an administrator'
);

-- --------------------------------------------------------------------------
-- Users and base records.
-- --------------------------------------------------------------------------
INSERT INTO auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'ops1@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'ops2@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'reviewer@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000004', 'admin@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000005', 'finance@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now());

SELECT pg_temp.assert_true(
  (SELECT count(*) = 5 FROM public.user_roles
   WHERE user_id::text LIKE '10000000-%' AND role = 'lab_manager'),
  'all newly created users must default to lab_manager'
);

DELETE FROM public.user_roles
WHERE user_id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'operations'),
  ('10000000-0000-4000-8000-000000000002', 'operations'),
  ('10000000-0000-4000-8000-000000000004', 'administration'),
  ('10000000-0000-4000-8000-000000000005', 'finance');

INSERT INTO public.projects (id, name)
VALUES ('20000000-0000-4000-8000-000000000001', 'Phase 1 Test Project');
INSERT INTO public.batches (id, project_id, name, dates, time_slots)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Phase 1 Test Batch',
  ARRAY['2026-10-10'::date, '2026-10-11'::date],
  ARRAY['09:00', '13:00']
);
INSERT INTO public.labs (id, name, lab_code, capacity)
VALUES ('40000000-0000-4000-8000-000000000001', 'Phase 1 Test Lab', 'PHASE1-LAB', 30);

-- --------------------------------------------------------------------------
-- Shared Operations allocation writes, revision increments, owner audit, CAS.
-- --------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","email":"ops1@example.test"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.batch_allocation_outputs (
  batch_id, project_id, summary, preferences_applied,
  allocation_storage_path, run_id, updated_by,
  allocation_owner, allocation_owner_email, created_by
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '{"total_students":10}'::jsonb,
  '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001/run-1.json',
  'run-1',
  'ops1@example.test',
  '10000000-0000-4000-8000-000000000001',
  'ops1@example.test',
  '10000000-0000-4000-8000-000000000001'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","email":"ops2@example.test"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.batch_allocation_outputs
SET summary = '{"total_students":11}'::jsonb,
    run_id = 'run-2',
    updated_by = 'ops2@example.test',
    allocation_owner = '10000000-0000-4000-8000-000000000002'
WHERE batch_id = '30000000-0000-4000-8000-000000000001';
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT revision = 2
          AND allocation_owner = '10000000-0000-4000-8000-000000000001'
          AND updated_by = 'ops2@example.test'
   FROM public.batch_allocation_outputs
   WHERE batch_id = '30000000-0000-4000-8000-000000000001'),
  'a second Operations account must update shared allocation, increment revision, and preserve original owner'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"reviewer@example.test"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.batch_allocation_outputs
  SET summary = '{"forbidden":true}'::jsonb
  WHERE batch_id = '30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Lab Manager unexpectedly updated an allocation';
  END IF;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","email":"ops2@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT public.save_batch_allocation_output_if_revision(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '{"total_students":12}'::jsonb,
  '{}'::jsonb,
  '30000000-0000-4000-8000-000000000001/run-3.json',
  'run-3',
  2,
  'ops2@example.test'
);
DO $$
BEGIN
  BEGIN
    PERFORM public.save_batch_allocation_output_if_revision(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '{"total_students":999}'::jsonb,
      '{}'::jsonb,
      'stale.json',
      'stale-run',
      2,
      'ops2@example.test'
    );
    RAISE EXCEPTION 'stale allocation save unexpectedly succeeded';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;
END;
$$;
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT revision = 3 AND run_id = 'run-3'
   FROM public.batch_allocation_outputs
   WHERE batch_id = '30000000-0000-4000-8000-000000000001'),
  'CAS must increment once and reject a stale expected revision'
);

-- --------------------------------------------------------------------------
-- VP state round trip. Payloads are stored verbatim, never recalculated.
-- --------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","email":"ops1@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT public.bulk_update_batch_vp_state(
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '[{"id":"rec-1","status":"accepted","qualificationReason":"client_verified_value"}]'::jsonb,
  '[{"id":"vp-1","capacity":30,"status":"active"}]'::jsonb,
  '[{"session_id":"vp-1","student_id":"student-1"}]'::jsonb,
  '{"assigned_count":1}'::jsonb,
  '{"decision-1":{"status":"accepted","grades":[4]}}'::jsonb,
  'ops1@example.test'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"reviewer@example.test"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE state jsonb;
BEGIN
  state := public.get_batch_vp_state('30000000-0000-4000-8000-000000000001');
  IF state->'recommendations' <> '[{"id":"rec-1","status":"accepted","qualificationReason":"client_verified_value"}]'::jsonb
     OR state->'sessions' <> '[{"id":"vp-1","capacity":30,"status":"active"}]'::jsonb
     OR state->'session_students' <> '[{"session_id":"vp-1","student_id":"student-1"}]'::jsonb
     OR state->'summary' <> '{"assigned_count":1}'::jsonb
     OR state->'decisions' <> '{"decision-1":{"status":"accepted","grades":[4]}}'::jsonb THEN
    RAISE EXCEPTION 'VP state did not round-trip verbatim: %', state;
  END IF;

  BEGIN
    PERFORM public.bulk_update_batch_vp_state(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
      'reviewer@example.test'
    );
    RAISE EXCEPTION 'Lab Manager unexpectedly persisted VP state';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- --------------------------------------------------------------------------
-- Resolution responsibility mapping: Operations creates; Lab Manager/Event
-- Team or Administration approves/rejects.
-- --------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","email":"ops1@example.test"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.batch_resolution_requests (
  id, project_id, batch_id, type, target_team, status, area, grades
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'overfill', 'Event Team', 'pending', 'Test Area', ARRAY[4]
);
DO $$
BEGIN
  BEGIN
    UPDATE public.batch_resolution_requests
    SET status = 'approved'
    WHERE id = '50000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Operations unexpectedly approved a request';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"reviewer@example.test"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.batch_resolution_requests
SET status = 'approved', reviewed_by_role = 'Lab Manager'
WHERE id = '50000000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT status = 'approved' FROM public.batch_resolution_requests
   WHERE id = '50000000-0000-4000-8000-000000000001'),
  'Lab Manager/Event Team reviewer must be able to approve'
);

-- Finance reaches catering through both grants and RLS.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","email":"finance@example.test"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.catering_providers (name, type, unit_price)
VALUES ('Phase 1 Finance Test', 'both', 1);
RESET ROLE;

-- --------------------------------------------------------------------------
-- Nearby approval: exact UUID batch, exact requested slots, no trigger-seeded
-- extras, request-tagged rows, and precise reversal.
-- --------------------------------------------------------------------------
INSERT INTO public.batch_resolution_requests (
  id, project_id, batch_id, type, target_team, status, area, grades, lab_id,
  nearby_lab_metadata
) VALUES (
  '50000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'nearby_lab', 'Event Team', 'pending', 'Origin Area', ARRAY[4],
  'PHASE1-LAB',
  jsonb_build_object(
    'lab_uuid', '40000000-0000-4000-8000-000000000001',
    'required_sessions', jsonb_build_array(
      jsonb_build_object('date', '2026-10-10', 'time', '09:00'),
      jsonb_build_object('date', '2026-10-11', 'time', '13:00')
    )
  )
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"reviewer@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT public.decide_nearby_lab_request(
  '50000000-0000-4000-8000-000000000002',
  'approved', 'Phase 1 Reviewer', 'Lab Manager', 'approved by test'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
   FROM public.assignment_sessions
   WHERE reservation_request_id = '50000000-0000-4000-8000-000000000002'),
  'nearby approval must create exactly the two requested sessions'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.assignment_sessions
    WHERE reservation_request_id = '50000000-0000-4000-8000-000000000002'
      AND (session_date, lower(BTRIM(session_time))) NOT IN (
        ('2026-10-10'::date, '09:00'),
        ('2026-10-11'::date, '13:00')
      )
  ),
  'nearby approval must not retain trigger-seeded schedules'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","email":"reviewer@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT public.decide_nearby_lab_request(
  '50000000-0000-4000-8000-000000000002',
  'rejected', 'Phase 1 Reviewer', 'Lab Manager', 'reversed by test'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.assignment_sessions
    WHERE reservation_request_id = '50000000-0000-4000-8000-000000000002'
  ),
  'reversing nearby approval must remove only request-tagged sessions'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.assignments
    WHERE notes = 'nearby_lab_request:50000000-0000-4000-8000-000000000002'
  ),
  'empty dedicated nearby assignment must be removed on reversal'
);

ROLLBACK;
