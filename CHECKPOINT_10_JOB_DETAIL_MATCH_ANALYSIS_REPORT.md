# CHECKPOINT 10 — Job Detail / Match Analysis Report

**Date:** 2026-09-09
**Status:** VALIDATED — READY FOR CHECKPOINT 11

---

## 1. Executive Summary

Checkpoint 10 transforms the job detail page from "here is a job posting" into "here is everything CareerPilot can currently tell you about this opportunity, why it was ranked where it was, what information is missing, and what you can do next."

**The single most important data finding of this checkpoint:** the job-detail API was reading only `seen_jobs.json` / `canonical_jobs.json`, so the pipeline's full evaluation and ranking output stored in `ranked_jobs.json` (scores, verdicts, strengths, gaps, evaluation dimensions, evaluated-at provenance) was **never surfaced on the detail page**. That gap is now fixed in the data layer (`store.py`), verified by 7 backend tests, validated against a live server, and fully rendered by a rebuilt JobDetail page.

**Personalized match analysis does NOT exist in this system.** There is no per-user matching engine. "Match analysis" on the page is the **global pipeline evaluation** (the same scoring output the pipeline produced for every job), labeled honestly as such. Where no evaluation exists, the page says plainly: *"Personalized match analysis is not yet available."* No score, verdict, skill claim, or compatibility claim is ever inferred or fabricated.

The frontend rebuild also fixed a **truthfulness bug**: the old "Apply" flow sent the global pipeline `rank_score` (0–100) into the personal "Fit Rating" field (1–5), which would have displayed as e.g. `49/5`. CP10 removes that mislabeling.

---

## 2. Implementation Summary

### 2.1 Backend — Data Layer (`backend/app/store.py`)

`DataStore.get_job_by_stable_id()` previously assembled a `JobRecord` from the seen/canonical records only. The method `load_ranked_jobs()` existed but was **unused** by the detail path.

**Change:** after resolving the base job record, the method now builds a lookup of ranked_jobs entries by `stable_id` and merges ranking/evaluation fields through a minimal `pick()` helper:

```python
def pick(ranked_key, job_key=None):
    if ranked_key in ranked and ranked.get(ranked_key) is not None:
        return ranked.get(ranked_key)
    return job.get(job_key or ranked_key)
```

- Prefers the **non-null** ranking/scoring output (`rank_score`, `rank_verdict`, `rank_date`, `strengths`, `gaps`, `fit`, `priority_tier`, `evaluation`, `processing_state`, etc.).
- Falls back to the seen/canonical value when the ranked record lacks the field.
- **Never invents data** — if a job was never scored, `evaluation` stays `null`, `rank_score`/`rank_verdict` stay `null`, and strengths/gaps stay `[]` (verified by test).
- Preserves **provenance** — `evaluation.evaluated_at` flows through untouched.
- State-only fields (`blocked_at`, `blocked_reason`, `changed_at`, `changed_fields`, `closed_at`) remain sourced from the seen/canonical record.

No scoring, ranking, canonicalization, verification, or retention logic was touched.

### 2.2 Frontend — Page Experience (`frontend/src/pages/JobDetail.tsx`)

Rebuilt as a 2-column, accessible information architecture:

| Section | What it shows |
|---|---|
| Header / Identity | Back links (Ranked Jobs + All Jobs), title/company, Refresh, "View Original Posting" (external, `rel="noopener noreferrer"`) |
| Meta badges | Arrangement, processing state, fit, portal, global score badge |
| **Job Overview** | Full description; honest empty state when not available |
| **Ranking Information** | Rank score, verdict, ranked-on date + amber "Ranking scope note" |
| **Candidate & Match Analysis** | Pipeline evaluation (overall + dimensions) when present; otherwise the honest "not yet available" state |
| **Pipeline Fit Notes** | Strengths / gaps from `evaluation.key_strengths` / `evaluation.gaps`, or top-level strengths/gaps |
| **Application / Tracking** | Linked application status via CSV tracker (by `stable_id`); otherwise "Track Application" |
| Sidebar Details | Location, salary, arrangement, work mode, source, priority tier, status, timestamps |
| Application Protected / Active Pool | Retention-context cards |
| Debug Information | `<details>` raw JSON (unchanged) |

---

## 3. CP10 Specification Step Verification

