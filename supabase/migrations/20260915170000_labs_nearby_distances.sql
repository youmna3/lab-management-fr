-- =====================================================================
-- Add nearby_labs JSONB column to public.labs table
-- Stores ranked nearby-lab distance entries:
-- [{ rank, nearbyLabId, nearbyLabName, nearbyArea, nearbyLocationUrl, distanceKm, distanceMethod, distanceStatus }]
-- =====================================================================
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS nearby_labs jsonb DEFAULT '[]'::jsonb;
