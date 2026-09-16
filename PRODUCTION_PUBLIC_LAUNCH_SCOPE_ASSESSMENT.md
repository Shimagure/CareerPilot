# CareerPilot — Production & Public Launch Scope Assessment

**Date:** 2026-09-13
**Type:** READ-ONLY assessment / design document. **No source, configuration, database, migration, or runtime artifact was modified to produce it** (see Section 16).
**Repo state reviewed:** HEAD `4b1ed77` ("feat(api): CP16.6 enabled-state bridge + scheduler DB-sync wiring"), CP0–CP15 complete, CP16.1–CP16.6 complete.

---

## 1. Executive Summary

CareerPilot is a fully working, **personal** career-command center: a FastAPI + React stack wrapped around a Node/Bun job-search pipeline (`orchestrator.js` stage scripts + portal CLIs), all running today against a single candidate's real data on SQLite + filesystem JSON, launched locally. The engineering is already strong — an incremental job-state machine with stable-ids and content fingerprints, checkpointed crash recovery, deterministic ranking, hardened upload/document storage, SSRF-guarded URL analysis, RBAC, argument-array (no-shell) subprocess execution, and a CP16.6 enabled-state bridge that reconciles SQLite intent with the SKILL.md runtime gate.

The path to a **public, recruiter-facing demo** while keeping the **private admin/job-search environment** unscathed is well-defined but requires a deliberate boundary decision, not a configuration flip. The single most important finding: **today the unauthenticated "public" endpoints (`/api/jobs`, `/api/pipeline/*`, `/api/health`) read the REAL personal dataset**, not the demo dataset. A public launch is therefore a **product boundary exercise**, not a deployment exercise alone.

Three decisions dominate everything downstream:
1. **Data plane:** separate a sanitized demo dataset from real data and make the public site read only the demo plane (a curated demo dataset of meaningful depth does not exist yet — the current `backend/demo_data/` holds only 8 jobs).
2. **Control plane:** pin the private environment (scraper automation, portal health auto-disable, document generation, approval gates) to run locally / behind admin auth. The scraper automation is intentionally **Claude-Code–agnostic in its CLI core** (server-friendly) but its *scheduling* currently depends on CronCreate, which is a Claude-session tool — a durable server-side scheduler is the one missing automation primitive.
3. **Deployment plane:** this scale needs no Kubernetes, message bus, or microservices. One VPS (or PaaS) running FastAPI + a SQLite-in-production (or managed Postgres if multi-user) behind a reverse proxy, with a static/cached React frontend, is the right shape.

**Security posture:** the codebase is unusually defensive for a solo project (per-user file isolation, magic-byte validation, SSRF blacklists, arg-array subprocesses, compensating rollback). The gaps are concentered and fixable: a **default JWT secret** with no `.env` in the backend (`secret_key: "dev-secret-change-in-production"`, `config.py`), **CORS `allow_origins=["*"]` + credentials**, **no rate limiting**, **open `/docs`**, and **unauthenticated real-data endpoints** that currently double as the demo surface.

**Roadmap recommendation (Section 10/15):** Do **not** run a literal CP16.7-as-specified. CP16.7 was defined as verifying three CP16 gaps; only one (enabled-state bridge) was implemented in `4b1ed77`. Gaps #1 (CandidateProfile auto-init) and #3 (`TestAdminUsersList`) remain open, so a literal CP16.7 verification would fail two of its own criteria. **Reframe CP16.7 as a slim "close-out verification" of the bridge + explicit deferral of the two minor gaps, then enter Phase 4 (Production & Public Launch).**

---

## 2. Current Architecture Map