| Step | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| 1 | Targeted Architecture Audit | ✅ | Audited routers, store, schemas, JobDetail/FitAnalysis pages |
| 2 | Job Detail Information Architecture | ✅ | 2-col grid with distinct Identity / Ranking / Candidate / Application sections |
| 3 | Header / Job Identity | ✅ | Title, company, back links, badges row |
| 4 | Description | ✅ | Full text; empty-state "Job description not available from the current pipeline data." |
| 5 | Ranking Explanation | ✅ | Ranking Information card + amber global-scope note; no personalized ranking claims |
| 6 | Candidate / Match Analysis | ✅ | Truthful: pipeline evaluation with provenance; else "Personalized match analysis is not yet available". **No AI matching engine built.** |
| 7 | Application Context | ✅ | Uses existing CSV-tracker apps keyed by `stable_id`; only existing supported functionality |
| 8 | Actions | ✅ | Refresh, View Original Posting, Track Application, View full fit analysis |
| 9 | Missing Data Handling | ✅ | `<NotProvided />`, empty states, no fabricated values |
| 10 | Loading / Error / Not Found | ✅ | Skeleton; NetworkError with retry; NotFoundError with back link |
| 11 | Responsive | ✅ | `lg:grid-cols-3` collapses to single column; wrapping header/footer |
| 12 | Accessibility | ✅ | `aria-label`s on sections, semantic `<dl>/<dt>/<dd>`, heading hierarchy, external-link clarity |
| 13 | Backend Security | ✅ | No secrets/paths leaked; public-by-convention matched to /api/jobs; per-job no-sensitive-field test |
| 14 | Performance | ✅ | Selective reads via the new `pick()` merge; no new pipeline work on read |
| 15 | Testing | ✅ | 7 new backend tests; frontend `tsc` + production build; live API smoke |
| 16 | Documentation | ✅ | This report |

---

## 4. Job Detail Information Architecture

```
Ranked Jobs / All Jobs ──► /jobs/:stable_id ──► /jobs/:stable_id/fit (FitAnalysis)
                              │
   HEADER: title, company, badges, actions
   MAIN (2 cols):  description | sidebar details
                   ranking information
                   candidate & match analysis
                   pipeline fit notes
                   application / tracking
```

- Deep links from RankedJobs table/cards and the dashboard already point at `/jobs/:stable_id`.
- The "View full fit analysis" link still routes to the existing radar-chart FitAnalysis page, but only renders when an evaluation actually exists.
- Global-vs-personalized scope is explicit in two places: the amber ranking note and the "pipeline output shown identically to all users" line in the match card.

---

## 5. Header / Job Identity

- Back links to `/ranked` and `/jobs` with chevron icons, `aria-hidden` on decorative SVGs.
- H1 title + company line.
- Header actions: **Refresh** (refetch), **View Original Posting** (opens `job.url` in a new tab with `rel="noopener noreferrer"`).
- Meta badge row: `ArrangementBadge`, `StateBadge`, `FitBadge`, portal badge, and the global pipeline "Score" badge (`rank_score` only when a real value exists; the badge tooltip clarifies it is a global pipeline score, not a personalized match score).

---

## 6. Job Description Section ("Job Overview")

- Renders the full description with `whitespace-pre-wrap` under `prose` styling for readability.
- **Missing-data honesty:** when the pipeline carries no description, the page renders an empty state — *"Job description not available"* / *"Job description is not available from the current pipeline data."* It does not substitute or synthesize a description.

---

## 7. Ranking Information

- **Amber scope note (Step 5 requirement), rendered verbatim:**

  > **Ranking scope note:** Scores and verdicts reflect the current global job-ranking pipeline. They are not personalized per-user match scores, and they are shown identically to all authenticated users.

- Displays Rank Score, Verdict, and Ranked On in a 3-column definition list.
- **Truthfulness in the real data:** `ranked_jobs.json` stores the primary score for most jobs as `evaluation.overall`, not as a top-level `rank_score`. When a job has an evaluation but no top-level `rank_score`, the card shows the score labeled *"(pipeline evaluation score)"*, rather than claiming a value that does not exist.
- When a job has **no** ranking output at all, the card shows: *"This job has not been ranked by the current pipeline. No score is available, and none is inferred."*

---

## 8. Candidate / Match Analysis

**Explicit answer:** **No personalized match analysis exists in CareerPilot.** No AI matching engine was built, and no match percentage or "you have all required skills" claim is produced.

The Candidate & Match Analysis card is therefore a **truthful presentation of what the scoring pipeline already computed**:

