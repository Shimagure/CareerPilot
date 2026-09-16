---
name: scrape
description: >
  Finds new job postings matching your profile via installed portal-search CLIs
  (LinkedIn, local job boards, and any skills added with /add-portal). Deduplicates
  across runs. Triggers on: job scrape, find jobs, search jobs, new jobs, job search,
  scrape jobs, /scrape
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(bun --version), Bash(bun run .agents/skills/*/cli/src/cli.ts *), WebFetch, WebSearch, Agent, AskUserQuestion
---

# Job Scraper

---

## Master Baseline (MANDATORY)

**Before every search cycle, read and follow `MASTER_JOB_SEARCH_BASELINE.md`** — it is the permanent operating standard for job scraping. It establishes candidate hard filters, search procedure, deduplication rules, live posting verification, fit evaluation standards, anti-fabrication rules, and the standard operating loop (SEARCH → DEDUP → HARD FILTER → LIVE VERIFY → SCORE → RANK → PRESENT → WAIT FOR APPROVAL → GENERATE → VERIFY → USER SUBMITS → UPDATE STATE → NEXT SEARCH).

The pre-search checklist (Section 16) must be silently confirmed before beginning any scrape:
- [ ] Candidate truth loaded/available
- [ ] Permanent CV rules loaded
- [ ] Evaluation framework loaded
- [ ] Tracker checked
- [ ] seen_jobs checked
- [ ] Salary target known
- [ ] Location/work-arrangement preference known
- [ ] Target role families known
- [ ] No-language/No-references CV rule active
- [ ] Certifications + Projects replacement rule active
- [ ] Token-efficient workflow active

---

## INCREMENTAL ARCHITECTURE (PERMANENT)

This skill implements a **session-independent incremental architecture** per `CLAUDE.md`'s "PERMANENT INCREMENTAL JOB SCRAPER ARCHITECTURE" section. Key principles:

1. **All state persisted** in `seen_jobs.json` (job records with `processing_state`, `fingerprint`, `stable_id`, timestamps, scores) and `job_scraper/checkpoints.json` (stage checkpoints)
2. **Cold-start correctness**: A brand-new session produces identical results to a continued session
3. **Default is incremental**: Only `NEW`, `NEEDS_VERIFICATION`, `STALE`, `CHANGED` jobs are processed; `ACTIVE_VERIFIED` ≤5 days old are skipped
4. **Explicit full audit**: User must say "/full-job-audit" or "full audit" to force re-processing everything
5. **Checkpoint at every stage**: Discovery → Canonicalization → Hard Filter → Verification → Scoring → Ranking/Report
6. **Crash recovery**: On any invocation, inspect checkpoints, resume only incomplete work
7. **403 handling**: Record block, retain recent data as `ACTIVE_UNVERIFIED`, retry only per stale policy
8. **Change detection**: Stable identifiers + content fingerprinting on material fields

See `CLAUDE.md` for complete state definitions, transition rules, fingerprint formulas, stale policy, and normal vs full-audit comparison table.

## How It Works

This skill searches job portals using the **installed portal-search CLIs** in
`.agents/skills/` (plus WebSearch as a fallback), using queries from your profile.
It deduplicates against previously seen jobs and the application tracker, and
presents new matches with a quick fit assessment.

## Invocation

The user triggers this skill by saying things like:
- "Find new jobs"
- "Scrape for jobs"
- "Any new positions?"
- "/scrape"

Optional arguments:
- A focus area, e.g. "/scrape data science" or "/scrape geophysics"
- "broad" to run all search categories, e.g. "/scrape broad"
- "health" to run the portal health check only (Step 4.75), without searching, deduplicating, or presenting jobs - e.g. "/scrape health", or "/scrape health jobnet" to probe one portal even if disabled

---

## Execution Steps

### Step 0: Load State & Detect Incremental vs Full-Audit Mode

1. **Determine run mode:**
   - If user explicitly said "/full-job-audit" or "full audit" → `FULL_AUDIT` mode
   - Otherwise → `INCREMENTAL` mode (default)
   
2. **Load persisted state:**
   - Read `job_scraper/seen_jobs.json` (create if missing: `{"seen": {}}`)
   - Read `job_search_tracker.csv` to extract already-applied companies+roles
   - Read `job_scraper/checkpoints.json` (if exists) for crash recovery
   - Read `search-queries.md` (this directory) for the search strategy

3. **Crash recovery (if checkpoints.json exists):**
   - If last stage `complete` → resume at next stage
   - If last stage `in_progress` or `failed` → resume at that stage, reprocessing only incomplete batches
   - Record new `run_id` (YYYYMMDD-HHMMSS) and append prior run to `run_history`

4. **Write initial checkpoint:**
   ```json
   {
     "run_id": "YYYYMMDD-HHMMSS",
     "started_at": "ISO timestamp",
     "mode": "INCREMENTAL|FULL_AUDIT",
     "stage": "discovery",
     "stage_status": "in_progress",
     "jobs_processed_in_stage": 0,
     "total_jobs_in_stage": 0,
     "batch_index": 0,
     "total_batches": 0,
     "last_updated": "ISO timestamp"
   }
   ```

### Step 1: Discovery (Search)

Read `search-queries.md` (this directory) for the search strategy. By default, run the top 3 priority query categories. If the user said "broad", run all categories. If the user specified a focus area (e.g. "data science"), prioritize queries from that category.

**In `FULL_AUDIT` mode:** Scope to last 30 days, run all query categories including broader variants.

**In `INCREMENTAL` mode (default):** Scope to last 14 days, run top 3 priority categories only.

**Use the installed CLI tools as the primary search mechanism**, and run the **supplementary WebSearch sources** from `search-queries.md` proactively in parallel with them — every run, not only on CLI failure. The `site:` query templates below the "Primary" list (US remote boards, company career pages) are supplementary coverage, not merely a fallback. Fall back to `WebSearch` for a CLI portal only when its CLI fails at runtime or `bun` is unavailable.

#### 1a. Check bun availability

```bash
bun --version
```

If this fails (bun not installed), skip to **1c (WebSearch fallback)** for all portals and note the fallback in the Step 5 output.

#### 1b. Run CLI tools (primary — run these in parallel where possible)

Discover all installed portal CLI skills by reading every `SKILL.md` found under `.agents/skills/*/SKILL.md`. Each file documents that portal's exact CLI flags and usage examples. **Use each portal's own documented interface — do not guess flags.** This approach automatically includes any new portals added via `/add-portal` without requiring changes to this file.

**Honor the `enabled` toggle.** A portal is enabled unless its `SKILL.md` frontmatter sets `enabled: false` (a missing key means enabled — the default). Skip each disabled portal and record it for the Step 5 summary. A fork can thus keep a portal installed but sit out a run without deleting its directory.

For each **enabled** portal skill:

1. Read its `SKILL.md` to find the correct `bun run …` invocation and supported flags.
2. Translate the query terms from `search-queries.md` into that portal's flag format (e.g. `--key`, `--search-string`, `--query`, filter codes — whatever the portal's SKILL.md specifies).
3. Scope recency: `INCREMENTAL` = 14 days, `FULL_AUDIT` = 30 days (using portal's supported recency flag).
4. Cap results: `INCREMENTAL` = ~20 per call, `FULL_AUDIT` = ~50 per call.
5. Use `--format json` for machine-readable output.

Run all portal CLI calls in parallel where possible using the Agent tool. Collect all `results` arrays into a single pool for Step 1.5, keeping each result tagged with its source portal skill.

If a CLI tool exits with a non-zero code, log the error message and continue — do not abort the whole search.

#### 1c. Supplementary WebSearch sources (run proactively every run)

In parallel with the CLIs (Step 1b), run `WebSearch` with the `site:` query templates from `search-queries.md` that are **not** covered by an installed CLI — currently the US remote boards (builtin.com, hiringcafe.com) and company career pages. These are supplementary coverage: they run every run, even when all CLIs succeed, because they reach boards with no programmatic CLI and employer career pages the aggregators miss. Use the query strings directly as WebSearch queries. Treat any result whose URL belongs to an installed-CLI portal as redundant and drop it at dedup (Step 2).

Also use `WebSearch` as a true fallback (instead of the above) when:
- A CLI portal fails at runtime (its `site:` query becomes the fallback for that one portal), or
- `bun` is unavailable (Step 1a failed) — cover all portals via WebSearch.

**Step 1 Checkpoint:** After all search results collected, write checkpoint:
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "discovery",
  "stage_status": "complete",
  "jobs_processed_in_stage": <total raw results>,
  "total_jobs_in_stage": <total raw results>,
  "last_updated": "ISO timestamp"
}
```

### Step 1.5: Canonicalization & Stable ID Assignment

For each raw result from Step 1:

1. **Normalize fields:** title, company, location, URL, date, salary, arrangement
2. **Compute `stable_id`** (see CLAUDE.md formula): SHA256 of normalized URL + company + title
3. **Look up in `seen_jobs.json` by `stable_id`:**
   - Found → existing record; note current `processing_state`, `fingerprint`, `last_verified`
   - Not found → `NEW` candidate
4. **Cross-reference tracker:** Check `job_search_tracker.csv` for company+role match
5. **Tag with:** `stable_id`, `source_portal`, `raw_result`, `discovered_at` (ISO timestamp)

**Step 1.5 Checkpoint:**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "canonicalization",
  "stage_status": "complete",
  "jobs_processed_in_stage": <unique stable_ids>,
  "total_jobs_in_stage": <unique stable_ids>,
  "new_count": <NEW count>,
  "existing_count": <existing count>,
  "last_updated": "ISO timestamp"
}
```

### Step 2: Hard Filter (Canonical Filtering)

Apply the MASTER_JOB_SEARCH_BASELINE.md hard filters to jobs from Step 1.5:

1. **Role family match:** End User Computing, IT Support, Desktop Support, Technical Support, Service Desk, Tier 2/L2, Systems Administration, Cloud/Infrastructure, Endpoint/IT Security
2. **Work arrangement:** remote → hybrid NCR → onsite NCR (justified)
3. **Salary floor:** ₱30,000+ gross/month (flexible for growth)
4. **Language gate:** Undeclared required language = excluded
5. **Location:** Philippines, NCR/Metro Manila focus

**Set `processing_state`:**
- `NEW` jobs passing hard filter → `NEEDS_VERIFICATION`
- `NEW` jobs failing hard filter → `DEPRIORITIZE` (do not process further)
- Existing jobs: retain current `processing_state` unless changed state applies

**Step 2 Checkpoint:**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "hard_filter",
  "stage_status": "complete",
  "jobs_processed_in_stage": <passed count>,
  "total_jobs_in_stage": <total from 1.5>,
  "passed": <NEEDS_VERIFICATION count>,
  "deprioritized": <DEPRIORITIZE count>,
  "last_updated": "ISO timestamp"
}
```

