# P5 — Deployment & Public Hosting Scope Assessment

**Date:** 2026-09-16
**Checkpoint:** P5 (read-only architecture/release assessment)
**Branch:** master
**HEAD:** `ad2ca66` — `fix(demo): wire public demo pages to public data APIs` (P4.3)
**Scope:** Assessment only. No source, config, data, demo-data, or environment files were modified. Nothing was deployed, built, committed, or pushed.

---

## 1. Executive Summary

CareerPilot currently ships as a **single FastAPI monolith + a Vite/React SPA** in one repository. The P1–P4.3 work established a structurally enforced public/private boundary **in application code**: every `/api/public/*` route reads exclusively from the fictional `DemoDataStore` (`backend/demo_data/*`), and no private router can be reached anonymously.

The deployment problem is therefore **not "do the public routes leak private data"** (they do not: they never reference the real store, the SQLite database, the scraper files, or auth). It is:

> The **application ship** is one process. The public demo plane and the private plane share a single FastAPI app, a single startup, a single production configuration gate, and a single set of mounted routers. There is no Dockerfile, no separate public-app entrypoint, and the frontend has **no runtime API-base URL wiring** (it uses same-origin relative `/api/*`).

**Consequences (verified):**
- A public demo deployment must still satisfy the full production-configuration gate (`SECRET_KEY`, explicit CORS, absolute `DATABASE_URL`, `RATE_LIMIT_ENABLED=true`) even though the demo endpoints need none of those at request time.
- The frontend build is pure static and can be hosted as static assets, **but** it must be served on the **same origin as the API** (or a small code change must wire `VITE_API_BASE_URL`, which is currently defined in `.env` but never read by the code).
- The cleanest deployment without any code change is **one origin behind one reverse proxy**: `/api/*` → FastAPI, everything else → static SPA with fallback to `index.html`.
- The rate limiter is in-process and single-worker; production must run **one uvicorn worker** in the default single-host topology (already the documented design).
- Public read endpoints are **not rate limited** (only auth/search/docgen are). Low amplitude, but an anonymous crawler is unthrottled — must be accepted or mitigated at the proxy.
- Repo/public-GitHub hygiene is the highest general-release risk: many real `job_scraper` outputs (e.g., `canonical_jobs.json`, `ranked_jobs.json`, `portal_health.json`, `top5/top10`, `scored/verified`, `raw_*`) exist **untracked and not gitignored** — a naive `git add .` (or a public release) would leak personal job-search data.

**Bottom line:** the public demo is deployable today as a same-origin single-host deployment with the existing build, using the reverse proxy to keep the private routes unreachable. No application-code change is strictly required for that topology. All other topologies (separate API domain, containers) require small, well-defined repository changes. The smallest next implementation checkpoint is **P5.1 — deployment packaging + production configuration** (reverse-proxy/static-hosting config, public-plane smoke test, production env template, and repo-hygiene gitignore hardening). Details in §17.

---

## 2. Current Architecture (verified)

| Layer | Technology (verified) | Notes |
|---|---|---|
| Backend runtime | Python 3.12 (CI pins this), FastAPI `0.115.0`, Uvicorn `0.32.0` (`backend/requirements.txt`) | SNI: uvicorn, single process design |
| ORM/DB | SQLAlchemy `2.0.34` + `aiosqlite`, Alembic `1.13.1` migrations present (`backend/alembic`) | DB engine is created lazily on first `get_db_manager()` call |
| Auth | JWT (python-jose) + passlib/bcrypt; `create_app` mounts `auth.router` | Unauthenticated: `/api/auth/register`, `/api/auth/login` |
| Public plane | `backend/app/demo_store.py` `DemoDataStore` → reads `backend/demo_data/*` only | Never imports the real `DataStore`, real DB, or personal state |
| Private plane | `backend/app/store.py` `DataStore` → real files + DB | Auth-gated routers (jobs/ranked/applications/pipeline/health/…/admin) |
| Frontend | React 19 + Vite 8 + TanStack Query + react-router 7 | `frontend/vite.config.ts`, `package.json` |
| Build output | `frontend/dist` (index.html + hashed JS/CSS + favicon/icons) | Verified present |
| CI | `.github/workflows/ci.yml` — template-specific (latex smoke, skill lint, portal-CLI typechecks, tool unit tests) | Does **not** build/test the CareerPilot FastAPI app or frontend; no pipeline/deploy job |
| Containers | **None.** No Dockerfile, no compose file found (searched to depth 3) | Containerization is optional, not present |
| Config | `backend/app/config.py` (pydantic-settings); `backend/.env.example` documents all vars | Production validator gates startup |

