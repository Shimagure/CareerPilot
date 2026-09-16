# P4 — Demo Dataset — Scope Assessment

**Checkpoint:** P4 (Demo Dataset) — **READ-ONLY scope assessment only.** No application code, demo data, tests, configuration, or Git state was modified. No commit; no push.

**Date:** 2026-09-15
**Baseline commit:** `d54b6bf247e0965da57b2f7f8b71aeebfd32d966` (P3.3) — the committed HEAD is `ad3eb9ef58f33a5265627996310b5ec9f15c2ece` (P3.4); this assessment inspects the current working tree.

---

## 1. Executive Summary

The public demo plane already exists as a **structurally isolated API layer**: `/api/public/*` and `/api/demo/*` are served exclusively by `DemoDataStore`, which only **reads** three hand-authored files under `backend/demo_data/` and has no code path that writes to them or falls back to real data. The current corpus is **8 demo jobs (7 in the active pool)** and **4 linked demo applications** — far too small to look like a real portfolio (a real ranked-jobs list, pipeline panel, and retention panel all expect tens of jobs), and it exercises **zero** evaluation/fit-analysis blocks (0 of 8 jobs), so the FitAnalysis surface can never be shown with content.

This assessment recommends:

- **Target corpus: 50 active-pool demo jobs** (plus ~6 contiguous staging/support records such as stale/closed/needs-verification so the retention and state panels render realistically) and **~16 demo applications** covering the tracker lifecycle.
- **Data generation strategy: ONE recommendation — programmatic generation** from a small, hand-authored, fictional seed table, via a committed generator script that emits the three committed demo files deterministically. Reason: the corpus is a fixed showcase artifact that must stay coherent, reproducible, and auditable, and its 28-day window (dates) age out — regeneration must be a one-command, deterministic operation, not a monthly hand-edit of ~50 records. The generator never reads real corpora and the output is reviewed and committed; the app itself never runs the generator.
- **The frontend does not consume the public demo feed at all today.** `client.ts` defines `getPublic*` methods but no page calls them; "Demo Mode" (DemoModeContext/DemoModeBanner) only drives the `/api/demo/status|bootstrap|reset` banner widgets. Wiring any page to the public feed is deliberately out of scope for the dataset checkpoint — the corpus is designed to satisfy the public API surface, and the demo UI decision is a separate, deferred checkpoint.
- **Safety: the public/demo boundary is verified structural.** `public.py` imports only `app.demo_store`; `demo_store.py` only json/csv-reads `backend/demo_data/`; no runtime `demo=true` toggle exists; `bootstrap`/`reset` only invalidate an in-memory cache and never touch the real store. The residual risk is authoring drift (copying real postings into demo files), which a testable no-intersection invariant closes.

---

## 2. Current Demo Architecture

How demo data flows today (traced in full).

### Data plane

| Layer | File | Role |
|---|---|---|
| Static demo corpus | `backend/demo_data/demo_seen_jobs.json` | Job records (pipeline-state vocabulary) |
| Static demo corpus | `backend/demo_data/demo_tracker.csv` | Application-tracking rows |
| Static demo corpus | `backend/demo_data/demo_checkpoints.json` | Pipeline checkpoint + run history |
| Reader (single source) | `backend/app/demo_store.py` | `DemoDataStore` — thread-safe, cached reader of the three files |
| Public router | `backend/app/routers/public.py` | `/api/public/*` — unauthenticated, demo-plane only |
| Demo admin router | `backend/app/routers/demo.py` | `/api/demo/*` — status pipelines + authenticated bootstrap/reset |

### Load path (no fallback to real data — verified)

`public.py` / `demo.py` → `get_demo_store()` singleton → `load_seen_jobs()`, `load_checkpoints()`, `load_applications()` → `json.load`/`csv.DictReader` on `backend/demo_data/*` only. There is **no** import of `app.store`, `DataStore`, SQLite, or `job_scraper/*` in `public.py`; `demo_store.py` opens files strictly read-only (all `open(..., "r")`). `load_seen_jobs()` handles the `{"seen": {...}}` wrapper and returns `{}` on a missing file — it never falls back to the real seen-jobs store.

### Bootstrap / reset semantics