### Step 2.5: Change Detection, State Assignment & Live Verification (Autonomous Batched)

This step combines change detection with live verification. Process the priority queue from Step 3 in **batches of 5 jobs**, checkpoint after each batch.

For each job in the current batch:

1. **Determine if live fetch is needed:**
   - `NEW` / `CHANGED` / `STALE` / `NEEDS_VERIFICATION` / `POSTING_CHANGED` → **FETCH**
   - `ACTIVE_VERIFIED` with `last_verified` ≤5 days ago → **SKIP** (retain state)
   - `ACTIVE_UNVERIFIED` with `blocked_at` ≤5 days ago → **SKIP** (retain state per 403 policy)

2. **Fetch live detail** (CLI `detail` command, or WebFetch for WebSearch results):
   - Use the job's source portal CLI `detail` command
   - For WebSearch results, use WebFetch with the canonical URL

3. **Compute new `fingerprint`** from fetched data (material fields only: title, company, location, arrangement, salary, key requirements)

4. **Compare with stored fingerprint:**
   - Identical → job unchanged; retain state
   - Different → update `fingerprint`, record `changed_at`, `changed_fields`, set `processing_state = CHANGED`

5. **Handle HTTP responses:**
   - **200 OK** → `ACTIVE_VERIFIED` (set `last_verified` = ISO timestamp)
   - **403 Forbidden** → Record `blocked_at`, `blocked_reason: "http_403"`, `blocked_source`; if canonical data ≤5 days old → `ACTIVE_UNVERIFIED` (retain); if >5 days or none → `STALE`; **never retry in same run**
   - **404 / dead / closed** → `CLOSED_OR_EXPIRED` (record `closed_at`)
   - **Material field change** (salary/arrangement/title/scope) → `POSTING_CHANGED` (record `changed_fields`)

