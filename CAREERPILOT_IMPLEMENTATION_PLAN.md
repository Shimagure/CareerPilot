# CareerPilot — Implementation Plan

**Audit-only deliverable.** This document maps the *existing* `ai-job-search` CLI architecture (authored and verified by direct file inspection) and proposes a portfolio-ready web application called **CareerPilot**. No code in this repo was modified to produce it.

---

## A. Current Architecture

The repository is a **CLI-first, session-driven job-search pipeline** for one candidate (Wilson DC. Chiquito). It is implemented as Node.js scripts under `job_scraper/scripts/` orchestrated by skill definitions under `.claude/skills/`, with all durable state in flat JSON files. There is **no backend server and no frontend** — everything runs inside a Claude Code session.

### High-level layers

| Layer | Location | Role |
|-------|----------|------|
| Skill orchestration | `.claude/skills/job-scraper/SKILL.md`, `.claude/skills/job-application-assistant/` | Define the autonomous pipeline steps and evaluation rules |
| Portal CLIs (6) | `.agents/skills/{jobstreet,linkedin,indeed,kalibrr,bossjob,freehire}-search/` | Each is a Claude skill that scrapes one board and emits raw JSON |
| Pipeline scripts | `job_scraper/scripts/*.js` | Discovery aggregation, canonicalization, hard filter, priority queue, verification, scoring, ranking |
| Persistent state | `job_scraper/canonical_jobs.json`, `seen_jobs.json`, `ranked_jobs.json`, `checkpoints.json` | JSON "database" |
| Application tracking | `job_search_tracker.csv` | Manual CSV of submitted applications |
| Truth sources | `CANDIDATE_TRUTH.md`, `CLAUDE.md`, `MASTER_JOB_SEARCH_BASELINE.md` | Anti-fabrication + hard-filter authority |

### Processing states (9, persisted on every job record)
`NEW`, `NEEDS_VERIFICATION`, `ACTIVE_VERIFIED`, `ACTIVE_UNVERIFIED`, `STALE`, `CHANGED`, `CLOSED_OR_EXPIRED`, `POSTING_CHANGED`, `DUPLICATE_OR_INVALID`

### Autonomy model
The pipeline runs **autonomously within a session** — no "proceed?" prompts between deterministic stages. Crash recovery is via `checkpoints.json` stage gates. This is encoded in CLAUDE.md, not in code, so a fresh session must reproduce identical results (cold-start correctness).

---

## B. Current Data Flow

```
PORTAL CLIs (.agents/skills/*)
   │  raw JSON dumps (one per portal)
   ▼
process_all_results.js        ── dedupe within-run, merge into canonical
   ▼
canonicalize.js               ── stable_id (SHA256 URL|company|title),
   │                             fingerprint (SHA256 material fields), normalize
   ▼
canonical_jobs.json           ── 531 unique records
   ▼
hard_filter.js                ── role/arrangement/salary/language gates
   │                             (marks DUPLICATE_OR_INVALID / DEPRIORITIZE)
   ▼
priority_queue.js             ── tiers 1-5, arrangement/salary/role/career/portal/freshness
   ▼
verify_jobs.js                ── live HTTP fetch (batch 5, 2 concurrent)
   │                             403 → ACTIVE_UNVERIFIED (≤5d) / STALE (>5d)
   │                             404 → CLOSED_OR_EXPIRED
   │                             fingerprint diff → CHANGED
   │                             success → ACTIVE_VERIFIED
   ▼
score_jobs.js                 ── 5 dimensions → overall, verdict, strengths/gaps
   ▼
rank_jobs.js                  ── deterministic desc rank, top 10/5, integrity check
   ▼
ranked_jobs.json              ── final active set
   ▼
PRESENT → WAIT APPROVAL → GENERATE (CV/CL) → VERIFY → USER SUBMITS → update tracker
```

**Key insight for web:** every arrow above is a pure function over JSON files. The web backend can wrap these scripts (or port them) as API endpoints without changing the data contract.

---

## C. Canonical Job Schema

Per-record fields in `canonical_jobs.json` / `seen_jobs.json`:

