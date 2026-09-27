-- Migration to add area coverage column to catering_providers
ALTER TABLE public.catering_providers ADD COLUMN IF NOT EXISTS area TEXT;
