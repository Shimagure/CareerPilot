# CHECKPOINT 11 — Saved Jobs Report

**Date:** 2026-09-09
**Status:** VALIDATED — READY FOR CHECKPOINT 12

---

## 1. Status

**IMPLEMENTED — VALIDATED.** The Saved Jobs feature is complete end-to-end: an authenticated user can save a job, see the saved state everywhere (Ranked Jobs, Job Detail, Saved Jobs page), unsave it, and view their own saved list. Ownership is derived strictly from the JWT — cross-user isolation is enforced and explicitly tested. Reuses the existing `UserJob` persistence model with **no schema change, no migration, and no second persistence mechanism**. Application history is structurally and provably preserved by unsave. Pipeline files are byte-identical before and after the live smoke.

---

## 2. Scope

| In scope (CP11) | Out of scope (CP12+ / deferred) |
|---|---|
| Save / unsave / list saved jobs (JWT-scoped) | Application Tracking (CP12) — submission, status management, interviews, timeline |
| Saved state on Ranked Jobs, Job Detail, Saved Jobs page | AI matching, resume tailoring, cover letters — roadmap features |
| Cross-user isolation + security hardening | Personalized matching engine — **does not exist and is not built** |
| Honest handling of jobs that leave the global dataset | Redesigning the frontend or re-architecting the pipeline |

No discovery, canonicalization, hard-filter, verification, scoring, ranking, search, or pipeline-adapter logic was touched.

---

## 3. Existing `UserJob` Architecture (Reused As-Is)

Prior to CP11 the `UserJob` model (`backend/app/models/database_models.py`) already represented personal per-(user, job) state:

- One row per `(user_id, job_stable_id)` with a **unique constraint** (`uq_user_job`) and a `status` enum — `SAVED` is the default value.
- Columns: `user_id` (FK → `users.id`, CASCADE), `job_stable_id`, `status`, `notes`, `viewed_at`, `created_at`, `updated_at`.

CP11 conclusion: **`UserJob` IS the saved-jobs store.** No new table, no column, no migration. Save = upsert a row with `status == SAVED`; unsave = delete only the current user's Saved row. The `applications` table is a **separate, independent table** keyed by `(user_id, job_stable_id)`, and the CSV tracker (`job_search_tracker.csv`) is separate storage too — so unsave structurally cannot destroy application history (verified by a dedicated test and by the live smoke).

---

## 4. Backend Changes

| File | Change |
|---|---|
| `backend/app/models/saved_jobs_schemas.py` | **NEW** — `SavedJobItem` Pydantic schema (`stable_id`, `saved_at`, `available`, `job: JobRecord \| None`). `available=False` + `job=None` when the job left the global dataset; no field is ever fabricated. |
| `backend/app/routers/saved_jobs.py` | **NEW** — 3-route wired-up router (see §5) reusing `UserJob`, `get_current_user`, `get_store`. |
| `backend/app/main.py` | Import + `app.include_router(saved_jobs.router)` (one line each). No other router touched. |
| `backend/tests/test_saved_jobs.py` | **NEW** — 15 tests (see §15). |

**No schema change, no Alembic migration, no changes to existing models, routers, or store logic.**

---

