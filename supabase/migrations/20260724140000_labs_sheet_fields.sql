-- =====================================================================
-- Lab Data — store the remaining reference columns from the camp sheet
-- (Domty sandwiches, Water Boxes, Water Vendor) so Lab Data mirrors the CSV.
-- Additive + idempotent.
-- =====================================================================
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS domty        int,
  ADD COLUMN IF NOT EXISTS water_boxes  int,
  ADD COLUMN IF NOT EXISTS water_vendor text;
