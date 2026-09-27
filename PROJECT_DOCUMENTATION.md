# Project Documentation

## 1. What this project is

This project is an internal iSchool operations portal for managing:

- lab master data
- lab quality and audit history
- projects and project batches
- lab demand and assignment planning
- catering planning
- budget tracking
- user roles and access control

In simple terms:

1. The team keeps a clean list of available labs.
2. The team scores those labs for quality and verifies their map locations.
3. The team creates projects and splits them into batches.
4. Each batch records how many labs are needed in each area.
5. Labs are assigned to those needs.
6. Catering and extra costs are tracked.
7. Dashboards, timeline views, and budget views summarize the operation.

## 2. Tech stack

- Frontend: React + TypeScript
- App framework: TanStack Start
- Routing: TanStack Router file-based routes
- State/data fetching: React Query + direct Supabase client calls
- Styling: Tailwind CSS
- Backend/data store: Supabase
- Auth: Supabase Auth

## 3. High-level app structure

Main private navigation tabs:

- Dashboard
- Lab Data
- Quality
- Projects
- Timeline
- Catering
- Budget
- Users

Visible tabs depend on the signed-in user's role.

Roles used by the app:

- `lab_manager`
- `operations`
- `finance`
- `administration`

Role behavior is implemented in:

- `src/hooks/useAuth.tsx`
- `src/components/AppNav.tsx`

## 4. Main business flow

The normal workflow is:

1. Create or import labs in `Lab Data`
2. Assess lab quality and verify map pins
3. Create a project in `Projects`
4. Create one or more batches inside that project
5. Import or define demand by governorate and area
6. Assign labs to the batch demand
7. Track quality incidents and post-use surveys in `Quality`
8. Plan meals and water in `Catering`
9. Review financial totals in `Budget`
10. Monitor execution dates in `Timeline`

## 5. Schema overview

### 5.1 Conceptual entity map

Even though the generated Supabase types do not include relationship metadata, the schema and the code clearly use the following logical relationships:

- `profiles` -> one row per authenticated user
- `user_roles` -> many roles per user
- `projects` -> one project can have many `batches`
- `batches` -> one batch can have many `batch_needs`
- `batches` -> one batch can have many `assignments`
- `labs` -> one lab can appear in many `assignments`
- `labs` -> one lab can have one current `lab_quality` row
- `labs` -> one lab can have many `lab_incidents`
- `labs` -> one lab can have many `lab_post_surveys`
- `assignments` -> can have many `catering_lines`
- `projects` -> can have many `project_extra_costs`
- `projects` -> can have many `timeline_overrides`

### 5.2 Core tables

#### `profiles`

Purpose:

- Stores user profile data for authenticated users

Important fields:

- `id`
- `email`
- `full_name`
- `avatar_url`
- `created_at`
- `updated_at`

Notes:

- Created automatically when a new auth user is created

#### `user_roles`

Purpose:

- Stores application roles for each user

Important fields:

- `user_id`
- `role`
- `created_at`

Notes:

- The first created user becomes `administration`
- Later users default to `lab_manager`

#### `labs`

Purpose:

- Main master table for all labs

Important fields:

- identity: `id`, `lab_code`, `name`
- geography: `gov`, `area`, `city`, `address`, `lat`, `lng`, `maps_url`
- contacts: `supervisor_name`, `supervisor_phone`, `facilitator_name`, `facilitator_phone`
- commercial: `session_price`, `hourly_price`, `vendor_name`
- capacity: `capacity`, `students_count`
- validation: `validation_status`, `maps_verified`, `maps_verified_note`
- lifecycle: `status`, `is_active`, `replaced_by_lab_id`, `replaced_at`, `deactivation_reason`

Notes:

- This is the base table used by almost every major tab

#### `lab_quality`

Purpose:

- Stores a structured quality assessment for each lab

Important fields:

- `lab_id`
- `pc_quality`
- `internet_quality`
- `chairs_quality`
- `cleanliness`
- `street_view`
- `ac`
- `projector`
- `security`
- `extra_activities`
- `quality_score`
- `assessed_by`
- `assessed_at`
- `notes`

