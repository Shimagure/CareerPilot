# MASTER JOB SEARCH BASELINE
## Permanent Standard for Claude / CareerPilot Job Scraping

**Status:** PERMANENT BASELINE  
**Purpose:** This file is the mandatory operating standard for every future job-search/scraping cycle.

---

## 0. Authority and Precedence

Before any job search, Claude MUST read and follow these sources in this order:

1. `CANDIDATE_TRUTH.md` — factual authority for candidate experience, skills, certifications, projects, education, metrics, and other claims.
2. `CLAUDE.md` — project-wide rules and permanent instructions.
3. `.claude/skills/job-application-assistant/05-cv-templates.md` — CV generation rules.
4. `.claude/skills/job-application-assistant/04-job-evaluation.md` — fit/evaluation framework.
5. This file — `MASTER_JOB_SEARCH_BASELINE.md`.
6. `job_search_tracker.csv` — application history/state.
7. `job_scraper/seen_jobs.json` — deduplication/history state.

If two instructions conflict, use the higher-priority source above and do not silently override it.

---

# 1. CANDIDATE HARD FILTERS

Use these as baseline filters unless the user explicitly changes them.

### Target roles
Prioritize:
- End User Computing / EUC
- IT Support / Desktop Support
- Technical Support
- Service Desk / Helpdesk
- Tier 2 / L2 support
- Systems Administration
- Cloud / Infrastructure
- Endpoint / IT Security

Prefer roles that provide a credible path toward Systems Administration, Cloud/Infrastructure, Endpoint Security, IAM, or related higher-level technical work.

### Work arrangement
Priority order:
1. Fully remote
2. Hybrid within NCR / Metro Manila
3. Onsite within NCR / Metro Manila if compensation and career value justify the commute
4. Do NOT treat non-NCR onsite roles as normal matches unless the user explicitly approves them.

Never infer remote/hybrid from vague wording such as:
- flexible scheduling
- flexible work arrangements
- work-life balance
- in-person support
- location listed without arrangement
- "remote" appearing only as a search/filter tag

If arrangement is unclear and materially affects fit, mark **NEEDS CLARIFICATION / HOLD**.

### Salary
Baseline target: **₱30,000–45,000 gross/month**.

- ₱30K+ = potentially acceptable.
- Above ₱45K = positive.
- Below ₱30K = normally deprioritize unless exceptional career value.
- Undisclosed salary = do not assume it meets target.
- If salary appears suspicious, annualized, foreign-currency based, or inconsistent, verify before relying on it.

Flexibility exists for roles with significant technical growth toward systems, cloud, infrastructure, security, or similar paths.

### Shift
User is open to:
- Day shift
- Night shift
- Rotational shift
- Weekend/holiday schedules

Do not reject a role solely because of shift.

### Language
Do not reject based on English unless the posting has a specific language requirement the candidate does not meet.

**Permanent CV rule:** Languages MUST NOT appear as a CV section.

### Eligibility
Do not invent citizenship/work authorization facts. Use verified candidate information only.

---

# 2. SEARCH PROCEDURE

Every standard search cycle should follow this order:

1. Load/refresh candidate truth and permanent rules.
2. Inspect tracker and seen-job history.
3. Search relevant job portals.
4. Collect candidate postings.
5. Normalize title/company/location/arrangement/salary/source/URL.
6. Deduplicate.
7. Apply hard filters.
8. Verify promising postings from the live source.
9. Score/rank surviving jobs.
10. Categorize:
   - APPLY-WORTHY
   - NEEDS CLARIFICATION / HOLD
   - DEPRIORITIZE
11. Present shortlist with direct job-posting links.
12. STOP and wait for explicit user approval before generating application documents.

Never automatically apply for a job.

Never automatically generate a CV or cover letter merely because a job was found.

---

# 3. DEDUPLICATION — MANDATORY

Before presenting a job as NEW, check BOTH:

- `job_search_tracker.csv`
- `job_scraper/seen_jobs.json`

