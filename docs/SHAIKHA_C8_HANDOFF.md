# C8 — Shaikha notifications and Renad integration

## Scope and honest completion status

This patch supplies a recipient-only in-app inbox, unread count/filter, persistent
mark-as-read, older-page loading, an automatic submission hook and a PRIVATE event
producer for approval, rejection and receipt. It adds one Notifications link to
the shared NavBar; no existing links, permissions or role routing are changed.

**Approval, rejection and receipt are not automatically connected by this patch.**
Renad must connect and test the calls below inside her authorized workflow
transactions. Do not report all of C8 as end-to-end complete until those three
events have been verified through the normal workflow. The supplied source ZIP
does not contain Renad's C5/C6 workflow functions, so this patch does not guess at
their names, edit them or install competing triggers on approval/transfer tables.

Notifications currently go to the original requester only. This gives the
requester submission confirmation and later outcome notices, with no cross-user
inbox access, global admin inbox, department broadcast, email or external push.
Any change to recipients should be reviewed with the relevant permission owner.
There is no auto-polling or Realtime requirement: use Refresh to load new events.

## Files

New:

- `app/protected/notifications/page.tsx`
- `app/protected/notifications/actions.ts`
- `app/protected/notifications/notification-model.ts`
- `supabase/migrations/20261122180000_shaikha_notifications.sql`
- `tests/shaikha-c8.test.mjs`
- `tests/shaikha-c8-access.mjs`
- `tests/shaikha-c8-isolated-db.sql`
- `docs/SHAIKHA_C8_HANDOFF.md`

Modified: `components/NavBar.tsx` adds just one Notifications link. If Budoor has
changed this file since the ZIP, add that single Link line to her latest version
instead of replacing her file. No global CSS, package, existing migration, C9,
request submission function, approval, reservation, release or receipt workflow
file changes are included.

## Install in a separate branch

Ensure your C9 and README changes are already merged and your tracked files are
clean. Preserve untracked ZIPs and `scoring copy.ts`; never use `git add .`.

```sh
git status --short
git switch main
git pull --ff-only origin main
git switch -c shaikha/c8-notifications
```

If that branch already exists, use `git switch shaikha/c8-notifications` instead
and inspect its status. Stop on conflicts; do not force/reset anything.
Extract the patch separately, copy its individual files into matching project
paths, and preserve existing folders and all other team files.

Review and apply ONLY the NEW migration
`20261122180000_shaikha_notifications.sql`, once, using the authorized team
migration process. It requires the already-applied foundation/contract, not a
rerun of either. It does not require rerunning C9 or AI5. The transaction creates
the notification table, indexes, policies, functions, and a request-submission
trigger. If an object already exists, stop and confirm the migration state.

The submission trigger and notice insert participate in the same transaction as
the request. An error rolls both back rather than reporting a saved notice for
a failed request. Review this behavior before applying to the shared database.
No historical events are automatically backfilled. Create a NEW fictional demo
request after enabling C8 to test submission. Existing requests need no updates.

## Database contract for Renad

**Not a browser/server-action RPC.** Ordinary clients, anonymous users and the
service role have no execute grant on `shaikha_emit_notification`. Call it from
the trusted PostgreSQL SECURITY DEFINER workflow function owned by the migration
owner (normally postgres), after normal permission, anti-self-approval, state,
reservation, stock and receipt checks/writes. Do not grant producer execution to
authenticated/anon/service_role to make a failing integration work. If a workflow
uses a different database owner, review the exact owner privileges with Renad.

```sql
-- Approval: after inserting the approval record AND updating request status.
perform public.shaikha_emit_notification('approved', v_approval_id);

-- Rejection: after inserting a Rejected approval AND setting request Rejected.
perform public.shaikha_emit_notification('rejected', v_approval_id);

-- Receipt: after writing received_by, received_at, received_quantity and status.
perform public.shaikha_emit_notification('received', v_transfer_id);
```

`v_approval_id` / `v_transfer_id` are illustrative names: use the actual local
variables in Renad's functions. No approval, stock or transfer mutation should be
performed by the notification function itself. Do not make a second browser HTTP
call after workflow success; keeping the insert in the SAME database transaction
makes rollback atomic. Do not catch and discard producer errors silently.

