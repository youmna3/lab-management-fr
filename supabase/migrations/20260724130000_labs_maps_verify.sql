-- =====================================================================
-- Lab Data — Google Maps verification module.
-- maps_verified: NULL = not checked, true = pin verified, false = mismatch.
-- Additive + idempotent.
-- =====================================================================
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS maps_verified      boolean,
  ADD COLUMN IF NOT EXISTS maps_verified_note text,
  ADD COLUMN IF NOT EXISTS maps_verified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS maps_verified_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;
