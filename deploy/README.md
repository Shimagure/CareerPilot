# CareerPilot — Single-Host Deployment Runbook (P5.1)

Deployment packaging for the recommended **same-origin single-host** topology:

```
https://<public-origin>
        │  nginx (deploy/nginx.conf, TLS terminated here)
        ├── /     → frontend/dist         (static + SPA fallback to index.html)
        └── /api/ → http://127.0.0.1:8000 (single-worker uvicorn)
                         │
                         └── existing FastAPI app
                                ├── /api/public/*  → DemoDataStore  (fictional demo)  [PUBLIC]
                                ├── /api/auth/*    → register/login/me              [PUBLIC]
                                └── all other /api/* → real data, JWT required      [PRIVATE/ADMIN]
```

This checkpoint produces **deployable packaging only** — nothing is deployed,
no DNS, no certificates, no containerization, no CI/CD.

---

## 1. Files in this package

| File | Purpose |
|---|---|
| `deploy/nginx.conf` | Generic reverse proxy: TLS termination (operator certs), static frontend, SPA fallback, `/api/*` → uvicorn, proxy-level bound on `/api/public/*` |
| `deploy/start_api.cmd` | Windows: single-worker uvicorn launcher (enforces `--workers 1`) |
| `backend/.env.production.example` | Production config template — placeholders only, **no real secrets** |
| `backend/.env.example` | Development/general config reference (unchanged behavior; new tuning knobs documented) |
| `.gitignore` (repo root) | Release hygiene: real personal job-search data can never be `git add`-ed |

---

## 2. Build the frontend

```bash
cd frontend
npm install          # once
npm run build        # = tsc -b && vite build
# Output: frontend/dist/  (index.html + content-hashed assets, favicon, icons)
```

Copy `frontend/dist/` to the web root referenced by `deploy/nginx.conf`
(`/var/www/careerpilot/frontend-dist`), or point the `root` directive at it.

**Same-origin design (do not change):** the API client uses `baseURL: ''`
(`frontend/src/api/client.ts`), so the built app talks to `/api/*` **relative to
its own origin**. This topology requires frontend and API behind **one** proxy.

> ⚠️ **`VITE_API_BASE_URL` trap.** `frontend/.env.example` defines
> `VITE_API_BASE_URL`, but nothing in `src/` reads it (verified by grep, P5.1).
> It is a local reminder only. In the same-origin deployment it is **not used
> and must not be relied on** — changing it has NO effect on the build. Do not
> add an API-base abstraction until a genuinely multi-origin deployment exists.

---

## 3. Backend production configuration

Copy `backend/.env.production.example` to `backend/.env` on the host and fill the
placeholders. The non-negotiable production rules are **enforced at startup** by
`backend/app/config.py::validate_production_config()` (the app refuses to start
with a bad production config):

| Variable | Rule (production) | Why |
|---|---|---|
| `ENVIRONMENT=production` | must be exactly `production` | enables security headers; **disables `/docs`, `/redoc`, `/openapi.json`** |
| `SECRET_KEY` | ≥ 32 chars, not the default `dev-secret-change-in-production` | JWT signing; the default is rejected |
| `CORS_ALLOWED_ORIGINS` | explicit origin(s), **never `*`** | wildcard with credentials is rejected |
| `DATABASE_URL` | **absolute** SQLite path or PostgreSQL | relative `sqlite+aiosqlite:///./...` is rejected |
| `RATE_LIMIT_ENABLED` | `true` | disabling it in production is rejected |

**Generate the secret** (do not invent one, and never commit it):
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## 4. Start the API (one worker, loopback only)

**Windows:** `deploy\start_api.cmd` (checks `backend\.env`, then
`py -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1`).

**Linux/systemd** (equivalent — no systemd unit is shipped, this is the shape):
```ini
# /etc/systemd/system/careerpilot-api.service
[Unit]
Description=CareerPilot API
After=network.target

[Service]
WorkingDirectory=/opt/careerpilot/backend
EnvironmentFile=/opt/careerpilot/backend/.env
ExecStart=/opt/careerpilot/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
User=careerpilot

[Install]
WantedBy=multi-user.target
```

**Single worker is mandatory.** The rate limiter is in-process
(`backend/app/rate_limit.py`); with N workers each keeps its own window, so N×
the anonymous budget is available and auth limits diverge. `--workers 1`.

**Bind to loopback only.** The nginx proxy reaches uvicorn on `127.0.0.1:8000`.
Never expose port 8000 to the internet — the proxy `location /api/*` is the only
public entry. `config.uplifts`/docs are already 404 under production.

---

## 5. Reverse proxy (nginx)

`deploy/nginx.conf` is generic (no domains, no embedded certs):

* `location /api/` → `proxy_pass http://127.0.0.1:8000` with
  `X-Forwarded-For` / `X-Forwarded-Proto` / `Host` forwarding.
* `location /api/public/` additionally applies a proxy-level
  `limit_req burst=60 nodelay` (defense-in-depth behind the in-app
  `public.read` limiter).
