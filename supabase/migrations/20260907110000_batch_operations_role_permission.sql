-- BUG-017: Restrict batch modifications (schedules, calendar days, time slots) to Operations and Administration roles only
-- Prevents unauthorized batch modifications from Lab Manager and other non-operations roles.

DROP POLICY IF EXISTS batches_write ON public.batches;

CREATE POLICY batches_write ON public.batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'operations') OR public.has_role(auth.uid(), 'administration'))
  WITH CHECK (public.has_role(auth.uid(), 'operations') OR public.has_role(auth.uid(), 'administration'));
