# AI2 / C5 reusable-evidence adapter — coordinated review only

## Status

Matching code is prepared against Renad's agreed five-field contract. **No SQL
was run and no shared Supabase data was accessed or modified.** The proposed new
migration is for joint review, NOT independent application. Provider storage,
authorization, parent-asset locking and typed submission remain Renad's work.

Prepared against the latest uploaded Shaikha source, plus the already-delivered
C8 patch. Since direct GitHub access from the preparation environment returned
403, this deliverable is a source patch, **not a pushed branch or commit**. Do not
report a commit SHA until the real project has been checked, committed and pushed.
The uploaded `scoring copy.ts` was compared with canonical `scoring.ts` in the
supplied project: they are byte-for-byte identical (SHA-256
`6f7bffdc4f5cc52ce2bfe88295c1459ef1ea788e415fd1969cc77a11ed466e61`).
There are no extra scoring changes to commit. The copy is not included or deleted;
canonical `scoring.ts` is unchanged.

## Changed files

- `app/protected/requests/reusable-evidence.ts` — strict reusable-facts adapter.
- `app/protected/requests/matching-contract.ts` — new source/version gate, mandatory item type, normalized evidence.
- `app/protected/requests/matching-actions.ts` — coordinated setup/version checks and clear messages.
- `app/protected/requests/matching-panel.tsx` — explains automatic typed rules and optional later editing.
- `supabase/migrations/20261122200000_shaikha_reusable_matching.sql` — PROPOSED new definitions for coordinated review only.
- `tests/shaikha-matching.test.mjs` — existing regression suite updated to the new input contract.
- `tests/shaikha-reusable-matching.test.mjs` — added adapter and SQL-source regression tests.
- This handoff.

No old migration, C8 file, scoring implementation, request submission action/form,
NavBar, role model, approval, stock, reservation, release or transfer code changes.

## Contract and behavior

All asset facts now originate from
`public.renad_reusable_asset_evidence(p_asset uuid) RETURNS jsonb`.
Only these fields are admitted:

```ts
{
  specifications: Record<string, string | number | boolean | null>;
  safetyStatus: "clear" | "restricted" | "unknown";
  inspectionRequired: boolean;
  inspection: {
    result: "passed" | "failed" | "unknown";
    inspectedOn: string;
    validUntil: string;
  } | null;
  earliestReceiptDate: string | null;
}
```

Null/missing/malformed evidence is ineligible; there is NO fallback to
`shaikha_asset_match_evidence` request–asset rows, Available/Good flags, asset
names or AI guesses. Old pair evidence is not deleted or rewritten.
Each request still supplies its own snapshot-bound mandatory/preferred rules.

The packet/read contract is now `weighted-reusable-v2` with
`evidence_source = renad_reusable_asset_evidence`. This deliberately fails closed
against old SQL. Coordinate the application and database rollout; copying the
frontend alone does NOT enable the provider or make live matching ready.

### Item-type routing

- Require exactly one mandatory string-valued `item_type` equality clause.
- Values are normalized to trimmed lowercase; `screen` maps to `monitor`.
  Other equivalents must be emitted consistently by the shared typed wrapper
  and provider; no fuzzy name-based or AI-based type inference is added.
- Printer and monitor candidates are separated BEFORE the 25-item shortlist,
  so a category full of monitors cannot crowd out a suitable printer.
- The provider may be evaluated for more than 25 basic assets to find the typed
  shortlist. Returned candidates and AI input remain bounded to 25; index/cache
  the source lookup and performance-test large categories with Renad.
- `base_total` still counts basic category candidates BEFORE item-type filtering;
  missing/unknown types cannot enter the same-type shortlist.

### Requirement edits and typed submission

Renad's `renad_submit_typed_request` must call the EXISTING
`shaikha_submit_request` once, then call `shaikha_confirm_matching_requirements`
once in that SAME transaction, under the original requester session. The rule
record includes the current request snapshot, submitted-by user, mandatory type
and initially empty preferred rules, as agreed. The matching UI does not require
a second confirmation when valid rules already exist.