**Step 2.5 Checkpoint (batched, after every 5 jobs):**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "verification",
  "stage_status": "in_progress|complete",
  "jobs_processed_in_stage": <verified this checkpoint>,
  "total_jobs_in_stage": <total to verify>,
  "batch_index": <N>,
  "total_batches": <M>,
  "verified": <ACTIVE_VERIFIED count>,
  "blocked": <ACTIVE_UNVERIFIED count>,
  "changed": <CHANGED count>,
  "closed": <CLOSED_OR_EXPIRED count>,
  "last_updated": "ISO timestamp"
}
```

**Concurrency limits (MANDATORY):**
- Maximum **2 concurrent verification workers** per batch
- **Sequential scoring** (1 worker per batch) — no parallel scoring
- **Sequential canonicalization/hard-filter** — deterministic single worker

**AUTONOMOUS CONTINUATION:** After each batch checkpoint, automatically continue to the next batch. Do NOT stop and ask for confirmation. Only stop if a fatal error occurs or the user explicitly interrupts.

### Step 3: Quick Fit Assessment & Priority Queue Construction

For each `NEW` or `CHANGED` job (not re-verified `ACTIVE_VERIFIED`), do a rapid fit check (NOT the full evaluation from `04-job-evaluation.md` - just a quick signal):

- **High match**: Role directly involves your core skills
- **Medium match**: Role is adjacent to your experience
- **Low match**: Role requires significant skills you lack

**Language override:** before assigning a match level, check the posting against `04-job-evaluation.md`'s Language Gate (a required language you haven't declared at all in your CLAUDE.md Languages table). A required language that's entirely undeclared overrides skill fit: mark it **Low** regardless of how well the skills align, and name it in the highlight bullets so it isn't buried under an otherwise-good-looking match. A **declared** language at a requirement that reads higher than your declared level is *not* an override — score fit normally, but add a red-flag bullet under that job's highlights (Step 6) quoting the posting's requirement next to your declared level, so the gap is visible without being auto-downgraded.

**Skip for:** `ACTIVE_VERIFIED` jobs ≤5 days old (already scored, no re-assessment needed)

**Priority Queue Construction (for verification):**

All jobs with `processing_state` in: `NEW`, `CHANGED`, `STALE`, `NEEDS_VERIFICATION`, `POSTING_CHANGED` that passed hard filter enter the verification queue.

Assign each job a **priority tier** (1 = highest, 5 = lowest):

| Tier | Criteria |
|------|----------|
| **1** | Remote + Salary ≥ ₱40K + Strong EUC/IT Support/Service Desk/Tier 2 match + Clear career progression |
| **2** | Remote + Salary ≥ ₱30K + Good technical match |
| **3** | Hybrid NCR + Salary ≥ ₱40K + Strong technical match |
| **4** | Onsite NCR + Salary ≥ ₱40K + Strong technical match |
| **5** | Other hard-filter-passing jobs |

**Within each tier**, sort by:
1. Technical fit (High > Medium > Low)
2. Salary (descending)
2. Arrangement (Remote > Hybrid > Onsite)
3. Career alignment strength
4. Experience match
5. Posting freshness (newer first)
6. Source reliability (portal CLI > WebSearch)

Process the queue in **batches of 5** in priority order. Do NOT truncate to "top 15" — all eligible jobs must eventually be processed.

**Step 3 Checkpoint (priority queue built):**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "priority_queue",
  "stage_status": "complete",
  "queue_length": <total jobs to verify>,
  "tier_breakdown": {"1": N, "2": N, "3": N, "4": N, "5": N},
  "last_updated": "ISO timestamp"
}
```