Match using multiple identifiers where possible:
- job URL
- JobStreet/Indeed/LinkedIn job ID
- normalized company + title
- company + distinctive role
- known previously rejected/held/submitted roles

A job already tracked must NOT be presented as a new job.

If a previously seen job has materially changed (salary, arrangement, title, scope, or posting status), report it as an **UPDATED EXISTING JOB**, not a new job.

Do not create duplicate tracker rows.

---

# 4. SEARCH QUALITY

Prioritize useful technical roles over raw result count.

Search broadly enough to find:
- Tier 2 / L2
- EUC
- Desktop Support
- IT Support
- Service Desk
- Systems / Infrastructure
- Endpoint / IAM / Cloud-adjacent roles

Avoid flooding the user with:
- obvious L1 step-downs
- unrelated customer service
- sales
- non-IT roles
- out-of-region onsite roles
- roles requiring unavailable languages
- roles clearly below salary floor
- roles with hard skill/certification gates that cannot be met

If a portal is returning poor-quality or broken results, document that briefly and reduce reliance on it rather than repeatedly spending tokens on bad searches.

---

# 5. LIVE POSTING VERIFICATION

Before a job reaches APPLY-WORTHY status, verify when practical:

- Posting is live
- Exact title
- Company
- Location
- Work arrangement
- Salary
- Shift/schedule
- Experience requirement
- Major technical requirements
- Language requirements
- Eligibility/work authorization requirements
- Application URL

Do not convert assumptions into facts.

Use explicit labels:
- VERIFIED
- NOT DISCLOSED
- AMBIGUOUS
- REQUIRES CLARIFICATION

If a material gate cannot be verified, use HOLD / NEEDS CLARIFICATION.

---

# 6. FIT EVALUATION

Use `04-job-evaluation.md` as the scoring authority.

At minimum evaluate:

### Technical Skills
How closely the verified technical requirements match the candidate's proven skills.

### Experience Match
Level, years, enterprise environment, Tier 1/Tier 2/Tier 3 scope, and domain relevance.

### Behavioral Fit
Communication, reliability, documentation, customer interaction, escalation, troubleshooting, and operating environment.

### Location & Logistics
Remote/hybrid/onsite, NCR preference, commute burden, shift, and schedule.

### Career Alignment
Whether the role advances:
- Tier 2 capability
- Systems Administration
- Cloud/Infrastructure
- Endpoint Engineering/Security
- IAM
- automation
- other credible technical progression

Do not inflate scores merely because a company is prestigious or salary is high.

---

# 7. CANDIDATE TRUTH / ANTI-FABRICATION

This is mandatory.

Never claim:
- a skill not supported by `CANDIDATE_TRUTH.md`
- a certification not held
- a project not verified
- a metric not verified
- a tool as professional experience when it is only awareness/learning
- a job responsibility merely because it appears in the target posting

Use the established Level 1 / Level 2 / Level 3 handling.

When a posting contains an unfamiliar technology:
- identify it as a gap
- do not fabricate experience
- only frame it as learning/target exposure when appropriate

---

# 8. APPLICATION DOCUMENT RULES

Only generate documents after explicit user approval.

### CV
- Exactly 1 page.
- Use the approved CV template.
- Follow `05-cv-templates.md`.
- No `Languages` section.
- No `References` section.
- Do not include "References available upon request."
- Reclaim space for:
  1. Certifications
  2. Projects
- Certifications and Projects must come only from verified candidate truth.
- Tailor keywords to the target posting without inventing experience.
- Preserve factual consistency.

### Cover letter
- Exactly 1 page.
- Tailored to the verified posting.
- Do not fabricate tools, responsibilities, achievements, or metrics.
- Keep it concise and technically relevant.

---

# 9. DOCUMENT VERIFICATION

After generating documents, verify efficiently:

