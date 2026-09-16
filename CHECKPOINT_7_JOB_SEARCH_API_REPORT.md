# CHECKPOINT 7 — Job Search API Implementation Report

**Date:** 2026-09-08  
**Status:** VALIDATED — READY FOR CHECKPOINT 8

---

## 1. Executive Summary

Checkpoint 7 implements an authenticated job search API with background execution, single-active-run concurrency, and a React frontend `/search` page integrated with the existing dashboard. All backend tests pass (30/30). Frontend TypeScript build succeeds. API smoke tests confirm correct behavior.

**Scope clarification:** The API executes the **portal discovery stage only** (the parameterizable portion of the existing pipeline). Downstream stages (canonicalization, hard filtering, verification, scoring, ranking) remain CLI-driven and are intentionally deferred because their current implementation is not safely parameterized for API execution. Preferences are captured/snapshotted at run creation; the API does not claim personalized ranking; no fake pipeline progress is exposed.

---

## 2. Backend Implementation

### 2.1 SearchRun Ownership & Authentication
- **Location:** `backend/app/routers/search.py`
- **Mechanism:** `get_current_user()` dependency extracts `User` from JWT; all queries filter by `SearchRun.user_id == current_user.id`
- **Validation:** Cross-user isolation tests confirm User B cannot list or get User A's runs (returns 404)

### 2.2 Search API Endpoints

| Endpoint | Method | Response | Description |
|----------|--------|----------|-------------|
| `/api/search` | POST | `SearchRunResponse` (201) | Start new search run (background) |
| `/api/search/{run_id}` | GET | `SearchRunResponse` | Get single run (must own it) |
| `/api/search` | GET | `SearchRunListResponse` | Paginated list (user-scoped) |

### 2.3 Request/Response Schemas
- **StartSearchRequest:** `dry_run?: boolean`, `search_keywords?: string`, `search_location?: string` (extra=forbid)
- **SearchRunResponse:** `id`, `status`, `started_at`, `completed_at`, `error`, `pipeline_stage`, `preference_snapshot`, `execution_options`, `result_summary`, `created_at`, `updated_at`
- **SearchRunListResponse:** `runs[]`, `total`, `limit`, `offset`

### 2.4 Background Execution Architecture
- **Module:** `backend/app/services/search_manager.py`
- **Pattern:** In-process asyncio tasks (NOT durable across restarts)
- **Lifecycle:** QUEUED → RUNNING → COMPLETED/FAILED
- **Startup reconciliation:** Marks stale QUEUED/RUNNING as FAILED with `error = "Run was interrupted by server restart."`
- **Wait-for-idle:** `wait_for_idle(timeout)` for deterministic test assertions and graceful shutdown

### 2.5 Concurrency Policy
- **Policy:** Single-active-run globally (409 Conflict)
- **Rationale:** Pipeline CLIs share filesystem state; concurrent runs would corrupt shared files
- **Implementation:** Check for any QUEUED/RUNNING run in `start_run()` under `_starting_lock`
- **Test validation:** `test_concurrency_is_global_not_per_user` confirms cross-user blocking

### 2.6 Failure Handling
- **Terminal states:** COMPLETED, FAILED (CANCELLED exists in DB enum but not yet implemented in API)
- **FAILED is terminal:** No auto-retry; error captured in `error` field and `run_metadata.pipeline_stage = "failed"`
- **Reconciliation:** Stale runs marked FAILED at startup

### 2.7 Preference Integration & Snapshot
- **Source:** `SearchPreferences` table (1:1 with User)
- **Snapshot timing:** Captured at run creation in `run_metadata.preference_snapshot`
- **Immutability:** Historical runs preserve original snapshot even if preferences change later
- **Test validation:** `test_run_keeps_snapshot_after_preferences_change` confirms snapshot honesty

### 2.8 Pipeline Adapter — Portal Discovery Only
- **Module:** `backend/app/services/pipeline_adapter.py`
- **Two implementations:**
  - `PortalDiscoveryExecutor`: Real CLI subprocess via argument arrays (NO shell strings)
  - `DryRunExecutor`: Controlled no-network path for tests/smoke tests
- **CLI invocation:** `bun run <cli.ts> search -q "<kw>" -l "<loc>" --jobage 14 --limit 20 --format json`
- **Allowlist:** Only flags `{-q, -l, --jobage, --limit, --format}` permitted
- **Validation:** `validate_search_term()` rejects shell metacharacters
- **Stage executed:** `discovery` only (portal CLIs)
- **Stages NOT executed:** canonicalization, hard_filter, verification, scoring, ranking

### 2.9 Existing Pipeline Preservation
- **No pipeline logic reimplemented** — adapter only invokes portal discovery CLIs
- **Downstream stages** (canonicalization, hard_filter, scoring, ranking) are date-hardcoded Node scripts, not parameterizable — intentionally deferred
- **Shared pipeline files** (canonical/seen/ranked JSON) are NOT touched by adapter; CLI writes its own raw output

