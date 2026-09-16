# CHECKPOINT 12 — Application Tracking Report

**Date:** 2026-09-09
**Status:** VALIDATED — READY FOR CHECKPOINT 13

---

## 1. Status

**IMPLEMENTED — VALIDATED.** Application Tracking is complete end-to-end: an authenticated user can create an application from any job, update its status and watch the honest timeline advance (applied → responded → interviewed → decided), set a personal 0–100 fit rating, add notes, and remove it. Ownership is derived strictly from the JWT — cross-user isolation is enforced and explicitly tested. The feature runs on the **existing `Application` DB model** keyed by `(user_id, job_stable_id)`, replacing the previous CSV-backed router: **no schema change, no migration**. The CSV tracker is left untouched as the CLI's operating tracker and the pipeline's retention source. Pipeline files are byte-identical before, during, and after the live smoke (verified against the CP11 recorded hashes).

---

## 2. Scope

| In scope (CP12) | Out of scope (CP13+ / deferred) |
|---|---|
| Create / list / get / update / delete applications (JWT-scoped) | AI matching, resume tailoring, cover letters — roadmap features |
| Status-driven timeline (applied/responded/interview/decided), never overwritten | Personalized matching engine — **does not exist and is not built** |
| Personal fit rating on the **0–100** scale (fixing the pre-existing `/5` display bug) | Writing web applications back to the CLI CSV tracker (intentionally separate stores) |
| 0–100 fit rating surfaced on Ranked Jobs and Job Detail (scale bug fix) | Redesigning the frontend or re-architecting the pipeline |

No discovery, canonicalization, hard-filter, verification, scoring, ranking, search, or pipeline-adapter logic was touched.

---

## 3. Existing `Application` Architecture (Reused)

Prior to CP12 the `Application` DB model (`backend/app/models/database_models.py`) already represented per-(user, job) application state:

- One row per `(user_id, job_stable_id)` with `ApplicationStatus` enum: `draft, submitted, under_review, interview, offer, rejected, withdrawn, accepted`.
- Timeline columns: `applied_at, responded_at, interview_at, decided_at`; bookkeeping `created_at, updated_at`; snapshot columns `company, role, role_type, sector, channel, contact_person, source, notes, fit_rating, cv_file, cover_letter_file`.

CP12 conclusion: **the DB `Application` table IS the web application tracker.** The previous router read/wrote `job_search_tracker.csv`; this checkpoint replaces it with the DB-backed, JWT-scoped router. The CSV remains the **CLI's** tracker and the retention-protection source (`store.get_application_stable_ids()`), never written by the web API. Per implementation plan §D: *"Application table keyed by stable_id … CSV is the legacy export; the web app becomes the source of truth."*

---

## 4. Backend Changes

| File | Change |
|---|---|
| `backend/app/models/application_schemas.py` | **NEW** — `ApplicationCreate` (`stable_id`, optional `status` default `draft`, optional `fit_rating` `ge=0 le=100`, `sector`, `role_type`, `channel`, `source`, `notes`), `ApplicationUpdate` (all incremental fields optional), `ApplicationDetail` (full record + `available: bool` + `job: JobRecord \| None`). Docstring is explicit that company/role are derived server-side from the dataset — never fabricated from client input. |
| `backend/app/routers/applications.py` | **REWRITTEN** — DB-backed, JWT-scoped CRUD at `/api/applications` (see §5). Replaces the CSV-backed router. |
| `backend/tests/test_applications.py` | **NEW** — 26 tests (see §15). |

**No schema change, no Alembic migration, no change to existing models, other routers, or store logic.** `main.py` already imported and mounted the applications router, so nothing in the app wiring changed.

---

