# Phase 4 Kickoff — Public Boundary Pin

**Date:** 2026-09-13
**Checkpoint type:** READ-ONLY planning/reconciliation.
**Repo HEAD:** `4b1ed77` — "feat(api): CP16.6 enabled-state bridge + scheduler DB-sync wiring"

**NO IMPLEMENTATION HAS BEEN PERFORMED IN THIS CHECKPOINT.**

No source code, configuration, `.gitignore`, database, migration, scraper runtime state, or dependency was modified. No files were staged, committed, or pushed. This document only locks scope, sequencing, and the public/private boundary for CareerPilot's eventual public launch. It builds on `PRODUCTION_PUBLIC_LAUNCH_SCOPE_ASSESSMENT.md` (earlier this session) as the architectural baseline.

---

## 1. Executive Decision

CareerPilot will eventually launch a **public, recruiter-facing demo website** while the **real job-search/admin environment stays private and local**. This is a **data-boundary exercise first, a deployment exercise second**: today the unauthenticated API surface reads the real personal dataset, so a public deployment must begin from a hard router/data boundary (Phase 4, P1), not from hosting.

Phase 4 sequence is locked as **P1 → P10** (Section 8). The two critical-path items are **P1 (public/private router & data boundary)** and **P4 (curated demo dataset)**.

CP16.7 is formally **reframed** as a slim close-out verification (Section 3); the two open CP16.5 gaps are **deferred** to the Phase 4 backlog as LOW priority unless later evidence shows they are launch blockers.

---

## 2. Current Verified State

Verified directly against the repo at HEAD `4b1ed77` this checkpoint:

| Item | Status | Evidence |
|---|---|---|
| CP15 (orchestrator, portal health, scheduling infra, API endpoints) | **Complete** | `orchestrator.js`, `portal_health.js`, `scheduler.js` + `schedules.json`, CP15.2–15.6 commits all prior to `4b1ed77` |
| CP16.6 committed | **Yes — this IS `4b1ed77`** | `git log --oneline -5` → `4b1ed77` is HEAD, latest implementation commit |
| CP16.6 enabled-state bridge | **Implemented** | `backend/app/enabled_bridge.py` (16.6); admin PATCH write-through + compensating rollback in `admin_sources.py:187`; health `job_source_enabled` in `portal_health.py` |
| CP16.6 scheduler DB-sync wiring | **Implemented** | `job_scraper/portal_health.js` `syncJobSourceEnabled`; `schedules.json` `portal-health` prompt runs `portal_health.js check --db backend/careerpilot.db` (CP15.3 report §Prompt Contracts) |
| CP15.3 scheduling infra | Registry/CLI only; CronCreate is a Claude-session tool, not a Node API | `CP15.3_SCHEDULING_INFRASTRUCTURE_REPORT.md` §Key Finding |
| CP16.7 as a full remediation checkpoint | **NOT implemented (do not start)** | Per standing instruction |
| CP16.5 Gap A — CandidateProfile.full_name auto-init at registration | **OPEN** | `auth.py:110-118` register creates `User(...)` only; no `CandidateProfile` row |
| CP16.5 Gap B — `/api/admin/users` dedicated tests | **OPEN** | `tests/test_rbac_auth.py` has no `TestAdminUsersList` (classes present: `TestUserRegistrationWithName`, `TestLoginTokenContainsRole`, `TestGetMeReturnsNameAndRole`, `TestAdminDependency`, `TestJobSourcesCRUD`, `TestSafeUrlAnalyzer`, `TestSafeUrlAnalyzerSecurity`) |
| CP16.5 Gap #2 — enabled-state architecture | **Implemented** (closed by CP16.6) | `enabled_bridge.py` + tests (`test_enabled_bridge.py`); backend 350 passed at CP16.6 |

**Not reopened:** CP16.4 (database state remediation) and CP16.6 are closed and will not be re-implemented; this checkpoint only records successors.

---

## 3. CP16.7 Close-Out Decision

**Reframe CP16.7 from "full gap remediation verification" to:**

> **CP16.7 — Final CP16 Close-Out Verification**

**Scope (limited to):**
1. Verify the CP16.6 enabled-state bridge end-to-end (admin PATCH write-through both directions, compensating rollback, CP15.5 `--db` auto-disable mirror, health `job_source_enabled` divergence visibility).
2. Verify full backend test health and the JS portal-health/scheduler suites.
3. Verify no regression in authentication, RBAC, or admin Job Sources (admin dependencies + 400/403 semantics).
4. Document remaining low-priority gaps (no implementation).

