# Checkpoint 2 — Authentication & Frontend Audit Report

**Status:** COMPLETE — VALIDATED  
**Generated:** 2026-09-07  
**Scope:** Authentication implementation, runtime diagnosis (502), end-to-end auth validation, senior frontend audit, targeted security review, backward compatibility  
**Next Step:** Awaiting instruction for Checkpoint 3

---

## 1. Authentication Architecture

CareerPilot uses stateless JWT authentication as an account layer around the existing job-search pipeline. Authenticated user data lives in the SQLAlchemy database (`users` table); the production job pipeline continues to read from its existing JSON/CSV files untouched.

| Component | Implementation |
|-----------|----------------|
| Password hashing | **bcrypt** (via `bcrypt` package directly in `backend/app/auth.py`) with `hash_password()` / `verify_password()`. Salts generated per user. |
| Token | **JWT (HS256)** via `python-jose`. Created by `create_access_token()`, validated by `decode_token()` (returns `None` on any `JWTError`). |
| Token payload | `{ "sub": <user UUID>, "exp": <utcnow + expiry> }` |
| Token expiry | Default **30 minutes** (`access_token_expire_minutes`), overridable via env |
| DB models | 7 SQLAlchemy models (User, Resume, CandidateProfile, SearchPreferences, SearchRun, UserJob, Application) with UUID string PKs |
| Alembic | Applied migration `84c84cccd871` — all tables present in `backend/careerpilot.db` |

### Identity & Ownership Model (server-side)

- User identity is derived **server-side** from the JWT `sub` claim via the `get_current_user()` FastAPI dependency in `backend/app/routers/auth.py`; it loads the `User` from the database and enforces `status == ACTIVE`.
- The frontend **never supplies a `user_id`** — ownership is established by `current_user.id` server-side.
- Future protected resources (resumes, candidate profile, search preferences, search runs, saved jobs, applications) are already modeled with `user_id` foreign keys and can authorize via the `get_current_user` dependency re-exported as `__all__` from the auth router.

## 2. Endpoints

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| POST | `/api/auth/register` | Public | Creates user (bcrypt hash), returns `{access_token, token_type, expires_in}` (201). Duplicate email → 400 `Email already registered`. Password < 8 chars → 422 (Pydantic). |
| POST | `/api/auth/login` | Public | Validates credentials, returns token. Failure → 401 `Incorrect email or password` (generic, no user enumeration). |
| POST | `/api/auth/logout` | Public | Stateless no-op returning `{message}`; token invalidation is client-side removal. Exists for API consistency / future blacklist. |
| GET | `/api/auth/me` | Bearer token | Returns `{user: {id, email, status, created_at}}`. No token / bad token / inactive user → 401. |
| GET | `/api/health` | Public | Healthy. |
| `/api/jobs`, `/api/ranked/*`, `/api/applications`, `/api/pipeline/*`, `/api/demo/*` | Public | Unchanged, unchanged by auth (no global auth dependency). |

## 3. JWT / Session Behavior

- Tokens are stateless; expiry enforced via the `exp` claim. `decode_token` returns `None` on expired/invalid → 401.
- Client stores the token in `localStorage` under `careerpilot_token` and sends `Authorization: Bearer <token>` on every request via the axios request interceptor.
- On any **401**, the response interceptor removes the localStorage token and dispatches a `careerpilot:unauthorized` window event; `AuthContext` listens and clears user/token so `ProtectedRoute` redirects to `/login`.
- On app mount, `AuthContext` restores the stored token and re-fetches `/me`; failure (expired/invalid) clears the session. *(Fixed in this checkpoint — see §9.)*

## 4. Environment Variables

Backend settings come from `backend/app/config.py` (pydantic-settings, `env_file=".env"` — a backend `.env` may override; none is currently committed):

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./careerpilot.db` | Relative to backend CWD; run uvicorn from `backend/`. |
| `SECRET_KEY` | `dev-secret-change-in-production` | **Must** be overridden in any non-local deployment. |
| `ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | |
| `DATABASE_ECHO` | `false` | |

Frontend uses Vite env (`frontend/.env`, `.env.local`). The API client uses **relative `/api/*` paths** with `baseURL: ''`, so all requests flow through the Vite dev proxy. `VITE_API_BASE_URL` is currently defined but **unused** by the client; the values are stale/inconsistent (`.env` → `8005`, `.env.local` → `8000`) and should be removed or reconciled as housekeeping.

## 5. Frontend Authentication Flow