## 5. API Endpoints

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/saved-jobs` | JWT (required) | Returns the authenticated user's saved items, most-recently-saved first. Never returns another user's rows. |
| `POST` | `/api/saved-jobs/{stable_id}` | JWT (required) | Saves for the current user (derived from JWT, never from the client). **Idempotent** upsert — saving an already-saved job returns it, no duplicate. Returns `404` if the `stable_id` no longer exists in the current global dataset (honest). Returns the saved item. |
| `DELETE` | `/api/saved-jobs/{stable_id}` | JWT (required) | Deletes only the current user's Saved row. **Idempotent** — `204` whether or not the job was saved. Never affects another user's saved state or any application/tracker record. |

All three 401 when unauthenticated. `GET` returns `List[SavedJobItem]`; `POST` returns `SavedJobItem`; `DELETE` returns `204`.

---

## 6. User Ownership / Security Model

**MANDATORY requirement met — the identity of every operation is derived from the JWT on the server:**

- `get_current_user` (existing dependency from `app.routers.auth`) resolves identity from `payload["sub"]` and checks `UserStatus.ACTIVE`.
- The frontend never sends a `user_id` in the request body, query string, or route. Ownership comes only from the Bearer token's `sub` claim.
- `GET` filters `UserJob.user_id == current_user.id AND status == SAVED`.
- `POST` writes `user_id = current_user.id`.
- `DELETE` deletes `WHERE user_id == current_user.id AND status == SAVED` — User A's row is physically unreachable by User B's request.

**Verified by tests:** `test_user_b_cannot_see_user_a_saved_jobs`, `test_user_b_cannot_unsave_user_a_saved_job`, `test_users_keep_separate_saved_lists` — and by the live smoke (User B never sees or affects User A's saved state).

---

## 7. Saved-State Semantics (Exact)

| Operation | What happens to `UserJob` | What does NOT happen |
|---|---|---|
| **Save** | Upsert (`INSERT` new row, or `UPDATE` existing row's `status` to `SAVED`; concurrent-race path handled via `IntegrityError` retry). | No change to rankings, scores, fit, seen/canonical/ranked JSON, or any other user's row. |
| **Unsave** | `DELETE` the current user's row where `status == SAVED` (other statuses are untouched). | No `DELETE`/`UPDATE` on the `applications` table; no `DELETE` on the CSV tracker row. Application history survives unsave (test `test_unsave_keeps_db_application_and_tracker_row`). |
| **Job removed from dataset** | Row stays; list item returns `available=false, job=null`. | No fabricated title/company/location/salary/score/description. The UI shows "No longer available" honestly. |
| **Saving a job not in the dataset** | `POST` → `404` "Job not found in the current job dataset." | The saved list can never reference an unknown `stable_id`. |

Saving is a **personal account action**. It never implies a change to the global pipeline ranking, score, or fit — the Ranked Jobs page continues to show the global-scope disclaimer, and Job Detail shows the Ranking scope note.

---

## 8. Frontend Changes

| File | Change |
|---|---|
| `frontend/src/api/types.ts` | **NEW** `SavedJobItem` interface (mirrors backend schema). |
| `frontend/src/api/client.ts` | `getSavedJobs()`, `saveJob(stableId)`, `unsaveJob(stableId)`. |
| `frontend/src/api/endpoints.ts` | `savedJobsApi.list / save / unsave` (typed). |
| `frontend/src/hooks/useSavedJobs.ts` | **NEW** — `useSavedJobs`, `useSavedJobIds`, `useSaveJob`, `useUnsaveJob`, `useSavedToggle`. Single query key `['saved-jobs']` is the shared source of truth across Ranked Jobs, Job Detail, and Saved Jobs; save/unsave invalidate `['saved-jobs']` + `['dashboard']` so server state stays authoritative and all surfaces stay consistent. |
| `frontend/src/components/common/SavedToggleButton.tsx` | **NEW** — reusable save/unsave control: bookmark icon (filled when saved), `aria-pressed`, "Save job"/"Saved" labels, disabled + spinner while a mutation is pending (prevents duplicate submissions). |
| `frontend/src/pages/SavedJobs.tsx` | **NEW** — the Saved Jobs page (see §11). |
| `frontend/src/pages/RankedJobs.tsx` | Desktop table gains a "Saved" column with the toggle; mobile cards gain the toggle and were **refactored** so the card is a `<div>` and the **title is the Link** (removes nested interactive-in-interactive). Rank/score/fit/filters/sort/disclaimer/application status all preserved. |
| `frontend/src/pages/JobDetail.tsx` | `SavedToggleButton` added to the header actions row, beside Refresh / View Original Posting. Ranking info, scope notes, missing-data honesty all preserved. |
| `frontend/src/App.tsx` | Route `/saved-jobs` registered under the protected layout. |
| `frontend/src/components/layout/Sidebar.tsx` | New "Saved Jobs" nav entry + bookmark icon between "Ranked Jobs" and "Applications". |
| `frontend/src/pages/Dashboard.tsx` | "Saved jobs" quick action added (grid adjusted `sm:grid-cols-2 lg:grid-cols-4` so 4 actions stay tidy). |

TanStack Query patterns match the existing codebase (typed endpoint fns, dedicated hooks, `staleTime`/`retry`, query-key-scoped invalidation). No unnecessary global state was introduced — saved state is derived in one place.

---

## 9. Ranked Jobs Integration

- **Desktop:** a new rightmost "Saved" column renders `SavedToggleButton` per row. The ranking experience (Rank, Score, Fit, filters, sort, tabs, global-scope disclaimer, application status) is fully preserved.
- **Mobile:** the previously whole-card `<Link>` was split — the card shell is now a `<div>`, the title is the `<Link>` (still navigates to `/jobs/:stable_id`), and the save toggle sits in the card footer row next to the application status.
- Honest framing: saved state is derived from `['saved-jobs']`, entirely separate from the ranked list. Saving never alters the rank list, and the existing amber "Global pipeline data" note is untouched.

## 10. Job Detail Integration

- `SavedToggleButton` added to the header actions (alongside Refresh and View Original Posting), so the user sees and toggles saved state at the top of the page.
- All existing CP10 content is preserved: ranking information + amber scope note, candidate & match analysis with its honest "pipeline output / not personalized" provenance, pipeline fit notes, application context, missing-data empty states, sidebar details, retention cards, debug details.
- Nothing implies Saved = Recommended / Strong Fit / Personalized Match. Saved state is an independent, personal bookmark.

---

## 11. Saved Jobs Page (`/saved-jobs`)

- **Header:** "Saved Jobs" title with count subtitle and a Refresh button.
- **What Saved means:** a brand-toned, plain-language note — *"Your personal bookmark list … a personal account action and does not change the job's global ranking, score, or fit from the CareerPilot pipeline."* This prevents any implication that bookmarks alter ranking.
- **Desktop table:** Title (link → detail), Company, Location (only when genuinely present, else `—`), Arrangement badge, Fit badge, Score (`—` when absent), Saved date, and Actions (`Open Detail` only when the job is available + unsave toggle).
- **Mobile cards:** same fields as cards; title is the link; toggle in the header row; "Open Detail →" in the footer. Location shown only when present.
- **Unavailable jobs:** shown honestly as "No longer available" with saved date and an unsave control — no fabricated title/company/location/score.
- **Empty state:** *"You haven't saved any jobs yet."* + "Browse Ranked Jobs" action → `/ranked`. Rendered as a friendly prompt, not an error.
- **Loading:** skeleton table (mirrors Ranked Jobs styling). **Error:** `NetworkError` with retry; a distinct signed-out style when the API returns 401.

No field that the API does not provide is displayed; never any fabricated salary/location/arrangement/description/match score.

---

## 12. Dashboard / Navigation Integration

- **Sidebar:** "Saved Jobs" entry with a bookmark icon between "Ranked Jobs" and "Applications" (existing sidebar conventions — active-state highlight, icon + label).
- **Dashboard Quick Actions:** "Saved jobs — Revisit jobs you bookmarked for later." added; grid changed to `sm:grid-cols-2 lg:grid-cols-4` so the 4 actions sit cleanly instead of a stray 4th cell. Existing activity stats already surface `saved_job_count`, and save/unsave invalidate the dashboard query so that count stays correct.

---

## 13. Accessibility

- `SavedToggleButton` uses `aria-pressed` (a true toggle semantic), a text label ("Save job"/"Saved"), a `title` for the action, and a visible spinner + disabled state while pending — the control is never silently non-responsive.
- Decorative SVGs carry `aria-hidden="true"`.
- Semantic `<table>`/`<th scope>` structure preserved on desktop; cards on mobile use headings + links.
- Focus rings come from the shared Button component (`focus-visible` styling), consistent with the rest of the app.
- The "What Saved means" note uses `role="note"`; screen readers hear the honest scoping alongside the action.

## 14. Responsive UX

- Uses the exact Ranked Jobs responsive pattern: **desktop table** (`hidden lg:block`, horizontal scroll on narrow desktop) and **mobile cards** (`lg:hidden`).
- Layouts wrap: header actions, badge rows, the note box, and the mobile card footer all use `flex-wrap`.
- No horizontal page growth: tables scroll inside their own `overflow-x-auto` container.
- Visual indicators and colors always pair with text, so state is legible in light/dark theme and without color alone.

---

## 15. Tests

### Backend — `backend/tests/test_saved_jobs.py` (15 tests, all passing)

```
Authorization
✅ test_get_requires_auth              anonymous GET  → 401
✅ test_save_requires_auth             anonymous POST → 401
✅ test_unsave_requires_auth           anonymous DELETE → 401