**Explicitly DEFER (LOW priority, Phase-4 backlog) — do NOT implement in CP16.7:**
- **A.** `CandidateProfile.full_name` auto-initialization during registration (`auth.py` register). Personal-onboarding/cosmetic; does not affect the public/private boundary; the registration → profile creation path is already authenticated and user-scoped.
- **B.** Dedicated `GET /api/admin/users` tests. Test-coverage gap only; the endpoint exists and is admin-gated (`admin_users.py:34`, `:42`).

Both are recorded as LOW-priority backlog items **unless later evidence shows they are launch blockers** (unlikely: neither is on the public surface).

**This checkpoint does not implement either deferred gap.**

---

## 4. Public / Private Architecture Boundary

Two logical planes, enforced by **router mounting and dependency scope** — never by a runtime `demo=true` toggle as the primary security boundary.

### PUBLIC DEMO PLANE — sanitized fictional data only
- Demo jobs (fictional companies, `example.com/*` URLs, `demo-*` stable ids)
- Demo applications, demo pipeline state, demo fit analysis
- Demo job-source / portal-health information where appropriate
- Recruiter-facing UI
- **No** personal account data, real scraper state, real applications, real resumes/documents, or admin controls

### PRIVATE REAL-DATA / CONTROL PLANE — authenticated real data
- Real jobs, real applications, candidate profile, resumes/documents
- Scraper, orchestrator, portal adapters, portal health automation
- Job Sources administration, document generation, scheduler/automation
- Admin functions

### Enforcement model (normative)
- **PUBLIC ROUTES → DEMO DATA ONLY.** The public router set is exclusively demo-plane (`/api/demo/*`, and any public status surface re-pointed at the demo store).
- **PRIVATE ROUTES → AUTHENTICATED REAL DATA.** Real-plane routers require `get_current_user`; admin routers require `get_current_admin_user` (already: `auth.py:20-80`, `auth.py:83-92`).

Both planes may coexist on one host (Section 9), but a runtime toggle must never be the load-bearing control — the boundary is structural (which router/mount/cache a path can reach).

---

## 5. Current Unsafe Public Exposure Findings

Mapped from `main.py:43-58` router registration + per-router dependency greps. **Identified, not fixed.**

### A. Endpoints currently exposing REAL data WITHOUT authentication
| Endpoint | Source | Real data leaked |
|---|---|---|
| `GET /api/jobs` | `jobs.py:11` (no `Depends`) | Real active job list via `DataStore` (titles, companies, salaries, descriptions, links) |
| `GET /api/jobs/{stable_id}` | `jobs.py:85` (no `Depends`) | Full real job record; enumerable stable ids |
| `GET /api/pipeline/status` | `pipeline.py:13` | Real `seen_jobs.json` pipeline/run stats |
| `GET /api/pipeline/health` | `pipeline.py:19` | Real scraper/portal state stats |
| `GET /api/pipeline/retention` | `pipeline.py:124` | Real retention/stale/blocked/application-protected stats |
| `GET /api/health` | `health.py:11` | Real store health shape |
| `GET /api/health/portals` | `portal_health.py:148` | Real `portal_health.json` + SKILL.md `enabled` + DB `job_source_enabled` |
| `GET /api/health/portals/{portal_name}` | `portal_health.py:195` | Same, per portal |

These are the **launch-blocking** exposures: if the backend is reachable publicly as-is, the recruiter-facing surface is the personal job search.

### B. Existing `/api/demo/*` (unauthenticated, read demo plane — the correct public nucleus)
`demo.py`: `GET /status`, `GET /jobs/active`, `GET /jobs/{stable_id}`, `GET /pipeline`, `GET /retention`, plus **`POST /bootstrap`** (`:47`) and **`POST /reset`** (`:73`). `demo_reset` at `demo.py:79` also calls `invalidate_store_cache()` — it clears the **real** store's in-memory cache. No user files are mutated (reload-only), so impact is limited, but this is a real↔demo plane coupling to remove/gate in P1; unauthenticated POSTs with no CSRF/rate guard are also inappropriate on a public surface.