### CV
- Compiles successfully with the required LaTeX engine.
- Exactly 1 page.
- ATS text extraction works.
- No `(cid:*)` artifacts.
- Email/phone remain readable text.
- No Languages section.
- No References section.
- Certifications included where space permits.
- Projects included where space permits.
- Claims remain grounded in candidate truth.

### Cover letter
- Compiles successfully.
- Exactly 1 page.
- ATS-readable text.
- No fabricated claims.

Do not repeat expensive verification procedures unnecessarily if the same artifact and rule set were already verified and unchanged.

If visual inspection is unavailable because of a tooling limitation, report that limitation rather than repeatedly retrying the same failed operation.

---

# 10. APPLICATION STATE MANAGEMENT

Use consistent states:

- `ranked` — found and evaluated
- `hold` — material information unresolved
- `drafted` — documents generated and verified, awaiting submission
- `submitted` — user confirms application was submitted
- `withdrawn` — user no longer wants to pursue it
- `rejected` — employer rejected application
- `closed` — posting closed/expired

Only change state based on evidence or explicit user confirmation.

When the user says they submitted an application:
- update tracker status to `submitted`
- update `seen_jobs.json`
- preserve fit score and source URL
- do not regenerate documents unless requested

When the user says an application is done, treat it as submitted only if the context clearly means the application was actually submitted.

---

# 11. FINAL SHORTLIST FORMAT

For each recommended job, provide:

- Rank
- Fit score/category
- Company
- Exact title
- Location
- Work arrangement
- Salary
- Key strengths
- Genuine gaps
- Major concerns
- Application recommendation
- **Direct job posting URL**

Always include the direct posting link when recommending a job for application.

Do not substitute recruiter-search links for the actual job posting.

---

# 12. HOLD / CLARIFICATION RULE

A job should be HOLD when a material requirement is unresolved, especially:

- work arrangement
- salary where salary is a meaningful filter
- language requirement
- work authorization
- required certification
- hard technical requirement
- location/commute
- schedule that could materially affect suitability

Do not assume a favorable answer.

Recommend the minimum clarification needed.

---

# 13. AFTER THE USER APPLIES

Once the user confirms submission:

1. Update tracker.
2. Update seen_jobs.
3. Confirm status.
4. Do not unnecessarily re-verify already verified documents.
5. Move to the next highest-value job/search cycle.

Previously submitted applications remain submitted unless the user changes their status.

---

# 14. TOKEN / EFFICIENCY RULE

**MAXIMIZE USEFUL WORK PER CLAUDE API TOKEN.**

Do not spend excessive tokens on repetitive checking.

Before running a command/search/read:
- Ask whether the result is already known.
- Reuse existing verified data.
- Avoid rereading unchanged files.
- Avoid repeating the same failed tool operation.
- Batch compatible searches/checks.
- Prefer concise summaries over verbose internal narration.
- Do not repeatedly re-check the same CV/template/tracker rule unless something changed.
- Do not perform visual verification repeatedly when the same artifact is unchanged.
- Stop once the required evidence is sufficient.

Use a **minimum-sufficient-verification** principle:
> Verify enough to establish correctness; do not verify the same fact repeatedly without a material reason.

The goal is high-quality job-search decisions, not maximum command count.

---

## 14.1 Reduced-Verification Rule (Permanent)

To prevent redundant work while preserving correctness:

- **Minimize repetitive/redundant verification and rereading** — Do not re-verify the same artifact, rule, or fact unless it has materially changed or new evidence requires it.
- **Reuse already verified canonical data** — If a job, CV, cover letter, or pipeline stage was already verified in a prior step or run, and nothing has changed, reuse the verified result rather than re-running the check.
- **Perform targeted verification only when it materially affects correctness or application readiness** — Verification should be scoped to what impacts the decision (fit score, document accuracy, hard gate). Do not verify for verification's sake.
- **Do not repeatedly re-fetch already canonicalized/evaluated job URLs or rerun completed pipeline checks** unless new evidence or a material change requires it (e.g., posting changed, stale threshold exceeded, 403 block lifted).
- **Preserve the CANDIDATE_TRUTH.md factual gate and accuracy** while avoiding unnecessary token/time consumption — Anti-fabrication rules and candidate truth validation remain absolute; only the *verification overhead* around already-validated facts is reduced.

