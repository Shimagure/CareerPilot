# P4 — Deterministic Expanded Public Demo Dataset — Implementation Report

**Baseline commit:** `ad3eb9e` — `feat(security): harden sessions and production invariants` (P3.4)
**Status:** Implemented, tested, single commit prepared (see §10)
**Scope:** P4 Demo Dataset only. **No** P5 deployment, P6 automation, P7 UX polish, P8 portfolio/GitHub, or P9/P10 launch work was started.

---

## 1. Baseline

Before P4, the public demo plane (`/api/public/*` → `DemoDataStore` → `backend/demo_data/*`) carried a hand-written corpus of **8** jobs (`demo-001`..`demo-008`), **4** applications, and a checkpoints file with **1** current + **1** history run. The full backend suite stood at **538 passed** at baseline (`ad3eb9e`).

The P1 public/private boundary was already structurally sound (verified in the P4 scope assessment): `public.py` imports only `demo_store`, `demo_store.py` opens the three demo files strictly read-only, reset only invalidates the demo cache, and there is no runtime `demo=true` toggle. P4 therefore required **zero changes** to `public.py`, `demo.py`, `demo_store.py`, `main.py`, or any auth/config file — verified by `git diff` staying empty for those files (exit criterion 12).

---

## 2. Implementation

1. **`backend/scripts/generate_demo_dataset.py`** (new, ~900 lines) — Python-stdlib-only, deterministic generator.
   - **Fictional seed table:** 20 hand-authored fictional archetypes (8 pre-existing demo companies preserved as `demo-001`..`demo-008`; 12 new fictional companies across candidate target sectors: IT Services, BPO, Cloud, Data Center, Cybersecurity, Telco, Media, FinTech, Logistics, Healthcare IT).
   - **Expansion:** each archetype is expanded via a deterministic prefix rotation and 1–4 variants to exactly **56** records (`variant_counts = [1]*8 + [4]*12`), assigned to a fixed 56-slot state layout.
   - **All randomness seeded:** every `random.Random(sha256(f"{GENERATOR_VERSION}|{corpus_date}|<salt>"))`; all timestamps relative to `corpus_date`; no `random.choice` without a seeded RNG.
   - **No real data reads:** only the SEED table in the file. Never opens `careerpilot.db`, `job_scraper/*`, `canonical_jobs.json`, `ranked_jobs*.json`, real tracker, profile, resumes, cover letters, portal health, credentials, or environment.
   - **Self-validating before writing** (raises `SystemExit`, writes nothing on failure): all MIN_* corpus targets, valid state/arrangement/fit/status enums, evaluation completeness and fit-band consistency, application reference resolution, note/doc coverage, stable-id uniqueness, and a forbidden-marker leakage scan over the serialized corpus.
   - **Outputs:** exactly the three demo files (JSON `{"demo_meta", "seen"}` wrapper, CSV tracker with explicit `stable_id` column, checkpoints with `current_checkpoint` + run_history). No caches, no temp files, no bytecode.
2. **`backend/demo_data/demo_seen_jobs.json`** (regenerated) — 56 records.
3. **`backend/demo_data/demo_tracker.csv`** (regenerated) — 16 applications.
4. **`backend/demo_data/demo_checkpoints.json`** (regenerated) — 1 current + 2 history runs.
5. **`backend/tests/test_demo_data.py`** (new) — 19 focused P4 tests (13 test methods across 13 classes, §7.1).
6. **`P4_DEMO_DATASET_SCOPE_ASSESSMENT.md`** — carried from the read-only scope phase; committed with P4.

No runtime architecture change: the runtime path remains `/api/public/*` → `DemoDataStore` → `backend/demo_data/*`. The generator is a dev/build-time tool only; no service loads generated files directly.

---

## 3. Final Corpus (exact counts)

### Jobs — `demo_seen_jobs.json` (56 records, `demo-001`..`demo-056`)

| State | Count |
|---|---|
| `ACTIVE_VERIFIED` | 38 |
| `ACTIVE_UNVERIFIED` (all `blocked_reason: http_403`) | 5 |
| `CHANGED` | 4 |
| `POSTING_CHANGED` | 3 |
| `STALE` | 2 |
| `CLOSED_OR_EXPIRED` | 2 |
| `NEEDS_VERIFICATION` | 1 |
| `DUPLICATE_OR_INVALID` | 1 |
| **Total** | **56** |