```
┌────────────────────────────── PUBLIC-FACING (fastapi) ──────────────────────────────┐
│ backend/app/main.py  (17 routers, CORS, lifespan → LLM provider init + stale-run    │
│                       reconciliation)                                               │
│  /api/health           → DataStore.get_health_info   (REAL filesystem state)         │
│  /api/jobs, /api/jobs/{id} → DataStore.get_active_jobs (REAL dataset, unauthenticated)│
│  /api/pipeline/status|health|retention → REAL seen_jobs portal/stale/blocked stats   │
│  /api/health/portals   → portal_health.json + SKILL.md + DB intent (unauthenticated) │
│  /api/demo/*           → DemoDataStore over backend/demo_data/ (unauthenticated)     │
│  /api/ranked/*         → authenticated, REAL active set                               │
│  /api/auth, /api/dashboard, /api/resume, /api/profile, /api/preferences,             │
│  /api/search, /api/saved-jobs, /api/applications → authenticated, user-scoped        │
│  /api/admin/sources, /api/admin/users → ADMIN role only                              │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── PRIVATE DATA PLANE ───────────────────────────────────┐
│ real: job_scraper/*.json (seen 3.8MB, canonical 1.08MB, ranked 386KB, raw_*,        │
│        scored, verified, priority_queue, top5/top10, checkpoints, run_history)      │
│ real: job_search_tracker.csv  (personal: notes, fit_rating, cv/cover filenames)     │
│ DB:   backend/careerpilot.db (SQLite; users/resumes/profiles/preferences/search_    │
│        runs/user_jobs/jobs/job_sources/applications)  (root careerpilot.db = 0-byte) │
│ files: data/uploads/resumes/<user_id>/, data/generated/*.pdf                         │
│ secrets: LLM keys via env ("openai"/"anthropic" provider); .env absent in backend   │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── DEMO DATA PLANE ──────────────────────────────────────┐
│ backend/demo_data/{demo_seen_jobs.json (8 jobs), demo_checkpoints.json,             │
│ demo_tracker.csv (4 rows)}  — fictional cos, example.com urls, no PII               │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── AUTOMATION (local / Claude-aware) ────────────────────┐
│ orchestrator.js       → execSync node stage scripts (canonicalize→hard_filter→      │
│                          priority_queue→verify→score→rank), cwd-sensitive           │
│ .agents/skills/*/cli  → bun run cli.ts search (portal discovery, real network)      │
│ portal_health.js      → check/status/enable/disable; --db best-effort SQLite mirror │
│                          (CP16.6); auto-disable on 403-threshold                    │
│ scheduler.js + schedules.json → prompt registry only; CRONCREATE IS CLAUDE-SESSION- │
│                          BOUND (7-day expiry), NOT a Node API                       │
│ sync_to_db.py (job_sync.py) → one-way JSON→SQL mirror, process lock,                  │
│                          app-protected tombstoning, reconciliation                  │
│ enabled_bridge.py (CP16.6) → SKILL.md frontmatter editor + SQLite intent + health   │
│                          store, atomic writes, compensating rollback                │
│ Search via API → SearchRunManager (asyncio.Task, non-durable) → PipelineAdapter →   │
│                          bun CLIs (subprocess, arg arrays, allowlist, 180s)         │
│ Documents → document_generator.py → lualatex/xelatex (subprocess, tempdir, 120s)   │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── FRONTEND ─────────────────────────────────────────────┐
│ React 19 + Vite 8 + TS, 16 pages, axios client baseURL '' → calls /api same-origin │
│ vite dev proxy /api → http://127.0.0.1:8000. dist/ built. No env-driven base URL.  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Component classification

| Component | Location | Classification |
|---|---|---|
| FastAPI backend + 17 routers | `backend/app/` | **Production candidate** (needs config/hardening) |
| SQLAlchemy/aiosqlite DB | `backend/careerpilot.db` | **Private/local** today; **production-capable with config** |
| `DataStore` (real JSON) | `backend/app/store.py` + `job_scraper/*.json` | **Private** — never public |
| `DemoDataStore` (demo JSON) | `backend/app/demo_store.py` + `backend/demo_data/` | **Public demo candidate** (needs richer dataset) |
| Portal CLIs (bun) | `.agents/skills/*/cli/` | **Dev/private** — real scraping, ToS/fragility risk |
| `orchestrator.js` stage scripts | `job_scraper/*.js` | **Private automation**, server-runnable |
| `portal_health.js` | `job_scraper/portal_health.js` | **Private automation**, server-runnable |
| `scheduler.js`/`schedules.json` | `job_scraper/` | **Dev-only registry**; CronCreate is Claude-session-bound |
| `enabled_bridge.py` | `backend/app/enabled_bridge.py` | Production-capable (operational consistency) |
| `sync_to_db.py` | `job_scraper/sync_to_db.py` | Private automation, server-runnable |
| Resume/file storage | `data/uploads/resumes/`, `data/generated/` | **Private**; storage layer is production-hardened |
| Frontend | `frontend/` | **Public demo candidate** (full rewrite not needed) |
| Claude skills/CLAUDE.md/baseline | `.claude/`, `CLAUDE.md`, `MASTER_JOB_SEARCH_BASELINE.md` | Dev/agentic; **assume not in production runtime** |
| Alembic migrations | `backend/alembic/versions/*.py` | Production-capable with config |

---

## 3. Public vs Private Boundary

### PUBLIC (safe to expose under the current data arrangement — but see caveat)
- `/api/demo/*` — reads `DemoDataStore` only (`backend/demo_data/`). **This is the correct public plane.**
- `/api/health` — returns store health shape; today derived from *real* filesystem state (Section 3 caveat).
- `/api/health/portals` — portal health statuses; reveals operational/SKILL.enabled/DB intent (informational, low sensitivity, but leaks infra state — keep either behind demo-mode or accept as status endpoint).

### PRIVATE (must stay authenticated / admin-only)
- `/api/auth/*`, `/api/dashboard`, `/api/resume`, `/api/profile`, `/api/preferences`, `/api/search`, `/api/saved-jobs`, `/api/applications`, `/api/ranked/*`, `/api/applications/.../documents`.
- `/api/admin/sources*`, `/api/admin/users` — ADMIN role only.

### ⚠️ Exposures that would leak personal data if the server is reachable publicly as-is
- **`GET /api/jobs` and `/api/jobs/{stable_id}` are unauthenticated and read the REAL dataset** (`store.get_active_jobs`) — real job titles, companies, salaries, full descriptions, evaluations, URLs to live postings, and pipeline state. Enumerable `stable_id`s.
- **`GET /api/pipeline/{status,health,retention}` are unauthenticated and read REAL `seen_jobs.json`** portal/stale/blocked statistics — they expose scraper operational data (e.g., which boards 403).
- **`/api/health` unauthenticated** over real filesystem state.
- The API `GET /docs` (Swagger) is open by default and enumerates every endpoint — helpful for recruiters, risky if the server exposes real-data routes; with real-data routes removed it is safe and a genuine portfolio plus.

### Boundary rule for Phase 4 (normative)
The public site must only ever mount: `/api/demo/*` (renamed or aliased as the canonical public router), `/docs` (over demo namespace only), and `/api/health` (over demo store). Everything else must be behind auth/admin and reachable only from the private environment. This is enforced by **router mounting**, not by middleware redaction.

---

## 4. Production Readiness Matrix

Classify: **P = production-ready** · **C = production-capable with config** · **R = requires architectural change** · **L = should remain private/local**.

| Concern | Evidence | Class | Notes |
|---|---|---|---|
| **Localhost / dev-only bind** | uvicorn launched manually; no `host`/`--workers` policy documented | C | Configure bind `0.0.0.0` only behind reverse proxy; dev proxy `http://127.0.0.1:8000` (`vite.config.ts`) |
| **SQLite** | `database_url = "sqlite+aiosqlite:///./careerpilot.db"` (cwd-relative), `config.py`; real file `backend/careerpilot.db` | C | Fine for a single-candidate private env and a small demo; **pin an absolute path**; for multi-user public → Postgres (Section 6) |
| **Filesystem JSON state** | `DataStore` reads `job_scraper/*.json`; atomic-write patterns in storage layer; `job_sync.py` mirrors JSON→SQL with lock | **R** | Works, but two mutable planes (JSON + SQLite) with a cache layer is the central readiness gap; acceptable if JSON plane stays private and sync-to-SQL is reliable; public plane must be SQL/serve only |
| **JSON artifacts** | `backend/demo_data/` (8 jobs) too thin; real `job_scraper/*.json` unignored by git | **R** | Needs a curated, generated demo dataset (Section 8) + gitignore hygiene (Section 6/14) |
| **`.env`** | **No `backend/.env` and no `backend/.env` file** → `secret_key` default `"dev-secret-change-in-production"` active whenever env not set; frontend has `.env/.env.example` (`VITE_API_BASE_URL`) but `client.ts` uses `baseURL: ''` | C→**R for secrets** | Must add backend `.env`/`.env.example`, require `secret_key`, forbid default in prod (Section 7) |
| **Absolute Windows paths** | `get_project_root()` = `parents[2]`; `data/`/`GENERATED_DOCS_DIR`/`SKILLS_DIR` derived from it | C | Works on server if project layout identical; prefer env-overridable paths — no rewrite needed |
| **Local subprocesses** | `document_generator.py` lualatex/xelatex (arg arrays, tempdir, 120s); pipeline CLIs `bun run cli.ts` (arg arrays, 180s) | C | Requires LaTeX + bun on the host; fine for the admin host, **not** needed on the public demo host |
| **Node/Bun scripts** | `orchestrator.js`, `portal_health.js`, `scheduler.js`, sync — all CLI-first | C | Server-runnable with Node/Bun installed; only `scheduler.js`→CronCreate is Claude-bound |
| **Claude Code / agentic skills** | `/job-scraper`, `/apply`, document approval gates, `CANDIDATE_TRUTH.md` review | L | **Assume NOT present in production runtime.** Live verification via WebFetch (agentic) while it exists; production automation uses the Node pipeline for what it can and keeps judgment steps in the private Claude session |
| **CronCreate / scheduled execution** | `scheduler.js` registry only; CronCreate session-scoped, expires 7d | **R** | Replace with a durable scheduler in production (systemd timer / APScheduler / cron). Section 9 |
| **Scraper runtime** | portal CLIs hit live boards; 403s already observed (JobStreet) | L | Fragile + ToS-sensitive → stays private/local only |
| **Uploaded/generated documents** | `data/uploads/resumes/<user>` (hash storage keys, magic bytes, 10MB), `data/generated/*.pdf` (guarded download, `is_relative_to`) | C | Latent fine; keep private; quota/rotation needed for multi-user |
| **Frontend / API wiring** | `client.ts` `baseURL: ''` + `/api` paths → same-origin expected; **FastAPI does NOT mount static files** (`main.py` has no `StaticFiles`/mount) | **R** | Decide serving: reverse-proxy root→static + `/api`→FastAPI, or mount dist in FastAPI. Small, but it is an architectural choice (Section 5) |

---

## 5. Hosting / Deployment Recommendation

Given the scale (a single-candidate command center + a demo footprint for recruiters) the simplest architecture that supports both public demo and private admin:

```
Browser
  │  https://careerpilot.example
  ▼
Reverse proxy (Caddy or nginx) — TLS termination, rate limiting, request-size caps
  ├── /          → static React build (frontend/dist) or CDN
  └── /api/*     → uvicorn (FastAPI) on 127.0.0.1:8000, workers=2
                        │
                        ├── SQLite (backend/careerpilot.db)  [private env]
                        └── demo plane JSON (backend/demo_data) [public plane]
```

- **Frontend hosting:** build `frontend/dist` and serve as static files (same-origin) so `client.ts`'s `baseURL: ''` works unchanged. No provider change needed; any static host or the proxy itself works.
- **FastAPI hosting:** one small VPS (or a PaaS like Render/Railway/Fly) running `uvicorn` behind the proxy. Two boxes/namespaces if you want physical separation between "public demo" and "private admin" — but a **single host with two deployments** (or one deployment in two modes via env `CPLOT_MODE=demo|admin`) is acceptable at this scale.
- **Database:** keep **SQLite for the private single-user env** and for the demo (read-mostly). Move to **managed Postgres only if** you want public user registration/multi-tenancy. The schema is already PG-anticipating (PG-UUID ids, `native_enum=False`, portability migrations in `job_sync.py`), so the upgrade path is cheap when/if needed — don't buy it now.
- **Background worker / scheduler:** a tiny worker running the private automation (orchestrator, portal health, DB sync) via **systemd timers or cron**, replacing CronCreate. Never inside the public app. For the demo plane no worker is needed.
- **Object/file storage:** not required. Keep files on disk in the private env; demo plane needs no uploads. If you later add public demo uploads, use the existing storage layer against blocks storage — no now.
- **Domain / HTTPS:** one domain, reverse-proxy TLS (Caddy auto-Let's-Encrypt). CORS becomes irrelevant (same-origin) — which also neutralizes the current `allow_origins=["*"]` issue.
- **Secrets/env:** backend `.env` (secret key, DB path, LLM keys); never the default secret in prod.
- **Logging/monitoring:** `uvicorn` access+error logs to files; API `logger` output in the private env; the built-in `/api/health` + `portal_health.js` already give the app-level heartbeat. No external monitoring service required at this scale.

**Not warranted (scope discipline):** Kubernetes, Docker orchestration (a single `Dockerfile` is fine), microservices, event bus, multi-region.

---

## 6. Database Readiness

- **SQLite vs Postgres:** today SQLite (`aiosqlite`) is used everywhere and works. The schema was written to be PG-portable on purpose — PG-native `UUID` columns (`sqlalchemy.dialects.postgresql.UUID(as_uuid=False)`), every `Enum` declared `native_enum=False` (VARCHAR+CHECK), and `sqlalchemy.dialects.sqlite|postgresql.insert` dual paths in `job_sync.py`. **Nothing is SQLite-only-locked except the absence of an async PG driver in `requirements.txt`** (no `asyncpg`/`psycopg`). So "PostgreSQL-straightforward" is accurate: add a driver, point `DATABASE_URL`, review the 5 Alembic migrations. Recommend staying on SQLite until real multi-user public registration.
- **Filesystem/JSON consistency:** the real data plane has **two writable representations** — pipeline JSON (authoritative for job data) and SQLite rows (auth/state + `jobs` mirror). `job_sync.py` is the reconciler (process lock, app-protected tombstoning, reconciliation pass) and `enabled_bridge.py` (CP16.6) adds compensating-rollback consistency for the enabled-state trio. This **works but is the largest production risk**: an unsynced JSON vs DB drift will surface as inconsistent reads. The demo plane avoids this entirely (single JSON source). Mitigation = keep the public plane single-source, and treat the JSON→SQL mirror as a private-maintenance job, not something the public API depends on.
- **Global vs user-specific:** clearly separated and enforced (`dashboard.py`/`preferences.py` count and scope by `user_id`; `job_sync` and `jobs` mirror are global). For the public demo, **use a separate demo dataset**, never user-owned rows.
- **Demo Mode storage:** `DemoDataStore` is already a separate file store (`backend/demo_data/`). Desired end state: public site reads demo plane exclusively; private env reads real plane exclusively. No schema change needed.
- **Migrations/constraints:** no migrations are required for the assessment — the hooks already exist (5 Alembic files). Notes for Phase 4 (do **not** run now): (a) `Job`/`UserJob`/`Application` link by string `stable_id` with **no FK** — acceptable with `job_sync` protection, but a FK is worth adding in the private env later; (b) `secret_key`/DB-path belong in env, not defaults; (c) gitignore MUST cover `job_scraper/canonical_jobs.json`, `ranked_jobs.json`, `portal_health.json`, `run_history.json`, `top5/top10_jobs.json`, `data/generated/` — verified today these are **unignored** and one `git add -A` before a public push would leak the full real dataset and scraper state (`git check-ignore` = NOT IGNORED; Section 14).

---

## 7. Security / Privacy Assessment

Severity = impact if a **public site misconfigured on top of the real plane is exposed**, or the misconfig directly translates to a public risk. **No fixes were made (read-only).**

### CRITICAL
| # | Finding | Evidence | Exposure if public |
|---|---|---|---|
| 1 | **Default JWT secret with no backend `.env`** | `config.py`: `secret_key: str = "dev-secret-change-in-production"`, HS256; no `backend/.env` found; `auth.create_access_token` signs with it | Attacker signs their own tokens with the public default → **forge ADMIN** → full `/api/admin/*`, job-source enable/disable write-through to SKILL.md (CP16.6) |
| 2 | **CORS `allow_origins=["*"]` + `allow_credentials=True` + `allow_headers ["*"]`** | `main.py` `CORSMiddleware`; token in `localStorage` (`client.ts:19`) sent as `Authorization: Bearer` | With manual Bearer headers a wildcard origin lets **any website call the API and read responses**; a single XSS anywhere magnifies it into cross-site data theft. Same-origin reverse proxy (Section 5) is the cheap remediation |
| 3 | **Unauthenticated public endpoints over REAL data** | `routers/jobs.py` (`/api/jobs`), `pipeline.py` (`/status`,`/health`,`/retention`), `health.py` — all `Depends`-free, read `DataStore`/real files; `/api/health/portals` leaks SKILL/DB intent | If the server is reachable publicly as-is, the recruiter-facing surface is the personal job search (titles, salaries, descriptions, live URLs, scraper 403 stats). **This is the #1 launch blocker** (Section 3) |

### HIGH
| # | Finding | Evidence | Exposure |
|---|---|---|---|
| 4 | No rate limiting on auth | `auth.py` register/login unbounded | Brute force / credential stuffing / account-registration spam on a public deploy |
| 5 | Open `/docs` (Swagger) | `FastAPI(...)` default | Full endpoint map/attack surface enumeration; safe only once public plane excludes real routes |
| 6 | Real dataset + scraper state ungitignored | `git check-ignore` "NOT IGNORED": `job_scraper/canonical_jobs.json`, `ranked_jobs.json`, `portal_health.json`, `run_history.json`, `top5/top10_jobs.json`, `data/generated/` | Accidental `git add -A`/public push leaks the entire real job dataset, personal tracker-adjacent state, and scraper infra info |
| 7 | Filesystem + SQLite dual state divergence | `DataStore` JSON cache vs `jobs` mirror (`job_sync.py`); no FK `stable_id` links | Operational correctness risk; stale/duplicated reads; sensitive if job data is misread as authoritative in a public report |

### MEDIUM
| # | Finding | Evidence | Exposure |
|---|---|---|---|
| 8 | JWT in `localStorage`, no revocation, logout is client-side no-op | `client.ts:19`; `auth.py` logout returns OK without invalidating | Practical only via XSS; once a token leaks it lives 30 min (`access_token_expire_minutes=30`) with no blacklist |
| 9 | XSS via scraped job descriptions | Job `description` is untrusted scraped HTML, surfaced in `/api/jobs` responses and rendered client-side | React escapes by default — **verify** no `dangerouslySetInnerHTML` in `frontend/src/pages/JobDetail.tsx`/`Jobs.tsx` during Phase P3; malicious posting text is a real vector |
| 10 | TeX/subprocess surface in document generation | `document_generator.py` compiles profile+job strings through `lualatex`/`xelatex` (escaped with `_escape_latex`) | Escaping is applied; residual TeX-injection risk if a field bypasses escaping — worth a seam review; tempdir/120s/coin isolation already good |
| 11 | Search-parameter → subprocess args | User `keywords`/`location` flow into `bun run cli.ts ... -q <kw> -l <loc>` (arg arrays, flag allowlist, `validate_search_term`) | No shell + allowlist make injection hard; confirm `validate_search_term` rejects control chars/newlines (Phase P3 test) |
| 12 | Operational info in error bodies | `admin_sources.py` 500 handler echoes `{exc}` | Driver/path detail leakage to an admin — minor; move to generic message |
| 13 | No generated-document quota/count cap | `/api/applications/with-documents` writes PDFs into `data/generated/` | Authenticated user could fill disk; low priority single-user, real concern if public registration added |

### LOW
| # | Finding | Exposure |
|---|---|---|
| 14 | Search runs non-durable (`asyncio.Task`), reconciled to failed on restart | Acceptable; documented in `search_manager.py` |
| 15 | `/api/demo/reset` calls `invalidate_store_cache()` | Only clears real-plane in-memory cache — benign, but tightens the demo↔real coupling smell |
| 16 | `/api/health/portals` shows `job_source_enabled` (CP16.6 bridge) | Moderate infrainfo; acceptable as a status endpoint if intentionally public |

### INFORMATIONAL
| # | Finding | Notes |
|---|---|---|
| 17 | `/api/health/portals` reveals SKILL.md `enabled` + DB intent | Fine for monitoring; enumerate it deliberately in the public API map |
| 18 | `/api/auth/me` + role claims in JWT | Standard; needed by the frontend |

### Notable strengths (verified, keep)
- Resume **storage layer**: per-user subdirs, server-generated UUID keys, `is_relative_to` traversal guards, magic-byte (`%PDF-`, `PK`) validation, 10MB cap, atomic `tmp+os.replace`.
- **Document download** resolves strictly inside `data/generated` (`applications.py`).
- **SSRF guard** in admin URL analysis: http(s)-only, loopback/private/link-local/CGNAT/metadata hostname blocks, manual redirect re-validation, content-type allowlist, 2MB cap, 8s timeout (`admin_sources.py`).
- **Subprocess discipline**: no `shell=True` anywhere inspected; allowlisted flags; 180s/120s timeouts.
- **Ownership scoping**: applications/saved-jobs/resumes/profile/preferences keyed to the authenticated `user_id`; 404 (not 403) on non-owned rows avoids existence leaks.
- **CP16.6 enabled-state bridge**: atomic writes + read-back verification + compensating rollback for the 3-store enabled state.

---

## 8. Demo Mode Assessment

**Today:** `/api/demo/*` reads `DemoDataStore` (`backend/demo_data/{demo_seen_jobs.json, demo_checkpoints.json, demo_tracker.csv}` = **8 jobs, 4 tracker rows**, all sanitized — fictional companies "TechCorp Philippines", `example.com` URLs, `demo-00N` ids, empty `contact_person`). It is genuinely isolated from real data at the file boundary, and public users **cannot mutate private state**: demo endpoints are read-only plus `bootstrap`/`reset` that only rewrite demo files; note `reset` also calls `invalidate_store_cache()` on the real store (cache only).

**Fit as a public landing page:** *partially*. The isolation model is correct, but the dataset is far too thin to showcase an engineered system (8 records cannot demonstrate ranking, staleness, change detection, portal health, or filtering). The implementation plan (`CAREERPILOT_IMPLEMENTATION_PLAN.md` §K) already specifies the right approach — **bundle a sanitized snapshot of the real dataset** (generalized companies, `example.com/job/{stable_id}` URLs, generic descriptions, candidate → "Demo Candidate", tracker contact stripped). That work is not yet done.

**The critical gap for public launch:** the *public default* is not Demo Mode. `/api/jobs` and `/api/pipeline/*` mount the **real** store. "Should demo become the default unauthenticated surface?" — **Yes**, but as a **mount boundary**, not a bolted-on mode: the public router set must be exclusively demo-plane, and the real-plane routers must be reachable only by authenticated/admin clients (private env). Do not rely on a runtime toggle that a misconfig could flip.

**Data exposed if demo becomes default:** only the curated demo set (no candidate PII, no real URLs, no contact info). Ensure `demo_seen_jobs.json` never carries `contact_person`/notes and that descriptions don't quote the candidate ("Demo Candidate" persona only).

**Changes needed (Phase 4, do not implement now):** (1) a dataset generator that produces a D50+ realistic demo corpus with the same schema; (2) router-mount boundary (Section 3); (3) a "Demo" indicator in the UI; (4) remove `invalidate_store_cache()` coupling or guard it to demo-plane only.

---

## 9. Scraper / Automation Deployment Assessment

**Assumption honored: Claude Code is NOT part of the continuous production runtime.** Splitting what transfers cleanly to a server from what must stay in the private Claude session:

| Component | Server-runnable? | Evidence / constraint |
|---|---|---|
| `orchestrator.js` (canonicalize→hard_filter→priority_queue→verify→score→rank) | ✅ Yes (Node) | Stage scripts run via `execSync`, `cwd: process.cwd()` — needs Node, consistent cwd; discovery requires portal CLIs (bun) |
| Portal CLIs (`.agents/skills/*/cli`, `bun run ... search`) | ⚠️ Yes but private | Real network scraping; anti-bot 403s documented (JobStreet); ToS risk → **private env only**, never demo |
| `portal_health.js check` (+ `--db` CP16.6 mirror) | ✅ Yes (Node) | Pure CLI; server-friendly |
| `sync_to_db.py` (`job_sync.py`) | ✅ Yes (Python) | Process lock, PG/SQLite dual upsert, reconciliation |
| `monitor.js` / progress reporting (CP15.4) | ✅ Yes (Node) | CLI-driven; can emit to a log/heartbeat |
| Scheduling *(replaces)* | ⚠️ **Requires architectural change** | `scheduler.js` + `schedules.json` is a **registry only**; CronCreate is a **Claude-session tool** (session-scoped, 7-day expiry) and is not callable from Node (`CP15.3_SCHEDULING_INFRASTRUCTURE_REPORT.md` §Key finding). Production needs a durable scheduler: systemd timer / cron / APScheduler firing `orchestrator.js`, `portal_health.js check --db`, and `sync_to_db.py` on the private host. |
| Live verification step | ⚠️ Split | The Node pipeline can verify via HTTP itself; the agentic `/job-scraper` skill path uses Claude WebFetch. For automation, prefer the Node path; keep judgment (fit approval) in the Claude session. |
| Document generation + approval gates | ❌ Claude-session (private) | `CANDIDATE_TRUTH.md` / `MASTER_JOB_SEARCH_BASELINE.md` anti-fabrication review and `/apply` decisions are deliberately human-in-the-loop; LaTeX compile is scriptable but the gating stays private. |

**Does the current architecture support scheduled scrape/health/monitoring/retry/disabled-source/DB-sync?** *Functionally yes* for scrape, health, monitoring, retry (checkpoint state machine), disabled-source handling (CP16.6 writes `enabled=false` to SKILL.md + DB mirror), and DB-sync — **provided scheduling is moved from CronCreate to a durable server scheduler**. That is the single automation primitive to build (Phase P6). Nothing about the scraper belongs on the public demo host.

---

## 10. CP16.7 vs Phase 4 — Roadmap Reconciliation

**What CP16.7 was specified to be** (`CP16.6_SCOPE_RECONCILIATION_REPORT.md` §10): READ-ONLY verification that all **3 CP16 gaps** are resolved — (1) `CandidateProfile` auto-init at registration, (2) CP15.5→DB enabled-state sync, (3) `TestAdminUsersList` tests; plus full-suite regression and no new regressions.

**What actually shipped:** only **Gap #2** was implemented (`4b1ed77`, CP16.6 enabled-state bridge). Verified by inspection:
- Gap #1 **open**: `routers/auth.py:110` creates `User(...)` only — no `CandidateProfile` row is initialized.
- Gap #3 **open**: `tests/test_rbac_auth.py` has no `TestAdminUsersList` class (classes present: `TestUserRegistrationWithName`, `TestLoginTokenContainsRole`, `TestGetMeReturnsNameAndRole`, `TestAdminDependency`, `TestJobSourcesCRUD`, `TestSafeUrlAnalyzer`, `TestSafeUrlAnalyzerSecurity`).

A literal, spec-pinned CP16.7 would therefore report FAIL on 2 of its own criteria despite the substantial work in `4b1ed77`. Running it "as-is" creates a misleading checkpoint.

**Recommendation:** **Reframe CP16.7** as a slim close-out that is honest to what shipped:
- **CP16.7 (closing CP16): pass if** (a) enabled-state bridge verified end-to-end (admin PATCH write-through both directions, CP15.5 `check --db` auto-disable→DB mirror, divergence visibility — largely validated by `test_enabled_bridge.py` 14 + `portal_health.test.js` §22 8 at 4b1ed77), (b) full backend suite green (350/0 at CP16.6), (c) Gap #1 and Gap #3 are **explicitly deferred** to the Phase-4 backlog with severity LOW (they do not affect the public/private boundary; Gap #1 is cosmetic onboarding data; Gap #3 is test coverage).
- **Then enter Phase 4 (Production & Public Launch)** as the new roadmap track, post-CP16.

This preserves the user's constraints (CP16.6 stays closed; nothing auto-starts) while giving the next checkpoint a definition that can succeed honestly. The smallest sensible next deliverable is the **Phase 4 dispatch plan + public-boundary decision** (Section 15).

---

## 11. Proposed Production / Public-Launch Phases (P1–P10)

| Phase | Name | Purpose | Major work (not implemented now) | Exclusions | Verification criteria |
|---|---|---|---|---|---|
| **P1** | Public/private boundary | Decide the product split and enforce it in code | Router-mount boundary: public set = demo-only routers; real-plane routers auth/admin-gated; remove real reads from `/api/jobs`,`/pipeline/*`,`/health` public paths; keep `/docs` demo-scoped | No new infra | Public hits return only demo-plane data; admin/JWT required for real plane; unauth `/api/jobs` returns demo job (or 404) |
| **P2** | Production architecture config | Pin deployment-time decisions as config | Backend `.env`+`.env.example` (secret key, absolute DB path, LLM keys, mode flag); CORS pinned to real origin (or removed under same-origin proxy); absolute path overrides; log file config; static-serve decision (`vite.config`/proxy + FastAPI mount or reverse proxy) | No schema/migration changes | Boots from `.env` with no defaults; CORS allowlist exact; path-independent CWD |
| **P3** | Security hardening | Close Section 7 findings | Enforce secret key (refuse default in prod); rate-limit auth; disable `/docs` on admin env (keep on demo); CSRF/XSS audit of description rendering; `validate_search_term` control-char test; generic error bodies; document-count quota; review if registration should exist publicly at all | No new auth stack | Findings 1,4,5,9,11,12,13 remediated; pentest-ish smoke via curl |
| **P4** | Demo/public dataset | Build the showcase dataset | Dataset generator producing ~50+ realistic skeleton jobs in demo schema (fictional companies, `example.com` URLs, graded evaluation/rankings, varied states incl. STALE/403/CLOSED); 10–15 demo applications; tracker stripped; versioned under `backend/demo_data/` | No real PII; no real URLs | Demo corpus loads; every stat/badge on the UI populated; no personal/candidate/company PII greps empty |
| **P5** | Deployment | Ship it | Reverse proxy (Caddy/nginx) + TLS + static dist + uvicorn; env plumbing; Dockerfile optional; staging→prod; launch checklist (gitignore sweep, secret rotation, CORS pin) | No multi-region/k8s | Public URL serves demo plane; HTTPS; `/docs` reachable on demo; health check green |
| **P6** | Production automation | Replace CronCreate with durable scheduling | systemd timer / cron / APScheduler driving `orchestrator.js` (private), `portal_health.js check --db`, `sync_to_db.py`; run-alerts via existing monitor/logs; document the runbook | Scheduling stays off public host | Schedules fire independently of any Claude session; auto-disable + DB mirror observed over 2 cycles; sync reconciliation passes |
| **P7** | UX / polish | Recruiter-first read of the demo | Landing/overview page, "how it's engineered" narrative in-app, score gauges, state badges, filter/search on demo data, demo banner; accessibility/responsive pass | No speculative features | Demo site walkable cold in <60s; mobile OK; key screens populated |
| **P8** | Portfolio integration | PR/pitch surface | README (architecture diagram, live demo link, stack, screenshots); repo cleanup (`.gitignore` for real dataset, scratch removal, LICENSE); OpenAPI export; optionally the demo rendered as an Artifact/interactive page | No enterprise claims | Public repo contains no real data; landing reads as an engineering portfolio |
| **P9** | Production verification | Prove the boundary | Full QA run: public plane (demo only) + private plane (real only) + admin flows; test suite regressions; security smoke (Section 7) | Nothing new shipped | Golden paths + boundary violations blocked; suites green |
| **P10** | Public launch | Cut over | Point domain, enabling demo mode as default; announce; iterate on feedback | No feature creep | Live for recruiters; monitoring heartbeat; rollback plan documented |

*Each phase is independently shippable; P1 → P4 are the critical path to a safe public demo; P2/P3 can be folded into P5 if capacity is tight.*

---

## 12. Scope Discipline — MUST / SHOULD / NICE / OUT

**MUST (blockers for safe public launch):**
- Public/private router-mount boundary so the public face reads demo-plane only (P1).
- Backend `.env` with a real `secret_key`; reject the default in production (P2/P3).
- CORS pinned to the real origin (or removed via same-origin proxy).
- Gitignore coverage for the real pipeline dataset, tracker, portal-health, generated docs (P8 sweep; also protects you today).
- A curated demo dataset (P4) — the current 8-job set is too thin.

**SHOULD (strongly recommended):**
- Rate limiting on auth; disable `/docs` on the admin env; generic 500 bodies.
- Durable scheduler (P6) replacing CronCreate so the private automation is session-independent.
- CP16.7 close-out reframing (Section 10) before Phase 4 kickoff.
- README/landing narrative + OpenAPI export for recruiters (P7/P8).

**NICE TO HAVE:**
- FK `stable_id` link for `jobs/user_jobs/applications` in private DB.
- Document quota/rotation; demo-plane cache-coupling cleanup.
- Stale/403/CLOSED demo records to showcase the state machine.
- Optional managed-Postgres switch if public registration becomes real.

**OUT OF SCOPE (avoid — speculative, not required):**
- Public user registration/multi-tenant jobs marketplace.
- Kubernetes, microservices, event bus, message queues.
- Mobile apps; serverless rewrites; multi-region.
- Adding AI/LLM chat to the demo ("ask the demo a question" is scope creep until the dataset/UX earns it).
- Re-scraping live boards from the public demo (ToS + fragility; stays private).
- Migrations/schema changes (out of scope for this assessment by instruction).

---

## 13. Recruiter-Facing Product Vision

CareerPilot's public story is not "a job board" — its story is **engineered career workflow**: a single-candidate command center that turns thousands of chaotic postings into a deterministic, verifiable, prioritized pipeline. Recruiters should see proof-of-craft:

1. **Deterministic engineering, not magic:** visible canonical `stable_id`/`fingerprint` change detection, checkpointed crash recovery, and a **ranked/evaluated** active set with explainable fit dimensions (the score gauges + strengths/gaps). This demonstrates data modeling, idempotency, and state machines.
2. **The dual-plane architecture** (real pipeline JSON vs sanitized demo plane) as a design-rationale story (data isolation, security-by-boundary) — a strong security/architecture signal.
3. **Operational automation:** portal health with 403 auto-disable and an **enabled-state bridge** that keeps three representations of "is this portal on" consistent with compensating rollback — an admin/system-design differentiator few candidate portfolios show.
4. **Hardened file/docs security** (magic-byte validation, per-user file isolation, traversal guards, SSRF-blacklisted URL analysis, arg-array subprocesses) — recruiters in security-adjacent roles (and technical screens) will read the code.
5. **A polished interactive demo** with a clear narrative: in <60s a visitor understands what it does, how it scores, and how the data stayed honest (sanitized, no fabrication — a rare "this person thinks about data integrity" signal, amplified for this candidate because `CANDIDATE_TRUTH.md`/anti-fabrication rules are the project's foundation).

**Pitch line (for the README/landing):** "CareerPilot — an end-to-end job-search command center: deterministic scraping, fingerprinted change-detection, transparent fit evaluation, and application-document generation, built with a private data plane and a public demo plane."

---

## 14. Risks and Dependencies

| Risk | Severity | Mitigation (Phase) |
|---|---|---|
| Public site accidentally reads real data (Section 3) | **CRITICAL** | P1 router-mount boundary + P9 boundary tests |
| Default JWT secret → admin forgery | **CRITICAL** | P2/P3 enforce secret key; rotate now |
| Wildcard CORS + localStorage token | CRITICAL→HIGH | P3 pin origins (same-origin proxy removes it) |
| Real dataset gitignored-incompletely → accidental public push | **HIGH** | P8 sweep; also immediate: `git add -A` audit before any push **now** |
| CronCreate-bound scheduling dies with the session | HIGH | P6 durable scheduler |
| JSON↔SQLite divergence (dual store) | HIGH (ops) | Keep public plane single-source; private mirror as maintenance job |
| Demo dataset too thin | MEDIUM | P4 generator |
| Scraping fragility/403s/ToS | MEDIUM | Private-only scraping; demo offline |
| LaTeX/TeX injection residual | MEDIUM | P3 seam review |
| CP16 gap #1/#3 unresolved | LOW | Defer explicitly in CP16.7 close-out |
| Scope drift (speculative features) | LOW→HIGH if unchecked | Section 12 gates each phase |

**Dependencies:** (1) user decision on public/private boundary shape (Section 3 normative rule); (2) user decision on CP16.7 framing (Section 10); (3) availability of a test domain/HTTPS for P5; (4) capacity for the P4 dataset generation (largest single authoring chunk).

---

## 15. Recommended Next Checkpoint

**Do not start CP16.7 or any Phase 4 work automatically.** The next checkpoint the user should approve is a **slim, read-only "Phase 4 Kickoff & Public-Boundary Pin"** (~1 session, documentation-first, no code changes):

1. **Boundary decision** — confirm the Section 3 normative rule (public = demo routers only; private = authenticated real plane) and the deployment topology from Section 5 (single host, two planes / two namespaces).
2. **CP16.7 close-out framing** — accept the reframed definition (Section 10): verify the bridge + full suite green, defer Gaps #1/#3 with severity LOW into the Phase-4 backlog. (This closes the CP16 storyline cleanly without inventing work.)
3. **Repo-hygiene checklist** — because the real dataset and `portal_health.json` are currently **unignored**, add them under gitignore and verify a staged `git status` before any public repo work.
4. **Phase sequencing** — commit the P1→P10 order from Section 11, with P1/P4 first.

Deliverable: a 2–4 page kickoff plan the user approves; afterwards, P1 (boundary) becomes the first code-change phase.

---

## 16. Statement of No Modifications

This assessment was **strictly read-only**. I inspected source (`backend/app/`, `backend/tests/`, `job_scraper/`, `frontend/`), configuration, docs (`CAREERPILOT_IMPLEMENTATION_PLAN.md`, CP15/CP16 reports, `PERPETUAL_MAINTENANCE_CYCLE.md`), the `.gitignore`, and git history. I did **not**: modify any source file, configuration, schema, database, or migration; run any scraper/portal-health/job or scheduled job; create any CronCreate job; change any schedule; install or upgrade any package; commit or push anything. The only artifact created is this document.

---

## RECOMMENDATION

**Decision: Reframe CP16.7 → slim close-out verification, then begin Phase 4 (Production & Public Launch).**

Rationale: a literal CP16.7 cannot pass its own criteria (two of three gaps are unimplemented — only the enabled-state bridge shipped in `4b1ed77`), so running it as-specified would produce a false checkpoint. The strongest next step is an honest CP16.7 close-out (verify the bridge end-to-end, full suite green, explicitly defer Gaps #1 and #3 to the Phase-4 backlog as LOW), immediately followed by **Phase 4 P1 (public/private boundary)** — which is the single highest-leverage change because today the unauthenticated public surface reads the real personal dataset. Everything else (config, hardening, demo dataset, deployment, automation) builds on that boundary and is already well-scoped by the codebase's defensive foundations.

*Out of respect for your standing instruction, CP16.7 has **not** been started, and nothing here was changed or scheduled. The next action is entirely yours: approve the Phase-4 kickoff checkpoint, or redirect.*