---

# 15. STANDARD OPERATING LOOP

Every normal cycle should effectively be:

SEARCH
→ DEDUP
→ HARD FILTER
→ LIVE VERIFY
→ ELIGIBILITY GATE (see `04-job-evaluation.md` Section 1)
→ LANGUAGE GATE (see `04-job-evaluation.md` Section 2)
→ SCORE
→ RANK
→ PRESENT WITH DIRECT LINKS
→ WAIT FOR APPROVAL
→ GENERATE DOCUMENTS ONLY AFTER APPROVAL
→ VERIFY DOCUMENTS
→ USER SUBMITS
→ UPDATE STATE
→ NEXT SEARCH

Never skip deduplication.
Never skip candidate-truth validation.
Never skip Eligibility Gate.
Never skip Language Gate.
Never assume missing posting details.
Never auto-apply.
Never fabricate.
Never generate documents before approval.

---

# 16. REQUIRED PRE-SEARCH CHECKLIST

Before each new scraping cycle, Claude should silently confirm:

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

Then begin the search.

---

# 17. REQUIRED PRE-APPLICATION CHECKLIST

Before generating documents:

- [ ] User explicitly approved the job
- [ ] Live posting verified
- [ ] Work arrangement verified
- [ ] Salary verified or clearly marked undisclosed
- [ ] No hard language/eligibility gate failed
- [ ] Fit score completed
- [ ] Candidate gaps identified
- [ ] Direct posting URL recorded
- [ ] Existing tracker/seen-job state identified
- [ ] Correct CV template selected
- [ ] No Languages/References sections
- [ ] Certifications + Projects available from verified truth

---

# 18. REQUIRED POST-APPLICATION CHECKLIST

After user confirms submission:

- [ ] Tracker status updated to `submitted`
- [ ] seen_jobs status updated
- [ ] Fit score preserved
- [ ] Direct posting URL preserved
- [ ] No duplicate row created
- [ ] Existing application states preserved
- [ ] Ready for next search cycle

---

# 19. DATA INTEGRITY AUDIT — MANDATORY FINALIZATION GATE

This audit is a REQUIRED STEP in EVERY future job-search run. The workflow MUST NOT proceed to final scoring/ranking/output until the audit passes.

## 19.1 The 13 Audit Checks

1. **Reconcile all job counts mathematically** — Total consolidated = PASSED + NEEDS_CLARIFICATION + DEPRIORITIZE
2. **Identify duplicates across portals** — Deduplicate by URL, job ID, company+title
3. **Recalculate scoring inputs from canonical dataset** — Use verified data, not search-result metadata
4. **Re-run Eligibility Gate explicitly** — Classify each as PASS / PROCEED_UNVERIFIED / FLAG / FAIL
5. **Re-run Language Gate explicitly** — Classify each as PASS / FLAG / FAIL
6. **Verify work arrangements and flag contradictions** — Live verification wins over search-result headline
7. **Verify salaries against candidate target** — Below / Meets / Above / Undisclosed
8. **Verify direct URLs are accessible** — 404/dead listings removed
9. **Perform final count/integrity reconciliation** — Canonical count mathematically derived
10. **Rebuild the shortlist from the canonical dataset** — Only verified, eligible jobs
11. **Cross-check existing application/tracker state** — No duplicate submissions
12. **Detect hard-filter keyword gaps and false negatives** — Restore relevant jobs missed by keyword omission
13. **Present the corrected canonical shortlist before final scoring/output** — Transparent audit trail

## 19.2 DATA INTEGRITY RULES

### Rule A — Never trust search-result metadata blindly
Search-result title, salary, location, remote/hybrid label, and snippets are provisional. Live verification takes precedence.