`demo_bootstrap` and `demo_reset` (both `Depends(get_current_user)` — authenticated) only call `invalidate_demo_store_cache()` and re-run the read path. They perform **no writes** — not to the demo files, not to a demo SQLite database, and explicitly not to the real store (`reset` even carries the comment `invalidate_store_cache() REMOVED - demo plane must not touch real store`).

### Registration order (main.py)

`public.router` is registered first with comment `PUBLIC: demo data only (unauthenticated)`; `demo.router` is annotated `INTERNAL: demo admin/bootstrap (unauthenticated, but gated by design)`. `invalidate_demo_store_cache()` runs on shutdown alongside the real-store invalidation.

---

## 3. Current Demo Corpus (exact counts)

### `demo_seen_jobs.json` — 8 records (`demo-001`..`demo-008`)

Wrapped as `{"demo_meta": {...}, "seen": {...}}`; every job carries the full JobRecord field set (title, company, location, salary, url, portal, arrangement, work_mode, description, processing_state, first_seen, last_verified, last_active_at, blocked_*, changed_*, closed_at, fingerprints, rank_score, rank_verdict, rank_date, strengths, gaps, fit, status, priority_tier).

| Metric | Value | Detail |
|---|---|---|
| Jobs on file | **8** | demo-001..008 |
| Processing-state mix | ACTIVE_VERIFIED ×4 (001–004); ACTIVE_UNVERIFIED ×1 (005, `blocked_reason http_403`); CHANGED ×1 (006); **NEEDS_VERIFICATION ×1 (007)**; POSTING_CHANGED ×1 (008) | |
| In `ACTIVE_POOL_STATES` | **7** | demo-007 (`NEEDS_VERIFICATION`) is **excluded** — `get_active_jobs()` yields 7, not 8 |
| Fit distribution | high ×3 (001, 002, 003); medium ×4 (004, 005, 006, 008); low ×1 (007) | |
| Arrangement | hybrid ×2 (001, 004); remote ×3 (003, 006, 008); onsite ×3 (002, 005, 007) | |
| Portal/source | linkedin ×3 (001, 004, 008); jobstreet ×2 (002, 007); indeed ×2 (003, 006); kalibrr ×1 (005) | |
| Rank scores | 92 / 88 / 82 / 79 / 75 / 70 / 65 / 55 | All ranked, ranked_on 2026-09-02/03 |
| `evaluation` blocks | **0 of 8** | `key_strengths`/`gaps` exist as flat job fields, but the `evaluation` sub-object is absent on every job → FitAnalysis renders "No Fit Analysis Available" for all demo jobs |
| Blocked (http_403) | 1 | demo-005 |
| URLs | 8/8 `https://example.com/jobs/demo-0XX` | Safe, fictional |
| 28-day window (as of 2026-09-15) | 7/7 active-pool jobs within window (latest `last_active_at` 2026-09-03) | stale = 0 today |

### `demo_tracker.csv` — 4 applications

| Job | Company → Role | Status | fit_rating | Notes | cv_file / cover_letter_file |
|---|---|---|---|---|---|
| demo-001 | TechCorp Philippines → Senior End User Computing Engineer | Applied | 4 | "Applied via LinkedIn Easy Apply" | both set |
| demo-002 | Global BPO Solutions → IT Service Desk Lead | Phone Screen | 3 | "Phone screen scheduled for Aug 28" | both set |
| demo-003 | CloudFirst Inc → Junior Systems Administrator | Applied | 5 | "Strong match - remote, Linux, cloud path" | both set |
| demo-004 | SecureNet Philippines → Endpoint Security Analyst | Pending | (blank) | (blank) | both blank |

- **4 rows; statuses** Applied ×2 / Phone Screen ×1 / Pending ×1; **8 distinct tracker statuses exist in the enum** (ApplicationStatus) but only 3 are used.
- All 4 link to demo jobs via explicit `stable_id` (and would also resolve via the normalized `company|title` lookup).
- **Scale mismatch (pre-P4 inconsistency):** demo `fit_rating` uses a **1–5** scale, but the frontend `JobDetail` renders `{fit_rating}/100` (and thresholds at 60/80). This must be reconciled when authoring the larger corpus.