### Step 4: Deduplicate & Store

1. **Persist all jobs to `seen_jobs.json`** with extended schema:
```json
{
  "seen": {
    "<stable_id>": {
      "stable_id": "...",
      "title": "...",
      "company": "...",
      "url": "...",
      "first_seen": "YYYY-MM-DD",
      "fit": "high/medium/low",
      "status": "new/skipped/evaluated/ranked/expired",
      "processing_state": "NEW|NEEDS_VERIFICATION|ACTIVE_VERIFIED|ACTIVE_UNVERIFIED|STALE|CHANGED|CLOSED_OR_EXPIRED|POSTING_CHANGED|DUPLICATE_OR_INVALID",
      "fingerprint": "<sha256>",
      "previous_fingerprint": "<sha256|null>",
      "last_verified": "YYYY-MM-DD|null",
      "blocked_at": "ISO timestamp|null",
      "blocked_reason": "http_403|null",
      "changed_at": "ISO timestamp|null",
      "changed_fields": ["salary", "arrangement"],
      "closed_at": "ISO timestamp|null",
      "portal": "<source portal skill>",
      "rank_score": 0-100,
      "rank_verdict": "fit band",
      "rank_date": "ISO date",
      "strengths": ["...", "..."],
      "gaps": ["...", "..."]
    }
  }
}
```