| Event | Source ID | Validated authoritative source | Recipient |
| --- | --- | --- | --- |
| submitted | Request ID | Submitted request with submission timestamp | `resource_request.submitted_by` |
| approved | Approval ID | Approved decision, positive allocated quantity, asset, different approver/requester, request Approved/Reserved/In Transfer/Fulfilled | Original requester |
| rejected | Approval ID | Rejected decision and request Rejected | Original requester |
| received | Transfer ID | Completed or Receipt Discrepancy with received_by, received_at and recorded quantity from 0 through transfer quantity | Original requester |

The producer derives IDs, recipient and source timestamp from stored data. The
client cannot supply a message, recipient, actor or URL. Text is defined locally
by known event types. A receipt notice deliberately says **receipt recorded**,
not successful completion: a recorded discrepancy (including zero received)
must not be described as a completed transfer.

Return value is inserted-row count: 1 for a new notice, 0 for an already emitted
recipient/type/source combination. A unique constraint enforces this even under
concurrent retries. One submission notice is stored per request ID, not per
resubmission attempt. Distinct approval IDs are distinct events. Bad IDs/states
raise SQLSTATE 22023. Emit historical events only through a separately authorized
reviewed backfill, if ever requested; this patch does not do so.

## Access, privacy and read semantics

- Inbox and mark-read derive the actor from `auth.uid()`. Require an active
  app_user, active department and at least one known application role.
- All users, including admins, can access ONLY their own inbox.
- Clients have no direct notification-table grants and cannot insert/delete
  messages or edit recipient/source references. RLS is enabled as a second
  boundary. Ordinary read access is through the scoped inbox RPC.
- Foreign, nonexistent and already-read IDs all return false from mark-read.
  A successful owner update is idempotent; subsequent calls do not move read_at.
- Existing event records are retained if an account is inactive; that account
  cannot read/update them until it meets active-account requirements again.
- Each inbox load returns at most 50 records plus a cursor, newest first.
  Created-time + UUID keyset pagination preserves microsecond precision and
  avoids offset shifts. New events require Refresh; they do not appear in the
  middle of already-loaded older pages. Mark-read refreshes from page one.
- Cursor and event references are validated; UI renders fixed event text and
  plain IDs, never untrusted HTML or arbitrary destination URLs.
- Notification FKs retain request/approval/transfer references; they do not
  cascade-delete business records. Coordinate any later data-retention cleanup.

## Verification

Prepared here: 21 C8 contract/source-regression tests passed, 15 C9 regression
tests passed, and 16 existing AI2 matching tests passed. Source-regression tests
inspect SQL text; they do NOT prove PostgreSQL privileges, trigger execution,
rollback or concurrency behavior. Full TypeScript/ESLint/browser and live SQL
execution were not possible in this preparation environment (dependencies and
PostgreSQL are absent; earlier npm installation was blocked by HTTP 403).

Run locally after copying:

```sh
npx tsc --noEmit
npx eslint app/protected/notifications components/NavBar.tsx
node --experimental-strip-types --test tests/shaikha-c8.test.mjs tests/shaikha-c9.test.mjs
node --experimental-strip-types --loader ./tests/shaikha-matching-loader.mjs --test tests/shaikha-matching.test.mjs
```

No new dependencies, application environment variables, service keys or AI
requests are needed. Do not change shared package module type to suppress Node
warnings. Tailwind-scanned source avoids the C9 filename-regex CSS issue.

### Browser acceptance checks

1. Authorized demo requester submits a NEW clearly fictional request after C8
   migration. Save its reference. Notifications link should show one unread
   **Request submitted** notice with the correct reference, not an old request.
2. Reload/Refresh repeatedly: no duplicate. The request still submits/tracks
   normally. Read status starts unread; mark it read, refresh/reopen, and verify
   it remains read. Unread filter excludes it and count changes appropriately.
3. Log into a different authorized demo account. It must not see the owner's
   notice. An admin must not see other users' notices either.
