# Renad: approval and reservation, first implementation

## What was reviewed
Main: c653b314a293e768032678f69d4b091c72762170.
Budoor's feature/asset-management files are already present in that main snapshot.
Shaikha requests/matching: eb989b6a44cdf56fb8d9b2a263fba8ce19be9918 (PR #2, not merged).
Shaikha reports: e213016715ec6a5440314ff8f17599747e691fae (PR #3, based on PR #2).
No remote branches were changed, no PRs were merged and no live database was accessed.

## Install on your existing branch
Save/commit any personal work first. From the project terminal:

    git switch main
    git pull origin main
    git switch renad/approval-transfer
    git merge main

If Git reports conflicts, resolve them before copying the new files.
Copy the package's app/approvals, lib/approvals, new migration, tests and docs into the project.
There are no replacement foundation migrations in this package.
For components/NavBar.tsx, the sole change is the role-gated Approvals link:

    {AuthService.hasRole(user, ROLES.APPROVER, ROLES.ADMIN) && (
      <Link href="/approvals" className="hover:underline">Approvals</Link>
    )}

Coordinate that small shared-file addition with Budoor; do not overwrite newer navigation edits.
/approvals follows Budoor's actual /assets and /search routing and uses her NavBar and AuthService.
It intentionally does not introduce another shared layout under the starter /protected layout.

## Database dependency order
1. Both original foundation migrations (already applied; DO NOT rerun).
2. Budoor: 20261114090000_budoor_access_and_assets.sql (confirm whether already applied).
3. Renad: 20261114100000_renad_approval_reservation.sql (new; apply once after review/testing).
Shaikha's request migrations are needed to SUBMIT requests through her UI; Renad's functions only
require the shared tables plus Budoor's helpers. Use the same request rows; do not create duplicates.
Shaikha's migrations 000100 through 000700 sort before Budoor's 090000 and don't depend on her
helpers. Do not renumber already applied files. Reconcile manual migration history before CLI use.

## What this milestone does
- Approver/admin authorization at the page, Server Action and database function.
- Start review; show request, eligible stock, previously accepted AI suggestions and named history.
- Approve and reserve automatically in one database transaction, as Phase 3 UC-06 describes.
- Reject with a reason; prevent self-review/approval and invalid request status changes.
- Lock request then asset, recheck stock, deduct only the reserved quantity and retain batch balance.
- Repeated reservation call returns its hold without allocating twice.
- Cancel Approved/Reserved requests or explicitly process an expired hold; restore stock once.
- Record request history, asset reservation history and audit entries within the same transaction.
- Preserve existing Budoor registration/publication history and Shaikha submission history.

Approval and reservation are separate database concepts, even though the normal UI saves them
together. After an expired hold, the request is Approved and can be reserved again after checking stock.

## How to read the code
app/approvals/page.tsx: authorize, load workspace, show each request.
app/approvals/ApprovalCard.tsx: accessible form and history display, with pending/error messages.
app/approvals/actions.ts: validate form, call the database operation, refresh affected pages.
lib/approvals/types.ts: readable data shapes shared by the page and form.
The SQL contains small named functions with comments; private helpers cannot be called by clients.
No service-role key is used by this feature.

## Tests and limits
Static integration checks passed (RPC names, imports, grants/revokes and schema targets).
Full TypeScript/lint/build were NOT run: npm ci was blocked by a registry HTTP 403.
SQL was NOT executed: this environment has no PostgreSQL server or connected Supabase access.
Do not describe this package as fully tested or C5/C6 complete.

On a configured local checkout run:

    npm ci
    npx tsc --noEmit
    npx eslint app/approvals lib/approvals
    npm run build

Run tests/approval-reservation.sql on a DISPOSABLE test database with the dependencies installed.
It uses real authenticated-role permissions and rolls fixtures back. If it errors, roll back the
transaction and resolve the failure before using the migration on the shared project.
Do not add test fixtures to production seed files.

Also test two independent sessions reserving the same last unit: one must succeed and the other
must fail after the row lock releases; stock must never go negative. The supplied sequential
regression tests do not substitute for that concurrency check.

Manual integration: requester submits through Shaikha -> different approver starts review ->
approve/reserve -> requester refreshes tracking -> stock is reduced -> cancellation restores stock.
Try direct calls as requester, inactive user and anonymous user; all approval operations must fail.

## Still to implement in the next C5/C6 milestones
- Transfer arrangements, release, receipt, discrepancies and ownership/custody/location updates.
- Partial allocations/receipts and split batches; this milestone reserves the full requested quantity.
- Scheduled expiry processing: currently an approver explicitly processes expired holds.
- Full lifecycle transitions, inspection/maintenance requirements and unified history screen.
- Requester amendment/resubmission and early cancellation coordinated with Shaikha. The database
  supports a return-for-information decision but its UI button is intentionally not exposed yet.
- This UI uses editable 24-hour default/1–168 hour duration choices, a prototype convention rather
  than a requirement quoted from the SRS. Database accepts any future expiry for later configuration.

Budoor and Shaikha can continue their work. Only the NavBar link is a shared UI edit in this package.