### C. Admin-only (correctly gated today — keep gated)
`GET/POST /api/admin/sources`, `GET/PATCH/DELETE /api/admin/sources/{id}`, `POST /api/admin/sources/analyze`, `POST /api/admin/sources/{id}/analyze` — all `Depends(get_current_admin_user)` (`admin_sources.py:93,130,172,192,285,312,538`). `GET /api/admin/users` — `admin_users.py:42`. Admin dependency denies non-ADMIN with 403 (`auth.py:87-91`).

### D. Authenticated user endpoints (correctly scoped today)
`/api/ranked/*`, `/api/dashboard`, `/api/resume`, `/api/profile`, `/api/preferences`, `/api/search*`, `/api/saved-jobs*`, `/api/applications*`, `GET /api/auth/me` — all `Depends(get_current_user)`, user-scoped.

**Unsafe to expose publicly as-is:** everything in list A, plus a public `/docs` (Swagger) that enumerates the full API (see §6). `/api/auth/register` + `/api/auth/login` are public by nature but need rate limiting if registration remains on a public host.

---

## 6. Security Launch Blockers

From `PRODUCTION_PUBLIC_LAUNCH_SCOPE_ASSESSMENT.md` §7, confirmed at this HEAD. **Separates launch blockers (must fix before launch) from post-launch hardening.**

### LAUNCH BLOCKERS (must be resolved before any public exposure)
**CRITICAL**
- **Default JWT secret active:** `config.py:22` `secret_key: str = "dev-secret-change-in-production"`; **no `backend/.env` or root `.env` exists** (verified), so this default is live. Forgeable tokens → forgeable ADMIN. Fix: require a real secret via env in production; reject the default.
- **CORS wildcard + credentials:** `main.py:34-40` `allow_origins=["*"], allow_credentials=True, allow_headers=["*"]`. With Bearer tokens in `localStorage`, any origin can call the API. Fix: pin exact origins, or neutralize via same-origin reverse proxy (recommended, §9).
- **Unauthenticated real-data endpoints** (§5A): the #1 launch blocker. Fix in P1 by the router boundary.

**HIGH**
- **Auth rate limiting:** `register`/`login` unauthenticated and unbounded (`auth.py:95`, `:133`).
- **Production docs/OpenAPI policy:** default `docs_url` exposes `/docs` (`main.py:26-31`, root `main.py:88` advertises it). Decide: demo-only `/docs`, disabled on the private env.
- **Real runtime data must not be committed** and **real scraper/portal state must not leak publicly** — see §7 hygiene + §5B (public status surfaces).
- **JSON/SQLite dual-state boundaries need explicit handling:** the public plane must be single-source (demo store); the real plane's JSON↔SQLite mirror (`job_sync`) stays a private-maintenance job, never a public dependency.

### POST-LAUNCH HARDENING (MEDIUM/LATER — backlog, not launch blockers)
- localStorage JWT storage + stateless-logout/revocation model (`auth.py:166-171` logout is a no-op by design)
- Scraped-HTML XSS / control-character review (React default-escapes; verify no `dangerouslySetInnerHTML`)
- TeX-injection seam review (`document_generator.py` escaping)
- Subprocess input validation edge cases (pipeline/CLI arg path already uses allowlists + arg arrays)
- Operational error-body leakage (500 handlers echo `{exc}` in `admin_sources.py`)
- Document-generation quotas/caps (`data/generated/`)

---

## 7. Repository Hygiene Findings

Read-only inspection of `git status --short` and `.gitignore`. **No `.gitignore` change made here** — these are recorded for the future repository-hygiene checkpoint (P8 / pre-public push).

### Currently IGNORED (verified via `git check-ignore`)
- SQLite DBs: `backend/careerpilot.db`, `careerpilot.db`, `backend/careerpilot_test.db`, `*.backup.*` (.gitignore:105-108)
- Job tracker: `job_search_tracker.csv` (:84), `job_search_tracker_fixed.csv` (:128)
- Primary personal dataset: `**/job_scraper/seen_jobs.json` (:26); checkpoints: `job_scraper/checkpoints.json` (:121)
- Resume uploads: `data/uploads/resumes/` (:131); generated PDFs (via global `*.pdf` :13); `.env*` (:34-35)