4. Use the live script below to attempt foreign mark-read and direct-table/
   producer calls with normal JWTs; ownership is not proven by UI hiding alone.
5. Test empty inbox and unread-only empty states. For 51+ notices on an isolated
   test account/database, Load older must avoid duplicates and include every
   notice. Do not mass-create records in the shared project merely for this.
6. After Renad connects each event, run a normal authorized approval, rejection
   and receipt scenario. Check correct recipient/type/reference, exactly once,
   and no notice on denied, rolled-back or self-approved actions. Include receipt
   discrepancy versus successful completion. Do not insert fake approvals or
   bypass stock/receipt checks just to make a demo notification appear.
7. Regression-check C4 submission/tracking, AI2 reviews, C9 reports and normal
   navigation. Inbox mark-read must not change business statuses or quantities.

### Live two-account check on authorized demo accounts

Create a new fictional request using the owner requester UI; do NOT mark its
notice read before running the script. Use two DIFFERENT existing authorized
demo accounts with active profiles/roles/departments. This script makes normal
auth sessions and marks only that owner's selected notice read. It does not
submit requests, change roles, touch allocations, insert outcomes or log secrets.

Mac zsh commands from project root (password input is hidden):

```sh
read 'shaikhaC8OwnerEmail?Demo requester email: '
read -s 'shaikhaC8OwnerPassword?Demo requester password: '
echo
read 'shaikhaC8OtherEmail?Different demo account email: '
read -s 'shaikhaC8OtherPassword?Different demo account password: '
echo
read 'shaikhaC8RequestId?NEW demo request reference: '
export shaikhaC8OwnerEmail shaikhaC8OwnerPassword shaikhaC8OtherEmail shaikhaC8OtherPassword shaikhaC8RequestId
node --env-file=.env.local --experimental-strip-types tests/shaikha-c8-access.mjs
unset shaikhaC8OwnerEmail shaikhaC8OwnerPassword shaikhaC8OtherEmail shaikhaC8OtherPassword shaikhaC8RequestId
```

Needs Node 24+. Missing migration, wrong passwords and unrelated errors must
print STOP, not count as successful permission denial. The notice must be in the
first 50 returned owner notices and still unread. Repeat testing needs another
NEW fictional request or an intentionally selected unread submission notice.
Credentials/tokens remain in the process only; no shared-account global logout.

### Isolated database producer/ACL test

`tests/shaikha-c8-isolated-db.sql` is for a disposable Supabase development/test
database with foundation/contract and C8 already installed. It creates fictional
fixtures inside BEGIN/ROLLBACK, tests all four producer events, deduplication,
pagination, account isolation and ACLs. It uses SQL role/JWT simulation, NOT real
login, and does NOT replace the live test above or Renad's end-to-end workflow
tests. Do NOT run it in the shared/production project or apply it as a migration.
It has not been executed in the preparation environment; review and run it in an
isolated database before claiming its checks passed. On error, ROLLBACK and
investigate; do not remove permission checks or modify real accounts.
The script refuses to start unless `SET shaikha.c8_allow_isolated_test = 'yes';`
was deliberately run in the same isolated database connection. This is an
operator opt-in, not automatic detection of a safe database. The fixture test
checks sequential retries, not a genuinely concurrent two-session race.

## Commit and handoff

After local and applicable live checks, stage only these files; preserve ZIPs,
duplicate copy files and secrets as untracked/ignored.

```sh
git config --get user.name
git config --get user.email
git add app/protected/notifications components/NavBar.tsx
git add supabase/migrations/20261122180000_shaikha_notifications.sql
git add tests/shaikha-c8.test.mjs tests/shaikha-c8-access.mjs tests/shaikha-c8-isolated-db.sql
git add docs/SHAIKHA_C8_HANDOFF.md
git diff --cached --stat
git commit -m "Add C8 private notification inbox and workflow event mechanism"
git push -u origin shaikha/c8-notifications
```

PR should list ACTUAL tests run and explicitly retain Renad's pending integration
items. Do not claim full C8 delivery before all four event paths are connected
and tested. Notify Budoor of the single NavBar link addition before merging.