- **Active pool:** 38 + 5 + 4 + 3 = **50** (≥50 target).
- **Peripheral:** 2 + 2 + 1 + 1 = **6** (≥6 target).
- **Distributions (active 50):**
  - Arrangement: remote **14**, hybrid **18**, onsite **18** (each ≥10).
  - Fit: high **18**, medium **20**, low **7**, unknown **5**.
  - Portal: linkedin **14**, jobstreet **16**, indeed **14**, kalibrr **6** — 4 distinct portals, max share 32% (≤40%).
- **Evaluations:** **50** records carry a complete `evaluation` block (technical/experience/behavioral/career, `overall`, `verdict`, `key_strengths`, `gaps`, `recommendation`, `evaluated_at`) — all 50 active records (≥30 target). Fit/`overall` internally consistent: high-fit `overall` ∈ [74,100], medium ∈ [58,100], low < 74. `ACTIVE_UNVERIFIED` records intentionally have no `last_verified` (never live-verified); `CHANGED`/`POSTING_CHANGED` records carry `previous_fingerprint` + `fingerprint` pairs.
- **Ranking:** `rank_score` spread 92 → 43 (active, descending) with a believable top-weighted distribution (median 65); 18 high-fit records cluster at the top with realistic variation; `rank_verdict` reuses each record's evaluation verdict.
- **From `/api/public/status` today:** `is_demo_mode: True`, 50 active within the 28-day window, 5 blocked (`http_403`), state_distribution = table above.

### Applications — `demo_tracker.csv` (16 rows)

| Status | Count |
|---|---|
| draft | 2 |
| submitted | 3 |
| under_review | 3 |
| interview | 3 |
| offer | 1 |
| accepted | 1 |
| rejected | 2 |
| withdrawn | 1 |
| **Total** | **16** |

- **8 distinct statuses** (≥6 target); all from the existing `ApplicationStatus` vocabulary the frontend renders.
- **16 apps with notes** (≥8 target); **13 with `cv_file` + `cover_letter_file` metadata** (≥8 target) — metadata filenames only (`cv_<company>_<role>.pdf`), no actual files, never `cv/main*` / `cover_letters/*` / `resumes/*`.
- **Every `stable_id` resolves** to a job record (`demo-001`..`demo-016`); `fit_rating` is 0–100 to match the frontend's `/100` rendering.

### Checkpoints — `demo_checkpoints.json`

- `current_checkpoint`: run `20260912-000000`, stage `ranking_report`, status `complete`, 56 jobs, 12 batches, `passed 52`, `deprioritized 1`, `queue_length 50`, `verified 38`, `blocked 5`, `changed 7`, `closed 2`, `tier_breakdown` from active priority tiers, `top5_count 5`, `top10_count 10`.
- `run_history`: 2 prior runs (40 jobs / 8 jobs) — coherent incremental history.
- Counts reconcile with the corpus derivation (verified/changed/closed/active all match the generated records).

---

## 4. Determinism

- **Byte-stable regeneration:** two fresh runs with the same `GENERATOR_VERSION` + corpus date into separate directories produced identical bytes for all three files (`diff -r` clean; sha256 equal).
- **Source-value reproducibility (not snapshot equality):** `test_demo_data.py` re-runs the generator as a subprocess and asserts the fresh output is **byte-identical to the committed files** — the committed corpus is provably reproducible from the generator at HEAD.
- All randomness flows through `random.Random(sha256(f"{GENERATOR_VERSION}|{corpus_date}|<salt>"))`; all dates derive from `corpus_date` (`--corpus-date`, default `2026-09-12`); JSON written with fixed key order (`sort_keys=False` for the jobs file where insertion order is deterministic; `sort_keys=True` for checkpoints); CSV with fixed field order and `\n` line terminators. No wall-clock, no network, no filesystem enumeration feeds the output.

---

## 5. Data Safety

The demo plane remains **structurally isolated and entirely fictional**:

