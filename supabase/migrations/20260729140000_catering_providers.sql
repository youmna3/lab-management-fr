-- Catering Providers / Vendors Table
CREATE TABLE IF NOT EXISTS public.catering_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'both', -- 'sandwich', 'water', 'both'
  unit_price NUMERIC NOT NULL DEFAULT 0,
  contact_person TEXT,
  phone TEXT,
  city TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catering_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cp_select ON public.catering_providers;
CREATE POLICY cp_select ON public.catering_providers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cp_write ON public.catering_providers;
CREATE POLICY cp_write ON public.catering_providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration') OR public.has_role(auth.uid(),'finance'))
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration') OR public.has_role(auth.uid(),'finance'));

-- Seed default catering providers
INSERT INTO public.catering_providers (name, type, unit_price, contact_person, phone, city)
VALUES 
  ('Domty Catering', 'sandwich', 45.00, 'Ahmed Domty', '01012345678', 'Cairo'),
  ('Baraka Water', 'water', 15.00, 'Mohamed Baraka', '01123456789', 'Cairo'),
  ('El-Ahram Bakery', 'sandwich', 40.00, 'Hassan Ahram', '01234567890', 'Giza'),
  ('Aqua Water Co', 'water', 12.00, 'Samy Aqua', '01543210987', 'Alexandria'),
  ('Royal Catering & Events', 'both', 50.00, 'Tarek Royal', '01099887766', 'Cairo')
ON CONFLICT DO NOTHING;