| Field | Type | Set by | Notes |
|-------|------|--------|-------|
| `stable_id` | string (SHA256) | canonicalize | Never changes after first ingestion |
| `fingerprint` | string (SHA256) | canonicalize/verify | Material-field hash for change detection |
| `title` | string | portal CLI | Raw posting title |
| `company` | string | portal CLI | Raw company name |
| `location` | string | portal CLI | May be "Remote", "Metro Manila", etc. |
| `arrangement` | enum | hard_filter | remote / hybrid / onsite |
| `salary` | string\|null | portal CLI | Often null (Philippine boards rarely list) |
| `url` | string | portal CLI | Source posting URL |
| `portal` | string | portal CLI | jobstreet / linkedin / indeed / kalibrr / bossjob / freehire |
| `description` | string | verify | Fetched live text (truncated 2000 chars in fingerprint) |
| `processing_state` | enum | pipeline | One of 9 states |
| `first_seen` / `last_verified` | ISO timestamp | verify | Stale-policy clock |
| `evaluation` | object | score | 5 dimension scores + overall + verdict + strengths + gaps |
| `priority_tier` | int 1-5 | priority_queue | Processing order |
| `blocked_at` / `blocked_reason` | ISO / string | verify | Set on 403 |
| `previous_fingerprint` / `changed_at` | — | verify | Set on CHANGED |

**Web schema recommendation:** promote this to a typed model (Pydantic `JobRecord`) and keep `stable_id` as the primary key. Do **not** add fields that could be fabricated; salary stays nullable.

---

## D. Application Tracking

`job_search_tracker.csv` — 21 rows, columns:

```
date, company, sector, role, role_type, channel, status,
contact_person, fit_rating, notes, cv_file, cover_letter_file, source
```

Statuses observed: `drafted`, `submitted`, `withdrawn`, `hold`, `rejected`, `closed`.

**Web model:** `Application` table keyed by `stable_id` (FK to JobRecord). CSV is the legacy export; the web app becomes the source of truth and can still emit the CSV for portability. Fit rating + notes are free-text (candidate-authored, not AI-fabricated).

**Never expose:** `contact_person` if it contains personal email/phone of a third party; treat as PII. CV/cover-letter file paths are local artifacts, not web-served.

---

## E. Stale-Job Architecture

| State | Time since verify | Action |
|-------|-------------------|--------|
| `ACTIVE_VERIFIED` | ≤5d | Skip re-verify (retain) |
| `ACTIVE_VERIFIED` | >5d | → `STALE`, re-verify next run |
| `ACTIVE_UNVERIFIED` | ≤5d | Retain, **no retry** (403 block likely persists) |
| `ACTIVE_UNVERIFIED` | >5d | → `STALE`, retry once |
| `STALE` | — | Live verify → `ACTIVE_VERIFIED` / `ACTIVE_UNVERIFIED` / `CLOSED_OR_EXPIRED` |

**403 protocol:** record `blocked_at`, `blocked_reason:"http_403"`; if canonical data ≤5d → `ACTIVE_UNVERIFIED`; else → `STALE`. Never retry 403 in same run.

**Web implication:** a `stale_check` cron (or on-read computed flag) must replicate this. The frontend "System Health" page reads `processing_state` counts + `blocked_source` tallies. Demonstrate: jobs older than 5d without re-verify should show a "stale" badge.

---

## F. Checkpoint / Pipeline State

`checkpoints.json` structure per stage gate:
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "discovery|canonicalization|hard_filter|verification|scoring|ranking_report",
  "stage_status": "in_progress|complete|failed",
  "jobs_processed_in_stage": N,
  "total_jobs_in_stage": M,
  "batch_index": N, "total_batches": M,
  "last_updated": "ISO"
}
```
`run_history[]` retains prior runs. Recovery: last `complete` → resume next; `in_progress`/`failed` → resume that stage, reprocess only incomplete batches.

**Web implication:** checkpoints become a `PipelineRun` table. A background worker (Celery/RQ or FastAPI BackgroundTasks) holds the run; the frontend polls `/api/pipeline/status`. Crash recovery = query incomplete batches.

---

## G. Existing Backend / API

**None.** No server, no REST layer, no database engine. All "state" is file mutation by Node scripts inside a Claude session.

---

## H. Existing Frontend

**None.** No HTML, no React, no templates. The only "UI" is Claude's terminal output (markdown tables) and LaTeX-compiled PDFs for CV/cover letters.

---

## I. Recommended CareerPilot Web Architecture

**Stack:** `FastAPI` (Python) backend + `React` (Vite + TypeScript) frontend, single repo, `docker-compose` for local portfolio demo.

### Why FastAPI over Node
- The scoring/evaluation logic is already well-specified in `.md` rules; porting to Python keeps one language for backend + the existing `*.py` helpers (`salary_lookup.py`, `backfill_seen_jobs.py`).
- Pydantic gives us the `JobRecord` / `Application` / `PipelineRun` models with validation — directly enforcing the canonical schema from §C.
- Auto-generated OpenAPI docs are portfolio gold.

### Component map

```
careerpilot/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app, CORS, routers
│   │   ├── models.py              # Pydantic: JobRecord, Application, PipelineRun
│   │   ├── store.py               # JSON-file persistence (reuse seen_jobs.json shape)
│   │   ├── pipelines/
│   │   │   ├── canonicalize.py    # port of canonicalize.js
│   │   │   ├── hard_filter.py     # port of hard_filter.js
│   │   │   ├── priority_queue.py  # port of priority_queue.js
│   │   │   ├── verify.py          # HTTP fetch + 403/404 state machine
│   │   │   ├── score.py           # 5-dim scoring port of score_jobs.js
│   │   │   └── rank.py            # deterministic ranking
│   │   ├── routers/
│   │   │   ├── jobs.py            # /api/jobs, /api/jobs/{stable_id}
│   │   │   ├── applications.py    # CRUD on tracker
│   │   │   ├── pipeline.py        # /api/pipeline/run, /status
│   │   │   ├── health.py          # /api/health (stale + portal stats)
│   │   │   └── demo.py            # /api/demo/bootstrap
│   │   └── security.py            # field-redaction for public/demo modes
│   └── data/                      # seeded from repo JSON (gitignored when real)
└── frontend/
    ├── src/
    │   ├── pages/                 # 8 required pages
    │   ├── components/            # JobCard, ScoreGauge, StateBadge, FitRadar
    │   └── api/                   # typed fetch client
    └── public/