- **No real data sourced:** the generator reads nothing; the corpus derives only from the hand-authored SEED table. It never opens the real SQLite DB, real `job_scraper/` artifacts, `canonical_jobs.json`, `ranked_jobs*.json`, the real tracker, candidate profile, resumes, cover letters, private portal-health data, or credentials.
- **Leakage scan (deterministic, content-level):** all three files were scanned case-insensitively for real-candidate markers (solaire, bulacan, san ildefonso, light.jukes), real email domains (@gmail, @outlook), real artifact paths (`careerpilot.db`, `job_scraper/`, `canonical_jobs`, `ranked_jobs`, `seen_jobs`, `job_search_tracker`, Windows paths, `/users/`, `uploads/resumes`), and secret patterns (`eyj0`/JWT, `sk-`, `api_key`, `secret`, `password`, `bearer`) — **zero matches**.
- **All 56 job URLs are `https://example.com/jobs/demo-<id>`** (verified by extraction); no other origin appears.
- **No emails or phone numbers anywhere** in the corpus.
- **No runtime toggle, no fallback:** public routes serve only the demo store; a missing demo file returns `{}`/empty — never the real store. `/api/demo/reset` invalidates the demo cache **only**; `invalidate_store_cache()` is not called.
- Boundary test `test_public_endpoints_no_fallback_to_real_data` asserts responses carry only `demo-\d{3}` stable-ids, `is_demo_mode: True`, and no candidate PII.

---

## 6. Frontend Compatibility

- **No frontend files changed** (`git diff HEAD -- frontend/` is empty) — exit criterion 12.
- The frontend consumes the data through the existing `/api/public/*` shape, which is unchanged; the corpus is schema-exact with `JobRecord` / `JobSummary` / `PipelineStatus` (no field aliases in the models).
- FitAnalysis UI (technical/experience/behavioral/career + strengths/gaps/recommendation) is fed by the 50 complete evaluation blocks; the Applications view's status vocabulary and the job detail `/100` fit_rating rendering are both covered by the corpus.
- `npm run build` (tsc -b + vite build): **passes** (only pre-existing chunk-size/`__dirname` warnings).
- `npm test` (vitest run): **8 files / 53 tests passed**.
- `npm run lint` (oxlint): reports **5 errors / 40 warnings, all pre-existing in head-tracked files** (`Profile.tsx`, `Search.tsx`, `Preferences.tsx`, etc.) — none in any file P4 touches, and none introduced by P4. Per the reduced-verification principle and the no-UI-change scope, these are documented as pre-existing and not fixed here.

---

## 7. Backend / Regression Verification

### 7.1 Focused P4 suite — `tests/test_demo_data.py` — **19 passed**
1. Min corpus counts (≥56 records, ≥50 active, ≥6 peripheral, ≥15 apps)
2. State distribution (AV≥35, AU≥4, CH≥3, PC≥3; only valid enum states; valid arrangement/fit)
3. Evaluation coverage & fit-consistency (≥30 complete; high 74–100, medium ≥58, low <74)
4. Application count, status vocabulary (≥6 distinct, valid), fit_rating 0–100
5. Application references resolve (every `stable_id` maps to a job; company/role populated)
6. Application metadata coverage (≥8 notes, ≥8 cv+cl metadata; metadata-only filenames)
7. Stable IDs unique + all URLs fictional (`demo-\d{3}`, `example.com`)
8. **Generator determinism** — regeneration byte-stable AND matches committed files (source-value, not snapshot)
9. No private-data references (forbidden-marker scan over all three files; only `example.com` URLs)
10. Public endpoints serve the expanded corpus (status/is_demo_mode + state_distribution, `/jobs/active` returns the recomputed active set, retention reconciles math, job detail includes evaluation, pipeline current_checkpoint `20260912-000000`)
11. Public endpoints never fall back to real data (responses contain only demo stable-ids; `/health/portals` marks is_demo_mode)
12. Demo reset still works (authenticated; demo-cache-only; corpus unchanged after reset; unauthenticated reset → 401)
13. Public/demo planes schema-compatible (identical active sets across `/api/public` and `/api/demo`; `JobRecord` field surface exercised)

All static-keyed assertions read the committed files (wall-clock independent); active-pool membership tests recompute the 28-day/application-protection rule from the files rather than hard-coding counts, so they stay correct as the corpus ages.

### 7.2 Regression anchors + full suite
- Anchor suites: `test_security_boundary.py` + `test_production_surface.py` + `test_config.py` → **93 passed** (26.9s).
- **Full backend suite: 557 passed** (395.4s) — includes the 19 new P4 tests and every P1/P2/P3 suite; zero failures. (Baseline at `ad3eb9e` was 538 passed; the +19 is exactly the P4 demo suite.)

