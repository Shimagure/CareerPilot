# Checkpoint 3 — Authenticated User Workspace Report

**Status:** COMPLETE — VALIDATED
**Generated:** 2026-09-07
**Scope:** Authenticated CareerPilot User Workspace — focused `GET /api/dashboard` endpoint, workspace UI, honest profile-readiness/future-action states, global-vs-user data separation, targeted frontend audit, responsive + accessible design, cross-user isolation, backward compatibility
**Next Step:** Awaiting instruction for Checkpoint 4

---

## 1. Workspace Architecture

The Checkpoint 3 workspace is the authenticated home page of CareerPilot. The old Dashboard was a **global system-operations page** (it called `/api/health`, `/api/pipeline/status`, `/api/ranked/top5`, and `/api/applications` — four unrelated public endpoints — and displayed raw pipeline internals). It is replaced by a **User Workspace** driven by a single focused endpoint.

```
Browser ──GET /api/dashboard──▶ Vite proxy ──▶ FastAPI
                                                │  JWT Bearer → get_current_user()
                                                │  → current_user.id (server-side identity)
                                                ▼
                                    User table (7 models)   ── user-owned counts
                                    store.get_health_info() ── global pipeline health
                                                │
                                                ▼
                              DashboardResponse (single payload)
```

- **One round-trip.** The page renders entirely from `DashboardResponse`. No discovery of user state from several endpoints, no race between them, no client-side summation that could mislabel global data as personal.
- **Ownership is server-side.** Every user-owned count is generated with `WHERE model.user_id == current_user.id`. The browser never sends a `user_id`; identity comes from the JWT `sub` via `get_current_user()`.
- **Global data stays labeled global.** Pipeline health (active/stale/blocked counts, stage, status) is rendered as a clearly-labeled system overview — shared, not user-owned.

## 2. Dashboard API — `GET /api/dashboard`

`backend/app/routers/dashboard.py`, response model `backend/app/models/dashboard_schemas.py`.

| Field | Source | Meaning |
|-------|--------|---------|
| `user` | `current_user` (JWT `sub`) | `{id, email, created_at}` — public identity only |
| `profile_readiness` | counts of user's `Resume`, `CandidateProfile`, `SearchPreferences` | `{resume_uploaded, candidate_profile_configured, search_preferences_configured, completed_steps, total_steps=3, ready}` |
| `user_activity` | counts of user's `SearchRun`, `UserJob`, `Application` | `{search_run_count, saved_job_count, application_count, has_activity}` |
| `system_overview` | `store.get_health_info()` | `{status, pipeline_stage, pipeline_status, active_jobs, stale_jobs, blocked_jobs}` — global, NOT user-owned |
| `next_steps` | derived server-side | Recommended actions: setup items (**coming-soon**), then existing-route items |
| `timestamp` | now (UTC) | Payload freshness |

Auth: `Depends(get_current_user)` — no token → 401, invalid token → 401. Sensitive fields (password hash, tokens, secrets) are never selected or serialized.

**Next-step derivation order** (`_build_next_steps`): missing setup steps first (`upload_resume`, `configure_profile`, `set_preferences` — all `coming_soon=True`, no dead href), then `track_applications` (`/applications`) when `application_count == 0`, then `browse_top_jobs` (`/ranked`) when `active_jobs > 0`.

## 3. User Ownership Model

- Identity: server-side `current_user.id` from JWT `sub`; an inactive user is rejected before any query runs.
- All 5 workspace queries scope to `current_user.id`: `Resume`, `CandidateProfile`, `SearchPreferences`, `SearchRun`, `UserJob`, `Application`.
- **Cross-user isolation is guaranteed by construction** (the `WHERE user_id` clause), and is explicitly tested — see §8 (`test_user_b_never_sees_user_a_records`, `test_user_a_keeps_own_records`).
- No user-ID parameter is accepted by the endpoint, so a client cannot request another account's workspace.
- Checkpoint 1 models are used **only to determine workspace state** (existence/counts), never to expose or mutate their records.

## 4. Frontend Structure

| File | Role |
|------|------|
| `src/api/types.ts` | `DashboardUser`, `ProfileReadiness`, `UserActivity`, `SystemOverview`, `NextStep`, `DashboardResponse` (mirror backend schema field-for-field) |
| `src/api/client.ts` | `getDashboard()` → `GET /api/dashboard` |
| `src/api/endpoints.ts` | `dashboardApi.get()` |
| `src/hooks/useDashboard.ts` | `useQuery(['dashboard'], dashboardApi.get, staleTime 30s, retry 2)` — same pattern as existing hooks |
| `src/pages/Dashboard.tsx` | User Workspace page (rewritten) |

Deleted: `src/hooks/useHealth.ts` — its only consumer was the old Dashboard, so it was dead code after the rewrite. `healthApi` / `HealthResponse` / `client.healthCheck()` are kept because `/api/health` remains a valid live endpoint surface.