### Rule B — Never score before deduplication
Duplicate jobs must be removed before ranking. Where possible, retain one canonical record and preserve portal/source identifiers as aliases.

### Rule C — Never allow a keyword omission to silently discard relevant jobs
Maintain a broad target-role synonym set. At minimum, ensure the hard filter recognizes relevant variants such as:
- End User Computing, EUC, End User Support
- IT Support, Desktop Support, Technical Support
- IT Service Desk, Service Desk, Help Desk, Helpdesk
- IT Support Engineer, Technical Support Engineer, Desktop Engineer, Support Engineer
- Tier 1, Tier 1.5, Tier 2, L1, L1.5, L2

Do not blindly add unrelated titles merely because they contain "support."

### Rule D — Contradictory source information requires live verification
Example: A listing may say "Remote" in its headline while the qualifications state "100% onsite." The verified requirement must win.

### Rule E — A 404/dead listing cannot remain an active canonical job
Keep it only in an audit/removal record if useful for traceability.

### Rule F — Newly restored jobs must pass all gates
If a job is restored after a hard-filter correction, it must enter the normal verification/gating pipeline. It cannot inherit PASS status from an earlier stage.

### Rule G — No silent corrections
Whenever a job is: restored, removed, reclassified, deduplicated, deprioritized, promoted — record the reason.

### Rule H — Counts must always reconcile
Never present a final shortlist where the displayed counts cannot mathematically be derived from the underlying dataset.

## 19.3 PERMANENT AUDIT OUTPUT FORMAT

Every future job-search run should produce a compact integrity summary before final ranking:

```
DATA INTEGRITY STATUS
- Total discovered:
- Total consolidated:
- Hard-filter passed:
- Needs clarification:
- Deprioritized:
- Duplicates removed:
- Dead URLs removed:
- Restored after keyword-gap detection:
- Final canonical jobs:
- Jobs actually verified:
- Jobs eligible for scoring:
- Integrity status: PASS / FAIL
```

If any number is unknown, do not fabricate it.

## 19.4 REGRESSION PROTECTION FOR KEYWORD-GAP ISSUE

The "end user support" omission demonstrates that the hard filter can produce false negatives.

Add a permanent regression test/check for target-role terminology. The system should periodically compare TARGET_ROLE_KEYWORDS against:
- Previously shortlisted jobs
- Manually tracked jobs
- Recently restored jobs
- Common terminology discovered during live verification

If a relevant role repeatedly appears outside the keyword vocabulary, flag it for review rather than silently excluding it.

Do not automatically expand the keyword list without checking whether the role genuinely matches the candidate's target career path.

## 19.5 AUDIT TRACEABILITY

Do not delete evidence of corrections. Maintain enough information to explain:
- Original status
- Corrected status
- Reason
- Source
- Verification result
- Timestamp/date when applicable

Example:
`DEPRIORITIZE → RESTORED → CANONICAL`
Reason: `"End User Support" missing from TARGET_ROLE_KEYWORDS`

This should make future debugging possible without repeating the entire investigation.

---

## PERMANENT DIRECTIVE

**This file is the master baseline for job scraping and application workflow. Claude must consult and follow it for every future job-search cycle.**

If Claude's current behavior conflicts with this file, stop and resolve the conflict using the authority order in Section 0 before continuing.

---

## 20. INCREMENTAL JOB SCRAPER ARCHITECTURE (PERMANENT)

The `/job-scraper` skill implements a **session-independent incremental architecture** defined in `CLAUDE.md`'s "PERMANENT INCREMENTAL JOB SCRAPER ARCHITECTURE" section. This baseline mandates compliance with that architecture.

### 20.1 Core Principles