### NOT IGNORED — real/personal runtime artifacts that could be staged by `git add -A`
Verified **negatives** (would enter a commit if staged):
- `job_scraper/canonical_jobs.json` (1.08 MB real dataset), `ranked_jobs.json`, `filtered_jobs.json`, `scored_jobs.json`, `verified_jobs.json`, `priority_queue.json`, `top5_jobs.json`, `top10_jobs.json`, `raw_results_*.json`, `raw_bossjob_*/raw_indeed_*/raw_jobstreet_*/raw_kalibrr_*/raw_linkedin_*/raw_freehire_*.json`, `canonical_*/filtered_*/ranked_*/priority_queue_*/verification_*.json` (dated snapshots), `hard_filtered_results.json`, `normalized_results.json`, `verification_queue.json`, `linkedin_jobs.json`
- `job_scraper/portal_health.json`, `job_scraper/run_history.json` — scraper/portal infra state
- `job_scraper/.tmp_*.json` (root temp files; the `.tmp/` **directory** is ignored but root `.tmp_*` files are not)
- `job_scraper/incremental_report_*.txt` — run reports
- Root-level scrub work: `kalibrr_results.json`, `raw_search_results.json`, `models.json`, `job_search_report.txt`, `aggregate_results.js`, `filter_jobs.js/.py/.ps1`, `live_verify.js`, `dedup_verify.js`, `compile_jobs.js`, `process_jobs.*`, `test_fp.js`, `test_load.py`, `backfill_seen_jobs.py`, `clipboard_lead.html`, `indeed_job.html`, `tempbossjob_test.html`
- `data/generated/` itself has no directory rule — safe only because all content is currently `*.pdf/*.aux/*.log` ignored; non-PDF outputs would leak
- `.agents/skills/*-search/` skill trees are untracked (not ignored; they are source, intended to be added when ready)

### Future repository-hygiene checkpoint must add
- Ignore rules (or a staging policy) for every "NOT IGNORED" pipeline artifact above, plus `data/generated/**` (not just `*.pdf`), plus root `.tmp_*`-style temp files — **without** ignoring the tracked pipeline *source* (`orchestrator.js`, stage scripts, `portal_health.js`, skill CLIs).
- A **pre-public-push audit**: after any planned hygiene change, run a `git status --short` where a dry staged view shows zero real/personal runtime data before any public push.

---

## 8. P1–P10 Implementation Sequence

Confirmed as the recommended order (dependencies noted). **Nothing below is implemented in this checkpoint.**

| Phase | Name | Purpose | Dependency notes |
|---|---|---|---|
| **P1** | **Public/private router & data boundary** | Structural separation: public router set reads demo plane only; real routers auth-gated. **Critical path.** | Nothing (start here) |
| **P2** | Production configuration | `.env`/secret-key enforcement, absolute paths, CORS pin, static-serve decision | After P1 (boundary shape informs config) |
| **P3** | Security hardening | §6 launch blockers (rate limit, docs policy, error bodies) | After P2 (config in place) |
| **P4** | Curated demo dataset | Deep, realistic, sanitized demo corpus (~50+ jobs) in demo schema. **Critical path.** | Can proceed parallel to P2/P3 |
| **P5** | Deployment | Reverse proxy/TLS + static dist + uvicorn; launch checklist | After P1–P4 |
| **P6** | Durable production automation | systemd/cron/APScheduler replacing CronCreate; private-host scheduler+sync | Parallel to P5; off public host |
| **P7** | Recruiter-facing UX polish | Landing, "how it's engineered" narrative, score/state visualization | After P4 (data to render) |
| **P8** | Portfolio/GitHub integration | README, OpenAPI export, repo hygiene sweep (§7) | After P5/P7 (live demo to link) |
| **P9** | Production verification/security smoke | Boundary + regressions + §6 smoke, golden-path QA | After all implementation phases |
| **P10** | Public launch | Cut over domain, demo as default, iterate | After P9 green |

**P1 and P4 are the critical path.** Anything else can be trimmed for schedule without blocking a safe public demo.

---

## 9. Deployment Topology

Simplest production architecture that satisfies the boundary (§4). **No architecture beyond this — see out-of-scope (§11).**