### 2.10 Security
- JWT authentication on all endpoints
- Ownership enforcement via `get_current_user()`
- Argument arrays (no shell strings) — prevents command injection
- Input validation via `validate_search_term()` (rejects `;`, `&`, `|`, `$`, `` ` ``, `>`, `<`, `(`, `)`, `=`, `'`)

---

## 3. Frontend Implementation

### 3.1 `/search` Page (`frontend/src/pages/Search.tsx`)
- **Sections:**
  1. Header with title/description
  2. Empty preferences CTA (links to `/preferences`)
  3. Active run card OR Start search card (mutually exclusive)
  4. Recent runs list (clickable to select)
  5. Preference summary sidebar (collapsible on mobile)

- **Run states rendered:**
  - **Queued:** "Waiting for current search to finish…" + warning badge
  - **Running:** "Searching for X in Y…" + info badge + Refresh button
  - **Completed:** Results summary + success badge + "Start New Search" button
  - **Failed:** Error message + danger badge + "Start New Search" button

- **Preference summary:** Target roles, locations, arrangements, salary, excluded keywords (as Badge chips)

### 3.2 Navigation (`frontend/src/components/layout/Sidebar.tsx`)
- **Position:** Top of sidebar (above Dashboard)
- **Icon:** `SearchIcon` (lucide-react)
- **Label:** "Job Search"
- **Route:** `/search`

### 3.3 Dashboard Integration (`backend/app/routers/dashboard.py` + `frontend/src/pages/Dashboard.tsx`)
- **Backend:** Fetches last `SearchRun` for user, builds `LastSearchRun` schema
- **Frontend `JobSearchStatusCard`:** Shows last run status badge, stage, date, error (if any), result summary (jobs found/saved/analyzed)
- **Next steps:** "Start a Job Search" link added when preferences configured but no runs yet

### 3.4 API Layer (`frontend/src/api/`)
- **Types:** `SearchRunStatus`, `SearchPipelineStage`, `StartSearchRequest`, `SearchRunResponse`, `SearchRunListResponse`, `LastSearchRun`
- **Client methods:** `startSearch()`, `getSearchRun()`, `listSearchRuns()`
- **Hooks:** `useSearchRuns`, `useSearchRun`, `useStartSearch` (TanStack Query v5, proper invalidation)

### 3.5 Frontend Build
- **Result:** ✅ `npm run build` succeeds (TypeScript + Vite)
- **Output:** `dist/index.html`, `dist/assets/index-*.js` (558 kB), `dist/assets/index-*.css` (40 kB)

---

## 4. Validation Results

### 4.1 Backend Tests (30/30 PASS)

| Test Class | Tests | Coverage |
|------------|-------|----------|
| `TestSearchAuthorization` | 4 | 401 on all endpoints, invalid token rejection |
| `TestSearchCreation` | 5 | Returns queued, requires preferences, uses first target role/location, accepts overrides, user-owned |
| `TestSearchValidation` | 5 | Unknown fields, empty keywords, dash-prefixed keywords, shell metacharacters in keywords/location |
| `TestSearchCrossUserIsolation` | 2 | User B cannot list/get User A runs |
| `TestSearchStatusLifecycle` | 3 | Starts queued, dry-run completes, failed is terminal |
| `TestSearchConcurrency` | 2 | Rejects concurrent start (409), global not per-user |
| `TestSearchPersistence` | 2 | Persists across requests, startup reconciles stale |
| `TestSearchPreferenceSnapshot` | 1 | Snapshot preserved after preference change |
| `TestSearchList` | 3 | Paginated results, limit/offset, max limit enforcement |
| `TestSearchResponseSafety` | 2 | No secrets in response, safe error responses |

### 4.2 API Smoke Tests (Live Server)

| Test | Result |
|------|--------|
| `GET /api/health` | ✅ 200 OK |
| `POST /api/auth/login` | ✅ 200 OK (token issued) |
| `POST /api/search` (no auth) | ✅ 401 Unauthorized |
| `POST /api/search` (dry_run=true) | ✅ 201 Created (run returned with queued status) |
| `GET /api/search` (list) | ✅ 200 OK (run appears in list) |
| Run transitions | ✅ queued → running → completed (dry_run completes in ~0.5s) |
| `GET /api/search/{run_id}` | ✅ 200 OK (full detail returned) |
| `GET /api/dashboard` | ✅ 200 OK (includes `last_search_run` with result_summary) |

### 4.3 Frontend Verification
- **TypeScript build:** ✅ Passes (no errors)
- **Vite dev server:** ✅ Starts on port 5176
- **Route registration:** `/search` appears in React Router config

### 4.4 Honesty Verification (Scope Reconciliation)

| Check | Result | Evidence |
|-------|--------|----------|
| `POST /api/search` executes portal discovery only | ✅ Confirmed | `PortalDiscoveryExecutor.execute()` in `search_manager.py:217` |
| Does NOT execute downstream stages | ✅ Confirmed | No calls to canonicalization/filtering/scoring/ranking in adapter or manager |
| Existing CLI pipeline unchanged | ✅ Confirmed | Adapter invokes same CLIs; no modifications to portal CLI code |
| API does NOT claim unexecuted stages | ✅ Confirmed | `pipeline_stage` values: `preparing` → `discovery` → `completed`/`failed` only |
| `pipeline_stage` values truthful | ✅ Confirmed | `STAGE_LABELS` in `Search.tsx` only has `preparing`, `discovery`, `completed`, `failed` |
| `result_summary` honest (no ranking/scoring claims) | ✅ Confirmed | Only `total_jobs_found`, `portals_attempted`, `portals_succeeded` |
| Frontend does not display fake stages | ✅ Confirmed | `Search.tsx` `STAGE_LABELS` matches actual API values |
| Dashboard wording honest | ✅ Confirmed | Dashboard shows actual `pipeline_stage` from `run_metadata` |

---

## 5. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Non-durable background tasks** | In-progress runs lost on server restart | Startup reconciliation marks stale as FAILED |
| **Single global concurrency** | Only one run at a time across all users | Acceptable for current scale; documented in API |
| **Pipeline stages beyond discovery** | Canonicalization, hard_filter, verification, scoring, ranking not invoked via API | Portal discovery is the only parameterizable entry point; downstream stages are date-hardcoded Node scripts — intentionally deferred to CP8+ |
| **CANCELLED status in DB but not API** | Legacy DB rows may have CANCELLED | API enum excludes CANCELLED; reconciliation marks as FAILED |
| **DryRunExecutor returns empty portals** | `portals_succeeded = 0` (by design) | Honest — no portals attempted in dry-run |

---

## 6. Deferred Work (Not in CP7)

- Cancellation endpoint (`DELETE /api/search/{run_id}`)
- Downstream pipeline execution: canonicalization, hard filtering, verification, scoring, ranking (requires parameterizable CLI or library layer)
- WebSocket/SSE for live run progress
- Search run history export
- Multi-run queue (would require pipeline filesystem isolation)

**CP8 scope guidance:** Progress must build around stages that are actually executable/observable (portal discovery + any newly parameterized stages). No fake pipeline progress.

---

## 7. File Inventory

### Backend (New/Modified)
- `backend/app/models/search_schemas.py` — Request/response schemas
- `backend/app/services/pipeline_adapter.py` — Pipeline adapter (PortalDiscoveryExecutor, DryRunExecutor)
- `backend/app/services/search_manager.py` — SearchRunManager singleton
- `backend/app/routers/search.py` — Search router (3 endpoints)
- `backend/app/validation.py` — Shared `validate_search_term()`
- `backend/app/routers/__init__.py` — Exports search router
- `backend/app/main.py` — Includes search router, startup reconciliation
- `backend/app/models/dashboard_schemas.py` — Added `LastSearchRun` schema
- `backend/app/routers/dashboard.py` — Fetches last SearchRun, adds "Start a Job Search" next step
- `backend/tests/test_search.py` — 30 tests

### Frontend (New/Modified)
- `frontend/src/api/types.ts` — Search types + `LastSearchRun`
- `frontend/src/api/client.ts` — Search client methods
- `frontend/src/api/endpoints.ts` — Search API object
- `frontend/src/hooks/useSearch.ts` — TanStack Query hooks
- `frontend/src/pages/Search.tsx` — Complete `/search` page
- `frontend/src/components/layout/Sidebar.tsx` — Added Search navigation
- `frontend/src/pages/Dashboard.tsx` — Integrated `JobSearchStatusCard`
- `frontend/src/components/common/Badge.tsx` — Exported `BadgeVariant` type

---

## 8. Conclusion

All Checkpoint 7 requirements are implemented and validated:

✅ **Backend:** 3 authenticated endpoints, background execution, concurrency, failure handling, preference snapshots, pipeline adapter (portal discovery only)  
✅ **Frontend:** `/search` page with all required states, navigation, dashboard integration  
✅ **Security:** JWT auth, ownership, argument arrays, input validation  
✅ **Tests:** 30/30 passing  
✅ **Build:** Frontend TypeScript/Vite build succeeds  
✅ **Smoke:** Live API endpoints tested and working  
✅ **Honesty verification:** API executes portal discovery only; no fake pipeline progress; no personalized ranking claims; Dashboard/Search page display only real stages/results  

**CHECKPOINT 7 VALIDATED — READY FOR CHECKPOINT 8**