1. **All state persisted** in `seen_jobs.json` and `job_scraper/checkpoints.json`
2. **Cold-start correctness**: New session = identical results to continued session
3. **Default is incremental**: Only process `NEW`, `NEEDS_VERIFICATION`, `STALE`, `CHANGED` jobs
4. **Explicit full audit**: User must say "/full-job-audit" to force re-processing everything
5. **Checkpoint at every stage**: Discovery → Canonicalization → Hard Filter → Verification → Scoring → Ranking/Report
6. **Crash recovery**: On any invocation, inspect checkpoints, resume only incomplete work
7. **403 handling**: Record block, retain recent data as `ACTIVE_UNVERIFIED`, retry only per stale policy
8. **Change detection**: Stable identifiers + content fingerprinting on material fields

### 20.2 Job Processing States (persisted in `seen_jobs.json`)

| State | Meaning | When Applied |
|-------|---------|--------------|
| `NEW` | First time discovered in current run | Initial discovery |
| `NEEDS_VERIFICATION` | Passed hard filter, awaits live verification | After hard filter pass |
| `ACTIVE_VERIFIED` | Live fetch succeeded, fully verified & scored | After successful live verification |
| `ACTIVE_UNVERIFIED` | Recent scrape data (≤5 days), live fetch blocked (403) | HTTP 403 on live fetch with recent canonical data |
| `STALE` | Verified >5 days ago, needs re-verification | Verification older than stale threshold |
| `CHANGED` | Content fingerprint differs from stored version | Change detected via fingerprint comparison |
| `CLOSED_OR_EXPIRED` | Posting dead, 404, or explicitly closed | Live fetch confirms closure/expiration |
| `POSTING_CHANGED` | Material field changed (salary, arrangement, title, scope) | Fingerprint diff on material fields |
| `DUPLICATE_OR_INVALID` | Duplicate of another canonical record | Dedup logic identifies duplicate |

### 20.3 Stale Verification Policy (Mandatory)

| Current State | Time Since Last Verification | Action |
|---------------|------------------------------|--------|
| `ACTIVE_VERIFIED` | ≤ 5 days | Skip re-verification |
| `ACTIVE_VERIFIED` | > 5 days | → `STALE`; schedule re-verification |
| `ACTIVE_UNVERIFIED` | ≤ 5 days | Retain `ACTIVE_UNVERIFIED`; do NOT retry |
| `ACTIVE_UNVERIFIED` | > 5 days | → `STALE`; schedule re-verification (retry once) |
| `STALE` | — | Attempt live verification |

### 20.4 HTTP 403 Handling (Mandatory)

When live fetch returns HTTP 403:
1. Record `blocked_at`, `blocked_reason: "http_403"`, `blocked_source`
2. If canonical data ≤5 days old → `ACTIVE_UNVERIFIED` (retain, no retry)
3. If canonical data >5 days or none → `STALE` (retry next run per stale policy)
4. Never retry 403 in same run
5. Report `blocked: <count> jobs (portal: <name>)` in summary

### 20.5 Checkpoint Stages (Mandatory)

Persist to `job_scraper/checkpoints.json` at each stage:
- `discovery` — search complete
- `canonicalization` — stable IDs assigned
- `hard_filter` — filters applied
- `verification` — live fetches (batched every 5 jobs)
- `scoring` — fit evaluation (batched every 5 jobs)
- `ranking_report` — final ranking complete

### 20.6 Normal `/job-scraper` vs `/full-job-audit`

| Aspect | `/job-scraper` (default, incremental) | `/full-job-audit` (explicit) |
|--------|--------------------------------------|------------------------------|
| **Trigger** | "find jobs", "/scrape", "new jobs" | "/full-job-audit" or "full audit" |
| **Discovery window** | 14 days | 30 days + broader queries |
| **Verification** | Only `NEW`, `NEEDS_VERIFICATION`, `STALE`, `CHANGED` | Re-verify ALL `ACTIVE_VERIFIED` + `ACTIVE_UNVERIFIED` |
| **403 retry** | Per stale policy only | Retry all 403-blocked once with browser headers |
| **Scoring** | Only `NEW`, `CHANGED`, `STALE`, `POSTING_CHANGED` | Re-score ALL canonical jobs |
| **Ranking** | Incremental merge | Full re-rank from scratch |
| **Report** | Incremental summary | Full integrity audit (Section 19) |
| **Token cost** | Minimal | Full |

