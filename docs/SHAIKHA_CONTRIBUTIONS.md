# Shaikha Alsereidi — Mandatory Feature Contribution Record

GitHub account: [Shaikha-Alsereidi](https://github.com/Shaikha-Alsereidi)

This record documents Shaikha's assigned mandatory implementation work and the tests performed with the team's demonstration accounts and database. It is not a claim that every group feature, deployment or production scenario has been verified.

## Features and implementation evidence

| Feature | Contribution | Implementation files | Pull request |
| --- | --- | --- | --- |
| C4 — Request and track | Request submission, persistent own-request tracking, input validation and submission/status-history display; backend ownership restrictions. | `app/protected/requests/page.tsx`, `app/protected/requests/actions.ts`, request submission/tracking migrations. | [PR #2 — merged into main](https://github.com/Software-Engneering-Lab/asset-management-system/pull/2) |
| AI2 — Matching and ranking | Up to five recommendations; eligibility checks before AI assessment; documented weighted scoring; score, evidence coverage and warnings; saved requester accept/reject decisions. Acceptance does not itself approve, reserve or transfer stock. | Matching, eligibility and scoring files in `app/protected/requests/`; matching migrations and `tests/shaikha-matching.test.mjs`. | [PR #2 — merged into main](https://github.com/Software-Engneering-Lab/asset-management-system/pull/2) |
| AI5 — Generated report | Database-calculated operational figures, Gemini-generated summaries, clearly labelled non-AI fallback, admin editing/review and publication, with original draft preservation. | `app/protected/reports/actions.ts`, `app/protected/reports/page.tsx`, `supabase/migrations/20261114000700_shaikha_reports.sql`. | [PR #3 — merged into main](https://github.com/Software-Engneering-Lab/asset-management-system/pull/3) |

### Key implementation commits

- [`7a96f7c`](https://github.com/Software-Engneering-Lab/asset-management-system/commit/7a96f7c): C4 request submission and tracking.
- [`eb989b6`](https://github.com/Software-Engneering-Lab/asset-management-system/commit/eb989b6): initial AI2 matching and recommendation review.
- [`2898161`](https://github.com/Software-Engneering-Lab/asset-management-system/commit/2898161): AI2 weighted-scoring and verified-eligibility correction.
- [`e213016`](https://github.com/Software-Engneering-Lab/asset-management-system/commit/e213016): AI5 generation, admin review and publication.

The original implementation branches were `shaikha/requests-ai` and `shaikha/ai-reports`. The team’s updated main branch was subsequently merged into the feature work and the local checks were repeated before pushing.

## Verification performed

These results were obtained through local application use, authenticated Supabase client tests, read-only database comparisons and the retained automated tests. They describe the exercised scenarios, not exhaustive security certification.

### C4

- Submitted the labelled fictional laptop request and confirmed it remained after refreshing.
- Confirmed one initial submission-history entry. A later `Submitted` → `Under Review` entry was dated 17 November 2026 with the reason `Approver started review`, preceding the 19 November recommendation-review test.
- Confirmed a different active requester saw no requests belonging to the first requester in its own-request list.
- Authenticated ownership tests confirmed the owner could access the existing request and the second requester had a functioning request workspace.
- The second requester was denied the other request's matching read, candidate retrieval and matching-rule operation; a direct table query revealed no foreign request.

### AI2

- TypeScript and feature-folder ESLint checks passed.
- All 16 retained matching/scoring/eligibility tests passed, including the documented 84.5/100 example, missing-versus-zero handling, tie-breaking and the five-result cap.
- The live application initially excluded two basic candidates lacking verified evidence and made no AI call.
- Six separately labelled fictional laptop fixtures were registered through the existing admin asset workflow, then populated with explicitly simulated test evidence. These are not real assets or real safety certifications.
- Generated a weighted run and confirmed five saved recommendations, including a displayed 96.11/100 score with 90% coverage. Missing AI confidence was labelled rather than invented.
- Saved accept/reject decisions, including rejection reasons, and confirmed persistence after refreshing.
- The post-review check showed available quantity 2 for each fictional laptop, zero request reservations and zero request approvals. Request history showed no new status transition caused by the matching review.

### AI5

- Generated an AI draft for 16–19 November 2026, using inclusive UTC reporting dates.
- Compared the four displayed figures against independent read-only SQL: 2 submitted requests, 0 completed transfers, 0 known received units and 0 completed transfers missing received quantities.
- Saved an admin edit, refreshed to verify persistence and confirmed the original generated draft was preserved.
- Published the reviewed demonstration report and received a publication confirmation.
- Temporarily disabled the local Gemini key, restarted the development server and generated a separate draft labelled `Database-generated fallback—not AI`; the Gemini configuration was then restored.
- Authenticated requester tests returned access-denied code `42501` for report workspace reading, figure calculation, privileged draft saving, editing and publication.

## Scope and handoff notes

- Login/role provisioning and shared navigation belong to Budoor. Approval, reservation, transfer and lifecycle operations belong to Renad. Full cross-feature approval/transfer alignment remains a team integration responsibility.
- Production deployment/build validation, exhaustive concurrency/security testing and all possible nonzero-transfer report scenarios are not claimed by this record.
- The fictional matching evidence created on 19 November expires on 26 November 2026. Any later demonstration must check expiry and current fixture state; do not relabel simulated evidence as real certification.
- Optional C8 notifications and C9 basic tables/CSV export were not part of the mandatory-feature commits listed above. They must be documented separately when implemented and tested.
- Applied SQL migrations must not be rerun merely because their files are merged or downloaded.
- Initial command-line implementation commits used an automatically generated local Git identity (`sh97`), not a GitHub-linked author email. This explains the attribution mismatch; the linked PRs and commits preserve the implementation record. Configuring the correct identity for new commits does not rewrite those historical commits or transfer their contribution statistics.

No account passwords, API keys or other credentials belong in this record.