`stable_id` is the canonical key (replaces the old `url_or_company_title_key`). Entries written before `stable_id` existed lack it; backfill by computing the formula on next encounter.

2. Only present jobs with `processing_state` in: `NEW`, `NEEDS_VERIFICATION`, `CHANGED`, `POSTING_CHANGED`, `ACTIVE_UNVERIFIED` (recently blocked, worth showing)

3. Do NOT re-present: `ACTIVE_VERIFIED` (already shown in prior runs), `CLOSED_OR_EXPIRED` (removed), `DEPRIORITIZE` (filtered out)

### Step 4.5: Generate Referral Contact Links (High & Medium Fit Only)

For every job from this run with `fit` of **high** or **medium** (skip low-fit jobs),
build two LinkedIn people-search URLs so the user can find a recruiter or team member to
reach out to for a referral or a warm intro. This is deliberately a link-generation step,
not an automated lookup: no scraping, no third-party API, zero runtime dependencies or
credentials required.

**A. Recruiters / Talent Acquisition (the referral path)**
```
https://www.linkedin.com/search/results/people/?keywords=<url-encoded "<Company Name> recruiter">&origin=GLOBAL_SEARCH_HEADER
```

**B. Role/team peers (informational-outreach / warm-intro path)**
```
https://www.linkedin.com/search/results/people/?keywords=<url-encoded "<Company Name> <role keyword>">&origin=GLOBAL_SEARCH_HEADER
```
Use a short keyword drawn from the posting's title for `<role keyword>` - e.g. a posting
titled "AI Program Manager" becomes `"<Company Name> AI Program Manager"`.

Both links are for the user to open and browse themselves - never fetch or scrape the
LinkedIn people-search result pages programmatically. Never fabricate contacts or claim a
specific person was found; these are search links, not results.

### Step 4.75: Portal Health Check

Scraper-based portal CLIs rot silently: when a portal changes its markup, the parser usually exits 0 with zero results or with null/garbled fields, and the Step 1c fallback never fires because it only triggers on hard failure. This step catches that from evidence the run already holds.

**Free pass (no extra requests).** For each enabled portal that ran in Step 1b:

- **Degraded scan:** inspect the results it returned this run. Flags: `company` null or empty on every result, empty titles, undecoded entities (`&amp;`) or HTML fragments in titles, URLs that do not point at the portal. Any of these means the parser is half-working and `/scrape` is silently collecting junk.
- **Yield history:** if the portal returned zero results across all of this run's queries, check whether `seen_jobs.json` holds prior entries from it (via the `portal` field, or by matching URL domains for entries predating the field). A portal that produced jobs on earlier runs and produces nothing now is suspect - the same queries worked before.

**Escalation (bounded, on suspicion only).** A suspect portal gets **one** sentinel probe: run its documented `search` with the example query from its own SKILL.md (that query provably worked when the skill was registered), the portal's limit flag capped at 3, `--format json`. If that returns nothing, retry **once** with a single common word. Only then is the verdict **broken**. A 429 or block page is **never** evidence of breakage - record the portal as **inconclusive (rate-limited)**, back off, and do not retry.

**Verdicts.** Healthy portals get silence - no table, no line. Anything else surfaces in the Step 6 summary as a health line.

**Probe-only mode (`/scrape health`).** Skip Steps 1-4 and this step's free pass (there is no fresh run to scan); instead probe every installed portal directly - enabled ones by default, a disabled one only when named explicitly (e.g. `/scrape health jobnet`). Each portal gets the sentinel probe above, the degraded criteria applied to whatever it returns, and - since the user explicitly asked for diagnosis - one `detail` fetch on the first result of each healthy portal (description must be readable decoded text; a failure downgrades to degraded). Report all statuses in this mode, including healthy. Volume stays bounded: one search, at most one retry, at most one detail per portal.

### Step 5: Score New/Changed Jobs (Autonomous Batched)

For jobs with `processing_state` in: `NEW`, `CHANGED`, `POSTING_CHANGED`, `STALE` that are now `ACTIVE_VERIFIED` (after verification):
- Apply `04-job-evaluation.md` full scoring framework (Technical Skills 30%, Experience 25%, Behavioral 15%, Career Alignment 30%, Location pass/fail)
- Set `rank_score`, `rank_verdict`, `rank_date`, `strengths`, `gaps`
- Update `status` to `"ranked"`
- **Skip scoring for:** `ACTIVE_VERIFIED` with `last_verified` ≤5 days old (already scored), `ACTIVE_UNVERIFIED` (already scored from prior run)

**In `FULL_AUDIT` mode:** Re-score ALL jobs in canonical dataset, including `ACTIVE_VERIFIED` and `ACTIVE_UNVERIFIED`.

Process in **batches of 5**, checkpoint after each batch. Automatically continue to next batch.