**P1–P4.3 state:** P1 (security/boundary core), P3 (resource/production/session hardening), P4–P4.3 (public demo dataset, public API, wire public UI) are complete and committed. P4.3 (`ad2ca66`) is HEAD; worktree is clean of tracked modifications (only pre-existing untracked artifacts remain).

**Public/private boundary (re-verified in code for this assessment):**
- `backend/app/routers/public.py` (`/api/public/*`) imports `demo_store` **only** (`from ..demo_store import get_demo_store`); the module docstring asserts it must never import the real `DataStore`/SQLite/personal state.
- `backend/app/routers/health.py` (`/api/health`) is auth-gated (`Depends(get_current_user)`).
- `backend/app/routers/demo.py` (`/api/demo/*`) GET endpoints are unauthenticated but serve **the same demo data** (duplication of `/api/public`); its mutations (`bootstrap`/`reset`) are auth-gated.
- `frontend` public pages import only public hooks (`frontend/src/pages/Public*.tsx`), all of which call `/api/public/*`.

---

## 3. Public Runtime Dependency Map (what the demo needs to run)

**Questions → answers (verified):**

| Dependency | Needed by public demo? | Evidence |
|---|---|---|
| SQLite | **No** (endpoint-level) | `public.py` touches only `demo_store`; real DB is never referenced by public routes |
| `careerpilot.db` (private DB) | **No** | Same — private `DataStore`/DB never imported by public plane |
| Scraper / orchestrator | **No** | Public plane reads `backend/demo_data/*`, not `job_scraper/*`, and DemoDataStore never invokes the scraper |
| Node/Bun | **No** at runtime | Node is a build-time tool (Vite); the built SPA is static |
| Python | **Yes** | FastAPI app itself runs under Python + Uvicorn |
| Authentication | **No** | Public endpoints are unauthenticated by design |
| Scheduler/orchestration processes | **No** | Rely on static demo data; `reconcile_stale_runs()` at startup touches the DB but is wrapped non-fatal |
| Real job data | **No** | Demo corpus only (`demo_seen_jobs.json`) |
| Filesystem write access | **No** | Public plane reads 3 files; needs **read-only** access to `backend/demo_data/*` (plus a writable runtime location only for server logs, if desired) |
| Environment secrets | **No** (for endpoint execution) | No secret is read by `public.py` |
| LLM provider / API keys | **No** | `get_llm_provider()` at startup logs a non-fatal warning if unconfigured |

**Necessary public endpoints** (the only ones a public demo needs exposed):
`GET /api/public/status`, `GET /api/public/jobs/active`, `GET /api/public/jobs/{stable_id}`, `GET /api/public/applications`, `GET /api/public/pipeline`, `GET /api/public/retention`, `GET /api/public/health/portals`.

**Files required at runtime (public only):** `backend/demo_data/demo_seen_jobs.json`, `backend/demo_data/demo_tracker.csv`, `backend/demo_data/demo_checkpoints.json` (read-only). That is the complete public dependency set for endpoint execution.

---

## 4. Private Runtime Dependency Map (what the private plane needs)

