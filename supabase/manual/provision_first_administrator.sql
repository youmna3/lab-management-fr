-- MANUAL, ONE-TIME STEP. Never add this file to the migration sequence.
--
-- 1. Keep public signup disabled.
-- 2. Invite the intended administrator from Supabase Authentication > Users.
-- 3. After that user exists, run this script in the SQL editor with a trusted
--    database administrator session after replacing the placeholder below.
-- 4. Confirm the returned UUID/email before committing.

BEGIN;

DO $$
DECLARE
  v_email text := 'youmna54@gmail.com';
  v_user_id uuid;
  v_matches integer;
BEGIN
  IF v_email = 'REPLACE_WITH_INVITED_ADMIN_EMAIL'
     OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Set v_email to the exact invited administrator email before running this script';
  END IF;

  SELECT count(*), (array_agg(id))[1]
  INTO v_matches, v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email);

  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing invited auth user for %, found %', v_email, v_matches;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'administration')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

SELECT u.id, u.email, ur.role
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE ur.role = 'administration'
ORDER BY u.email;

-- Review the row above. Replace ROLLBACK with COMMIT only when it is the
-- intended invited administrator.
ROLLBACK;