**Step 5 Checkpoint (batched, after every 5 jobs):**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "scoring",
  "stage_status": "in_progress|complete",
  "jobs_processed_in_stage": <scored this checkpoint>,
  "total_jobs_in_stage": <total to score>,
  "batch_index": <N>,
  "total_batches": <M>,
  "newly_scored": <count>,
  "re_scored": <count>,
  "skipped": <count>,
  "last_updated": "ISO timestamp"
}
```

**AUTONOMOUS CONTINUATION:** After each batch checkpoint, automatically continue to the next batch. Do NOT stop and ask for confirmation.

### Step 6: Rank & Report (Autonomous — No Confirmation Required)

1. **Re-rank all active jobs** by `rank_score` descending (ACTIVE_VERIFIED + ACTIVE_UNVERIFIED + NEW + CHANGED + POSTING_CHANGED)
2. **Generate incremental run summary** (see CLAUDE.md format)
3. **Present new jobs table** (only NEW/CHANGED/POSTING_CHANGED/ACTIVE_UNVERIFIED jobs)
4. **Show top 5** ranked active jobs
5. **Portal health lines** (if Step 4.75 found issues)

**In `FULL_AUDIT` mode:** Present complete canonical dataset + integrity status per MASTER_JOB_SEARCH_BASELINE.md Section 19.

**Step 6 Checkpoint (final):**
```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "stage": "ranking_report",
  "stage_status": "complete",
  "total_active_jobs": <count>,
  "top_5": ["<stable_id>", ...],
  "last_updated": "ISO timestamp"
}
```

**DO NOT ASK "Want me to evaluate...?" or any confirmation question.** The pipeline is autonomous. Present the final report and stop. The user will initiate evaluation if desired.

If Step 4.75 found a broken portal, report it in the portal health line. Only offer to disable the portal (`enabled: false`) if the user explicitly asks about it — do not prompt.

---

## Output Formats

### Incremental Run Summary (Step 6 - INCREMENTAL mode)

```
INCREMENTAL RUN SUMMARY — YYYY-MM-DD
- Run ID: YYYYMMDD-HHMMSS
- Mode: INCREMENTAL
- Discovered: X raw results
- After canonicalization: Y unique stable_ids
- New jobs: A
- Existing jobs: B (C ACTIVE_VERIFIED ≤5d skipped, D ACTIVE_UNVERIFIED retained)
- Hard filter passed: E
- Verified (live): F (G new, H re-verified stale)
- Blocked (403): I (retained as ACTIVE_UNVERIFIED)
- Changed: J (fingerprint diff on material fields)
- Closed/Expired: K (removed from active)
- Scored: L (M new, N re-scored changed)
- Ranked: O total active jobs
- Top 5: [job titles with scores]
- Portal health: [health lines if any]
- Checkpoint: complete at ranking_report
```

### New Jobs Table (INCREMENTAL mode)

Present ONLY jobs with `processing_state` in: `NEW`, `CHANGED`, `POSTING_CHANGED`, `ACTIVE_UNVERIFIED` (recently blocked)

```
| # | State | Fit | Title | Company | Location | Arrangement | Salary | Score | URL |
|---|-------|-----|-------|---------|----------|-------------|--------|-------|-----|
| 1 | NEW | High | ... | ... | ... | remote | ₱45-55K | 87 | [Link](...) |
| 2 | CHANGED | High | ... | ... | ... | hybrid | ₱40-50K | 82 | [Link](...) |
```

### Full Audit Output (FULL_AUDIT mode)

Complete canonical dataset + integrity status per MASTER_JOB_SEARCH_BASELINE.md Section 19 format:

```
DATA INTEGRITY STATUS
- Total discovered: X
- Total consolidated: Y
- Hard-filter passed: Z
- Needs clarification: A
- Deprioritized: B
- Duplicates removed: C
- Dead URLs removed: D
- Restored after keyword-gap detection: E
- Final canonical jobs: F
- Jobs actually verified: G
- Jobs eligible for scoring: H
- Integrity status: PASS / FAIL
```

Followed by ranked table of all canonical jobs.

---

## Important Rules

1. **Never fabricate job postings.** Only present jobs from actual CLI search/detail output or WebSearch/WebFetch results.
2. **Respect deduplication.** Always check seen_jobs.json AND job_search_tracker.csv before presenting.
3. **Focus on configured geographic area.** Skip jobs that require relocation or are clearly outside commute range.
4. **Only open positions.** Skip postings with expired deadlines or those marked as closed.
5. **Be efficient with detail fetches.** Don't run `detail` or WebFetch on every search hit — pre-filter by title/snippet, then fetch only promising matches.
6. **Parallel searches.** Run portal CLI searches in parallel; use WebSearch only for gaps the CLIs don't cover.
7. **No automated people lookups.** Referral contacts (Step 4.5) are LinkedIn search links only - never fetch or scrape LinkedIn people-search result pages programmatically.
8. **Health checks are bounded and honest.** Step 4.75 spends at most one probe, one retry, and (in `health` mode) one detail fetch per portal - a diagnosis, not a crawl. A rate-limit is never evidence of breakage. Health verdicts come only from observed CLI output; a portal that could not be tested is reported as inconclusive, never guessed. The `enabled` toggle is the only thing the health check may edit, and only with confirmation.
9. **Flag distribution patterns, never accuse.** The mass-posting signal (Step 2.5) describes how a listing is being distributed, not a claim that the employer is a scam. Never name a company as fraudulent or untrustworthy - present the observation and let the user decide.