Notes:

- The app calculates `quality_score` in code using weighted criteria

#### `lab_incidents`

Purpose:

- Records operational or quality incidents for a lab

Important fields:

- `lab_id`
- `batch_id`
- `project_id`
- `title`
- `severity`
- `category`
- `description`
- `reported_by`
- `reported_at`

#### `lab_post_surveys`

Purpose:

- Stores post-usage survey feedback after lab use

Important fields:

- `lab_id`
- `batch_id`
- `project_id`
- `overall_rating`
- `pc_rating`
- `internet_rating`
- `cleanliness_rating`
- `facilities_rating`
- `feedback`
- `submitted_by`

#### `projects`

Purpose:

- Top-level project or intake record

Important fields:

- `id`
- `name`
- `code`
- `client`
- `program`
- `intake_label`
- `participants_per_session`
- `sessions_count`
- `start_date`
- `end_date`
- `status`
- `owner_id`
- `notes`

#### `batches`

Purpose:

- Sub-schedules inside a project

Important fields:

- `project_id`
- `name`
- `date_mode`
- `dates`
- `time_slots`
- `status`
- `notes`

Status values:

- `draft`
- `assigning`
- `confirming`
- `ready`
- `exported`

#### `batch_needs`

Purpose:

- Stores how many labs are needed for a given batch in a given governorate and area

Important fields:

- `batch_id`
- `gov`
- `area`
- `labs_required`

#### `assignments`

Purpose:

- Stores the actual lab-to-batch assignment records

Important fields:

- `batch_id`
- `lab_id`
- `need_id`
- `status`
- `confirmed_price`
- `days`
- `sessions_per_day`
- `time_slots`
- `denied_reason`
- `notes`

Status values:

- `pending`
- `confirmed`
- `denied`

#### `catering_providers`

Purpose:

- Stores provider records for meals and water

Important fields:

- `name`
- `type`
- `unit_price`
- `contact_person`
- `phone`
- `city`
- `area`
- `is_active`
- `notes`

#### `catering_lines`

Purpose:

- Stores per-assignment catering calculations

Important fields:

- `assignment_id`
- `type`
- `provider`
- `students`
- `sessions`
- `unit_price`
- `extra_qty`
- `extra_fee`
- `lab_total`
- `notes`

#### `project_extra_costs`

Purpose:

- Stores manual extra costs that should be included in financial summaries

Important fields:

- `project_id`
- `label`
- `category`
- `amount`
- `created_by`

#### `timeline_overrides`

Purpose:

- Stores manual timeline events that should appear in the timeline workspace

Important fields:

- `project_id`
- `batch_id`
- `event_date`
- `kind`
- `label`
- `created_by`

### 5.3 Financial views

These are read-only reporting views built from core tables.

#### `batch_budget_view`

Purpose:

- Shows financial totals at the batch level

Computed totals:

- `lab_cost`
- `sandwich_cost`
- `water_cost`
- `catering_cost`
- `total_cost`

#### `project_budget_view`

Purpose:

- Shows financial totals at the project level

Computed totals:

- `lab_cost`
- `sandwich_cost`
- `water_cost`
- `catering_cost`
- `extras_cost`
- `total_cost`

#### `intake_budget_view`

Purpose:

- Shows financial totals grouped by project program/intake

Computed totals:

- `lab_cost`
- `sandwich_cost`
- `water_cost`
- `catering_cost`
- `extras_cost`
- `total_cost`

### 5.4 Support and future-facing tables

These exist in the schema but are not central to the current main tab flow:

- `lab_photos`
- `project_sessions`
- `catering_vendors`
- `catering_items`
- `catering_orders`
- `catering_order_items`

They look like support for more detailed session-level catering and media tracking, but the current UI mainly works with `catering_providers` and `catering_lines`.

### 5.5 Functions

#### `has_role`

Purpose:

- Checks whether a user has a specific application role