### `demo_checkpoints.json` — 1 current + 1 history

- `current_checkpoint`: run `20260904-000000`, stage `ranking_report`, status `complete`, 8 jobs, 2 batches, `batch_index 2`. No `queue_length` / `tier_breakdown` / `verified` / `blocked` / `changed` / `closed` summary fields.
- `run_history`: 1 entry — run `20260903-143000`, `ranking_report` complete, 8 jobs.
- `/api/public/retention` reports `total_runs = len(run_history) = 1`, `last_run` = current.

### Derived public-facing numbers (unchanged code, today)

- `/api/public/status` and `/api/public/health/portals`: `active_jobs_count = 7`, `stale_jobs_count = 0`, `blocked_jobs_count = 1`, `total_seen = 8`, `state_distribution` = the 8 records across 5 states.
- `/api/public/jobs/active`: **7** job summaries.
- `/api/public/pipeline`: current + 1 history entry.

---

## 4. Frontend Coverage Analysis

Ground truth (grep/read-verified):

- **No page consumes the public demo feed.** The `getPublic*`/`publicHealthCheck` methods in `frontend/src/api/client.ts` are defined but **never called** anywhere else in the codebase.
- **Demo-mode wiring is banner-only.** `DemoModeContext` + `DemoModeBanner` (+ Sidebar/Header controls) call `/api/demo/status`, `/api/demo/bootstrap`, `/api/demo/reset`. `isDemoMode` is pure client-side state; it **does not redirect any page's data feed**.
- **Every data-bearing page hits authenticated private endpoints serving real data:** `useJobs`→`jobsApi.list` (`/api/jobs`), `useJob`→`jobsApi.get` (`/api/jobs/{id}`), `useTop5/Top10/AllRankedJobs`→`rankedApi.*` (`/api/ranked/*`), `useApplications`→`applicationsApi.*`, `usePipelineHealth`→`pipelineHealthApi.*`, `useDashboard`→`dashboardApi.get`. In demo mode these all still render **real** (private) data.

Mapping of existing public endpoints → pages that *would* consume them (none today):

| Public endpoint | Client method | Themed consumer |
|---|---|---|
| `/api/public/jobs/active` | `getPublicJobs` | RankedJobs / Jobs list |
| `/api/public/jobs/{id}` | `getPublicJob` | JobDetail / FitAnalysis |
| `/api/public/pipeline` | `getPublicPipelineStatus` | Pipeline page |
| `/api/public/retention` | `getPublicRetentionStats` | RetentionStats |
| `/api/public/health/portals` | `getPublicPortalHealth` | PipelineHealth portals panel |

**Conclusion for the corpus:** today a 50-job corpus would make the *API* look real but would not show up in any UI. Corpus design should therefore target (a) the public API surface, (b) a future public demo page (deferred — §13), and (c) staying structurally isolated. The dataset checkpoint does not include building that demo UI.

---

## 5. Proposed Demo Corpus

**Target: 50 active-pool demo jobs** (the ≈50+ ask, made exact against the implementation: `get_active_jobs()` returns only `ACTIVE_POOL_STATES` within the 28-day window, so "active" is defined by code, not by file count) **plus ~6 peripheral non-active records** (stale / closed / needs-verification / duplicate) so `state_distribution`, the retention panel, and stale/protected math render realistically. Total file records: **~56**. Demo applications: **~16**, each resolving to an active demo job.

### Distribution spec (A–F), applied to the 50 active jobs