```
                 ┌──────────────────────────── public host ───────────────────────────┐
 Browser ──HTTPS──► Reverse proxy / TLS (Caddy|nginx) ──┬── /          ──► static React dist │
                                                       └── /api/*     ──► uvicorn (FastAPI)  │
                                                                       │                      │
                                    PUBLIC path:  /api/demo/* + public status → DemoDataStore │
                                    PRIVATE path: authenticated /api/*        → real SQLite   │
                                    (JWT required; ADMIN for /api/admin/*)                    │
┌────────────────────────────────────────── private environment ───────────────────────────┐
│ Private scheduler (cron/systemd/APScheduler) ─► orchestrator.js ─► portal CLIs ─► JSON   │
│   portal_health.js check --db ─► real SQLite   │   sync_to_db.py (job_sync)               │
│ Claude Code agentic skills / document generation / approval gates  (human-in-the-loop)   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Public requests:** browser → public frontend → demo API/data (never real).
- **Private operations:** authenticated/admin → real API; private scheduler → scraper/orchestrator → JSON/SQLite (never on the public host).
- SQLite for the private env and demo initially; managed Postgres only if real multi-user registration appears (schema is already PG-anticipating — no rewrite needed).
- No CDN/service split beyond a possibly static-hosted dist; single host is the default.

---

## 10. P1 Exit Criteria

P1 ("Public/Private Router & Data Boundary") is **not complete** until ALL of the following hold:

1. **Public API surface contains demo endpoints only** — every unauthenticated route resolves from the demo plane.
2. **Real-data endpoints require authentication** — listing A of §5 is either gone, 401-gated, or demo-mapped.
3. **Admin endpoints require the admin role** — `get_current_admin_user` enforced on every `/api/admin/*`.
4. **Public frontend cannot request real personal data** — the built client only calls demo/public routes.
5. **Demo data is isolated from personal DB/runtime state** — `demo_store` never reads real files; remove the `invalidate_store_cache()` coupling in `demo.py:79`.
6. **Direct URL access cannot bypass the boundary** — hitting `/api/jobs/{id}`, `/api/pipeline/*`, real `/api/health/portals`, or any private route unauthenticated returns 401/404 (no data).
7. **Tests prove public/private separation** — dedicated P1 tests: public routes return demo-only payloads; private routes require JWT; admin routes 403 non-admins.
8. **No real personal data appears in public demo responses** — response-content assertion/grep across all public routes.
9. **CORS and production secret handling are not left in insecure defaults** — wildcard/credentials removed (or same-origin), default `secret_key` unusable.
10. **/docs policy applied** — OpenAPI exposed only over the demo namespace / disabled on the private env.

---

## 11. Explicit Out-of-Scope Items

The following are **out of scope** for Phase 4 unless separately re-scoped by the user — do not introduce:

- Kubernetes, container orchestration complexity beyond a single `Dockerfile` (if any)
- Microservices / service split
- Event bus / message queue / streaming
- Serverless split (FaaS API vs separate infra)
- Multi-region / edge architecture
- **Public live scraping** — portal adapters, orchestrator, and portal-health automation stay private-only (ToS + fragility); the public site shows demo data, never live scrapes
- Public user registration / multi-tenant jobs marketplace (would force Postgres + revocation work — revisit only if the demo proves demand)
- Mobile apps; speculative AI/LLM features on the public demo

---

## 12. Recommended Next Checkpoint

> **P1 — Public/Private Router & Data Boundary**

P1 is the first code-change phase of Phase 4 and the single highest-leverage change: today the unauthenticated surface reads the real personal dataset (§5A). P1 exit criteria are pinned in §10. It should be executed as its own read-only planning → approved implementation → verification cycle, in the repo's established checkpoint discipline (no staging/commit until the user approves).

**CP16.7** — as reframed in §3 (Final CP16 Close-Out Verification) — is the immediate predecessor/parallel read-only verification; it does not gate P1 beyond confirming the bridge and test suite are green at the reframed scope.

---

## Final Validation Record (this checkpoint)

- **Files created:** `PHASE4_KICKOFF_PUBLIC_BOUNDARY_PIN.md` (this document). `PRODUCTION_PUBLIC_LAUNCH_SCOPE_ASSESSMENT.md` was created earlier this session; neither is committed.
- **Git status:** `git status --short` shows no tracked modifications (`git diff` and `git diff --cached` empty). Untracked files other than the two assessment documents are all pre-existing personal/runtime artifacts (pipeline JSON, scraper debug/utility scripts, `.agents/skills/*-search/`, CP reports) — none created, modified, or staged by this checkpoint.
- **Unexpected modifications:** none. No source, config, `.gitignore`, database, migration, or scraper runtime state was touched.
- **Commit/push:** none — nothing staged, no commit created, no push. HEAD remains `4b1ed77`.
- **CP16.6:** remains the latest implementation commit.
- **Claims check:** this document records reframed scope and future plans only; it does not claim that any P-phase, CP16.7, or deferred gap has been implemented.

**STOP — per instruction, no automatic progression into CP16.7 or P1.**