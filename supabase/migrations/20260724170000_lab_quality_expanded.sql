-- =====================================================================
-- Expanded Lab Quality Assessment schema fields
-- Adds: pc_count, lab_size, bathroom_type, internet_speed_mbps, ac_count,
--       parent_waiting_area, floor_number, has_elevator, video_url,
--       image_urls, has_printer, has_instructor_pc, seated_capacity
-- =====================================================================
ALTER TABLE public.lab_quality
  ADD COLUMN IF NOT EXISTS pc_count             int,
  ADD COLUMN IF NOT EXISTS lab_size             text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS bathroom_type        text DEFAULT 'separate',
  ADD COLUMN IF NOT EXISTS internet_speed_mbps  int,
  ADD COLUMN IF NOT EXISTS ac_count             int,
  ADD COLUMN IF NOT EXISTS parent_waiting_area  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS floor_number         int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_elevator         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_url            text,
  ADD COLUMN IF NOT EXISTS image_urls           text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_printer          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_instructor_pc    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS seated_capacity      int;
