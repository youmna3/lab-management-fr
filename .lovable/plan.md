
# Full Build — Phases 1 through 4

Phase 0 (auth, roles, shell) is live. This plan implements the remaining functional modules from the PDF roadmap in one continuous build. Each phase ships schema + RLS + UI + role-gated actions.

## Phase 1 — Lab Data

Central repository of labs available to book.

**Schema (single migration)**
- `labs`: id, name, location_address, city, capacity, hourly_price numeric, quality_rating smallint (1–5), notes, is_active bool, created_by, timestamps.
- `lab_photos`: id, lab_id fk, url, created_at (URLs stored as text; upload handled via a `lab-photos` storage bucket).
- RLS:
  - SELECT: any authenticated user.
  - INSERT/UPDATE/DELETE: `lab_manager` or `administration`.
- GRANTs to authenticated + service_role.
- Storage bucket `lab-photos` (public read, authed write).

**UI (`/lab-data`)**
- Table view with filters (city, capacity, price range, rating).
- "Add Lab" dialog + edit dialog (role-gated).
- Detail drawer with photos.

## Phase 2 — Projects

Offline session batches assigned to labs.

**Schema**
- `projects`: id, name, client, intake_label, start_date, end_date, sessions_count, participants_per_session, status enum (`draft`,`assigned`,`confirmed`,`completed`,`cancelled`), owner_id, timestamps.
- `project_sessions`: id, project_id fk, session_date, start_time, end_time, lab_id fk nullable, participants int, confirmed_at, notes.
- `app_role` extended usage: create/edit by `operations`/`administration`; read by all authenticated; finance read-only.
- RLS + GRANTs.

**UI (`/projects`)**
- List with status chips.
- Create/edit project → auto-generates N session rows based on dates + count.
- Session table with lab picker (queries `labs`), confirm button, timeline (simple horizontal grouped-by-date view).

## Phase 3 — Catering

Per-session sandwich + beverage orders.

**Schema**
- `catering_vendors`: id, name, contact, notes, is_active.
- `catering_items`: id, vendor_id fk, name, category enum (`sandwich`,`beverage`,`extra`), unit_price numeric, is_active.
- `catering_orders`: id, session_id fk (project_sessions), vendor_id, status enum (`draft`,`ordered`,`delivered`,`cancelled`), ordered_at, notes.
- `catering_order_items`: id, order_id fk, item_id fk, quantity, unit_price_snapshot.
- RLS: read authenticated; write `operations`/`administration`; vendors/items manageable by `administration`.

**UI (`/catering`)**
- Tabs: Orders | Vendors | Items.
- Order form tied to a project session with add-item rows and live subtotal.

## Phase 4 — Budget

Consolidated cost reporting.

**Schema**
- `project_extra_costs`: id, project_id fk, label, amount numeric, category text, created_by, created_at.
- View `project_budget_view` computing per-project totals: lab cost (Σ session hours × lab hourly_price), catering cost (Σ order_items qty × price), extras, grand total. Implemented as a SQL view with RLS-friendly base tables (no SECURITY DEFINER).
- RLS: read by `finance`/`administration`/project owner; extras writable by `finance`/`administration`.

**UI (`/budget`)**
- Project selector → breakdown card (Labs, Catering, Extras, Total).
- Extras editor (role-gated).
- Export CSV (client-side).

## Cross-cutting

- All tables: GRANT SELECT/INSERT/UPDATE/DELETE to `authenticated`, GRANT ALL to `service_role`, RLS ON with policies as above.
- All new routes under `_authenticated/`; nav already role-filters.
- Reuse shadcn: Table, Dialog, Sheet, Select, Tabs, Card, Badge, Sonner.
- No new server functions needed; direct client → Supabase with RLS.
- Each phase = one migration + route files + small components; delivered sequentially in one turn.

## Out of scope (defer)

- Google Maps embed for lab locations.
- XLSX bulk import/export (CSV export only for budget).
- Email notifications on confirmation.
- Advanced analytics dashboards.

Approve and I'll implement Phases 1 → 4 back-to-back.