The updated confirmation function preserves an existing mandatory item type if
an edit omits it, rejects changing it to a different type, rejects duplicates,
and prevents moving type to preferred rules. An explicit screen/monitor-equivalent
edit is allowed and canonicalized. New or legacy untyped requests need an explicit
type; it is never guessed from their free text. Existing extra mandatory/preferred
rules are still checked. Editing replaces the submitted rule arrays intentionally,
so the UI tells requesters to include the COMPLETE list of other mandatory rules.
Typed submission must capture all structured mandatory requirements that its
form collects; do not silently discard them or claim free text was verified.

The supplied patch intentionally does NOT guess the new typed-wrapper RPC
signature or replace the submission form/action. Renad must connect those to her
wrapper as part of the coordinated submission correction. Keep the old request
submission call single-use, with no fallback second submission if typing fails.

### C8 and duplicate protection

The C8 submission trigger, notification mechanism and original request submission
function are untouched. This adapter inserts NO requests, request-status-history
rows or notifications. It only updates feature-owned requirement records,
recommendations and their existing audit records. Do not install another
submission/notification trigger. A wrapper failure must roll back the request,
initial history, rules and C8 notice together; test this in an isolated database.

### Safety, dates, ranking and snapshots

Category, publication, Available state, stock quantity, Good/Fair condition,
clear safety and every mandatory specification remain eligibility gates.
Required inspections must be passed, non-future-dated and valid through the later
of today/required receipt date. Failed, missing or expired required inspection
never passes. Deadline requests still require a verified arrival date no later
than the deadline. Unknown arrival feasibility stays null and excludes deadline
requests; it is not replaced by today, asset-ready date or AI output.

Weights remain 35/25/10/10/10/5/5 and scoring version remains
`phase45-weighted-v1`: the formula, top-five cap, deterministic ties and confidence
warnings are unchanged. Missing optional factors are omitted from the denominator,
not scored as zero. Renad's contract provides no location/cost/environmental
scoring facts, so those factors remain null, even if a payload contains legacy
extra fields. Coverage and resulting normalized scores can legitimately differ
from old request-pair examples without changing any weight or formula.

Snapshots include the full current asset, request/rules and the canonical five
reusable evidence fields. Save recomputes the packet and rejects mismatches.
Read marks mismatched old snapshots ineligible. Accept re-fetches current facts
under a parent-asset share lock and rejects stale/ineligible recommendations,
including repeated accept calls if the evidence is no longer valid. It never
approves/reserves stock. Legitimate old weighted runs may display as stale and
must be regenerated; no historical rank/decision is silently rewritten.

## Renad's prerequisites BEFORE any SQL application

1. Provider returns deterministic current authorized/valid facts or null. It must
   enforce source freshness, authorized verification and revocation itself, since
   those metadata are not in the five-field return. Both approval and matching
   must use this same provider; matching does not independently guess validity.
2. Provider must work inside the private SECURITY DEFINER packet during both
   ordinary requester reads and the service-role save/revalidation path. The
   packet first verifies requester ownership via `shaikha_require_requester`.
   Do not grant broad evidence/table privileges or weaken provider authorization.
3. `earliestReceiptDate` must retain the SAME logical requesting-department arrival
   semantics in BOTH caller paths, not change to asset availability or depend on
   an absent service-role `auth.uid()`. If context cannot be established safely,
   return null. Test requester A/B from different departments explicitly.
4. Evidence insert/update/revocation and any edit affecting eligibility MUST acquire
   the same parent `public.asset` row FOR UPDATE, held to transaction end. Save
   takes ordered FOR SHARE locks on category assets; accept takes FOR SHARE on
   the selected asset before provider re-read. Finalize this shared lock order
   with approval to avoid races and deadlocks. The provider alone cannot lock
   unspecified child tables on behalf of the adapter.
5. Apply provider dependencies before this new adapter; the file checks the
   function exists and returns jsonb. Existence checks do NOT prove the locking
   contract. Do not apply until that review and isolated tests are complete.
6. Coordinate one forward-only correction. Renad may integrate these reviewed
   definitions into the jointly owned new migration, OR apply this new file after
   her provider migration, but do not apply BOTH copies. Coordinate the migration
   timestamp/order before automatic migration tooling. Never rerun old migrations.