| Dependency | Evidence / reason |
|---|---|
| SQLite (or Postgres) via `DATABASE_URL` | Users, saved jobs, applications, search runs (ORM models in `backend/app/models/`) |
| Alembic migrations | Schema management for the real DB |
| Real scraper outputs (`job_scraper/canonical_jobs.json`, `seen_jobs.json`, `ranked_jobs.json`, `top5/top10`, `scored/verified`, `portal_health.json`, `checkpoints.json`) | `store.py`/DataStore reads these for `/api/jobs`, `/api/ranked/*`, `/api/pipeline/*`, `/api/portal-health/*` |
| `job_search_tracker.csv` | Personal application tracker |
| Uploads + generated output dirs | `data/uploads/resumes`, `data/generated`, resume/documents (CV/CL downloads in frontend) |
| LLM provider API keys | Optional at startup (non-fatal warning) but required for search/assistant features at runtime |
| Writable filesystem | DB, uploads, generated docs, logs |
| Auth (JWT + bcrypt) | All private routes |
| Logs | `logs/audit.log` and server logs |

**Separation verdict:** the public plane is **fully separable from the private filesystem at the data level** — the public app code path reads only `backend/demo_data/*`. *But* the two share one process/config; a true separate-filesystem deployment is possible only by either (a) reverse-proxy path filtering to a single process, or (b) shipping a trimmed public-only app entrypoint (a P5.1 candidate, §17).

---

## 5. Frontend Deployment Requirements (verified)

- **Vite config** (`frontend/vite.config.ts`): plugins, path aliases, dev server on :5173 with an `/api` proxy to `http://127.0.0.1:8000`. The proxy is **dev-only** (not baked into the build).
- **Build output:** `frontend/dist` contains `index.html`, hashed `index-*.js`/`index-*.css` in `assets/`, and `favicon.svg`/`icons.svg` (from `public/`). Verified present; build passes (`tsc -b && vite build`).
- **API base URL:** `frontend/src/api/client.ts` uses **`baseURL: ''`** — all requests are **same-origin relative** (`/api/public/...`, `/api/jobs`, ...). `VITE_API_BASE_URL` is defined in `frontend/.env` / `.env.example` but is **never read by any source file** (grep confirmed — only `import.meta.env.DEV` appears). 
  - **Implication (verified fact):** in the built app the API origin **must equal the frontend origin**. Any topology where the API lives on another origin (subdomain or separate static host) requires a small code change to consume `VITE_API_BASE_URL` in the axios client.
- **Routing strategy:** react-router `BrowserRouter` with deep routes including:
  `/demo`, `/demo/jobs`, `/demo/jobs/:stableId`, `/demo/jobs/:stableId/fit`, `/demo/ranked`, `/demo/applications`, `/demo/pipeline`, `/demo/retention` (P4.3).
- **SPA fallback (required):** direct loads and hard refreshes of `/demo/*` hit the web server, which must rewrite unknown paths to `index.html` (react-router then renders the right page). Hosting without fallback → 404 on refresh/deep-link.
- **Environment variables:** the frontend consumes **no runtime env** in the built bundle; none are required at runtime.
- **Asset paths:** absolute root-relative (`/favicon.svg`, `/src/main.tsx` at build; hashed assets referenced relative to root). Works on any origin root (no custom `base` set; domain root assumed).

---

## 6. Backend Deployment Requirements (verified)

`backend/app/config.py` production validator (runs at startup; raises and aborts on violation):

| Variable | Mandatory in production? | Safe default / note |
|---|---|---|
| `ENVIRONMENT=production` | **Yes** | Not a secret |
| `SECRET_KEY` | **Yes** — must differ from `dev-secret-change-in-production` | Generate `secrets.token_urlsafe(32)`; **never committed** |
| `CORS_ALLOWED_ORIGINS` | **Yes** — `"*"` rejected with credentials | For same-origin deploy, set to the published origin(s); not the wildcard |
| `DATABASE_URL` | **Yes** — relative `sqlite+aiosqlite:///./...` rejected | Absolute path (`sqlite+aiosqlite:////...`) or PostgreSQL |
| `RATE_LIMIT_ENABLED=true` | **Yes** — `false` rejected in production | Must stay enabled |
| `RATE_LIMIT_TRUST_PROXY` | Optional (default `false`) | Set `true` **only** if the app is reachable exclusively through **one** reverse proxy that sets `X-Forwarded-For` (see §9) |
| `UPLOAD_DIR`, LLM keys, model names, rate-limit tunables | Optional | LLM keys optional at startup; required only for search/assistant features |
| `DATABASE_ECHO` | No | Leave `false` |