Commands (per repo convention, `pytest` from `backend/`, absolute Python path):
```
cd backend
"C:/Users/Soladm/AppData/Local/Programs/Python/Python314/python.exe" python -m pytest tests/test_demo_data.py -q          # 19 passed
"C:/Users/Soladm/AppData/Local/Programs/Python/Python314/python.exe" python -m pytest tests/test_security_boundary.py tests/test_production_surface.py tests/test_config.py -q   # 93 passed
"C:/Users/Soladm/AppData/Local/Programs/Python/Python314/python.exe" python -m pytest -q                                    # 557 passed
```

---

## 8. P4 Exit Criteria — PASS/FAIL (all PASS)

| # | Criterion | Result |
|---|---|---|
| 1 | ≥50 active-pool jobs; ≥6 peripheral records | **PASS** — 50 active; 6 peripheral (2 STALE, 2 CLOSED, 1 NV, 1 DUP) |
| 2 | At generation/test time `active_pool_count ≥ 45` within 28-day window | **PASS** — all 50 within the window (corpus dated 2026-09-12) |
| 3 | Arrangement mix (A): remote/hybrid/onsite each ≥10 among active 50 | **PASS** — 14 / 18 / 18 |
| 4 | Source mix (B): ≥4 portals, each ≥5, none >40% | **PASS** — 4 portals, min 6, max 32% |
| 5 | Fit mix (C): high ≥15, medium ≥15, low ≥5, unknown ≥1 | **PASS** — 18 / 20 / 7 / 5 |
| 6 | State coverage (D): AV≥35, AU≥4 (all http_403), CH≥3, PC≥3, STALE≥1, CLOSED≥1 | **PASS** — 38 / 5 (all http_403) / 4 / 3 / 2 / 2 |
| 7 | ≥30 complete evaluations; fit consistent with overall/verdict | **PASS** — 50 complete; band-consistent (tested) |
| 8 | ≥15 apps; ≥6 statuses; ≥8 notes; ≥8 cv/cl metadata; all resolve | **PASS** — 16 / 8 / 16 / 13 / all resolve |
| 9 | Retention reconciles: total_seen = file total; active + stale = active-pool total | **PASS** — `total_seen = 56`; `active_pool_count + stale_count = 50` (protected subset included in `active_pool_count`, matching the store's derivation) |
| 10 | Test suite green: `test_demo_data.py` + anchors + baseline | **PASS** — 19 + 93 anchors; full suite 557 passed |
| 11 | Deterministic & safe: byte-stable regeneration; zero runtime deps/network; leak invariant green | **PASS** — verified live + test 8; test 9 green |
| 12 | No runtime toggle; boundary unchanged | **PASS** — no `demo=true`; `git diff` empty for `public.py`, `demo.py`, `demo_store.py`, `main.py`, auth/config files |

---

## 9. Known Limitations

- **Demo age-out:** the corpus is pinned to `corpus_date = 2026-09-12`; public active-pool membership follows the real 28-day retention rule, so the showcase naturally ages and can be refreshed by re-running the generator with `--corpus-date` (committed files stay reproducible). This is deliberate: the production retention implementation is untouched, and the generator is the refresh path.
- **Pre-existing frontend lint findings:** 5 `react-hooks(rules-of-hooks)` errors + 40 warnings exist in head-tracked frontend files (`Profile.tsx` and others) at baseline; P4 does not fix or add to them.
- **Application document metadata is filenames only** — no real CV/cover-letter bytes are included, matching the metadata-only requirement.
- **No portal-health file** is generated; `/api/public/health/portals` continues to echo the store's health info (correct transitive behavior; runtime derivation unchanged).
- **`fit_rating` scale changed to 0–100** in the demo tracker to match the frontend's `/100` rendering (the previous demo used a 1–5 scale).

## 10. Deferred Work (P5+ NOT implemented)

- **P5 (deployment)** — Docker/Kubernetes, deploy pipelines, the existing `PRODUCTION_PUBLIC_LAUNCH_*` docs: **not started**.
- **P6 (automation)** — durable scheduler, scheduling infrastructure: **not started**.
- **P7 (UX polish)** — any UI change: **not started** (frontend of P4 is untouched).
- **P8 (portfolio/GitHub)** — publication, README/portfolio-facing wiring: **not started**.
- **P9/P10 (launch)** — go-live: **not started**.

The commit for this phase contains only the five P4 artifacts (generator, three demo files, `test_demo_data.py`, this report, and the P4 scope assessment), with the exact subject `feat(demo): expand deterministic public demo dataset`.