## Verification performed here

78 automated Node checks passed: 16 existing matching regressions, 26 new reusable
adapter/source guards, 21 C8 and 15 C9 checks. The documented weighted 84.5 example
is preserved. New scenarios cover printer/monitor separation, screen alias,
two requests sharing facts, per-request mandatory differences, missing evidence,
inspection/date failures, omitted optional factors and top-five ranking.

SQL-source guards check that snapshot/ownership/locking statements remain and
the proposed file does not insert requests/history/notices or edit C8 triggers.
They are NOT executed PostgreSQL tests. No SQL, Gemini calls, browser tests or
live approval/transfer operations were run here. Full TypeScript/ESLint remain
local checks because this environment lacks project dependencies and earlier
npm installation was denied (403). Do not claim these pending checks passed.

## Local install and commit (NO SQL)

The uploaded scoring copy comparison is complete: no extra changes were found.
Leave that duplicate untracked; this patch does not replace `scoring.ts`.
The ZIP contains ONLY the eight adapter files listed above, not the rest of C8.

From a clean tracked worktree with the merged C8/C9 main (preserve untracked files):

```sh
git status --short
git switch main
git pull --ff-only origin main
git switch -c shaikha/reusable-matching
```

Copy individual patch files into matching paths; replace only the four existing
matching UI/contract/action/test files listed above. Preserve whole folders and
all other team edits. The proposed SQL is for review, not execution. Then run:

```sh
npx tsc --noEmit
npx eslint app/protected/requests
node --experimental-strip-types --loader ./tests/shaikha-matching-loader.mjs --test tests/shaikha-matching.test.mjs tests/shaikha-reusable-matching.test.mjs tests/shaikha-c8.test.mjs tests/shaikha-c9.test.mjs
git diff --stat
```

Only after resolving errors and reviewing the diff:

```sh
git add app/protected/requests/reusable-evidence.ts app/protected/requests/matching-contract.ts app/protected/requests/matching-actions.ts app/protected/requests/matching-panel.tsx
git add tests/shaikha-matching.test.mjs tests/shaikha-reusable-matching.test.mjs
git add supabase/migrations/20261122200000_shaikha_reusable_matching.sql docs/SHAIKHA_REUSABLE_MATCHING_HANDOFF.md
git diff --cached --stat
git config --get user.email
git commit -m "Adapt AI2 matching to shared reusable verified asset facts"
git push -u origin shaikha/reusable-matching
git log -1 --format="%H | %an | %ae | %s"
```

Share the REAL pushed branch/SHA with Renad and describe SQL as proposed and
unapplied. PR must require coordinated review; do not merge/deploy this adapter
against old database functions. Leave ZIPs, `scoring copy.ts` and secrets unstaged.

## Joint acceptance checklist (after coordinated DB review, not now)

- One typed request creates exactly one request, one initial history entry and
  one C8 submission notice; invalid type/rule rolls ALL of them back.
- Typed requests rank without a second confirmation form; later edits cannot
  remove/change their canonical item type, but all other mandatory rules remain
  evaluated. Legacy untyped/stale-rule requests fail until explicitly corrected.
- Printer request rejects monitors; monitor request rejects printers; valid
  evidence with `screen` is canonical monitor. A suitable typed asset is found
  even when 25+ other-type assets precede it in category/UUID order.
- Same asset facts work for two requests; one may still fail its different
  mandatory specs, stock or arrival deadline. Missing evidence never passes.
- Revoke/expire/update facts between generation and save, and between save and
  accept: stale rankings are rejected. Run TWO-SESSION races with evidence writes
  holding the agreed parent lock to verify blocking/revalidation and lock order.
- Assert SQL/JS factor parity on actual provider payloads; optional factors stay
  null. Verify requester A/B and service-role saves keep arrival semantics correct.
- Repeat ownership, safety/inspection, insufficient-stock, rejected/self-approval,
  reservation/release/receipt and C8/C9 regressions through normal authorized
  workflows. No direct production fixture inserts or permission bypasses.