```
Register page ──POST /api/auth/register──▶ token ──▶ localStorage + axios header
Login page    ──POST /api/auth/login─────▶ token ──▶ localStorage + axios header
(both)        ──GET /api/auth/me─────────▶ user → AuthContext.user
Header        ──POST /api/auth/logout────▶ client-side token removal → navigate /login
```

Key files: `src/context/AuthContext.tsx`, `src/components/auth/ProtectedRoute.tsx`, `src/pages/Login.tsx`, `src/pages/Register.tsx`, `src/api/client.ts`, `src/components/layout/Header.tsx`.

## 6. Protected Routes

- `ProtectedRoute` wraps the authenticated area. While `AuthContext.loading` is true it renders a branded spinner; otherwise it renders `<Outlet/>` if `isAuthenticated`, or redirects to `/login` preserving `state.from`.
- Protected layout now lives at **`/dashboard`** (index = Dashboard), with `/` redirecting to `/dashboard`. (`/dashboard` was previously undefined while the header navigation already linked there — fixed in this checkpoint, see §9.)
- `/login` and `/register` are public.

## 7. User Ownership Model

- All future user-scoped resources are modeled with `user_id` UUID FK columns and cascade deletes.
- Authorization must use the server-side `current_user` dependency; a frontend-provided id is never trusted.
- This checkpoint only established the account layer; no user-scoped resource routes are exposed yet (they belong to later checkpoints).

## 8. Security Review

### Satisfactory
- Passwords hashed with bcrypt; no plaintext storage. Password hashes never returned by any endpoint.
- JWT signature verified with the configured secret + algorithm; bad/expired tokens rejected (401), no exception leakage.
- Login error message is generic (`Incorrect email or password`) — no login-time user enumeration.
- `/me` returns only public fields (id, email, status, created_at).
- Identity is derived server-side from `sub`; frontend supplies no user id.
- Logout clears local state + storage regardless of network result.
- CORS is wildcard with `allow_credentials=True` (see hardening below) — not exercised in dev because the app uses a same-origin Vite proxy.

### Documented for future hardening (NOT blockers at this checkpoint)
- **`SECRET_KEY` default** is public and named as replaceable; **must** be env-overridden before any shared deployment.
- **Register leaks email existence** (`400 Email already registered`). Acceptable tradeoff now; a generic 400 + email verification flow is future work.
- **Token in `localStorage`** is XSS-exposable. Curated for this architecture (task specifies client-side removal); an httpOnly cookie / refresh-token rotation model is the production upgrade.
- **Stateless logout** (no server blacklist). A token denylist or short-lived access + refresh tokens is future work if session revocation becomes a requirement.
- **CORS `*` + credentials** is technically unsound for browsers; point it at the real frontend origin in production.
- `passlib` is declared in requirements but unused (auth uses `bcrypt` directly) — minor dependency hygiene.

## 9. Frontend Senior Audit Findings

### KEEP (no change)
- Reusable, accessible `Input` / `Button` components (labels, `aria-invalid`, `aria-describedby`, focus rings, disabled + loading states, focus-visible outline).
- `ProtectedRoute` loading spinner and redirect-with-`from` preservation.
- Loading spinners & disabled submit buttons on Login/Register.
- Client-side validation (password ≥ 8, confirm-password match) on Register.
- Auth logout UX in both desktop and mobile Header with explicit aria-labels.
- Clean registration/login card layout, dark-mode support, responsive `px-4 sm:px-6 lg:px-8`.
- API client auth interceptor pattern (single relative-URL config through the Vite proxy).

### IMPROVE (implemented this checkpoint)
1. **Session restore on refresh (AuthContext).** `refreshUser()` read `token` from a stale closure (`null` right after `setToken`), so `/me` was skipped on reload — the user was dropped back to `/login` despite a valid stored token. Fixed by accepting an explicit token override (`refreshUser(tokenOverride?)`) and passing the freshly stored/issued token from `initAuth`, `login`, and `register`. This was the root cause of login/register not establishing `user` state.
2. **Surface real API error messages (Login/Register).** Axios flattened failures into `Request failed with status code 401`; the backend `detail` (`Incorrect email or password`, `Email already registered`) was never shown. Added `src/utils/errors.ts` `getApiErrorMessage()` and used it on both pages.
3. **Session-expiration handling.** A mid-session 401 removed the localStorage token but left `AuthContext` state authenticated (stale UI). The response interceptor now dispatches `careerpilot:unauthorized`, and `AuthContext` clears `user`/`token` so protected routes redirect to login.
4. **Routing coherence (App.tsx).** Protected layout moved to `/dashboard` so the header `Dashboard` link resolves; `/` redirects to `/dashboard`. Previously the header linked to a nonexistent route (blank page).