## 5. API Endpoints

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/applications` | JWT (required) | Authenticated user's applications, most-recently-updated first. Never returns another user's rows. |
| `POST` | `/api/applications` | JWT (required) | Create an application for a job **in the current global dataset** (`stable_id` required). Company/role are snapshotted from the dataset server-side. `404` if the job is not in the dataset (honest). `409` if an **open** (non-terminal) application already exists for `(user, job)`. Re-creation is allowed after a terminal status. |
| `GET` | `/api/applications/{app_id}` | JWT (required) | Get one owned application. Cross-user or unknown id → `404` (no existence leak). |
| `PATCH` | `/api/applications/{app_id}` | JWT (required) | Update the application and advance its honest timeline. Any subset of `status`, `fit_rating`, `sector`, `role_type`, `channel`, `contact_person`, `source`, `notes`. Timeline timestamps are set on transitions and **never overwritten** (§7). |
| `DELETE` | `/api/applications/{app_id}` | JWT (required) | Delete the owned application. `204` only for owned rows; non-owned/unknown → `404`. Never modifies saved-job state or the CSV tracker. |

All routes 401 when unauthenticated; an invalid status value → `422`. `fit_rating` is bounded `0–100` by the schema.

---

## 6. User Ownership / Security Model

**MANDATORY requirement met — identity is derived from the JWT on the server, never from the client:**

- `get_current_user` (existing dependency from `app.routers.auth`) resolves identity from `payload["sub"]` and checks `UserStatus.ACTIVE`.
- The frontend never sends a `user_id`; ownership comes only from the Bearer token's `sub` claim.
- `list` filters `Application.user_id == current_user.id`.
- `create` writes `user_id = current_user.id`.
- `get`/`patch`/`delete` use `_get_owned(session, user_id, app_id)` → `404` for any row not owned by the caller. **User A's row is physically unreachable and undetectable by User B** (no existence leak — a foreign row and a nonexistent row are both `404`).

**Verified by tests** (`TestApplicationsCrossUser`, `TestApplicationsAuthorization`) and by the live smoke (User B receives `404` on A's row for get/patch/delete and sees an empty own list).

---

## 7. Application Semantics (Exact)

| Operation | Behavior |
|---|---|
| **Open-application rule** | Only one **open** (non-terminal: not accepted/rejected/withdrawn) application per `(user, job)`; a second create → `409`. After a terminal status, a fresh application is allowed (new lifecycle). |
| **Timeline honesty** | `applied_at` set when status → `submitted` (also set at create if created as `submitted`); `responded_at` on the first employer/response signal (`under_review`, `interview`, `offer`, `rejected`, `accepted`); `interview_at` on `interview`; `decided_at` on a terminal status. Each timestamp is set once and **never overwritten** — advancing the status later cannot retroactively rewrite history. |
| **Fit rating scale** | Personal `fit_rating` is **0–100** (schema-bounded). This fixes the pre-existing `/5` display bug in Job Detail / Ranked Jobs — the global pipeline `rank_score` was never a 1–5 scale either. |
| **Anti-fabrication** | `company`/`role` are derived from the global dataset at create time (server-side), never from client input. If the job later leaves the dataset, the row stays but the API returns `available=false` and `job=null` — the UI shows "No longer available" honestly. Creating an application for a `stable_id` not in the dataset → `404`. |
| **Separation of stores** | Web applications live in the DB and are the web's source of truth. The CSV tracker (`job_search_tracker.csv`) is never written by this router; it remains the CLI tracker and the retention-protection source. Deleting an application never affects saved-job rows or tracker state. |

---

## 8. Frontend Changes

| File | Change |
|---|---|
| `frontend/src/api/types.ts` | **NEW** `APPLICATION_STATUSES` (8 statuses), `ApplicationStatus`, `ApplicationRecord`, `ApplicationCreate`, `ApplicationUpdate`. |
| `frontend/src/api/client.ts` | `getApplication(appId)`, `deleteApplication(appId)`; `updateApplication` changed from CSV index-based to PATCH-by-id. |
| `frontend/src/api/endpoints.ts` | `applicationsApi = { list, get, create, update(appId, payload), remove(appId) }` (typed). |
| `frontend/src/hooks/useApplications.ts` | **REWRITTEN** — query key `['applications']`; `useApplications`, `useApplication(appId)`, `useCreateApplication`, `useUpdateApplication`, `useRemoveApplication`. Every mutation invalidates `['applications']` + `['dashboard']` (and the detail key on update) so server state stays authoritative across all surfaces. |
| `frontend/src/pages/Applications.tsx` | **REWRITTEN** — the application tracker page (see §11). |
| `frontend/src/pages/JobDetail.tsx` | Application context card rewritten to the new contract: `ApplicationStatusBadge` (color-coded status), a `TimelineDate` helper for applied/responded/interview/decided rows, `fit_rating` shown as `/100` (≥80 success, ≥60 warning, else danger, hidden when `0`), plus the existing "View in application tracker" link. |
| `frontend/src/pages/RankedJobs.tsx` | `applicationMap` lookup key fixed from `app.stable_id` → `app.job_stable_id`; fit rating badges on both desktop rows and mobile cards moved to the `/100` scale with the ≥80/≥60 thresholds (hidden when `0`). |

TanStack Query patterns match the existing codebase (typed endpoint fns, dedicated hooks, `staleTime`/`retry`, query-key-scoped invalidation). No new global state — application status is derived from the one `['applications']` query across Ranked, Detail, and the tracker page.

---

## 9. Applications Page (`/applications`)

- **Header:** "Applications" title with a live count, a Refresh button, and a plain-language note — *"These are applications you record in your CareerPilot tracker … Moving a status updates the honest timeline — applied, responded, interviewed, decided."*
- **Desktop table:** Applied date (`applied_at` fallback `created_at`), Company (+sector), Role (+role_type), Status (inline `<select>` + color badge), Channel, Fit Rating (inline editor, 0–100), Notes (inline editor), Linked Job (links to detail when the job is still in the dataset; honest "No longer available" badge otherwise), and a two-click Remove control.
- **Mobile cards:** same fields as the table (title = role, company, sector, applied date, channel, status select + badge, fit-rating editor, view-job link, notes, remove).
- **Inline editing with no page reload:** status/fit/notes edit in place and commit via `PATCH`; mutations invalidate the shared query so the row reconciles to server truth.
- **Empty state:** `NoApplications` prompt. **Loading:** skeleton table. **Error:** `NetworkError` with retry; 401 surfaces the signed-out style.
- **Status colors:** `draft/withdrawn` neutral, `submitted` info, `under_review/interview` warning, `offer/accepted` success, `rejected` danger. Colors always pair with text.

---

## 10. Job Detail & Ranked Jobs Integration

- **Job Detail:** the application context card reads `linkedApplication = applications.find(app => app.job_stable_id === stable_id)` and renders the status badge, applied/responded/interview/decided timeline (each as `yyyy-MM-dd` via `TimelineDate`, `—` when not yet recorded), channel, `fit_rating` as `/100`, notes, and the tracker link. "Apply" creates the application as `status: 'draft'` with `channel` from the job portal — the client passes only `stable_id`; **fit_rating is deliberately never auto-filled**: passing the global pipeline `rank_score` into the user's personal 0–100 fit rating would mislabel global ranking as a personalized rating.
- **Ranked Jobs:** the existing "Application" column signals tracked state per row on desktop and mobile. The map now keys by `job_stable_id` (the correct FK), so tracked status and fit actually appear on the matching rows — and fit shows `/100` with the same thresholds as the tracker page.

---

## 11. Dashboard / Navigation Integration

The dashboard already counts DB `Application` rows per user (`application_count`), so the existing stats stayed correct with no backend change. Creating/updating/removing an application invalidates `['dashboard']`, keeping the number reconciled to server truth. No sidebar/route change was required — the Applications page already existed in the app shell from earlier checkpoints.

---

## 12. Accessibility

- Status/fit/notes editors are real `<select>`/`<textarea>` controls with labels or `aria-label`s; `Enter`/blur commit edits, and a disabled + spinner state is shown while a mutation is pending (no silent non-responsiveness).
- `RemoveButton` is a two-click confirm (label flips to "Confirm remove") and resets on blur — destructive actions are never single-click.
- Decorative SVGs carry `aria-hidden="true"`; semantic `<table>` on desktop, cards with headings + links on mobile.
- Fit/status colors always pair with text, so state is legible in light/dark theme and without color alone.
- The "What tracking means" note uses `role="note"` so screen readers hear the honest scoping.

## 13. Responsive UX

Uses the exact Ranked Jobs responsive pattern: a **desktop table** (`hidden lg:block`, horizontal scroll on narrow desktop) and **mobile cards** (`lg:hidden`). Tables scroll inside their own `overflow-x-auto` container — no horizontal page growth.

---

## 14. Tests

### Backend — `backend/tests/test_applications.py` (26 tests, all passing)

```
Authorization
✅ test_list_requires_auth           anonymous GET → 401
✅ test_create_requires_auth         anonymous POST → 401
✅ test_get_requires_auth            anonymous GET /{id} → 401
✅ test_update_requires_auth         anonymous PATCH → 401
✅ test_delete_requires_auth         anonymous DELETE → 401

