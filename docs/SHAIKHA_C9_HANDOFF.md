# Shaikha — C9 basic reports and CSV

Scope: C9 only. This patch does not implement C8 notifications, replace AI5
summaries, or change approval/transfer workflows. No new npm dependencies,
environment variables for the application, or AI keys are needed.

## Included files

- `app/protected/reports/page.tsx`: adds a link inside the existing authorized AI5 workspace.
- `app/protected/reports/records/page.tsx`: filters, table, pagination and CSV download.
- `app/protected/reports/records/actions.ts`: signed-in server action; normal Supabase client.
- `app/protected/reports/records/record-model.ts`: validation and CSV helpers.
- `supabase/migrations/20261122160000_shaikha_basic_report_rows.sql`: NEW read-only admin RPC and supporting indexes.
- `tests/shaikha-c9.test.mjs`: dependency-free contract/CSV tests.
- `tests/shaikha-c9-access.mjs`: optional live authenticated, read-only RPC checks.
- This handoff.

No shared layout, navigation component, global stylesheet, package file, existing
migration, evidence record or business table row is modified by this patch.

## 1. Prepare your existing bonus branch

Run in your project terminal, not inside a running development server:

```sh
git status --short
git switch main
git pull --ff-only origin main
git switch shaikha/bonus-reports-notifications
git merge --no-edit origin/main
```

The bonus branch was already created earlier. If a command fails or reports
conflicts, stop and inspect `git status`; do not force or reset anything. Preserve
your untracked ZIP files and `scoring copy.ts`; do not stage them.

Unzip the patch into a separate folder. Copy the listed individual files into the
matching project paths. Replace only `app/protected/reports/page.tsx`; merge the
new files into their existing folders. Do not replace whole `app`, `docs`, `tests`
or `supabase` folders. Keep `docs/SHAIKHA_CONTRIBUTIONS.md` and all team files.
If somebody has edited the reports page since this source ZIP, merge its small
link/import change instead of overwriting their work.

## 2. Review and apply only the NEW migration

The prerequisite is the already-applied AI5 migration 007, specifically its
private `shaikha_report_admin(uuid)` helper. Do NOT rerun migration 007 or any
other old migration. Review and apply ONLY:

`supabase/migrations/20261122160000_shaikha_basic_report_rows.sql`

Use your team's authorized migration process, once. It runs in a transaction,
creates three indexes and one function, and grants that function to authenticated
clients. The function independently requires an active admin profile, active
department and admin role, using the existing AI5 helper. Anonymous callers have
no execute grant. Other signed-in users receive permission denied. No direct table
grants, existing policies or existing functions are changed. Do not disable RLS.

Applying to a large database can lock tables while indexes build; coordinate an
appropriate time. If it reports an existing object, do not delete anything or
rerun other migrations: confirm whether this new migration was already applied.

## 3. Local checks

From the project root with your existing installed dependencies:

```sh
npx tsc --noEmit
npx eslint app/protected/reports
node --experimental-strip-types --test tests/shaikha-c9.test.mjs
```

Prepared-package result: 15/15 dependency-free tests passed under Node 24.
Full TypeScript, ESLint, browser checks and live Supabase checks were NOT run in
the preparation environment: dependency installation returned npm HTTP 403.
Run those checks locally before committing. Node's MODULE_TYPELESS warning is
non-fatal; do not change the shared package type just to suppress it.

## 4. Browser test

Start `npm run dev` once. If it is already running, use the existing server.
Log in with an authorized demo admin and open Operational Reports. Click
**Basic request/transfer tables and CSV export (C9)**, or use
`http://localhost:3000/protected/reports/records`.

1. Choose Requests and an inclusive UTC period containing existing demo requests;
   load it and compare IDs, quantities, dates and statuses with known records.
2. Filter to one request status; verify every returned row has that status.
3. Export and open the CSV. It includes ALL loaded rows, across 25-row table pages.
   Empty database values stay empty in CSV; recorded zero remains `0`.
4. Change a filter without loading: the previous table stays labelled, and export
   is disabled until reloading. An empty result has a clear message and can export
   headers only. No invented sample records are inserted.