**Verified production behavior already implemented:** interactive docs `/docs`, `/redoc`, `/openapi.json` are **disabled** in production (`main.py:59-61`); `SecurityHeadersMiddleware` adds `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (no CSP — documented as not yet audited). CORS uses `allow_credentials=True` with explicit origins. Rate limiter is in-process/single-worker by design.

**Public demo CAN operate without real-data configuration** in the sense that it never reads real data — but it **cannot** run without the production gate, because it shares the app and its startup validator with the private plane. This is a finding (§9 risk #4): a demo-only deploy literally requires `DATABASE_URL` pointing at a real (empty) database path and a `SECRET_KEY`, even though those endpoints never use them.

---

## 7. Database / Persistence Requirements (verified classification)

| Artifact | Class |
|---|---|
| `backend/demo_data/demo_seen_jobs.json` | **PUBLIC DEMO REQUIRED** (read-only) |
| `backend/demo_data/demo_tracker.csv` | **PUBLIC DEMO REQUIRED** (read-only) |
| `backend/demo_data/demo_checkpoints.json` | **PUBLIC DEMO REQUIRED** (read-only) |
| `backend/demo_data/../demo_seen_jobs.json` fixtures | Public demo fixtures |
| `backend/careerpilot.db` (+ backups) | **PRIVATE REQUIRED** (real DB; gitignored) |
| `job_scraper/canonical_jobs.json`, `ranked_jobs.json`, `top5/top10`, `scored/verified`, `portal_health.json`, `checkpoints.json`, `seen_jobs.json` | **PRIVATE REQUIRED** (`seen_jobs.json`/`checkpoints.json` ignored; the others currently untracked-not-ignored — hygiene finding §12) |
| `job_search_tracker.csv` | **PRIVATE REQUIRED** (gitignored) |
| `data/uploads/resumes`, `data/generated` | **PRIVATE REQUIRED** (writable; uploads ignored) |
| `logs/` | **PRIVATE/RUNTIME** (gitignored via `*.log`) |
| Root `careerpilot.db`, `careerpilot_test.db` | **DEVELOPMENT ONLY** (ignored) |
| Stray empty dir `frontend/C:UsersSoladmDownloadsPilotai-job-searchbackenddemo_data` | **NOT REQUIRED** (empty accident; hygiene note) |

**Verdict:** a public deployment can be **completely separated from the private filesystem** — it needs only the 3 demo files, read-access. The private deployment additionally needs DB, scraper data, uploads, generated output, logs, writable storage. With a single-process deployment these live on one host but the public pages never reach them; with a trimmed public-only entrypoint (P5.1 option) they can be physically separate.

---

## 8. Deployment Topology Options (evaluated; not ranked, per directive)

### Option A — Single host, one origin: reverse proxy (TLS) + static SPA + FastAPI
- **Components:** one VM/container host; Nginx (or Caddy/Traefik) terminating TLS; serves `frontend/dist` as static; SPA fallback to `index.html`; proxies `/api/*` (and `/`, `/docs` optional) to Uvicorn on `127.0.0.1:8000`; environment variables; systemd process supervision (single uvicorn worker).
- **Complexity:** Low. **No code change required** (same-origin relative API works).
- **Security:** Private routes still exist upstream; they are unreachable-only-by-configuration (proxy path rules). Rate-limit IP identity comes from the proxy (`RATE_LIMIT_TRUST_PROXY=true`), which is the supported single-proxy model.
- **Persistence:** private plane needs DB/fs (same host); public plane read-only demo files.
- **Operational burden:** Low-moderate; one host, one process, one proxy.
- **Suitability:** Best fit for this project today (matches same-origin frontend, in-process rate limit, single-worker design).

### Option B — Static hosting + separate FastAPI API
- **Components:** static host/CDN for `frontend/dist` (with SPA fallback) + API host (Uvicorn behind proxy) on another origin.
- **Complexity:** Moderate. **Requires a code change**: wire `VITE_API_BASE_URL` into `client.ts` (currently unused) and rebuild; configure CORS for the frontend origin.
- **Security:** CORS becomes meaningful (cross-origin) — must keep default credentials behavior compatible; ensure API sets the correct explicit origins.
- **Persistence / operational:** same as A split across two managed services; more moving parts, more config.
- **Suitability:** Fine if the team prefers managed static hosting/CDN; not required functionally.

### Option C — Containerized frontend/backend
- **Components:** Dockerfile for the API (Python + uvicorn, bundled demo_data), a static-serving container (or nginx-based image), optional compose; persist private data via volume; single uvicorn worker.
- **Complexity:** Moderate; none exist today (§8 below), so all artifacts are net-new.
- **Security:** Better process isolation (public/private can be separate containers/networks), image-age patching obligation.
- **Persistence:** volumes for DB/private data; public demo image can be truly read-only + stateless.
- **Suitability:** Worthwhile when a restricted public network boundary or reproducible env is needed; otherwise adds operational overhead beyond A.

### Option D — Public-only trimmed app (no separate reverse-proxy filtering)
- **Components:** a second FastAPI entrypoint building only the public + auth routers from the same source (e.g., a small `public_main.py`), deployed on the same or separate host; reverse proxy sends only `GET /api/public/*` and, optionally, `/api/auth/*`.
- **Complexity:** Low-moderate **code change** (new entrypoint file); strongest enforcement (the private routers never run in the public process).
- **Security:** Best real isolation — a compromise of the public process cannot reach private routes/DB/files.
- **Suitability:** The natural next-step if Option A's "unreachable-by-config" property is considered insufficient. Fits P5.1.

(Recommendation not made here per directive; §17 proposes P5.1 to implement the chosen option, with A as the zero-code baseline.)

---

## 9. Network / Security Considerations (verified)

**Externally reachable classification:**
- **PUBLIC (unauthenticated):** `/`, `/api/public/*` (7 endpoints), `/api/auth/register`, `/api/auth/login`, and the duplicate **`/api/demo` GET plane** (`status`, `jobs/active`, `jobs/{id}`, `pipeline`, `retention`). All demo data; no real data.
- **PRIVATE (JWT):** `/api/health`, `/api/jobs/*`, `/api/ranked/*`, `/api/applications/*`, `/api/pipeline/*`, `/api/portal-health/*`, `/api/dashboard`, `/api/resume/*`, `/api/profile`, `/api/preferences`, `/api/search*`, `/api/saved-jobs/*`, `/api/auth/me`, `/api/auth/logout`.
- **ADMIN (admin JWT):** `/api/admin/sources`, `/api/admin/users`.
- **Docs:** disabled in production.

**Reverse-proxy exposure notes (verified facts → risks):**
1. **Docs/OpenAPI:** disabled under `production` — good. Verify `ENVIRONMENT=production` is actually set; under `development` docs are public.
2. **`/api/demo` duplicate plane:** unauthenticated reads of the same demo data as `/api/public`. Not a real-data leak, but two anonymous surfaces; a maintenance/consistency hazard and a slightly larger anonymous footprint.
3. **CORS:** with same-origin Option A, CORS is effectively moot (same origin). If Option B/CORS explicit list is used, `allow_credentials=True` + explicit origins is correct; keep the list tight.
4. **Forwarded headers / proxy trust:** the app takes client IP from `X-Forwarded-For` **only when `RATE_LIMIT_TRUST_PROXY=true`**. Behind a proxy with the flag off, rate-limit IPs collapse to the proxy's IP (limits become global, less precise but still on). With the flag on, the proxy must strip/set `X-Forwarded-For` and the app must not be directly reachable (documented P3.1 requirement).
5. **TLS termination:** at the proxy; app behind it speaks HTTP on loopback — fine and supported.
6. **Health endpoints:** `/` and `/api/public/status` are unauthenticated liveness; `/api/health` is auth-gated (private). Load-balancer/probe readiness should target the public path (§11).
7. **Error handling:** public errors are standard FastAPI HTTP/404/422/429 detail responses; no stack traces leak to clients (framework default). `NetworkError`/`NotFoundError` handled client-side.
8. **Rate limiting:** in-process sliding-window for `auth.login`, `auth.register`, `search.start`, `docgen.generate`. **Public GET endpoints are unthrottled** (no global middleware). Anonymous crawling of `/api/public/jobs/active` is unbounded (small amplification, but a real unbounded-anonymous-read vector). Mitigation options (defer or accept): proxy-level limit, or a future public-read rate limit (P5.x).

---

## 10. Observability / Health Requirements (verified)

- **Existing endpoints:** `/` (public, app metadata + health link), `/api/public/status` (public demo health/info), `/api/public/health/portals` (public portal health), `/api/health` (auth-gated, real-pipeline + data-file status).
- **Externally accessible (recommended):** `/` and `/api/public/status` for a public liveness/ready probe.
- **Private:** `/api/health` must remain auth-gated — it reports real pipeline/data-file status and must not be exposed.
- **Readiness check:** no dedicated readiness endpoint exists or is needed; `/api/public/status` returning 200 from the public plane is a suitable readiness signal. Note that `/api/public/status` depends only on demo files, so "public ready" ≠ "private plane ready"; monitor the private plane separately in full deployments.
- **Logging:** uvicorn access logs to a writable path; `logs/audit.log` for audit events. In production, redirect stdout/stderr to a supervisor/journald capture.

---

## 11. Performance / Resource Baseline (estimated from repo, not speculation)

- **Static frontend:** `frontend/dist` — a handful of hashed assets (~tens–hundreds of KB; single JS + CSS). Trivial to serve; any static host copes.
- **FastAPI process:** single Uvicorn worker; pydantic-settings config; in-memory rate limiter bounded at 10k keys; demo store caches ~56 jobs ≈ **127 KB** plus ~16 applications in memory (LRU/cache with `invalidate_demo_store_cache`). Negligible CPU; demo retention computes over ≤56 records per request.
- **Demo dataset:** 56 jobs (`demo_seen_jobs.json`, 127 KB), 16 application rows (`demo_tracker.csv`), checkpoint metadata (`demo_checkpoints.json`).
- **Expected public workload:** portfolio/demo traffic — low. Same-origin single host handles it easily.
- **In-process rate limiting under the proposed topology:** correct for Option A/B/C single-worker; documented limitation is multi-worker deployments (each worker keeps its own window) — production must run **one worker**, and any horizontal scaling (not needed now) requires an external limiter.
- **Constraints that matter:** one uvicorn worker; a writable location for logs; watch `pool_pre_ping`/SQLite locking only if the private plane runs on the same host. Public-only requests impose no DB load.

---

## 12. Repo / Public GitHub Hygiene (verified findings)

**Checked-in tree:** clean — the real DB, tracker, CVs/cover letters, uploads, seen_jobs, and checkpoint files are gitignored (verified via `git check-ignore`). `backend/demo_data/*` is intentionally tracked (fictional corpus — correct).

**Risk — untracked and NOT gitignored (the primary release hazard):**
- `job_scraper/canonical_jobs.json`, `ranked_jobs.json`, `top5_jobs.json`, `top10_jobs.json`, `scored_jobs.json`, `verified_jobs.json`, `priority_queue*.json`, `raw_*2026082*.json`, `filtered_*.json`, `verification_*.json`, `incremental_report_*.txt`, `job_search_report.txt`, `normalized_results.json`, `hard_filtered_results.json` — **real personal job-search data**, currently untracked but **not ignored** (`.gitignore` only covers `seen_jobs.json`, `checkpoints.json`, `.md`, `*.backup.*`, `.tmp/` under `job_scraper/`). A single `git add .` or a careless public publish exposes them.
- `logs/audit.log` — gitignored only via the blanket `*.log` rule; audit content exists in the worktree.
- `backend/.env.example` — an example (no secrets), currently untracked-not-ignored (harmless; may be tracked or ignored deliberately).
- Stray **empty** directory `frontend/C:UsersSoladmDownloadsPilotai-job-searchbackenddemo_data` — accidental (from an earlier path-expansion bug); should be deleted (cleanup, not this checkpoint).

**Must-have before any public publish:** extend `.gitignore` to cover `job_scraper/*.json` outputs and any new personal outputs; consider a `git filter-branch`/`history` review is **not** required for untracked-only files (they are not in history), but the working tree must not be `git add`-ed wholesale. Do not delete/modify anything in this checkpoint (verified: nothing was).

---

## 13. MUST HAVE Deployment Requirements

1. `ENVIRONMENT=production` (also disables docs, enables security headers).
2. Strong random `SECRET_KEY` (≠ default), held as a secret, never committed.
3. Explicit `CORS_ALLOWED_ORIGINS` = the published origin(s); wildcard rejected by the validator.
4. Absolute-path `DATABASE_URL` (or PostgreSQL) — required even for demo-only because of the shared startup validator; point it at a real, provisioned private DB.
5. `RATE_LIMIT_ENABLED=true` (enforced) and **exactly one uvicorn worker** (in-process limiter correctness).
6. Run uvicorn bound to loopback behind a TLS reverse proxy that owns `/api/*` and serves the static SPA with SPA fallback (`/demo/*` → `index.html`).
7. Serve `/api/health` (private) and admin paths as private; only `/api/public/*` + `/` + optionally `/api/auth/register|login` reach the internet.
8. `RATE_LIMIT_TRUST_PROXY=true` only when there is exactly one reverse proxy setting `X-Forwarded-For` and the app is unreachable directly.
9. Ship `backend/demo_data/*` with the app and expose read-only.
10. **Repo hygiene before any public publish:** gitignore the untracked `job_scraper` outputs and scrub the working tree (§12).

## 14. SHOULD HAVE Requirements

1. Process supervision (systemd/CI-managed run) with restart + stdout capture.
2. Public liveness probe on `/api/public/status` (and `GET /`), distinct from the private `/api/health`.
3. Production logging to a bounded, rotated sink; `logs/audit.log` preserved if audit is used.
4. Optional network-layer rate limiting / WAF rule for anonymous `/api/public/*` reads (in-process limiter does not cover them).
5. A staging environment that mirrors production config (validator runs identically) with a public-plane smoke test.
6. Access log filtering to avoid logging tokens (client clears tokens on 401; ensure proxies don't log Authorization headers).

## 15. DEFERRED Requirements

1. Containerization (Dockerfile/compose) — unnecessary for the current single-host scale; revisit with the public app if process isolation is demanded.
2. Separate public-only FastAPI entrypoint (Option D) — strongest isolation; naturally becomes P5.x if the "unreachable-by-config" property is judged insufficient.
3. Horizontal scaling / external rate-limiter/Redis — not needed at demo traffic; would change the in-process limiter design.
4. CDN edge caching of static assets and of `/api/public/jobs/active` — optional once traffic warrants.
5. Frontend CSP — blocked on a frontend audit (documented in `security_headers.py`); not required to deploy.
6. Custom domain/DNS, analytics, SEO, shareable links — portfolio niceties; checkpointed later.

## 16. Risks / Open Questions

1. **Shared-process boundary (accept-by-design):** the public demo and the private plane run in one process. Public routes never reach private data, but a defensive compromise of the demo-only backend process would host (not expose) the private routers. Defer Option D if stricter isolation is required.
2. **Public reads unthrottled:** anonymous crawlers have no in-app limit on `/api/public/*`. Accept or mitigate (ideal proxy-level or P5.x read limit).
3. **`/api/demo` duplicate anonymous surface:** two unauthenticated planes serving the same demo data increases surface area and future drift (e.g., if someone adds real-data logic to the demo router). Consider deprecating/deleting the `/api/demo` GET endpoints.
4. **Unused `VITE_API_BASE_URL`:** currently a trap — an operator may set it expecting the app to use it, but nothing reads it. Either wire it (if multi-origin topology is ever chosen) or remove it. Same-origin baseline needs neither.
5. **Frontend runtime env absent:** no runtime knobs (e.g., feature toggles) exist; any change requires a rebuild. Acceptable for a demo.
6. **`/docs` exposure if `ENVIRONMENT` mis-set:** all hardening keys off the `production` flag; a staging instance accidentally running `development` will expose docs and skip the validator. Guard: CI/environment assertion at deploy.
7. **Stale demo timestamps:** `demo_checkpoints.json` uses fixed 2026-09-12 timestamps; retention math over demo jobs is static by design (fictional) — fine, but anyone reading "retention" numbers should see them as frozen demo output.
8. **SQLite concurrency on a shared host:** if the private plane is on the same host, aiosqlite + single worker is fine; avoid multi-worker.

## 17. Proposed Next Implementation Checkpoint

**Name:** **P5.1 — Deployment packaging & production configuration.** (Not assumed in advance; this is the smallest logical implementation step after the P5 assessment.)

**What it should implement, and why:**
- **Choose and wire the baseline topology (Option A default):** produce the concrete reverse-proxy + static-hosting + single-worker uvicorn configuration (config files, not prose), SPA-fallback rules covering all `/demo/*` routes, and the exact production `ENVIRONMENT` variable set.
- **Expose the API base for non-same-origin options:** wire `VITE_API_BASE_URL` into `client.ts` (and set a sane default) **only if** the chosen topology is multi-origin; otherwise leave same-origin and drop the misleading env var.
- **Public-plane smoke test:** an automated check that, from a deployed artifact (staging), all 8 `/demo/*` routes + `/api/public/*` return 200 anonymously and the private routes remain 401 — codifies the P4.2/P4.3 boundary in a deployment test.
- **Production env template + secret handling:** a reviewed production `.env` checklist and secret-injection pattern (not your machine's `.env`).
- **Repo hygiene gate:** gitignore hardening for the untracked `job_scraper` outputs (§12) as a release prerequisite.
- **Why smallest/first:** everything else (containers, trimmed public app, CDN) is optional and builds on this; P5.1 delivers the first genuinely deployable public demo with the boundary preserved.

## 18. P5 Exit Criteria

For P5 (this assessment) to be considered complete, acceptance requires:
1. `P5_DEPLOYMENT_PUBLIC_HOSTING_SCOPE_ASSESSMENT.md` exists as the **only** new artifact.
2. No source, config, data, demo-data, or environment file modified; no deploy/build/commit/push performed.
3. HEAD remains `ad2ca66` (P4.3); `git status --short` shows only pre-existing untracked artifacts + this report.
4. Public demo runtime dependency set fully identified (§3) and minimum endpoint list documented.
5. Frontend producibility verified: static assets, same-origin API requirement, SPA fallback for `/demo/*` (§5).
6. Backend production variables classified mandatory/optional/never-commit (§6); `ENVIRONMENT=production` gating confirmed.
7. Topology options A–D evaluated without premature ranking (§8).
8. Network boundary classified PUBLIC/PRIVATE/ADMIN and reverse-proxy risks enumerated (§9).
9. Filesystem/persistence classification complete incl. demo-vs-private separation verdict (§7).
10. Docker/container readiness assessed as absent + optional (§8/§15).
11. Hosting requirements documented as technical facts, not vendor marketing (§5–§7, §11).
12. Security invariants from P1–P4.3 carried forward; any deployment-specific gaps flagged, not fixed (§9, §16).
13. Observability: /`api/public/status` identified as the public readiness probe; /`api/health` confirmed private (§10).
14. Performance/resource baseline estimated from repo evidence; single-worker constraint recorded (§11).
15. Repo/public-GitHub hygiene findings documented, incl. the untracked-not-ignored `job_scraper` outputs (§12).
16. MUST / SHOULD / DEFERRED deployment lists produced (§13–§15).
17. Next implementation checkpoint proposed with rationale (§17).
18. Risks/open questions enumerated and not silently resolved (§16).

---

### Verification note
This assessment used **reduced verification** (targeted file inspection + config review + `git check-ignore` classification). No source files, configuration, demo data, or environment files were modified. No tests were re-run (none are affected — the assessment changes nothing). No containers, infrastructure, or deployments were created. Nothing was committed or pushed.

**Post-assessment `git status --short`:** unchanged from baseline — only the pre-existing untracked artifacts plus this new report. P4.3 (`ad2ca66`) remains HEAD.