## 5. UX Decisions

- **Welcome.** Header greeting uses the JWT-authenticated identity — `data.user` from the endpoint, with `useAuth()` user as fallback for the display name derivation. No fabricated name; the local part of the email is used, never a guessed full name.
- **Profile Readiness (honest future-action states).** Renders a 3-item checklist (Resume / Candidate profile / Search preferences) with an accurate `X of 3` counter and a badge (`All set up` / `Getting started`). Pending steps show a **"Not yet started"** badge plus a subtle **"Coming soon"** tag — these capabilities are genuine future checkpoints, not fake completed data, and not dead buttons that navigate nowhere. Each item carries its real description of what it will do.
- **Job Search Status — global vs user, clearly separated.** Two stacked cards in the workspace sidebar:
  - **Your Activity** — user-owned counts (search runs, saved jobs, applications) scoped to the account, with an honest empty-state note when `has_activity` is false.
  - **Global Job Pipeline** — explicitly labeled *"System-wide job data — shared, not specific to you."* API status, pipeline stage/status, and active/stale/blocked counts. The global pipeline is never presented as the user's own activity.
- **Quick Actions.** Three existing, live routes always reachable (`/ranked`, `/applications`, `/jobs`) as card links.
- **Next Steps.** Recommended actions from `next_steps`: setup items render disabled **"Coming soon"** badges; existing routes render an enabled **Go** link. This is the only place coming-soon capabilities appear, and they are always marks, never broken navigation.
- **No fabrication.** Fresh users see literal `0` counts and honest empty states; the system overview shows real pipeline numbers but labeled global.

## 6. States (empty / loading / error)

| State | Render |
|-------|--------|
| **Loading** | Skeleton layout mirroring the final structure (welcome line, readiness card, two status cards, next-steps card), `aria-busy="true"`, `aria-label="Loading your workspace"` |
| **Error** | Full-width `NetworkError` for connection failures, generic `ErrorState` ("Couldn't load your workspace") with retry for API failures — both invoke `refetch()`; the app shell (header/sidebar) stays intact |
| **Empty** | New-user readiness shows all-false state with 0-of-3; activity card shows an honest "No activity yet" notice; next-steps shows the 5 recommended actions; if `next_steps` is empty the card says "Nothing needs your attention right now." |

## 7. Responsive & Accessibility

- **Responsive:** `lg:grid-cols-3` workspace grid (readiness spans 2, status column 1) collapses to a single column on smaller screens; `sm:` breaks inside cards for header rows; stat grids `grid-cols-3` collapse gracefully; quick-action grid `sm:grid-cols-3`.
- **Semantic HTML:** `h1` page title, cards use `CardTitle` (`h3`), lists use `ol`/`role="list"` + `role="listitem"`, stats use `dl/dt/dd`, status rows use `dl`.
- **Not color-only:** every status pairing uses text + badge variant (e.g., "All set up" badge has both color and label; dots are decorative `aria-hidden`); step icons pair a check/clock glyph with a text label.
- **Focus:** interactive elements use existing focus-ring system (buttons, links) from the shared components; card links are real `<Link>`s (keyboard-focusable).
- **Dark mode:** all new markup uses the same `dark:` token conventions as the rest of the app.

## 8. Tests (targeted)

New `backend/tests/test_dashboard.py` — **9 passed** against an isolated temp SQLite DB:

| Class | Coverage |
|-------|----------|
| `TestDashboardAuthorization` | 401 without token, 401 on invalid JWT, 200 with valid token + correct user identity |
| `TestDashboardReadiness` | New-user honest empty state (0/3, all false, `has_activity` false, setup steps recommended); setup-complete reflects state (3/3, `ready` true, setup items absent from next steps); **no sensitive fields** (`password`/`access_token`/`secret` absent from raw body, `user` is exactly `{id,email,created_at}`); system overview present but global (new user activity empty) |
| `TestDashboardCrossUserIsolation` | **User A's records never appear for User B** (B sees empty state despite A's rows); A's own records remain intact when serving A |

Regressions:
- `backend/tests/test_auth.py` — **19 passed** (auth internals unchanged).
- `backend/tests/test_database_foundation.py` — **14 passed** (models unchanged).
- Frontend `npm run build` (`tsc -b && vite build`) — **Passed**; only pre-existing warnings (native config loader, >500 kB chunk size).
- Total **42 passed**, 0 failed.

## 9. Runtime Validation