```

### Persistence decision
Keep the **JSON-file store** for the portfolio build (zero infra, deterministic, matches cold-start correctness). Add a `store.py` abstraction so swapping to SQLite/Postgres later is a one-file change. Do **not** introduce a DB in v1 — it complicates the demo and the existing pipeline is file-based by design.

---

## J. Required API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/jobs` | List active jobs; filters: `state`, `arrangement`, `portal`, `min_score`, `tier`, `q` |
| `GET` | `/api/jobs/{stable_id}` | Full record + evaluation + description |
| `GET` | `/api/jobs/{stable_id}/fit` | 5-dimension breakdown + verdict + strengths/gaps |
| `POST` | `/api/pipeline/run` | Trigger discovery→rank (async, returns `run_id`) |
| `GET` | `/api/pipeline/status?run_id=` | Stage progress from checkpoints |
| `GET` | `/api/pipeline/history` | `run_history` list |
| `GET` | `/api/applications` | Tracker rows |
| `POST` | `/api/applications` | Add/update application (status, fit_rating, notes) |
| `GET` | `/api/health` | State-count distribution, blocked-portal tally, stale count |
| `GET` | `/api/demo/bootstrap` | Load sanitized dataset, return demo token |
| `POST` | `/api/demo/reset` | Restore seeded demo state |

**Scoring is read-only over stored `evaluation`** — the web app displays scores, it does not recompute them on every request (matches "score coverage" integrity rule).

---

## K. Demo Mode Strategy

Goal: a recruiter/hiring-manager opening the portfolio sees a **fully populated, non-empty** CareerPilot without any real PII or live scraping.

1. **Seed data:** bundle a sanitized copy of `canonical_jobs.json` (531 records) with:
   - `company` names generalized to recognizable-but-fictional (e.g., "Metro Bank Corp" → "Sample Financial Ltd")
   - `url` rewritten to `https://example.com/job/{stable_id}` (no real scrape targets)
   - `description` kept generic but plausible (no real posting text)
   - Candidate name → "Demo Candidate"; `job_search_tracker.csv` contact_person stripped
2. **Demo token:** `/api/demo/bootstrap` returns a token that flips `security.redact()` to strip any field tagged `pii: true` in `models.py`.
3. **No live calls:** in demo mode `verify.py` is a no-op (returns `ACTIVE_VERIFIED` from seed). This keeps the demo offline and fast.
4. **Reset:** `/api/demo/reset` restores seed so the portfolio always opens clean.
5. **Toggle in UI:** a prominent "Demo Mode" banner; the Dashboard shows "Sample data" watermark.

**What demo mode must NEVER expose (see §L security):** real `url` scrape targets, real candidate email/phone, real `contact_person` PII, real salary if sourced from non-public data.

---

## L. Files To Change (and what to protect)

### Reuse as-is (read-only inputs)
- `CLAUDE.md`, `CANDIDATE_TRUTH.md`, `MASTER_JOB_SEARCH_BASELINE.md` — authority, not code
- `canonical_jobs.json`, `seen_jobs.json`, `ranked_jobs.json` — seed/source data
- `job_search_tracker.csv` — import source for applications

### Port (logic, not files)
- `job_scraper/scripts/canonicalize.js` → `backend/app/pipelines/canonicalize.py`
- `hard_filter.js` → `hard_filter.py`
- `priority_queue.js` → `priority_queue.py`
- `verify_jobs.js` → `verify.py` (HTTP + state machine)
- `score_jobs.js` → `score.py`
- `rank_jobs.js` → `rank.py`