### REFACTOR / REPLACE
- None required. The component architecture was already sound.

### FUTURE (later checkpoints)
- Use `location.state.from` on Login to redirect back to the originally requested route.
- `VITE_API_BASE_URL` cleanup (remove or reconcile `8005`/`8000`).
- Code-split routes (the bundle is >500 kB after minification — an existing warning).
- Route-level access annotations for user-scoped resources once they exist.
- Optional "remember me" / persistent-until-expiry semantics and a token-expiry countdown notice.

## 10. Test Results (targeted)

| Suite | Result |
|-------|--------|
| `backend/tests/test_auth.py` | **19 passed** (register, duplicate register, login, invalid login, `/me`, expired token, logout, protected route, password hashing/verify, token encode/decode) |
| `backend/tests/test_database_foundation.py` | **14 passed** |
| **Total** | **33 passed** |
| `frontend npm run build` (`tsc -b && vite build`) | **Passed** (only pre-existing warnings: native config loader, chunk size) |
| Changed modules through Vite dev server | All 6 transform `200`; new logic present in served bundles |

## 11. Runtime Validation

| Check | Result |
|-------|--------|
| Backend | `http://127.0.0.1:8000` (uvicorn, PID 4916) — `/api/health` **200** |
| Frontend | `http://localhost:5173` (Vite, PID 3888) |
| Proxy | `/api/*` → `http://127.0.0.1:8000` confirmed — health through proxy **200** |
| Register | **201** + JWT; user persisted to DB (users 3 → 4) |
| Duplicate register | **400** `Email already registered` |
| Short password | **422** |
| Login (valid) | **200** + JWT |
| Login (invalid) | **401** `Incorrect email or password` |
| `/api/auth/me` (with token) | **200** `{user:{id,email,status,created_at}}` |
| `/api/auth/me` (no token) | **401** |
| Logout | **200**, token cleared client-side |
| Protected route | Redirects unauthenticated `/dashboard` → `/login`; serves Layout when authenticated |
| Demo Mode | Isolated — reads `backend/demo_data/*`, no DB/User coupling, endpoints **200** |
| Existing API | `/api/jobs`, `/api/ranked/{top5,top10,all}`, `/api/pipeline/{status,health,retention}`, `/api/applications`, `/api/demo/status` all **200** |

*Browser-level note: React UI interaction (visual transitions, redirect rendering) was validated at the code + build + dev-server-transform + API-proxy levels; no browser automation harness is present in the repo, so on-screen pixel behavior was not screenshot-verified.*

## 12. Backward Compatibility

- **Job pipeline** untouched: `job_scraper/canonical_jobs.json`, `seen_jobs.json`, `checkpoints.json`, `job_search_tracker.csv`, and `backend/demo_data/*` are unchanged (mtimes predate this session).
- All existing read endpoints return 200; no auth dependency was added to any existing router (auth is additive under `/api/auth/*`).
- Demo Mode and production job stores remain isolated from the users table.
- CLI job-search workflow unchanged (JSON/CSV read-only).

## 13. Environment Cleanup

Exactly two development servers are running (intended state):
- `127.0.0.1:8000` — FastAPI/uvicorn (started by this checkpoint)
- `[::1]:5173` — Vite (pre-existing)

No duplicate or stale listeners on 8000/5173/8001/8005. The OmniRoute dashboard `Update Available: v3.8.50` notification is informational and unrelated to CareerPilot — not acted on.

---

## 14. Files Changed (this checkpoint)

- `frontend/src/context/AuthContext.tsx` — session-restore + token-override fix, 401 synchronization listener
- `frontend/src/api/client.ts` — dispatch `careerpilot:unauthorized` on 401
- `frontend/src/utils/errors.ts` — **new** API error-message helper
- `frontend/src/pages/Login.tsx` — use `getApiErrorMessage`
- `frontend/src/pages/Register.tsx` — use `getApiErrorMessage`
- `frontend/src/App.tsx` — protected layout path `/dashboard`; `/` redirects to it
- `CHECKPOINT_2_AUTHENTICATION_REPORT.md` — **new** (this document)

No backend files or job-pipeline data were modified.