**Default is incremental.** The user must explicitly request a full audit. Never auto-escalate.

### 20.7 Incremental Run Summary (Mandatory Output)

Normal `/job-scraper` output MUST begin with:

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

### 20.8 Autonomous Execution (Mandatory)

The normal `/job-scraper` pipeline is **fully autonomous** — it does NOT stop for user confirmation between deterministic stages:

```
DISCOVERY → CANONICALIZATION → HARD FILTER → PRIORITY QUEUE → VERIFICATION (batched) → SCORING (batched) → RANKING → TOP 10/5 → REPORT → PERSIST
```

**Do not ask "Want me to proceed?" or any confirmation question between stages.** The user is only prompted when an actual policy decision is required.

### 20.9 Priority Verification Queue (Mandatory)

**Do NOT hard-code "verify only the top 15 High-fit jobs" as the normal architecture.**

ALL eligible jobs enter the verification queue:
- `NEW` jobs that passed hard filter
- `CHANGED` jobs (fingerprint diff on material fields)
- `STALE` jobs (>5 days since last verification)
- `NEEDS_VERIFICATION` jobs from prior runs
- `POSTING_CHANGED` jobs

Jobs are processed in **priority order** (not arbitrarily truncated):

| Tier | Criteria |
|------|----------|
| **1** | Remote + Salary ≥ ₱40K + Strong EUC/IT Support/Service Desk/Tier 2 match + Clear career progression |
| **2** | Remote + Salary ≥ ₱30K + Good technical match |
| **3** | Hybrid NCR + Salary ≥ ₱40K + Strong technical match |
| **4** | Onsite NCR + Salary ≥ ₱40K + Strong technical match |
| **5** | Other hard-filter-passing jobs |

Within each tier, sort by: technical fit, salary (desc), arrangement, career alignment, experience match, posting freshness, source reliability.

**Batch size: 5 jobs**. **Maximum 2 concurrent verification workers per batch**. Checkpoint after each batch. Automatic continuation.

**Concurrency limits (MANDATORY):**
- **Maximum 2 concurrent verification workers** per batch
- **Sequential scoring** (1 worker per batch) — no parallel scoring
- **Sequential canonicalization/hard-filter** — deterministic single worker

### 20.10 Ranking — Complete Active Set (Mandatory)

After all eligible jobs verified/scored:
- Re-rank **COMPLETE ACTIVE JOB SET** (existing + new): `ACTIVE_VERIFIED` + `ACTIVE_UNVERIFIED` + `NEW` + `CHANGED` + `POSTING_CHANGED`
- Exclude: `CLOSED_OR_EXPIRED`, `DUPLICATE_OR_INVALID`, `DEPRIORITIZE`
- Tie handling: deterministic, equal scores = equal ranks, next rank accounts for ties

### 20.11 Top 10 / Top 5 — Derived from Ranking (Mandatory)

Automatically generate:
- **TOP 10** — top 10 from complete ranked active set
- **TOP 5** — top 5 from complete ranked active set

Derived directly from final ranking, not manually maintained.

### 20.12 Final Integrity Check — Lightweight Targeted (Mandatory)

Before final output, perform ONE targeted check:
- Canonical count reconciles mathematically
- Unique stable IDs (no duplicates in active set)
- Score coverage (all ranked jobs have scores)
- Verification coverage (all scored jobs verified or `ACTIVE_UNVERIFIED` with recent data)
- Ranking order (descending by score)
- Tie handling (deterministic)
- Top 10/5 consistency with ranking

Do NOT perform multiple redundant audits.

---

## 26. CV QUALITY STANDARD — READABILITY, TRUTHFULNESS, AND TARGETING

These rules are permanent and apply to every generated or modified CV.