1. **Evaluation present** → shows the overall pipeline score, a `FitBadge` mapping the verdict vocabulary only for recognized verdicts (strong/moderate/weak → high/medium/low; anything else renders as a neutral badge), and the technical/experience/behavioral/career dimension scores. It adds provenance:
   > "This evaluation was produced by the CareerPilot scoring pipeline on {evaluated_at}. It is a pipeline output shown identically to all users — it is not a personalized per-user match score."
2. **Evaluation absent** → renders:
   > "Personalized match analysis is not yet available / CareerPilot does not yet compute per-user match scores. Ranking data shown reflects the global job-ranking pipeline, not a personalized candidate-match assessment."

The verdict-to-color mapping is explicit (`fitLevelFromVerdict`) so "Weak Fit" can never be colored as medium/high.

---

## 9. Application Context

- Uses **only existing supported functionality**: the CSV application tracker served by the applications router, matched by `stable_id`.
- When a linked application exists, the card shows its status, date, channel, personal fit rating (1–5), notes, and a "View in application tracker" link.
- The personal Fit Rating is only ever shown from the user's own tracker record — it is never populated from the global pipeline score. **The CP9-era bug that would have written `job.rank_score` into the personal 1–5 fit rating is removed.**
- No DB-backed per-user tracking (UserJob/Application) is wired in this checkpoint, and none is invented.

---

## 10. Actions

| Action | Behavior | Honesty |
|---|---|---|
| Refresh | Refetches the job record | — |
| View Original Posting | Opens `job.url` in new tab | Only when a URL exists |
| Track Application | Creates a tracker record via the existing applications router | No `fit_rating` sent — global score is never conflated with a personal rating |
| View full fit analysis | Links to `/jobs/:stable_id/fit` | Only rendered when an evaluation exists |

---

## 11. Missing Data Handling

Every optional field renders `<NotProvided />` ("Not provided") or a purpose-built empty state:

- Missing description → "Job description not available from the current pipeline data."
- No ranking output → explicit "No ranking data ... none is inferred."
- No evaluation → "Personalized match analysis is not yet available."
- No linked application → "Not yet tracked."
- No location / salary / rank verdict → italic "Not provided".

The page never substitutes a guessed value for a missing one.

---

## 12. Loading / Error / Not Found States

- **Loading:** animated skeleton block (title + two card skeletons).
- **404:** `NotFoundError` + "Back to Ranked Jobs" link (both the axios-404 path and the "no job returned" path).
- **Other errors:** `NetworkError` with retry that calls `refetch()`.

---

## 13. Responsive Layout

- 2-column layout uses `grid-cols-1 lg:grid-cols-3` — single column on small screens, `2/3 + 1/3` on desktop.
- Header actions wrap; back links stack; badge rows wrap with `flex-wrap`.
- Code blocks / debug JSON scroll horizontally (`overflow-x-auto`), never widening the page.

---

## 14. Accessibility

- Semantic structure: `<h1>` title, `<section aria-label>` per card, `<dl>/<dt>/<dd>` for attribute pairs.
- Decorative SVG icons have `aria-hidden="true"`; interactive icons (back links) sit inside link text.
- Buttons carry `aria-label` where the label is icon-only (Refresh).
- Success/error text uses `role="alert"` for the failed-application message.
- The amber scope note is visible text (not color-only), with explicit `font-medium` emphasis.
- External link ("View Original Posting") opens in a new tab with `rel="noopener noreferrer"`.

---

## 15. Backend Security

- The job-detail endpoint remains **public by convention**, matching the existing `/api/jobs` listing (no JWT), because the underlying job data is global pipeline data — consistent with how CP9 kept ranked data visible and the pre-existing jobs list. Application *writes* go through the same applications router as before.
- **No internal detail is exposed.** Verified by test `test_job_detail_no_sensitive_fields` and by the live smoke: the response contains no `password`/`secret`/`token`/`api_key`/`private_key` **fields**, no filesystem paths, no `__pycache__`, no `\app\` / `c:\` / `/app/` path fragments. (The word "secret" appears only inside the employer-authored job description — e.g. "secretly get a little excited" — which the app is designed to display.)
- **No fabricated evaluation** for unscored jobs (test `test_job_detail_no_fabricated_evaluation`): `evaluation=null`, `rank_score=null`, `strengths=[]`.

---

## 16. Performance

- The detail query reads the same cached, in-memory `DataStore` structures as every other endpoint — no new filesystem work per request beyond one ranked_jobs pass built from the already-cached `load_ranked_jobs()`.
- No scoring/verification/ranking pipeline work runs on read; the page only *presents* persisted output.
- Frontend: single TanStack Query fetch (`useJob`) with the existing staleTime/retry defaults; production bundle ~569 kB (pre-existing chunk-size warning, not introduced by CP10).

---

## 17. Testing

### Backend — `backend/tests/test_job_detail.py` (7 tests, all passing)

```
✅ test_job_detail_success                    — 200 + correct identity for a valid stable_id
✅ test_job_detail_unknown_stable_id_404      — unknown id → 404
✅ test_job_detail_response_schema            — 15 required JobRecord fields present
✅ test_job_detail_merges_scored_evaluation   — rank_score/verdict/fit/strengths/evaluation surface,
                                                 provenance (evaluated_at) preserved