Used for:

- row-level security
- role-gated access rules

#### `lab_is_reserved`

Purpose:

- Checks whether a lab is already reserved for certain dates

Used for:

- assignment and scheduling protection logic

### 5.6 Enums

Main enums used in the schema:

- `app_role`: `lab_manager`, `operations`, `finance`, `administration`
- `assignment_status`: `pending`, `confirmed`, `denied`
- `batch_status`: `draft`, `assigning`, `confirming`, `ready`, `exported`
- `date_mode`: `range`, `custom`
- `program`: `DECI`, `DEMI`
- `project_status`: `draft`, `assigned`, `confirmed`, `completed`, `cancelled`
- `catering_type`: `sandwich`, `water`
- `catering_category`: `sandwich`, `beverage`, `extra`
- `catering_order_status`: `draft`, `ordered`, `delivered`, `cancelled`
- `ac_quality`: `yes`, `no`, `partial`

## 6. Authentication and role model

### Sign-in flow

The project uses Supabase Auth.

Main auth routes:

- `/auth`
- `/reset-password`

Behavior:

- unauthenticated users are redirected to `/auth`
- authenticated users are redirected to `/dashboard`
- roles are loaded from `user_roles`

### Role access by tab

- Dashboard: `lab_manager`, `operations`, `finance`, `administration`
- Lab Data: `lab_manager`, `administration`
- Quality: `lab_manager`, `operations`, `finance`, `administration`
- Projects: `lab_manager`, `operations`, `administration`
- Timeline: `lab_manager`, `operations`, `finance`, `administration`
- Catering: `operations`, `finance`, `administration`
- Budget: `finance`, `administration`
- Users: `administration`

## 7. Tab-by-tab documentation

## Dashboard

Purpose:

- Gives a high-level operational summary

Main data it reads:

- `labs`
- `lab_quality`
- `projects`
- `batches`
- `batch_needs`
- `assignments`
- `intake_budget_view`

What it shows:

- total labs
- governorate coverage
- quality average and quality distribution
- map verification status
- batches and assignment funnel
- budget by intake for finance/admin users

Why it exists:

- This is the executive snapshot of the whole operation

## Lab Data

Purpose:

- Manages the master lab list

Main data it reads/writes:

- `labs`
- `lab_quality`

Main features:

- import labs from spreadsheets
- map imported columns to schema fields
- detect differences on re-import
- edit lab records manually
- delete labs
- manage lab active/suspended/replaced lifecycle
- import video links
- import session prices
- export CSV templates and current data
- verify Google Maps locations
- flag map mismatches
- auto-verify some pins
- save quality assessment data for each lab

Why it exists:

- This is the source of truth for lab identity, readiness, pricing, and location quality

## Quality

Purpose:

- Tracks quality status over time, not just the latest static lab record

Main data it reads/writes:

- `labs`
- `lab_quality`
- `lab_incidents`
- `lab_post_surveys`
- `assignments`
- `batches`

Main features:

- shows quality score and quality band per lab
- shows usage history and assignment count
- logs incidents
- records post-usage surveys
- exposes a trace view per lab

Why it exists:

- It answers: "How good is this lab?" and "What happened after we used it?"

## Projects

Purpose:

- Manages top-level projects and their operational performance

Main data it reads:

- `projects`
- `batches`
- `batch_needs`
- `assignments`
- `labs`

Main features:

- lists all projects/intakes
- groups projects by program
- shows fulfillment and cost indicators
- links into each project's detailed workspace

Why it exists:

- This is the portfolio view across all projects

## Project Detail

Purpose:

- This is the main execution workspace for one project

Main data it reads/writes:

- `projects`
- `batches`
- `batch_needs`
- `assignments`
- `labs`
- `lab_quality`
- `lab_incidents`
- `lab_post_surveys`

Main features:

- create and delete batches
- define batch dates and time slots
- import demand needs by governorate and area
- create assignment candidates
- rank/select labs
- confirm or deny assignments
- update batch status through the workflow
- export operations data
- attach incident and survey information back to the project context

