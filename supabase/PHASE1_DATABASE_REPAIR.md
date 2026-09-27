# Phase 1 database migration repair

This phase is database-only. It does not change allocation, consolidation, VP
eligibility/grouping/capacity, operational UI, or frontend workflows.

## Migration order

1. `20260917120000_nearby_lab_requests.sql`
2. `20260917120001_project_rosters_storage.sql` (renumbered from the duplicate
   `20260917120000` version; SQL body unchanged)
3. `20260927100000_phase1_duplicate_history_reconciliation.sql`
4. `20260927110000_phase1_allocation_metadata_and_vp_state.sql`
5. `20260927120000_phase1_security_auth_and_realtime.sql`
6. `20260927130000_phase1_nearby_lab_reservations.sql`

The reconciliation migration is additive and idempotent. Before using these
files against any database with pre-existing migration history, inspect
`supabase_migrations.schema_migrations` and the affected objects. Do not repair
history by deleting data or migration records.

## VP RPC persistence contract

`get_batch_vp_state(p_batch_id uuid)` returns a JSON object with:

- `recommendations` (array)
- `sessions` (array)
- `session_students` (array)
- `summary` (object)
- `decisions` (object)
- persistence metadata (`batch_id`, `project_id`, `revision`, `updated_by`,
  `updated_at`)

`bulk_update_batch_vp_state` accepts:

- `p_batch_id uuid`
- `p_project_id uuid` (nullable)
- `p_recommendations jsonb` (array)
- `p_sessions jsonb` (array)
- `p_session_students jsonb` (array of objects containing non-empty
  `session_id` and `student_id`)
- `p_summary jsonb` (object)
- `p_decisions jsonb` (object)
- `p_updated_by text`

The RPC stores these values atomically and verbatim. It validates container
shape and batch/project consistency only. It does not derive or modify any VP
business decision.

## Allocation revisions

Direct frontend upserts now receive a database-controlled, monotonic revision.
Ownership fields preserve the original creator for audit but do not restrict a
different Operations user from updating the allocation.

`save_batch_allocation_output_if_revision` is the safe compare-and-swap path:

- pass `0` to create a row that does not exist;
- pass the revision loaded by the client to update;
- a stale revision raises SQLSTATE `40001` and changes nothing.

The unchanged frontend does not call this RPC yet. Automatic revision increments
provide an audit sequence now, but stale-browser overwrite prevention becomes
effective only after a separately approved frontend phase sends the loaded
revision through this RPC. Storage objects are content-addressed, so a rejected
metadata commit can leave an unreferenced object rather than corrupting the
authoritative row.

## Roles

- Operations and Administration can create/update shared allocation state.
- Lab Manager, Operations, and Administration can read allocation state.
- Operations creates resolution requests.
- `lab_manager` is the application's Event Team reviewer role and can approve
  or reject requests. Administration can perform all request actions.
- Operations can perform non-approval request workflow updates.
- Finance, Operations, and Administration can write catering providers.
- Anonymous access to the repaired application tables and RPCs is revoked.

## Authentication bootstrap

Local signup is disabled in `config.toml`. Before exposing a hosted project,
also disable public email signup and anonymous sign-in in the hosted Auth
settings. Do not create a demo user.

Invite the intended first administrator from the hosted Auth administration
interface, then review and run `manual/provision_first_administrator.sql` using
a trusted database administrator session. The checked-in script fails closed
and rolls back until an operator explicitly supplies and verifies the invited
email.

## Tests

After starting the local Supabase stack:

```sh
supabase db reset --local
supabase test db supabase/tests/phase1_database_repair.sql
```

The SQL suite is transactional and rolls back all fixtures. It checks schema,
privileges, allocation sharing/revisions/CAS, VP round trips, request role
responsibilities, catering access, Realtime publication, and exact nearby-lab
reservation and reversal.
