# Team implementation starting point

## Apply the foundation (Renad, once)
The uploaded first migration is at commit c230398674e4ea67da3d8d8e2445ee7119aafd6f.
Add the second migration from this handoff to the same branch. Do not replace the first.
These files have been statically reviewed, not executed against PostgreSQL in this environment.

1. Confirm the selected Supabase project is the team's new project.
2. If its public schema has no project tables, open SQL Editor, paste and run the ENTIRE first migration.
3. Only after success, run the ENTIRE second migration.
4. Run supabase/checks/verify_foundation.sql. Expect 17 tables with RLS, no anon/authenticated table grants,
   four roles, three demo departments and three categories.
5. If any step fails, stop and share its error; do not delete tables or repeat successful migrations.
6. Record each successful filename/date in your team notes. Manual SQL Editor execution does not
   populate the Supabase CLI migration history; reconcile that history before adopting CLI db push.
7. Merge the two migration files into main after successful checks. Each member pulls main before
   branching. Keep application work on separate branches.

Supabase dashboard execution uses privileged access. Do not expose database credentials or a
service-role key in browser code. App data access is deliberately blocked until Budoor's scoped
policies and the owners' authorized workflow functions are added.

## Feature ownership and first deliverables
Budoor: C1-C3. Implement login-linked app_user profiles, department assignment, roles and scoped RLS;
then asset registration, publication and search. Self-signup must not grant privileged roles.
Shaikha: C4, AI2, AI5. Request forms/tracking, matching and report summary review.
Renad: C5-C6. Approval/reservation/release/receipt operations and lifecycle/history.

Everyone can build screens and TypeScript data shapes now using these table columns.
After the foundation succeeds, connect each feature as its access rules are implemented.
A permission-denied response is expected before the corresponding grants AND policies are added;
do not disable RLS to work around it.

## Shared contract
Tables/columns are those in the first migration plus corrections in the second.
IDs are UUID strings. app_user.user_id is the corresponding Supabase Auth user's ID.
Never store passwords in app_user. Profile provisioning and role assignment belong to Budoor.
Create test users through Auth, then link profiles to existing departments. No fake auth IDs.

Roles: requester, custodian, approver, admin. Multiple roles use user_role.
The first privileged profile/role is bootstrapped by the project owner via SQL Editor;
subsequent changes require admin authorization. Do not let users assign their own roles.

Exact statuses are enforced by the second migration (capitalization matters).
Asset conditions: use Good, Fair, Poor as an initial shared UI convention; eligibility/safety
rules still require feature implementation. Urgency: Low, Normal, High as a UI convention.
Asset registration begins Registered/unpublished; request drafting begins Draft.
Approval alone does not decrement availability.
Reservation requires an atomic database transaction locking the asset and rechecking remaining stock.
Release consumes a reservation without subtracting availability a second time.
Receipt updates received units only, uses source_asset_id for a split batch, and leaves them unpublished.
Do not change an entire source batch's owner when only part of it is transferred.

Only the owning feature's authorized operation changes workflow state.
Do not implement approval, reservation, receipt or role assignment as unrestricted browser table updates.
History and audit rows must be created by trusted operations, never accepted as user-authored evidence.
Renad supplies common asset/request history integration for Budoor and Shaikha.

AI2: enforce current eligibility before ranking; show at most five per result set. Store score
(0-100), separate nullable confidence (0-1), explanation, model version and human review.
Repeated ranking runs need an explicit batch/run convention before persisting multiple sets.
AI5: calculate figures using database records; preserve calculated_figures, AI draft and human-edited
published_text separately. AI produces prose, not authoritative totals.

## Scope and deliberate differences from the ER
17 tables cover the shared mandatory foundation, not all 25 design tables.
Optional classification, assistant, notification and sustainability work is deferred.
Attachments and detailed inspection/maintenance records are not included in this initial subset.
The generic approval design is narrowed to requests here; maintenance/disposal approvals require
a later migration. Full lifecycle labels exist, but their authorized transitions are not implemented.
Embedding columns are deferred until the team selects a matching implementation/model.
Additional report snapshot/publication fields preserve calculated inputs and reviewed output.
One transfer per reservation is enforced; partial receipts use transfer_discrepancy on that transfer.
None of these foundation constraints implement self-approval prevention, concurrent allocation,
automatic history, eligibility checks, ownership updates or feature-specific RLS.

## How each person changes the database
Create a new timestamped SQL file for your feature. Do not edit files already applied.
Send it for review with the feature code. Renad applies reviewed files once, in dependency order.
Everyone uses the same shared Supabase database even though Git branches differ.
Keep a short note of field or function changes other members need.

First integration target: register/publish one eligible asset -> submit a request -> approve ->
reserve -> schedule/release -> confirm receipt -> see ownership/history.
Test unauthorized access, self-approval, two reservations for the last unit, cancellation,
expiry, partial receipt and repeated receipt before calling C5/C6 complete.
Reserve the final three days for integration, fixing issues and demo practice; postpone bonuses.