* `location /` serves `frontend/dist` with `try_files $uri $uri/ /index.html;`
  — the **SPA fallback** so every BrowserRouter route loads on direct
  navigation/refresh:
  `/demo`, `/demo/jobs`, `/demo/jobs/:stableId`, `/demo/jobs/:stableId/fit`,
  `/demo/ranked`, `/demo/applications`, `/demo/pipeline`, `/demo/retention`.
  `/api/*` is matched by the two API locations **first**, so API requests are
  **never** rewritten to `index.html`.
* A commented `listen 443 ssl` block shows TLS termination with
  operator-provided certs, plus an HTTP→HTTPS redirect you can drop into the
  `:80` server.

`RATE_LIMIT_TRUST_PROXY=true` in `.env` is **only** correct because this proxy
sets `X-Forwarded-For` and uvicorn is unreachable directly. Keep it `false`
otherwise (limits then key on the proxy address — still enforced, just shared).

---

## 6. What the public demo needs vs. the private plane

**Public demo (fictional data) requires only:**
* `backend/demo_data/demo_seen_jobs.json`, `demo_tracker.csv`,
  `demo_checkpoints.json` — read-only. That is the entire public corpus.
* No real database records, no tracker, no scraper output, no uploads, no
  generated documents.

**Backend startup still requires the production `DATABASE_URL`** because the app
is one monolith (public + private routers share one process and one startup
validation). The demo endpoints never open it, but the process needs a valid,
writable, absolute path (an empty SQLite DB is fine for a demo-only host).

**Private plane requires** (this checkpoint does not deploy a private plane;
the app simply keeps these working where present): `careerpilot.db`, scraper
outputs, uploads, generated docs, logs, JWT auth, admin auth.

**Boundary invariants** (unchanged by this checkpoint):
* Public pages (`/demo/*`) call only `/api/public/*` → `DemoDataStore`.
* Private `/api/*` routes are JWT-gated — anonymous requests get `401`, admin
  routes additionally need an admin JWT. The proxy adds **no** auth bypass.
* `/docs`, `/redoc`, `/openapi.json` are 404 in production.

---

## 7. Health / readiness

* `GET /api/public/status` — the public readiness probe (no JWT, demo-only
  payload: data-file presence for the 3 demo files, pipeline stage, counts,
  `is_demo_mode`). Safe to expose.
* `GET /api/health` — **PRIVATE** (JWT-gated; reports real pipeline/data-file
  status). Never expose it. Keep probes on `/api/public/status`.

---

## 8. Anonymous read protection (rate limiting)

**Both layers are now in place (P5.1):**

1. **Application layer** (`backend/app/rate_limit.py`): a `public.read` scope
   (`PUBLIC_READ_LIMIT_PER_IP=120` / `PUBLIC_READ_WINDOW_SECONDS=60` defaults)
   applies to the whole `/api/public` router via a router dependency. Same
   bounded, evictable limiter as every other scope — memory stays bounded, 429
   carries a safe `Retry-After`, and authenticated limits are untouched.
2. **Proxy layer** (`deploy/nginx.conf`): `limit_req` on `/api/public/` as
   defense-in-depth behind the app limit.

Defaults are generous so ordinary demo browsing + readiness probes are
unaffected; a crawler is capped regardless of which layer it hits.

---

## 9. Launch checklist

1. `git` hygiene: `git status --short` shows **no** real personal data files as
   tracked or staged (see §10).
2. `backend/.env` valid per §3; `validate_production_config()` passes.
3. `npm run build` produces `frontend/dist`.
4. Proxy `nginx -t` passes; HTTP→HTTPS redirect enforced.
5. Smoke: anonymous `GET /api/public/status` → 200; `GET /api/health` → 401;
   `GET /docs` → 404; a browser refresh of `/demo/jobs` renders the SPA.

---

## 10. Repository hygiene (why `.gitignore` changed)

`job_scraper/` accumulates **real** personal job-search data on every run
(canonical/ranked/scored/top-N/verified/raw/normalized/portal-health/run-history
JSON, incremental reports). P5 found a single `git add .` would publish them.
P5.1 adds (repo root `.gitignore`):

```gitignore
**/job_scraper/*.json
**/job_scraper/*.txt
raw_search_results.json
kalibrr_results.json
job_search_report.txt
clipboard_lead.html
indeed_job.html
tempbossjob_test.html
```

Notes:
* gitignore never un-tracks already-tracked files. Three pre-existing tracked
  `job_scraper` files (`portal_health.json`, `run_history.json`,
  `schedules.json`) were inspected — `run_history.json` is empty and
  `portal_health.json` currently holds zeroed counts, but they are **historical
  leak considerations**, not a P5.1 code fix. Removing history is scope for the
  launch/portfolio phase, not this checkpoint.
* Intended tracked data (`backend/demo_data/*`), all source, and scratch
  *code* scripts remain untouched/visible as before — nothing is over-ignored.

---

## 11. Limitations documented (P5.1)

* No real nginx binary was installed; `deploy/nginx.conf` is validated by
  review + the local smoke test that mirrors its routing (static + SPA fallback
  + `/api` proxy), not by `nginx -t` on this machine.
* No TLS certs, no DNS, no cloud, no containerization, no CI/CD — all out of
  scope (see `P5.1_DEPLOYMENT_PACKAGING_IMPLEMENTATION_REPORT.md` §18).
* A genuine production database / private-plane deployment is a follow-on scope;
  this package makes the **public recruiter demo** deployable and keeps its
  boundary intact.