| Check | Result |
|-------|--------|
| Backend | `http://127.0.0.1:8000` — `/api/health` **200** |
| Frontend | `http://localhost:5173` (Vite, IPv6 loopback) **200** |
| Vite proxy | `http://localhost:5173/api/health` → **200**; `/api/dashboard` unauthenticated → **401** (proxy path intact) |
| Register (live) | New user registered → JWT returned |
| `/api/dashboard` (authenticated, fresh user) | **200**; `user` = `{id,email,created_at}`; all readiness `false` (0/3); activity zeros + `has_activity` false; `system_overview` = live global pipeline (status ok, stage `ranking_report`, status complete, 124 active / 240 stale / 39 blocked); `next_steps` exactly `[upload_resume, configure_profile, set_preferences, track_applications, browse_top_jobs]`; `timestamp` present |
| Sensitive-field scan (live) | No `password` / `access_token` / `secret` / `hash` in the payload |
| `/api/dashboard` (no token) | **401** |
| Backward compatibility | `/api/health`, `/api/jobs`, `/api/ranked/top5`, `/api/applications`, `/api/pipeline/status` — all **200**; `/api/demo/status`, `/api/demo/jobs/active`, `/api/demo/pipeline` — all **200** |

Note: no browser-automation harness exists in the repo. The React page was validated via the type-checked build, live dev-server transforms, and the authenticated API round-trip above; a visual in-browser pass is recommended before presenting the workspace to a user.

## 10. Backward Compatibility

- Job pipeline data untouched: `job_scraper/canonical_jobs.json`, `seen_jobs.json`, `checkpoints.json`, `job_search_tracker.csv`, and `backend/demo_data/*` are unchanged.
- No auth dependency was added to any existing public router; auth remains additive under `/api/auth/*` and the new authenticated endpoint under `/api/dashboard`.
- Existing endpoints (`/api/jobs`, `/api/ranked/*`, `/api/applications`, `/api/pipeline/*`, `/api/demo/*`) return the same shapes as before.
- Demo Mode remains isolated (reads `backend/demo_data/*`; no DB/User coupling).
- CLI job-search workflow unaffected.
- No migration of `seen_jobs.json` / `checkpoints.json` / `.scrape_out` / `job_search_tracker.csv` into the user DB — global pipeline data is not converted to user-owned data.

## 11. Targeted Frontend Audit (Workspace)

### KEEP
- Shared `Card`/`Badge`/`Skeleton`/`EmptyState`/`ErrorState`/`Button` primitives — reusable, accessible, dark-mode aware (reused as-is).
- `AuthContext` + `ProtectedRoute` pattern and the axios 401 → `careerpilot:unauthorized` synchronization.
- `useQuery` hook conventions (`useDashboard` matches `useJobs`/`useApplications`/etc.).
- Relative `/api/*` + Vite proxy approach (single origin, no CORS in dev).
- Reusable `useAuth()` for authenticated identity fallback.

### IMPROVE (implemented)
1. **Old Dashboard was a system-ops page, not a workspace.** It called four unrelated endpoints and showed raw pipeline internals to an authenticated user. Replaced with a single focused endpoint + user workspace.
2. **User data vs global data was indistinguishable.** Now explicitly split and labeled ("Your Activity" vs "Global Job Pipeline — shared, not specific to you").
3. **No honest setup/adoption states.** Now a truthful 3-step readiness checklist with future-action states, plus a next-steps recommender.
4. **Dead code removed.** `useHealth` (orphaned by the rewrite) deleted.

### REFACTOR / REPLACE
- **REPLACED** the old `Dashboard.tsx`. No broader refactor was needed; the surrounding component architecture was sound and was reused.

### FUTURE (later checkpoints)
- Resume upload / parser / profile extraction / search-preferences UI (the three "Coming soon" steps).
- Wire `/api/dashboard` readiness + next steps into real setup flows once checkpoint-4 features land.
- `location.state.from` redirect on Login (deferred from CP2).
- `VITE_API_BASE_URL` cleanup (unused env, stale `8005`/`8000` values).
- Route-level code splitting (bundle > 500 kB — pre-existing warning).
- Token-expiry countdown / refresh-token model (deferred from CP2 security notes).

## 12. Files Changed (this checkpoint)

Backend:
- `backend/app/models/dashboard_schemas.py` — **new**: workspace Pydantic schemas.
- `backend/app/routers/dashboard.py` — **new**: authenticated `GET /api/dashboard`.
- `backend/app/routers/__init__.py` — register dashboard router.
- `backend/app/main.py` — include dashboard router.
- `backend/tests/test_dashboard.py` — **new**: 9 tests incl. cross-user isolation.

Frontend:
- `frontend/src/api/types.ts` — dashboard interfaces.
- `frontend/src/api/client.ts` — `getDashboard()`.
- `frontend/src/api/endpoints.ts` — `dashboardApi`.
- `frontend/src/hooks/useDashboard.ts` — **new** hook.
- `frontend/src/pages/Dashboard.tsx` — rewritten as the User Workspace.
- `frontend/src/hooks/useHealth.ts` — **deleted** (orphaned after rewrite).

Docs:
- `CHECKPOINT_3_WORKSPACE_REPORT.md` — **new** (this document).

No job-pipeline or demo-mode data files were modified.