-- Enforce the product limit independently of every UI/import entry point.
CREATE OR REPLACE FUNCTION public.enforce_assignment_session_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count integer;
BEGIN
  -- Serialize writes for one assignment/day so concurrent imports cannot exceed the limit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.assignment_id::text || '|' || NEW.session_date::text, 0)
  );

  SELECT COUNT(*)
  INTO v_existing_count
  FROM public.assignment_sessions session
  WHERE session.assignment_id = NEW.assignment_id
    AND session.session_date = NEW.session_date
    AND session.id <> NEW.id;

  IF v_existing_count >= 4 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'An assignment cannot have more than four sessions on %s.',
        NEW.session_date
      ),
      DETAIL = 'Remove a selected slot before saving or importing this schedule.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_session_daily_limit ON public.assignment_sessions;
CREATE TRIGGER trg_assignment_session_daily_limit
BEFORE INSERT OR UPDATE OF assignment_id, session_date
ON public.assignment_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_assignment_session_daily_limit();