- **A — Arrangement:** remote ≥ 15, hybrid ≥ 15, onsite ≥ 15 (balance ~15/15/15, last 5 flexible); 0–2 `unspecified` on peripheral records.
- **B — Source/portal:** ≥ 4 distinct portals; each ≥ 8 jobs; railmix over linkedin / jobstreet / indeed / kalibrr / bossjob.
- **C — Fit level:** high ≥ 15, medium ≥ 15, low ≥ 8, unknown ≥ 1 (fits must match the `fit` field, `rank_verdict` vocabulary, and the evaluation `overall`/`verdict` for scored jobs).
- **D — Processing state:** ACTIVE_VERIFIED ≥ 35, ACTIVE_UNVERIFIED ≥ 5 (each with `blocked_reason: http_403`), CHANGED ≥ 4, POSTING_CHANGED ≥ 4; peripheral: 1–2 STALE, 1–2 CLOSED_OR_EXPIRED, 1 NEEDS_VERIFICATION, 1 DUPLICATE_OR_INVALID.
- **E — Role-family / salary realism:** cover EUC/Endpoint, Service Desk / Helpdesk, Systems Administration, Cloud Support, NOC, Security Analyst, DevOps (all aligned to the candidate's target sectors), salaries PHP 25k–90k with a coherent distribution peaking in the 30k–60k band; arrangement/salary coherent (remote cloud roles priced higher than onsite helpdesk).
- **F — Application + status lifecycle:** 16 demo applications; statuses span **≥ 6** of the 8 enum values (draft…accepted); ≥ 10 with notes; ≥ 8 with `cv_file`/`cover_letter_file` names; every application resolves to a real demo job via normalized `company|title` (and explicit `stable_id`).

### Job-detail completeness (all active records)

Every one of the 50 carries: description (2–4 sentences, genre-consistent), location, salary, work_mode, strengths ≥ 2, gaps ≥ 1, rank_verdict, rank_date, priority_tier, first_seen/last_verified/last_active_at with **coherent timing** (see §7). **≥ 30 carry a complete `evaluation` block** (technical, experience, behavioral, career, overall, location, location_note, verdict, key_strengths, gaps, recommendation, evaluated_at) so the FitAnalysis surface has content to render — closing the current 0/8 gap.

### Checkpoints

One current checkpoint + ≥ 4 run_history entries whose counts reflect a 50+/56-job run (jobs_processed, batches, and summary fields `queue_length`, `tier_breakdown`, `verified`, `blocked`, `changed`, `closed`, `top5_count`, `top10_count`).

---

## 6. Data Model / Field Requirements

Extending the corpus must stay **schema-exact** with the existing Pydantic models and the store's field reads.

### Jobs — every file record must match what `demo_store.get_job_by_stable_id` reads

The store reads these keys directly; they must be present and correctly typed: `stable_id`, `title`, `company`, `location`, `salary`, `url`, `portal`, `arrangement` (enum `remote|hybrid|onsite|unspecified`), `work_mode`, `description`, `processing_state` (enum from `ProcessingState`), `first_seen`, `last_verified`, `blocked_at`, `blocked_reason`, `changed_at`, `changed_fields`, `closed_at`, `fingerprint`, `previous_fingerprint`, `rank_score`, `rank_verdict`, `rank_date`, `strengths` (list), `gaps` (list), `fit` (enum `high|medium|low|unknown`), `status`, `priority_tier`, `last_active_at`, and optionally `evaluation` (the full `Evaluation` shape: 4 numeric dimensions + `location`/`location_note` + `overall`/`verdict` + `key_strengths`/`gaps` lists + `recommendation` + `evaluated_at`).

### Constraints enforced by code (must hold for every record)

- `processing_state` **must** be a valid `ProcessingState`; `arrangement`/`fit` valid enums → otherwise the store coerces to `UNKNOWN`/`unspecified`.
- `ACTIVE_POOL_STATES` = `{ACTIVE_VERIFIED, ACTIVE_UNVERIFIED, CHANGED, POSTING_CHANGED}`; only these are returned by `/jobs/active`. Peripheral non-active states exist deliberately **outside** this set.
- 28-day window is computed live from `last_active_at` → `last_verified` → `blocked_at` → `first_seen` (fallback chain). Active records must carry a recent `last_active_at` **or** an application link (protection).
- `fit_rating` in the tracker must reconcile with the frontend's 0–100 rendering, or the CSV value and/or frontend display must be normalized together — the current 1–5 example is internally inconsistent and must not be replicated.

### Applications — `demo_tracker.csv`

Header must stay exactly: `date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,stable_id`. Each `company|role` should resolve via the store's normalized lookup (`_normalize_company|_normalize_title`, punctuation/case-stripped) to a demo job, and/or carry an explicit `stable_id`.

### Checkpoints — `demo_checkpoints.json`

Shape: `current_checkpoint` object + `run_history` array of `PipelineCheckpoint` fields (`run_id`, `started_at`, `stage` enum, `stage_status` enum, `jobs_processed_in_stage`, `total_jobs_in_stage`, `batch_index`, `total_batches`, `last_updated`, plus optional summary fields). Invalid checkpoint entries are silently skipped by the store (`except Exception: pass`) — so malformed entries degrade the demo silently; generation must validate.

---

## 7. Data Generation Strategy

**Recommended (ONE): programmatic generation** — a committed, deterministic generator script plus a small hand-curated seed table, emitting the three demo files.

### Rationale (why not hand-authored, why not "hybrid")

- **Hand-authoring ~56 records × ~20 fields each is the least maintainable option.** Every month the 28-day window ages out and an author must re-stamp dates across all active records by hand; cross-file link integrity (`company|title → stable_id`), state/fit/salary/rank coherence across 56 rows, and the A–F distributions cannot be *guaranteed* by eyeball. The corpus is a showcase artifact that must stay coherent, reproducible, and auditable in perpetuity — that is a machine-reproducible contract, not a writing task.
- **"Hybrid" adds a second path without a second benefit here.** Programmatic *with* a curated human-authored seed table already captures the one genuine virtue of hybrid authoring (human realism on descriptions/verdicts), because the seed is hand-written and reviewed. A procedural-only generator with no curated seed risks templated, samey descriptions — avoided by seeding.

### Recommended shape (next checkpoint)

- **Seed (hand-authored, fictional):** a compact table of ~20 role archetypes (title, company, location, salary band, arrangement, work_mode, portal, description skeleton, strengths/gaps, verdict template, priority_tier) + a portfolio of ~8 fictional companies. Addresses realism-without-fabrication: every company/URL is invented or explicitly sanitized.
- **Generator (`backend/scripts/generate_demo_dataset.py`, stdlib-only, no runtime dependency):** combines archetypes × variants deterministically (fixed RNG seed replayable), computes `stable_id`/`fingerprint` hashes, generates coherent `rank_score`/`evaluation`/`strengths`/`gaps` from the archetype, stamps dates relative to *generation time* (keeps the 28-day window fresh; first_seen vs last_verified vs last_active ordering enforced), writes applications with resolved links, writes checkpoint counts from the generated totals, and **self-asserts the A–F distributions and schema enums before writing**. It never reads `job_scraper/*` or `job_search_tracker.csv`.
- **Output is committed.** The three files stay checked in (they already are; `.gitignore` does not exclude `demo_data`). The app at runtime never runs the generator — regeneration is an authoring-time operation only.
- **Reproducibility:** `PYTHONHASHSEED`-free ordering, fixed seeding, and ISO timestamps make output byte-stable so regeneration is diff-able.

**Safety within generation:** seed content is hand-authored fictional; the generator asserts zero intersection with the real corpora (§8, criterion 12) at generation time and in tests.

---

## 8. Safety / Leakage Analysis

### The public boundary remains structural (verified in code)

- `backend/app/routers/public.py` imports only `..demo_store` + `..models.schemas`. It never imports `app.store`, the real `DataStore`, SQLite, or any personal runtime state (docstring enforces the intent; imports enforce the fact).
- `backend/app/demo_store.py` opens demo files **read-only** (`open(..., "r")` on every access). A repository-wide scan for writes (`open(` / `write_text` / `.write(`) found **no path that writes to `backend/demo_data/`**.
- `bootstrap` / `reset` only call `invalidate_demo_store_cache()` — in-memory cache drop + re-read. **No** demo DB is created, **no** demo file is written, and the real store is explicitly not touched.
- **No runtime `demo=true` toggle.** `is_demo_mode` is a constant `True` flag derived in the public health payload — a label, not a switch. Frontend `isDemoMode` is client-side banner state and does not re-point any request to demo data.
- **No fallback to real data.** `load_seen_jobs()` reads only `DEMO_SEEN_JOBS_FILE` and returns `{}` if absent; there is no code path that serves real `seen_jobs.json`/tracker rows through the public plane. The "never assume safe because it's under `demo_data`" requirement is satisfied by actually tracing the load path — done in §2 — and by the invariant tests in §9/§10 that will lock it against drift.

### Corpus-content safety

- **Today:** all 8 demo URLs are `https://example.com/jobs/demo-0XX`; companies are fictional (TechCorp Philippines, Global BPO Solutions, CloudFirst Inc, SecureNet Philippines, FinanceHub Corp, TelcoManila, StartupHub). Two nits to carry forward: "AWS Partner Network" of demo-006 reuses a **real** AWS program name (borderline — should be fictionalized in the new corpus), and portals `linkedin/jobstreet/indeed/kalibrr` are real brand names used as benign source tags (acceptable, but kept as tags only — never as exemplars of actual postings).
- **Prohibited content (unchanged, restated from the phase spec):** no real tracker records, applications, notes, PII, candidate-profile data, resumes, generated documents, scraper artifacts, portal-health history, credentials/tokens, job-source configuration, private URLs, or unsanitized copies of real jobs. Demo companies must **not** name the candidate's real employers or applications.
- **Test-gated no-intersection invariant (the real risk controller):** the only realistic leak vector is authoring drift — a future author pasting a real posting into a demo file. §9/§10 add a structural test asserting demo companies, URLs, and stable_ids do **not** intersect real `job_scraper/seen_jobs.json` / `job_search_tracker.csv` content, and that demo files contain no PII shapes.

---

## 9. Testing Strategy

Follows the project's reduced-verification principle: focused tests for every behavior the corpus changes; nothing broad or redundant; no network; deterministic fixtures only.

**Backend — new focused suite `backend/tests/test_demo_data.py` (schema + integrity, no HTTP):**
1. Schema conformance — every demo file record coerces cleanly through the Pydantic models used by the store (JobRecord, JobSummary, ApplicationRecord, PipelineCheckpoint), no `UNKNOWN` coercion from typos.
2. Load-path integrity — `get_demo_store().load_seen_jobs()` returns the exact committed counts (file total, active-pool total, state distribution).
3. Distribution assertions — A–F ratios (§5) enforced as ranges.
4. Cross-file link integrity — every application's normalized `company|role` resolves to a demo job; `get_application_stable_ids()` equals the application-linked set.
5. Retention math — `active_pool_count + stale_count` reconcile with `state_breakdown`; `protected_count` equals the application-linked count; all active records satisfy the 28-day window **or** application protection at test time.
6. Evaluation coverage — scored-jobs count ≥ threshold; every evaluation parses with all dimensions populated.
7. **Leak-safety invariant** — demo companies/URLs/stable_ids do not intersect real corpora; no PII shapes (email/phone/token) anywhere in `backend/demo_data/`.

**Backend — extend existing boundary tests:**
8. `test_security_boundary.py` — the existing public-endpoint and demo-isolation tests (§ items at lines 108–374) stay green against the expanded corpus; add an expected-count assertion for `/api/public/jobs/active`, `/api/public/retention`, `/api/public/pipeline` using the committed corpus values.
9. Regression anchors — affected suites rerun green: `test_security_boundary.py`, `test_production_surface.py`, `test_config.py`; the 206-test anchor baseline must stay green.

**Frontend — no test-code changes in this checkpoint.** The SPA does not consume the public feed (§4); the pre-existing JS suite is invoked per repo convention (no new page tests). A frontend demo-UI test only becomes relevant if/when the demo UI is built (deferred, §13).

**Determinism check:** `invalidate_demo_store_cache()` + repeated reads → identical bodies; regeneration is byte-stable (diffable).

---

## 10. P4 Exit Criteria

Measurable, all pass before P4 is called complete:

1. **Corpus size:** committed demo corpus holds **≥ 50 active-pool demo jobs** (`/api/public/jobs/active` returns ≥ 50) and **≥ 6 peripheral non-active records** present in the JSON.
2. **Fresh active window:** at test/generation time, `active_pool_count ≥ 45` of the active records satisfy the 28-day window (rest may be application-protected).
3. **Arrangement mix (A):** each of remote / hybrid / onsite ≥ 10 among the active 50.
4. **Source mix (B):** ≥ 4 distinct portals, each ≥ 5 jobs; no portal exceeds 40% of the corpus.
5. **Fit mix (C):** high ≥ 15, medium ≥ 15, low ≥ 5, unknown ≥ 1.
6. **State coverage (D):** ACTIVE_VERIFIED ≥ 35, ACTIVE_UNVERIFIED ≥ 4 (all `http_403`-blocked), CHANGED ≥ 3, POSTING_CHANGED ≥ 3; STALE ≥ 1 and CLOSED_OR_EXPIRED ≥ 1 present in the file.
7. **Evaluation coverage:** ≥ 30 active demo jobs carry a complete `evaluation` block (all four numeric dimensions, `overall`, `verdict`, `key_strengths`, `gaps`); their `fit` is consistent with `overall`/`verdict`.
8. **Application coverage:** ≥ 15 demo applications; ≥ 6 distinct `ApplicationStatus` values; ≥ 8 with notes; ≥ 8 with `cv_file`/`cover_letter_file`; every application resolves to a demo job.
9. **Retention coherence:** `/api/public/retention` numbers reconcile mathematically (total_seen = file total; active + stale + protected = active-pool total; `protected_count` = application-linked count).
10. **Schema + integrity tests green:** the new `test_demo_data.py` suite (§9 items 1–7) and the extended `test_security_boundary.py` all pass; 206-test anchor baseline stays green.
11. **Deterministic & safe:** regeneration of the corpus is byte-stable; zero runtime dependencies or network calls; leak-safety invariant test green.
12. **No runtime toggle / structural boundary unchanged:** no `demo=true` switch introduced; `public.py` still imports only the demo store; `git diff` on `public.py`, `demo.py`, `demo_store.py`, `main.py`, and all auth/config files is empty for P4's dataset work.

---

## 11. Implementation Plan (NEXT CHECKPOINT ONLY)

This section plans only the immediate next checkpoint. Everything after is one-line scope notes to be expanded by their own checkpoints.

### Checkpoint P4-I1 — Corpus + generator (the next checkpoint)

1. Author the **fictional seed table** (hand-written, reviewed): ~8 fictional companies + ~20 role archetypes (titles within candidate target sectors; descriptions, strengths/gaps, verdict vocabulary, salary bands, priority tiers). Fictionalize the "AWS Partner Network" company name. Keep all URLs on `example.com/jobs/demo-<id>`.
2. Add `backend/scripts/generate_demo_dataset.py` (stdlib-only, deterministic seed): expands archetypes → 50 active + ~6 peripheral records; stamps coherent dates relative to generation time; computes `stable_id`/`fingerprint`; writes applications with verified `company|title` links; writes checkpoints from generated totals; self-asserts the A–F distributions and enum validity before writing.
3. Regenerate and commit all three `backend/demo_data/*` files with the new corpus; review the diff for realism and safety (no PII, no real companies/URLs).
4. Add `backend/tests/test_demo_data.py` (§9 items 1–7); extend `test_security_boundary.py` with corpus-count assertions (§9 item 8).
5. Run focused suites + 206-test anchor baseline (reduced-verification principle; pytest from `backend/`, absolute Python per repo convention).
6. Confirm the A–F exit criteria (items 1–12 of §10) are satisfied; write the P4 implementation report.

### Later checkpoints (scope notes only — NOT planned now)

- P4-I2 — public demo UI page wiring (maps public endpoints to a portfolio page; frontend work; separate checkpoint).
- P4-I3 — reconciliation of the tracker `fit_rating` scale (1–5 vs 0–100) across the frontend display.
- P4-I4 — refresh process/rotation for the 28-day window over time (regeneration cadence or CI freshness).

---

## 12. Risks / Limitations

- **Date drift:** the 28-day active window is evaluated live against wall-clock time. A committed corpus ages stale within ~a month unless regenerated; the recommended generator makes regeneration cheap but someone must run it. Without a cadence, the public site silently empties (active_pool_count → 0 for non-protected jobs). Mitigation: application-protected records survive, and regeneration is a one-command deterministic operation.
- **Unwired frontend:** the SPA does not consume `/api/public/*` (§4). A bigger corpus improves the API surface and backend realism but produces no UI change until the demo page is built (deferred). Expectation-setting is required at the P4 release gate.
- **Authoring drift (the leak risk):** copying real postings/tracker rows into demo files is the one realistic way to leak data. Mitigated by the structural no-intersection test, but tests only catch committed content — review discipline is still required.
- **Scale inconsistency:** demo `fit_rating` is 1–5 while the frontend renders `/100`; unaddressed, it produces a misleading "Your Fit Rating" in JobDetail. Deferred to P4-I3 but flagged because new application seeding inherits the mismatch.
- **Real-world name adjacency:** "AWS Partner Network" (demo-006) and real portal brand names appear in the current corpus. The former should be fictionalized (fabrication-adjacent realism); the latter is acceptable as a benign source tag but should never be expanded into real postings.
- **Silent-degradation by design:** the store's checkpoint parser silently skips malformed entries (`except Exception: pass`), so a bad checkpoint degrades the demo without an error — validation in the generator and schema tests are the control.
- **No runtime safety net:** demo data is trusted static content; there is no runtime validation layer between the JSON and the Pydantic coercion beyond the store's defensive fallsafe (which hides, rather than reports, bad data).

---

## 13. Explicitly Deferred

- **Public/portfolio demo UI page** that actually renders `/api/public/*` (frontend wiring, routing, styling) — a separate checkpoint; nothing in P4-I1 changes the SPA.
- **Demo authentication/accounts** (e.g. a "try the demo" role with seeded private data so the *private* surfaces can be showcased) — not part of the demo *dataset* boundary; large surface, separate decision.
- **Runtime demo database or runtime seed writes** — explicitly rejected; demo remains static committed files, structurally isolated, with no `demo=true` toggle.
- **Auto-refresh / CI freshness for the 28-day corpus window** (§12 item 1) — operational concern beyond dataset authoring.
- **Frontend `fit_rating` scale reconciliation** — tracked, deferred to its own checkpoint.
- **Scraper, portal, or search changes; deployment/Docker; scheduler; authentication changes; dashboard redesign** — each already excluded by phase scope and remain so.

---

## Appendix — Files Inspected (read-only)

**Backend**
- `backend/app/demo_store.py` — DemoDataStore, load paths, active-pool/retention logic, singleton + cache invalidation.
- `backend/app/routers/public.py` — public plane, structural isolation.
- `backend/app/routers/demo.py` — status/bootstrap/reset/retention.
- `backend/app/main.py` — router registration order, lifespan, production-config validation, shutdown invalidation.
- `backend/app/config.py` — environment/settings, `DATA_DIR`, `ACTIVE_POOL_STATES`, `STALE_JOB_DAYS`, `verify_data_files()`.
- `backend/app/models/schemas.py` — JobRecord/JobSummary/ApplicationRecord/Evaluation/PipelineCheckpoint/PipelineStatus shapes.
- `backend/demo_data/demo_seen_jobs.json`, `backend/demo_data/demo_checkpoints.json`, `backend/demo_data/demo_tracker.csv` — the corpus itself.
- `backend/tests/conftest.py`, `backend/tests/test_security_boundary.py`, `backend/tests/test_production_surface.py` — existing demo/public coverage.
- `backend/tests/test_session_security.py`, `backend/tests/test_config.py` (+ P3.4 report) — prior-phase context, no demo relevance.

**Frontend**
- `frontend/src/api/client.ts`, `frontend/src/api/endpoints.ts`, `frontend/src/api/types.ts` — client methods and types.
- `frontend/src/context/DemoModeContext.tsx`, `frontend/src/components/layout/DemoModeBanner.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/layout/Header.tsx`, `frontend/src/components/layout/Layout.tsx` — demo-mode wiring.
- `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/JobDetail.tsx`, `frontend/src/pages/FitAnalysis.tsx` — data-bearing consumers.
- `frontend/src/hooks/useJobs.ts`, `frontend/src/hooks/useJob.ts`, `frontend/src/hooks/useRankedJobs.ts` — endpoint targets (confirmed private).

**Repo-level**
- `.gitignore`; `git ls-files` for `backend/demo_data` and demo modules (all tracked; demo dir not ignored); repo-wide write-path scan (no writes to `backend/demo_data/`).