5. Select Transfers; compare with existing demo transfers, if any. Zero rows is
   not an error but does not verify non-empty transfer display. For that test,
   coordinate a normal authorized demo transfer with Renad; do not fabricate
   approvals or bypass the workflow using direct inserts.
6. Check a UTC start/end boundary and a period longer than 366 inclusive days.
   Invalid periods/statuses must be rejected, not silently corrected.
7. For datasets over 25 rows, confirm Next/Previous and that CSV contains all
   loaded records. Over 1,000 matching records, display is explicitly capped and
   CSV is disabled. Narrow the period/status. Do not claim a complete export of a
   truncated result. The unit tests exercise the cap even if live data is small.
8. Verify old AI5 draft, review and publication screens still work normally.
   Reading/exporting C9 must not approve requests, reserve stock or create transfers.

### Date meaning is deliberately explicit

| Table | Inclusive UTC filter | Reason |
| --- | --- | --- |
| Requests | `resource_request.created_at` | Basic creation-period records, including drafts |
| Transfers | Linked `approval.decided_at` | Shared transfer table has NO creation timestamp |
| Existing AI5 summary | Request submission / completed transfer receipt dates | Existing operational aggregate definition, unchanged |

Consequently a C9 row count need not equal an AI5 aggregate for identical dates.
Records are read in one bounded statement, ordered newest date then stable UUID.
They are a loaded snapshot, not live updates. Reload for later changes.

### CSV handling

CSV is UTF-8 with BOM, quoted fields, doubled internal quotes and CRLF record
separators. Arabic, commas, quotes and embedded newlines are preserved. Known
formula-like text receives an apostrophe plus tab prefix inside the quoted cell;
this deliberately changes that cell for human spreadsheet viewing, so CSV is
NOT a lossless machine-import format. Do not remove protective prefixes or enable
formulas. Spreadsheet editing/resaving can change protection: no escaping method
guarantees safety in every spreadsheet or after arbitrary transformations.

References: https://www.rfc-editor.org/rfc/rfc4180 and
https://owasp.org/www-community/attacks/CSV_Injection

## 5. Optional live permission checks (no business writes)

Use Node 24+ from the project root. The script uses your existing public Supabase
URL/key from `.env.local`, never a secret/service key. It logs no passwords or
tokens. It checks anonymous denial, then the selected existing account. Use only
authorized demo credentials; do not reset another person's account for a test.

On your Mac's zsh terminal, enter these lines. Type credentials at the prompts;
the password is hidden:

```sh
read 'shaikhaC9Email?Demo account email: '
read -s 'shaikhaC9Password?Demo account password: '
echo
read 'shaikhaC9Expected?Expected access (admin or denied): '
export shaikhaC9Email shaikhaC9Password shaikhaC9Expected
node --env-file=.env.local --experimental-strip-types tests/shaikha-c9-access.mjs
unset shaikhaC9Email shaikhaC9Password shaikhaC9Expected
```

Run once with an active demo admin (`admin`) and again with the demo requester
(`denied`). A missing migration, wrong password or connection failure prints
STOP and is NOT counted as successful permission denial. The admin run additionally
checks database rejection of invalid filters. The fixed November 2026 period can
legitimately return zero rows. The script does not verify browser rendering,
inactive-profile behavior, or non-empty data automatically; those remain manual
checks. Do not change real roles/statuses without the team's approval.

## 6. Commit only after checks pass

```sh
git config --get user.name
git config --get user.email
git diff -- app/protected/reports/page.tsx
git add app/protected/reports/page.tsx app/protected/reports/records
git add supabase/migrations/20261122160000_shaikha_basic_report_rows.sql
git add tests/shaikha-c9.test.mjs tests/shaikha-c9-access.mjs docs/SHAIKHA_C9_HANDOFF.md
git diff --cached --stat
git commit -m "Add C9 admin request and transfer reports with CSV export"
git push -u origin shaikha/bonus-reports-notifications
```

Before committing, the configured author should be Shaikha and the GitHub-linked
email already set for this repository. Do not use `git add .`. Review the staged
list: no credentials, ZIP files, unrelated code or duplicate copy files.
Create a PR into `main` for C9, report the actual local/live test results, and
follow team review rules. C8 notifications come after C9 is tested and integrated.
This new correctly attributed commit does not rewrite ownership of older commits.
