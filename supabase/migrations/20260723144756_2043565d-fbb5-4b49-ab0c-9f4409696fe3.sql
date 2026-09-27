
-- Enums
CREATE TYPE public.project_status AS ENUM ('draft','assigned','confirmed','completed','cancelled');
CREATE TYPE public.catering_category AS ENUM ('sandwich','beverage','extra');
CREATE TYPE public.catering_order_status AS ENUM ('draft','ordered','delivered','cancelled');

-- =========================
-- LABS
-- =========================
CREATE TABLE public.labs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location_address text,
  city text,
  capacity int NOT NULL DEFAULT 0,
  hourly_price numeric(10,2) NOT NULL DEFAULT 0,
  quality_rating smallint CHECK (quality_rating BETWEEN 1 AND 5),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labs TO authenticated;
GRANT ALL ON public.labs TO service_role;
ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;
CREATE POLICY labs_select_auth ON public.labs FOR SELECT TO authenticated USING (true);
CREATE POLICY labs_insert_mgr ON public.labs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'));
CREATE POLICY labs_update_mgr ON public.labs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'));
CREATE POLICY labs_delete_admin ON public.labs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_labs_updated BEFORE UPDATE ON public.labs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LAB PHOTOS
CREATE TABLE public.lab_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_photos TO authenticated;
GRANT ALL ON public.lab_photos TO service_role;
ALTER TABLE public.lab_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_photos_select ON public.lab_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY lab_photos_write ON public.lab_photos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'lab_manager') OR public.has_role(auth.uid(),'administration'));

-- =========================
-- PROJECTS
-- =========================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client text,
  intake_label text,
  start_date date,
  end_date date,
  sessions_count int NOT NULL DEFAULT 0,
  participants_per_session int NOT NULL DEFAULT 0,
  status public.project_status NOT NULL DEFAULT 'draft',
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_select_auth ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY projects_insert_ops ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
CREATE POLICY projects_update_ops ON public.projects FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration') OR owner_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration') OR owner_id = auth.uid());
CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'administration') OR owner_id = auth.uid());
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PROJECT SESSIONS
CREATE TABLE public.project_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '17:00',
  lab_id uuid REFERENCES public.labs(id) ON DELETE SET NULL,
  participants int NOT NULL DEFAULT 0,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_sessions TO authenticated;
GRANT ALL ON public.project_sessions TO service_role;
ALTER TABLE public.project_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps_select ON public.project_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY ps_write ON public.project_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_ps_updated BEFORE UPDATE ON public.project_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- CATERING
-- =========================
CREATE TABLE public.catering_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_vendors TO authenticated;
GRANT ALL ON public.catering_vendors TO service_role;
ALTER TABLE public.catering_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY cv_select ON public.catering_vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY cv_write ON public.catering_vendors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_cv_updated BEFORE UPDATE ON public.catering_vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.catering_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.catering_vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  category public.catering_category NOT NULL DEFAULT 'sandwich',
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_items TO authenticated;
GRANT ALL ON public.catering_items TO service_role;
ALTER TABLE public.catering_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_select ON public.catering_items FOR SELECT TO authenticated USING (true);
CREATE POLICY ci_write ON public.catering_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_ci_updated BEFORE UPDATE ON public.catering_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.catering_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.project_sessions(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.catering_vendors(id) ON DELETE SET NULL,
  status public.catering_order_status NOT NULL DEFAULT 'draft',
  ordered_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_orders TO authenticated;
GRANT ALL ON public.catering_orders TO service_role;
ALTER TABLE public.catering_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY co_select ON public.catering_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY co_write ON public.catering_orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_co_updated BEFORE UPDATE ON public.catering_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.catering_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.catering_orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.catering_items(id) ON DELETE SET NULL,
  quantity int NOT NULL DEFAULT 1,
  unit_price_snapshot numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_order_items TO authenticated;
GRANT ALL ON public.catering_order_items TO service_role;
ALTER TABLE public.catering_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY coi_select ON public.catering_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY coi_write ON public.catering_order_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'operations') OR public.has_role(auth.uid(),'administration'));

-- =========================
-- BUDGET
-- =========================
CREATE TABLE public.project_extra_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  category text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_extra_costs TO authenticated;
GRANT ALL ON public.project_extra_costs TO service_role;
ALTER TABLE public.project_extra_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pec_select ON public.project_extra_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY pec_write ON public.project_extra_costs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'finance') OR public.has_role(auth.uid(),'administration'))
  WITH CHECK (public.has_role(auth.uid(),'finance') OR public.has_role(auth.uid(),'administration'));
CREATE TRIGGER trg_pec_updated BEFORE UPDATE ON public.project_extra_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Consolidated budget view
CREATE OR REPLACE VIEW public.project_budget_view
WITH (security_invoker = true)
AS
WITH lab_costs AS (
  SELECT ps.project_id,
         COALESCE(SUM(EXTRACT(EPOCH FROM (ps.end_time - ps.start_time))/3600.0 * COALESCE(l.hourly_price,0)),0) AS lab_cost
  FROM public.project_sessions ps
  LEFT JOIN public.labs l ON l.id = ps.lab_id
  GROUP BY ps.project_id
),
catering_costs AS (
  SELECT ps.project_id,
         COALESCE(SUM(coi.quantity * coi.unit_price_snapshot),0) AS catering_cost
  FROM public.catering_order_items coi
  JOIN public.catering_orders co ON co.id = coi.order_id
  JOIN public.project_sessions ps ON ps.id = co.session_id
  WHERE co.status <> 'cancelled'
  GROUP BY ps.project_id
),
extras AS (
  SELECT project_id, COALESCE(SUM(amount),0) AS extras_cost
  FROM public.project_extra_costs
  GROUP BY project_id
)
SELECT p.id AS project_id,
       p.name,
       p.client,
       p.status,
       COALESCE(lc.lab_cost,0)      AS lab_cost,
       COALESCE(cc.catering_cost,0) AS catering_cost,
       COALESCE(ex.extras_cost,0)   AS extras_cost,
       COALESCE(lc.lab_cost,0) + COALESCE(cc.catering_cost,0) + COALESCE(ex.extras_cost,0) AS total_cost
FROM public.projects p
LEFT JOIN lab_costs lc ON lc.project_id = p.id
LEFT JOIN catering_costs cc ON cc.project_id = p.id
LEFT JOIN extras ex ON ex.project_id = p.id;

GRANT SELECT ON public.project_budget_view TO authenticated;