### New files
- `backend/app/main.py`, `models.py`, `store.py`, `security.py`, `routers/*`
- `frontend/` React app (8 pages)
- `docker-compose.yml`, `README.md` (portfolio), `.env.example`

### Security — data NEVER to expose via web
| Field | Reason |
|-------|--------|
| Candidate email / phone (from `CLAUDE.md`) | Personal PII — never in API responses |
| `contact_person` in tracker | Third-party PII |
| Real `url` scrape targets in non-demo | Could enable abuse / ToS violation of boards |
| `salary` if from non-public source | Confidential |
| `blocked_reason:"http_403"` + source IP hints | Leaks scraping infra |
| Local CV/cover-letter file paths | Filesystem disclosure |

Redaction enforced in `security.py` via Pydantic `Field(..., pii=True)` + a response middleware that drops/stars those fields unless an authenticated admin scope is present (portfolio has no such scope).

---

## M. Implementation Phases

**Phase 0 — Scaffold (½ day)**
- Repo structure, FastAPI hello-world, Vite React shell, docker-compose, CORS.

**Phase 1 — Data models + store (1 day)**
- `models.py` (JobRecord, Application, PipelineRun), `store.py` JSON persistence, seed loader from repo JSON.

**Phase 2 — Pipeline ports (2 days)**
- Port canonicalize → hard_filter → priority_queue → verify → score → rank to Python. Unit-test each against existing `seen_jobs.json` outputs for parity.

**Phase 3 — API layer (1.5 days)**
- Routers for jobs, applications, pipeline, health, demo. OpenAPI auto-docs.

**Phase 4 — Frontend pages (3 days)**
1. Dashboard (counts, top-5, stale badge, pipeline status)
2. Job Explorer (filterable table/grid)
3. Job Detail (full record + description)
4. Fit Analysis (5-dim radar + verdict + strengths/gaps)
5. Application Tracker (CRUD on statuses)
6. Pipeline / System Health (stage gates, portal 403 tallies, stale stats)
7. Data Retention / Stale-Job stats (state distribution over time)
8. Demo Mode (bootstrap/reset controls + banner)

**Phase 5 — Demo mode + security (1 day)**
- Seed sanitizer, demo token, `security.py` redaction middleware, reset endpoint.

**Phase 6 — Portfolio polish (1 day)**
- README with architecture diagram, screenshots, live-demo link, `docker-compose up` one-liner.

**Total estimate: ~10 engineer-days** for a portfolio-grade build.

---

## N. Risks / Blockers

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Score parity drift** when porting JS→Python | Web scores differ from CLI, breaking "cold-start correctness" | Golden-test against `seen_jobs.json`; assert identical `stable_id`/`fingerprint`/scores |
| **Live verification needs HTTP** — boards (JobStreet) already 403 | Web verify may be fully blocked; demo must not depend on it | Demo mode = no-op verify; real mode documents 403 rate via health page |
| **PII leakage** via over-broad API | Portfolio exposes candidate/contact data | `security.py` redaction + no admin scope in portfolio build |
| **No existing tests** in repo | Ports unverified | Add parity tests in Phase 2 before UI |
| **Large `seen_jobs.json` (3.8MB)** read per request | Latency in web | `store.py` loads once into memory; API reads from cache, writes atomically |
| **LaTeX CV/CL generation** not in scope for v1 web | Application docs still CLI-only | v1 shows tracker status + file links; CV gen stays in Claude skill (documented limitation) |
| **Anti-fabrication rules are `.md`, not code** | Web could display unverified claims if logic drifts | Keep `CANDIDATE_TRUTH.md` as the immutable gate; score.py imports Level 1/2/3 sets as constants |
| **Single-candidate design** limits "product" feel | Portfolio viewer may expect multi-user | Frame as "personal career command center" — that *is* the differentiator |

---

### Appendix — Audit method
All claims above were verified by direct file inspection during this session:
- `CLAUDE.md`, `MASTER_JOB_SEARCH_BASELINE.md`, `CANDIDATE_TRUTH.md`
- `.claude/skills/job-scraper/SKILL.md`, `04-job-evaluation.md`
- `job_scraper/scripts/*.js` (canonicalize, hard_filter, priority_queue, verify_jobs, score_jobs, rank_jobs, process_all_results)
- `job_scraper/{canonical_jobs,seen_jobs,ranked_jobs,checkpoints}.json`
- `job_search_tracker.csv`
- `.agents/skills/*-search/` (6 portal CLIs)

No repository files were modified.