### 26.1 Readability over keyword density
- Never sacrifice recruiter readability merely to increase ATS keyword density.
- Do not cram excessive technologies, abbreviations, or keywords into the Professional Summary or Skills section.
- Avoid microscopic text, excessive compression, or visually dense layouts just to force content onto one page.
- A clean, readable one-page CV is preferred over a technically one-page CV that is visibly overcrowded.

### 26.2 Clearly distinguish technology proficiency levels
Technologies must be presented according to `CANDIDATE_TRUTH.md` evidence.
- **Professional Experience** — actually used in verified employment.
- **Verified Project Experience** — actually used in verified projects.
- **Certifications / Training** — supported by verified certifications/training.
- **Learning / Target Technologies** — being learned or intentionally targeted.
Never present a learning/target technology in a way that implies professional production experience.

### 26.3 Never keyword-stuff
- Do not copy every technology or keyword from a job posting into the CV.
- Do not add a technology solely because it appears in the posting.
- Do not convert a job requirement into a claimed skill.
- Tailoring means prioritizing relevant verified experience, not fabricating keyword matches.
- Prefer fewer strong, truthful keywords over a larger list of ambiguous or unsupported ones.

### 26.4 Professional Summary standard
The summary must lead with the strongest verified experience, state the target role/level when useful, highlight relevant verified technologies/responsibilities, and remain natural and recruiter-readable. Avoid long chains of abbreviations or wording that makes learning/target technologies appear to be professional experience.

### 26.5 Skills section standard
- Organize skills into logical categories.
- Prioritize verified professional skills first.
- Keep learning/target technologies visually and semantically distinct.
- Do not use one extremely long compressed technology line.
- Avoid duplicate keywords unless genuinely useful.
- Skills must support the experience section rather than overwhelm it.

### 26.6 Experience bullet standard
When supported by candidate truth, prefer **Action + technology/process + scope/outcome**. Do not invent metrics, outcomes, ownership, tools, or responsibilities.

### 26.7 Projects and certifications
Because Languages and References are permanently prohibited, use reclaimed space for verified **Certifications** and **Projects** when relevant. Do not use either as a backdoor for claiming unsupported professional experience.

### 26.8 One-page rule with quality exception
The default CV target remains exactly one page. Never achieve one page by making the CV unreadably dense. First remove redundancy, weak content, unnecessary wording, and low-value keywords; then optimize spacing/layout. If one page genuinely cannot remain readable after sensible optimization, report the conflict instead of silently producing an overcrowded CV.

### 26.9 Job-specific tailoring
For each approved application: identify the highest-value requirements; map them to verified evidence; prioritize strongest evidence; identify genuine gaps; never disguise gaps as experience; tailor summary, skills emphasis, and experience bullets around truthful matches; keep unrelated technologies from dominating merely because they are searchable keywords.

### 26.10 Final human-readability check
Before declaring a CV ready, confirm the summary is understandable, the skills section is not a keyword wall, professional skills cannot be confused with learning/target technologies, relevant experience is prominent, Projects/Certifications are readable, there are no Languages or References sections, and the CV remains clean and professional at normal viewing size.

---

## 27. APPLICATION TRACKING — COMPLETED SUBMISSIONS

This section records applications that have been fully generated (CV + cover letter), verified, and submitted by the user.

| Date | Company | Role | Tracker Status | Fit Rating | Notes |
|------|---------|------|----------------|------------|-------|
| 2026-08-27 | Satellite Office | IT Service Desk / Desktop Support Analyst (Cross-Skilled) - Rotating Shift | submitted | 89 | Tailored CV and cover letter created; verified 1-page each; cross-skilled Tier 2 EUC + desktop support match; remote arrangement; rotating shift acceptable; salary undisclosed |
| 2026-08-27 | HRTx, Inc. | IT Support Specialist L1/L2 | submitted | 88 | Tailored CV and cover letter created; verified 1-page each; Tier 1/2 service desk match; M365/AD/remote support experience; remote arrangement; onshore collaboration experience; ServiceNow gap acknowledged; salary undisclosed |