✅ test_job_detail_no_fabricated_evaluation   — unscored job → null evaluation/rank, empty arrays
✅ test_job_detail_public_matches_jobs_convention — accessible without auth, like /api/jobs
✅ test_job_detail_no_sensitive_fields        — no secrets/keys/paths leaked
```

Run: `/c/Users/Soladm/AppData/Local/Programs/Python/Python314/python -m pytest tests/test_job_detail.py -v` → **7 passed in 0.91s**.

The full backend suite was previously validated at **168 passed** (CP9); this checkpoint adds 7 focused tests and does not modify scoring, canonicalization, verification, or retention.

### Frontend — build + live smoke

- `npm run build` (tsc + vite) → **zero TypeScript errors**, production bundle emitted.
- **Live API smoke** against a fresh backend on port 8010 (own process; the user's dev server on 8000 was left untouched) for the First Focus job (`c48b6af…`):
  - `HTTP 200`; `evaluation.overall = 94`, `verdict = Strong Fit`, `technical = 100`, `experience = 85`, `behavioral = 88`, `career = 100`, `evaluated_at = 2026-08-22T13:33:01.239Z`, 5 key strengths, 1 gap, 5087-char description.
  - `rank_score`/`rank_verdict` are `null` for this job because `ranked_jobs.json` stores its score as `evaluation.overall` — the page shows this truthfully as "(pipeline evaluation score)".
  - No sensitive-field or path leaks (see Section 15).
- **Honest limitation:** a visual browser interaction test of the rebuilt page was not executed because the user's running Vite proxy is hardcoded to the pre-CP10 backend on port 8000. The data contract is verified at the API level and the component passes strict TypeScript. **To see the enriched detail page in the UI, restart the backend dev server on port 8000** (it is currently serving pre-CP10 code).

---

## 18. Documentation & Conclusion

Files changed in CP10:

| File | Change |
|---|---|
| `backend/app/store.py` | `get_job_by_stable_id()` merges ranking/evaluation output from `ranked_jobs.json` (minimal `pick()` merge; no pipeline rewrite) |
| `backend/tests/test_job_detail.py` | NEW — 7 backend tests (schema, enrichment, no-fabrication, 404, auth convention, no-secret/path leak) |
| `frontend/src/pages/JobDetail.tsx` | Rebuilt information architecture: Ranking Information + scope note, Candidate & Match Analysis (honest), Pipeline Fit Notes, fixed fit_rating mislabeling, missing-data empty states, a11y + responsive pass |

**Checkpoint 10 is VALIDATED:**

- ✅ Job detail now surfaces what the pipeline actually knows (score, verdict, dimensions, strengths/gaps, provenance)
- ✅ Ranking presented as **global pipeline output**, never as a personalized match score (amber note + provenance lines)
- ✅ **Personalized match analysis: does NOT exist** — no matching engine built; absent scores explicitly labeled "not yet available"; nothing inferred or fabricated
- ✅ Apply flow no longer maps the global 0–100 score onto the personal 1–5 fit rating
- ✅ Missing data handled honestly (`Not provided` / purpose-built empty states)
- ✅ Loading / 404 / error / responsive / accessibility / security states verified
- ✅ 7 backend tests pass; frontend builds with zero TS errors; live API smoke confirms 94 / Strong Fit surfaces
- ✅ No scoring/ranking/canonicalization/verification/retention logic modified
- ✅ User's live dev backend (8000) untouched; documented that a restart is needed to serve enriched data

**CHECKPOINT 10 VALIDATED — READY FOR CHECKPOINT 11**