Lifecycle
✅ test_create_application           create draft → 201, dataset-derived company/role
✅ test_create_sets_applied_at_when_submitted
✅ test_list_returns_owned_applications
✅ test_get_application_by_id
✅ test_get_missing_returns_404
✅ test_duplicate_open_application_409
✅ test_recreate_after_terminal_status
✅ test_update_status
✅ test_update_fit_rating
✅ test_delete_application           204 → list empty
✅ test_delete_missing_returns_404

Timeline
✅ test_submitted_sets_applied_at
✅ test_response_status_sets_responded_at
✅ test_interview_sets_interview_at
✅ test_terminal_sets_decided_at
✅ test_timestamps_never_overwritten   advancing status cannot rewrite history

Cross-user isolation
✅ test_user_b_cannot_read_user_a_app          get → 404
✅ test_user_b_cannot_update_user_a_app        patch → 404
✅ test_user_b_cannot_delete_user_a_app        delete → 404
✅ test_users_keep_separate_lists

Honesty / protection
✅ test_removed_job_is_available_false         available=false, job=null (no fabrication)
✅ test_delete_preserves_saved_state           delete app leaves saved-job row intact
```

- Full backend suite: **216 passed** (190 baseline from CP11 + 26 new), exit 0, no regressions.
- Test DOOD pattern: per-function `db_manager` fixture (tempfile sqlite), `store_files` monkeypatch for the global job dataset, `create_user` + `auth_header` helpers — matching `test_saved_jobs.py`.

### Frontend

- `npx tsc --noEmit` → **zero TypeScript errors** after all CP12 edits.
- `npm run build` (`tsc -b && vite build`) → **green production build**; 480 modules; `dist/assets/index-*.js` 587 kB gzip 150 kB. (The 500 kB chunk-size warning pre-exists.)

---

## 15. Live Smoke Results (fresh backend, own process)

A **fresh backend was started on port 8099** (own process, using a **copy** of the dev DB so the real `careerpilot.db` was never written; the user's dev server on port 8000 was left untouched throughout, confirmed healthy before and after). The smoke ran against the **real global job dataset** — picked a real `stable_id` from `job_scraper/ranked_jobs.json` (First Focus — Systems Administrator/L3 Support) and derived its company/role over the wire.

**32/32 checks passed:**

```
✅ create draft → 201
✅ create derives dataset company (First Focus)
✅ create derives dataset role (Systems Administrator/L3 Support)
✅ in-dataset job marked available=true
✅ available job carries its job record
✅ draft has null applied_at
✅ duplicate open application → 409
✅ list returns created app
✅ get by id → 200
✅ submitted sets applied_at
✅ submitted has no responded_at yet
✅ under_review sets responded_at
✅ applied_at preserved (never overwritten)
✅ interview sets interview_at
✅ rejected sets decided_at
✅ terminal status recorded
✅ fit_rating update → 200
✅ fit_rating 85 stored
✅ recreate after terminal → 201
✅ unknown stable_id → 404 (honest)
✅ cross-user get → 404
✅ cross-user patch → 404
✅ cross-user delete → 404
✅ second user sees own empty list
✅ unauthenticated GET/POST/GET {id}/PATCH/DELETE → 401 (×5)
✅ invalid status → 422
✅ delete own row → 204
✅ get deleted → 404
```

**Cleanup after smoke:** the port-8099 backend was terminated, and the throwaway DB copy (`smoke_cp12.db`) and the smoke script were deleted. `careerpilot.db` was byte-untouched (mtime unchanged); port 8000 on the user's dev server remained live.

**Honest limitation (unchanged from CP11):** a real in-browser click-through was **not** executed because the running Vite dev-server proxy is hardcoded to the user's backend on port 8000 and no browser-automation tool is available in this environment. The feature is verified at the **API contract level** (32/32 live), components pass strict TypeScript, the production build is green, and every UI surface derives application state from that one verified API via a shared query.

---

## 16. Pipeline Preservation Verification

The five canonical data files were verified byte-identical to the CP11-recorded values (same MD5) during and after the live smoke:

| File | MD5 | CP11 value |
|---|---|---|
| `job_scraper/canonical_jobs.json` | `6e4d4456…` | identical |
| `job_scraper/seen_jobs.json` | `5ad07af7…` | identical |
| `job_scraper/ranked_jobs.json` | `5827937c…` | identical |
| `job_scraper/checkpoints.json` | `ef8a5850…` | identical |
| `job_search_tracker.csv` | `5d3a1dfa…` | identical |

The smoke backend read the global dataset and wrote only to a throwaway DB copy; the real `careerpilot.db` was never touched by the smoke. No discovery, canonicalization, hard-filter, verification, scoring, ranking, search-API, pipeline-adapter, or CLI-script logic was modified.

---

## 17. Senior Frontend Audit Findings

| Area | Finding |
|---|---|
| **Architecture** | Reused patterns end-to-end (typed API fns → dedicated hooks → shared query key → reusable components). Single source of truth for application state (`['applications']`), cross-surface consistency via invalidation of `['applications']` + `['dashboard']`. No new global state, no prop drilling. |
| **Truthfulness** | Company/role come from the dataset (server-side), never the client. Timeline timestamps reflect actual transitions via `PATCH` — no backdated fabrication. Fit rating is personal and shown `/100`; the auto-`draft` application deliberately omits any fit rating rather than mislabeling the global `rank_score` as personal. Unavailable jobs show "No longer available" honestly. |
| **Scale bug fixed** | The pre-existing `/5` fit display in Job Detail and Ranked Jobs was corrected to `/100` with proper thresholds — no `rank_score` is ever presented as a personal 1–5 rating. |
| **Concurrency** | Inline editors disable while a mutation is pending; Remove is a two-click confirm and resets on blur. |
| **State consistency** | All mutations invalidate the shared query + dashboard, so the tracker page, Ranked Jobs, Job Detail, and the dashboard count reconcile to server truth. |
| **UX quality bar** | No gradients, animations, decorative cards, modals, fake AI personalization, fake progress, or unnecessary badges were added. Visual language matches Ranked Jobs (cards, tables, shared Badge/Button components). |
| **Performance** | One lightweight list endpoint; TanStack dedupes the shared query; inline edits are single `PATCH`es with no page reload. |

---

## 18. Known Limitations

- **UI click-through not machine-verified:** no browser automation exists in this environment; the running frontend proxy points at the user's pre-change dev backend. API contract, types, and build are verified; visual interaction requires a restart of the dev stack (documented in §15).
- **Web ↔ CLI tracker are separate stores:** applications created in the web tracker do not appear in `job_search_tracker.csv`, per plan §D ("CSV is the legacy export"). `store.get_application_stable_ids()` (CSV) remains the retention-protection source the pipeline relies on; web rows never interfere with it.
- **No bulk operations, tags, or server pagination** on the application list in this checkpoint (beyond the existing full-list response).
- Deleting an application is final for that row (two-click confirm mitigates accidental removal); it never touches saved-job state or the CSV tracker.

---

## 19. Deferred Work (explicitly out of CP12)

| Item | Status |
|---|---|
| CV / cover-letter generation from a tracked application (wiring `/apply` CLI outputs into the web tracker) | **DEFERRED** — roadmap. The tracker already stores optional `cv_file`/`cover_letter_file` on the model, but the upload/flows are future work. |
| AI matching engine / personalized match scores | **DEFERRED / does not exist.** Only global pipeline output is presented, honestly. |
| Resume tailoring, interview prep in the web app | **DEFERRED** (roadmap / existing `/apply` CLI skills). |
| Application-list features (notes history, tags, bulk actions, server pagination, stats charts) | **DEFERRED** — not required by CP12. |
| Frontend visual smoke with a real browser | **DEFERRED** to when a browser-automation path or a fresh dev stack is available. |

---

## 20. Final Validation Status

- ✅ Backend: 26 focused tests + full suite **216 passed**, no regressions.
- ✅ Cross-user isolation: enforced server-side from JWT, provably tested and live-smoked (A can never read/update/delete B's, and existence is not leaked).
- ✅ Honest data handling: company/role derived from the dataset; missing job → `available=false`/`job=null`; create of unknown id → 404; fit rating is the personal 0–100 scale — never the global rank score; no fabricated fields anywhere.
- ✅ Timeline honesty: timestamps set on transitions and never overwritten (tested + live-smoked).
- ✅ Frontend: `tsc` clean, production build green, all integrations wired (tracker page, Job Detail, Ranked Jobs, dashboard count).
- ✅ Pipeline preservation: 5 data files byte-identical to CP11; real `careerpilot.db` untouched; no pipeline logic touched.
- ✅ Live smoke: 32/32 against a fresh backend on an owned port (8099) with a throwaway DB copy; user's dev server (8000) untouched; all smoke artifacts removed.
- ✅ Documentation: this report.

**CHECKPOINT 12 VALIDATED — READY FOR CHECKPOINT 13**