Why it exists:

- This is where planning turns into actual operations

## Timeline

Purpose:

- Shows when batches and milestones happen

Main data it reads:

- `projects`
- `batches`
- `assignments`
- `labs`
- `timeline_overrides`

Main features:

- gantt-like timeline view
- calendar and list views
- filtering by program and status
- batch detail inspection
- manual timeline events through overrides

Why it exists:

- It helps operations understand timing, overlap, and schedule pressure

## Catering

Purpose:

- Plans and prices food/water operations for assigned labs

Main data it reads/writes:

- `projects`
- `batches`
- `assignments`
- `labs`
- `catering_providers`
- `catering_lines`

Main features:

- manage catering providers
- assign providers to project/batch activity
- calculate row-level catering costs
- save catering lines
- inspect provider history
- export catering sheets

Why it exists:

- It translates confirmed assignments into meal/water operational cost lines

## Budget

Purpose:

- Gives finance and admins a consolidated cost view

Main data it reads/writes:

- `intake_budget_view`
- `project_budget_view`
- `batch_budget_view`
- `project_extra_costs`
- `catering_providers`
- `labs`

Main features:

- total financial overview
- intake-level summaries
- project-level summaries
- batch-level summaries
- add and remove extra costs
- export budget CSV files

Why it exists:

- It converts operational work into finance-ready totals

## Users

Purpose:

- Manages user access and permissions

Main data it reads/writes:

- `profiles`
- `user_roles`

Main features:

- list users
- see assigned roles
- grant/revoke roles
- send password reset emails
- explain the effective access matrix

Why it exists:

- It is the control center for access governance

## 8. Important implementation notes

### Quality score

Quality score is calculated in application code, not in SQL.

The main weighted factors are:

- PC quality
- PC count
- internet quality
- AC
- lab size
- cleanliness
- chairs quality
- security
- projector
- instructor PC
- printer
- bathrooms
- parent waiting area
- street view
- extra activities

The score is then grouped into:

- `high`
- `medium`
- `low`

### Budget logic

Budget totals are not typed in manually as one single number.
They are derived from:

- confirmed assignment prices
- catering line totals
- manual extra costs

That makes the finance summary consistent with real operations data.

### Lab quality versus lab status

The project distinguishes between:

- lab master data in `labs`
- lab audit data in `lab_quality`
- live incident history in `lab_incidents`
- post-use feedback in `lab_post_surveys`

This separation is important because a lab can be structurally good, but still have operational issues later.

## 9. Suggested mental model for new team members

If you are new to the project, remember it in this order:

1. `labs` = where we can run sessions
2. `lab_quality` = how good each lab is
3. `projects` = what we need to deliver
4. `batches` = when parts of the project happen
5. `batch_needs` = how many labs we need in each area
6. `assignments` = which labs we actually chose
7. `catering_lines` = meal/water cost for those choices
8. `project_budget_view` = final rolled-up cost summary

## 10. File map for the main product areas

- Navigation: `src/components/AppNav.tsx`
- Auth/roles: `src/hooks/useAuth.tsx`
- Dashboard: `src/routes/_authenticated/dashboard.tsx`
- Lab master data: `src/routes/_authenticated/lab-data.tsx`
- Quality: `src/routes/_authenticated/quality.tsx`
- Projects list: `src/routes/_authenticated/projects.index.tsx`
- Project detail: `src/routes/_authenticated/projects.$id.tsx`
- Timeline: `src/routes/_authenticated/timeline.tsx`
- Catering: `src/routes/_authenticated/catering.tsx`
- Budget: `src/routes/_authenticated/budget.tsx`
- Users: `src/routes/_authenticated/users.tsx`
- Supabase typed schema: `src/integrations/supabase/types.ts`
- Role/bootstrap migration: `supabase/migrations/20260723140252_0a9db5dd-436a-4cba-bec4-28df770ff810.sql`
- Budget view migration: `supabase/migrations/20260724120000_lab_mgmt_rebuild.sql`