Lifecycle
✅ test_save_job                       auth user saves a real fixture job → 200, available=true, title carried
✅ test_list_saved_jobs                saved job appears with company
✅ test_list_empty_for_user_with_no_saves
✅ test_save_is_idempotent             double save → still exactly 1
✅ test_unsave_job                     unsave → 204 → list empty
✅ test_unsave_when_not_saved_is_noop  unsave → 204
✅ test_save_missing_job_returns_404   404 (honest)

Cross-user isolation
✅ test_user_b_cannot_see_user_a_saved_jobs
✅ test_user_b_cannot_unsave_user_a_saved_job   A's row survives B's attempt
✅ test_users_keep_separate_saved_lists         A unsaves; only A's view changes

Missing job honesty
✅ test_removed_job_is_available_false          available=false, job=null (no fabrication)

Application protection
✅ test_unsave_keeps_db_application_and_tracker_row  unsave removes only the UserJob row; DB Application row and CSV tracker row survive
```

- Run: `/c/Users/Soladm/AppData/Local/Programs/Python/Python314/python -m pytest tests/test_saved_jobs.py -v` → **15 passed**.
- **Full backend suite: `190 passed`** (CP9 baseline 168 → CP10 added 7 job-detail tests → CP11 adds 15 → 190). No regressions.

### Frontend

- `npx tsc --noEmit` → **zero TypeScript errors** after all CP11 edits.
- `npm run build` (`tsc -b && vite build`) → **green production build**; 480 modules; `dist/assets/index-*.js 582 kB gzip 149 kB`. (Chunk-size warning pre-exists from earlier checkpoints; CP11 adds ~13 kB and does not introduce a new issue.)

---

## 16. Live Smoke Results (fresh backend, own process)

A **fresh backend was started on port 8010** (own process, using a **copy** of the dev DB so the real `careerpilot.db` was never written; the user's dev server on port 8000 — PID 17984 — was left untouched throughout). The smoke ran against the **real global job dataset**: picked a real `stable_id` from `/api/ranked/all` over the wire.

**21/21 checks passed:**

```
✅ anonymous GET /api/saved-jobs → 401
✅ anonymous POST save → 401
✅ anonymous DELETE unsave → 401
✅ /api/ranked/all returns real jobs (124 active)
✅ missing id is not in the real dataset
✅ A's initial saved list is empty
✅ A saves a missing job → 404 (honest)
✅ A saves the real job → 200, available=true
✅ saved item carries the real title from the global dataset
✅ A saves twice → idempotent, still exactly 1
✅ B cannot see A's saved jobs
✅ B saves the same job → 200
✅ B unsaves own → 204
✅ B list empty again (own scope)
✅ B unsave idempotent → 204
✅ A's saved job survives B's unsave      ← cross-user isolation
✅ A unsaves → 204
✅ A's list empty after unsave
✅ /api/ranked/all still returns the job   ← global dataset intact
✅ /api/jobs/{id} still resolves normally   ← detail endpoint intact
```

**Cleanup after smoke:** the port-8010 backend was terminated (port confirmed free), and `smoke_cp11.db`, both smoke logs, and the smoke script were deleted. `netstat` confirmed port 8000 still owned by the user's dev process.

**Honest limitation (same as CP10):** a real in-browser click-through of the rebuilt UI was **not executed** because the running Vite dev-server proxy is hardcoded to the user's backend on port 8000 and no browser-automation tool is available in this environment. The feature is verified at the **API contract level** (21/21 live), the components pass strict TypeScript, the production build is green, and every UI surface derives saved state from that one verified API via a shared query. To exercise it visually, restart the frontend against a backend running this branch.

---

## 17. Pipeline Preservation Verification

Explicitly checked before and after the live smoke (byte-for-byte identical MD5):

| File | Before | After |
|---|---|---|
| `job_scraper/canonical_jobs.json` | `6e4d4456…` | `6e4d4456…` |
| `job_scraper/seen_jobs.json` | `5ad07af7…` | `5ad07af7…` |
| `job_scraper/ranked_jobs.json` | `5827937c…` | `5827937c…` |
| `job_scraper/checkpoints.json` | `ef8a5850…` | `ef8a5850…` |
| `job_search_tracker.csv` | `5d3a1dfa…` | `5d3a1dfa…` |

No discovery, canonicalization, hard-filter, verification, scoring, ranking, search-API, pipeline-adapter, or CLI-script logic was modified.

---

## 18. Senior Frontend Audit Findings

| Area | Finding |
|---|---|
| **Architecture** | Reused patterns end-to-end (typed API fns → dedicated hooks → shared query key → reusable components). Single source of truth for saved state (`['saved-jobs']`), cross-surface consistency via invalidation. No new global state, no prop drilling. |
| **Truthfulness** | Saved is presented as a personal bookmark; the note on the Saved page, the preserved amber global-scope note on Ranked, and the Ranking scope note on Detail never imply that saving changes ranking or that a job is "matched" because it was saved. Unavailable jobs are labeled "No longer available" — nothing fabricated. |
| **Interactive nesting** | Ranked mobile cards refactored (`<div>` card, title = `<Link>`, toggle = `<Button>`) — the one latent accessibility bug found in the pre-existing markup. |
| **Concurrency** | Toggle disables while its mutation is pending; `aria-pressed` reflects server-confirmed state after invalidation. |
| **Stat e consistency** | Save/unsave invalidate both `['saved-jobs']` and `['dashboard']`, so the Dashboard saved-count and every surface reconcile to server truth. |
| **UX quality bar** | No gradients, animations, decorative cards, modals, fake AI personalization, fake progress, or unnecessary badges were added. Visual language matches Ranked Jobs (cards, tables, Badge/Button components). |
| **Performance** | One lightweight list endpoint; TanStack dedupes the shared query; no per-save page reload; bundle growth minimal (582 kB, pre-existing warning). |

---

## 19. Known Limitations

- **UI click-through not machine-verified:** no browser automation exists in this environment; the running frontend proxy points at the user's pre-change dev backend. API contract, types, and build are verified; visual interaction requires a restart of the dev stack (documented in §16).
- **`saved_at` uses `UserJob.created_at`:** re-saving after an unsave creates a new row, so the shown date is "when first saved in the current bookmark". This is honest, and no separate saved-at column was added to avoid schema churn.
- Saved state is per **(user, job)**; there is intentionally no bulk operations, tags, notes, or sort/paginate on the saved list in this checkpoint.

---

## 20. Deferred Work (explicitly out of CP11)

| Item | Status |
|---|---|
| **Application Tracking (CP12)** — application submission/status management, interviews, timeline | **DEFERRED** to CP12. Existing application info displayed on Ranked/Detail is preserved; unsave never touches it. |
| AI matching engine / personalized match scores | **DEFERRED / does not exist.** No match engine built; the app continues to present only global pipeline output honestly. |
| Resume tailoring, cover letters, interview prep | **DEFERRED** (roadmap / existing `/apply` CLI skills). |
| Saved-list features (notes, tags, folders, bulk actions, server pagination) | **DEFERRED** — not required by CP11; added only if a later checkpoint asks. |
| Frontend visual smoke with a real browser | **DEFERRED** to when a browser-automation path or a fresh dev stack is available. |

---

## 21. Final Validation Status

- ✅ Backend: 15 focused tests + full suite **190 passed**, no regressions.
- ✅ Cross-user isolation: enforced server-side from JWT, provably tested and live-smoked (A can never read/unsave B's).
- ✅ Honest data handling: missing job → `available=false`/`job=null`; save of unknown id → 404; no fabricated fields anywhere.
- ✅ Application protection: unsave deletes only the UserJob Saved row; DB Application + CSV tracker survive (tested + structurally guaranteed by separate storage).
- ✅ Frontend: `tsc` clean, production build green, all integrations wired (Ranked, Detail, Saved page, nav, dashboard).
- ✅ Pipeline preservation: 5 data files byte-identical before/after live smoke; no pipeline logic touched.
- ✅ Live smoke: 21/21 against a fresh backend on an owned port; user's dev server (8000) untouched; all smoke artifacts removed.
- ✅ Documentation: this report.

**CHECKPOINT 11 VALIDATED — READY FOR CHECKPOINT 12**