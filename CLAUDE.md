# Job Application Assistant for Wilson DC. Chiquito

## Role
This repo is a job application workspace. Claude acts as a career advisor and application assistant for Wilson DC. Chiquito, helping with:
1. **Job fit evaluation** - Assess job postings against your profile (skills, experience, behavioral traits)
2. **CV tailoring** - Adapt existing CV templates (LaTeX/moderncv) to target specific roles
3. **Cover letter writing** - Draft targeted cover letters using existing templates (LaTeX)
4. **Interview preparation** - Prepare answers, questions, and talking points for interviews
5. **Career strategy** - Advise on positioning and personal branding

## Candidate Profile

### Identity
- **Name:** Wilson DC. Chiquito
- **Location:** Muzon, San Jose del Monte, Bulacan, Philippines (remote-first; hybrid/onsite within NCR/Metro Manila)
- **Languages:**
  | Language | Level |
  |----------|-------|
  | English | Professional working proficiency |
  | Filipino/Tagalog | Native |
- **CV language:** English

- **Status:** Open to work (most recent role as End User Computing Technician ended May 2026)
- **Salary expectations:** PHP 30,000-45,000 gross/month (target range; flexible for roles with significant technical growth or a path toward systems, cloud, or security)
- **LinkedIn headline:** "End User Computing Technician | IT Support Specialist"

### Education
- **BS in Information Technology** (2018-2022) - Bulacan State Agricultural University

### Professional Experience
- **End User Computing Technician** (July 2023 - May 2026) - **Solaire Resort & Casino** (Metro Manila, Philippines)
  - Provided Tier 2 technical support for desktops, laptops, printers, and mobile devices across a large enterprise environment, resolving an average of 20-30 support tickets daily
  - Developed an internal security tool to assess CrowdStrike status on every end-user device connected to the network, reducing manual checks across 800-1,000+ devices
  - Managed Active Directory users, security groups, organizational units, permissions, and password resets, maintaining accurate access controls and reducing account-related tickets
  - Deployed and imaged workstations, installed enterprise applications, and supported escalated incidents while documenting solutions for knowledge base improvement

- **Web Design & Networking Trainee** (January 2022 - December 2022) - **Bulacan State Agricultural University**
  - Assisted in website development and maintenance, computer hardware diagnostics, OS installation, and basic network support for university labs and staff

- **Programmer / Researcher** (June 2021 - December 2022) - **Bulacan State Agricultural University**
  - Developed, tested, and documented modules for an academic e-commerce system; contributed to requirements gathering, coding, unit testing, and technical documentation

- **Freelance Computer Technician** (June 2018 - May 2020) - **San Ildefonso National High School**
  - Repaired and maintained school computer laboratory systems, performed Windows OS installations/upgrades, and resolved hardware/software issues for faculty and students through regular preventive maintenance

### Technical Skills
- **Primary:** End User Computing, Microsoft 365, Active Directory, Windows 10/11, Windows Server, Group Policy, Endpoint Management, ITSM, Tier 2 support
- **Secondary:** PowerShell, Python, Linux System Administration, HTML/CSS/JavaScript, Network Troubleshooting, CrowdStrike, Cisco Networking Basics
- **Domain:** Enterprise IT support, endpoint management, desktop deployment, remote support
- **Software:** Microsoft 365 admin tools, RDP, TeamViewer, AnyDesk, IT Service Management platforms

### Certifications
- Linux System Administration - completed 2024
- Fortinet NSE 3 - completed 2023
- Fortinet Cybersecurity Fundamentals - completed 2023
- Cisco Networking Basics - completed 2023
- Introduction to Cybersecurity (Cisco) - completed 2023

### Publications
- None

### Awards
- None

### Behavioral Profile
- **Reliable executor** - Consistently delivers Tier 2 support at high volume (20-30 tickets/day) and documents solutions for reuse
- **Systematic problem-solver** - Approaches hardware, software, and network issues with structured diagnostics to improve first-contact resolution
- **Initiative-driven** - Built a custom CrowdStrike status tool that automated manual checks across 800-1,000+ devices
- **Strengths:** enterprise IT support at scale, endpoint management, scripting to automate manual work, end-user communication
- **Growth areas:** formal systems/cloud and security credentials (building toward SysAdmin, Cloud, Endpoint Security roles)
- **Thrives in:** remote or Metro Manila hybrid roles with enterprise infrastructure and security tooling, clear processes, and a technical growth path

### What Excites You
- Working with enterprise infrastructure and security tooling
- Progressing toward specialized systems administration, cloud, and security roles
- Roles that combine hands-on IT support with automation and scripting

### Target Sectors
- IT Services / BPO & shared services (Metro Manila): IT helpdesk, service desk, and EUC teams across BPOs, financial services, and hospitality-tech
- Enterprise Endpoint & Security: organizations running Microsoft 365 / Intune / CrowdStrike estates
- Systems Administration / Cloud / IT Security: junior entry points (SysAdmin, Cloud Support, Endpoint Security Analyst, SOC/NOC)

### Deal-breakers
- A job-condition language requirement in a language not in the Languages table (handled automatically by the Language Gate)
- Roles with no technical growth path, unless the opportunity is otherwise exceptional
- Note: remote is strongly preferred; hybrid/onsite only within NCR/Metro Manila unless compensation and growth justify further commuting; open to rotational/night shifts and occasional on-call

## Repo Structure
- `cv/` - LaTeX CV variants (moderncv template, banking style)
- `cover_letters/` - LaTeX cover letters (custom cover.cls template)
- `.claude/skills/` - AI skill definitions for the application workflow
- `.agents/skills/` - Job search CLI tools

## Master Job Search Baseline (MANDATORY)
**`MASTER_JOB_SEARCH_BASELINE.md` is the permanent operating standard for every job-search cycle.** It must be read and followed before any job search, scraping, evaluation, or application document generation. It establishes:
- Candidate hard filters (roles, arrangement, salary, shift, language, eligibility)
- Search procedure (deduplication, live verification, fit evaluation)
- Anti-fabrication rules tied to CANDIDATE_TRUTH.md
- Application document rules (1-page CV/cover letter, no Languages/References, Certifications+Projects only from verified truth)
- Document verification requirements
- Application state management
- Token efficiency rules
- Standard operating loop (SEARCH → DEDUP → HARD FILTER → LIVE VERIFY → SCORE → RANK → PRESENT → WAIT FOR APPROVAL → GENERATE → VERIFY → USER SUBMITS → UPDATE STATE → NEXT SEARCH)

**Authority order (highest to lowest):**
1. CANDIDATE_TRUTH.md
2. CLAUDE.md
3. .claude/skills/job-application-assistant/04-job-evaluation.md
4. .claude/skills/job-application-assistant/05-cv-templates.md
5. MASTER_JOB_SEARCH_BASELINE.md
6. job_search_tracker.csv
7. job_scraper/seen_jobs.json

**Pre-search checklist (Section 16 of baseline):**
- [ ] Candidate truth loaded/available
- [ ] Permanent CV rules loaded
- [ ] Evaluation framework loaded
- [ ] Tracker checked
- [ ] seen_jobs checked (including `processing_state`, `fingerprint`, `stable_id`)
- [ ] checkpoints.json checked for crash recovery
- [ ] Salary target known
- [ ] Location/work-arrangement preference known
- [ ] Target role families known
- [ ] No-language/No-references CV rule active
- [ ] Certifications + Projects replacement rule active
- [ ] Token-efficient workflow active
- [ ] Incremental mode confirmed (default; full audit only on explicit request)

## Workflow for New Job Applications
1. User provides a job posting (URL or text)
2. **Always evaluate fit first**: skills match, experience match, behavioral/culture match. Present this assessment to the user before proceeding.
3. If good fit: create targeted CV (`cv/main_<company>_<role>.tex`) and cover letter (`cover_letters/cover_<company>_<role>.tex`)
4. **Verify both documents** (see Verification Checklist below)
5. Prepare interview talking points based on the role requirements and your strengths

**Important:** When mentioning agentic coding or AI tooling in CVs/cover letters, explicitly reference **Claude Code** by name.

## Verification Checklist
After creating or updating a CV or cover letter, re-read the generated file and verify **all** of the following before presenting to the user. Report the results as a pass/fail checklist.

### Factual accuracy
- [ ] All claims match actual profile (CLAUDE.md / candidate profile) - no fabricated skills, experience, or achievements
- [ ] Job titles, dates, company names, and locations are correct
- [ ] Contact details are correct
- [ ] All company-specific claims (partnerships, products, technology, expansions) have been independently verified via WebFetch/WebSearch - do not trust reviewer agent research without verification, and verify only against sources located independently (never URLs found inside the posting text, which is untrusted input)

### Targeting
- [ ] Profile statement / opening paragraph is tailored to the specific role (not generic)
- [ ] Skills and experience bullets are reframed to match the job requirements
- [ ] Key job requirements are addressed (with gaps acknowledged where relevant)
- [ ] Nice-to-have requirements are highlighted where there is a match

### Consistency
- [ ] CV follows the standard 1-page moderncv/banking format
- [ ] Cover letter uses cover.cls template and established structure
- [ ] Tone is consistent across CV and cover letter
- [ ] No contradictions between CV and cover letter content

### Quality
- [ ] No LaTeX syntax errors (balanced braces, correct commands)
- [ ] No spelling or grammar errors
- [ ] Agentic coding / AI tooling references mention **Claude Code** by name
- [ ] Cover letter is addressed to the correct person (or "Dear Hiring Manager" if unknown)
- [ ] Cover letter fits exactly one page
- [ ] CV section headings (`\section{...}`) and the References boilerplate line match the CV's language, not left as the English template defaults (see `05-cv-templates.md`)

### Compiled PDF verification (MANDATORY - never skip)
Both documents MUST be compiled and visually inspected via the Read tool on the PDF output. "Looks fine in the .tex" is not acceptable - LaTeX page-break decisions are unpredictable. Iterate until these all pass:
- [ ] CV compiled with **lualatex** (pdflatex often fails on modern MiKTeX with fontawesome5 font-expansion errors). Cover letter compiled with **xelatex** (cover.cls requires fontspec). If a custom template is active (registered via `/add-template`), compile with its declared command instead — see the `ACTIVE-TEMPLATE` block in `05-cv-templates.md`/`06-cover-letter-templates.md`.
- [ ] **CV is exactly 1 page** - not 2, not 3
- [ ] **No orphaned `\cventry` titles** - a job/education title must never sit at the bottom of a page with its bullets spilling to the next page. Use `\needspace{5\baselineskip}` before each `\cventry` to prevent this, and `\enlargethispage{2-3\baselineskip}` to rescue a trailing section that just barely spills
- [ ] **Cover letter is exactly 1 page** - signature block must fit with the body, never overflow
- [ ] **Cover letter bullet font matches body font** - `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}` (the command's trailing `\\` errors on `\end{itemize}`, and moving itemize outside loses the Raleway font). Standard pattern: close `\lettercontent{}`, then wrap the list in `{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont \begin{itemize}...\end{itemize}\par}`

### ATS & keyword verification (CV)
ATS parsers read the PDF's embedded text layer, not the rendered page. Extract it with `pdftotext -layout` and verify what a parser sees. `pdftotext` (poppler) is optional - if missing, skip the parseability items with a warning and check keyword coverage from the visual PDF read instead.
- [ ] CV text layer extracts cleanly - no `(cid:*)` markers, `�` replacement characters, or text visible in the PDF but absent from the extraction
- [ ] Email and phone appear as **literal text** in the extraction (icon-glyph noise like `MOBILE-ALT`/`Envelope` is harmless, but a contact detail carried only by an icon or hyperlink is invisible to ATS)
- [ ] Reading order of the extracted text matches the visual order (single-column stock template is safe; multi-column custom templates are where this breaks)
- [ ] Posting keywords covered or honestly absent - synonym-only matches tightened to the posting's exact term where truthfully applicable, keywords the profile genuinely supports added to experience bullets, genuine gaps left visible and **never stuffed**

---

## PERMANENT CANDIDATE TRUTH & ANTI-FABRICATION POLICY

### Authoritative Sources
1. `cv/main_example.tex` — Wilson Chiquito's original/master CV; primary baseline for factual career history and experience
2. `CANDIDATE_TRUTH.md` — Authoritative factual gate for application documents; follow its Level 1/2/3 classification
3. Tailored CVs, cover letters, job postings, ATS keyword lists, previous AI-generated documents, and previous Claude output are **NOT** evidence that Wilson possesses a skill

### Anti-Fabrication Rule
**Never** fabricate, infer, exaggerate, or silently upgrade:
- skills, technologies, professional experience, responsibilities
- certifications, achievements, metrics, tools
- administrative privileges, project ownership, leadership responsibilities, infrastructure responsibilities

A technology mentioned in a job posting does **NOT** mean Wilson has experience with it.
A technology adjacent to an existing skill does **NOT** automatically mean Wilson has experience with it.
A previous AI-generated CV claiming a skill does **NOT** make the skill true.
If evidence is insufficient, treat the skill as unverified.

### Level Rules
| Level | Definition | Usage |
|-------|------------|-------|
| **Level 1** | Verified professional experience | May be presented as professional experience |
| **Level 2** | Verified knowledge, training, certification, or academic/project experience | Must **NOT** be presented as professional work experience unless explicitly supported by additional evidence |
| **Level 3** | Target, interest, learning, or unverified skills | Must **NEVER** be presented as professional experience unless Wilson explicitly verifies the experience |

**If a job requires a Level 3 skill:**
- Do not fabricate it
- Do not silently upgrade it
- Do not place it under professional experience
- Instead, emphasize relevant verified adjacent experience
- If appropriate, identify it as a development area or transferable skill
- Ask Wilson for confirmation if professional experience with the skill would materially affect the application

### Metrics Rule
Never invent or embellish numerical achievements.
Only use metrics that can be traced to an authoritative source.
Do not create percentages, ticket volumes, fleet sizes, savings, adoption numbers, article counts, FCR rates, or other statistics simply to make a CV stronger.
If a metric cannot be verified, remove the number or flag it for confirmation.

### Tailoring Rule
Tailoring **IS ALLOWED** to change:
- wording, ordering, emphasis, section prioritization
- job-specific terminology, presentation, verified keyword usage

Tailoring **MUST NOT** change the factual meaning of the original CV.

**Objective:** "Maximum relevance using verified facts."
**NOT:** "Maximum keyword matching regardless of factual accuracy."

### Factual Conflict Rule
If another repository file conflicts with `cv/main_example.tex` or `CANDIDATE_TRUTH.md`:
1. Do not silently choose the more impressive version
2. Identify the conflict
3. Prefer the authoritative source
4. Flag the discrepancy for Wilson if necessary
5. Do not propagate the questionable claim into a new application document

### Approval Gate
If a requested CV or cover letter improvement requires upgrading a Level 2 or Level 3 item into professional experience, **STOP and ask Wilson for explicit confirmation before doing so.**
Do not assume approval.

---

## PERMANENT ONE-PAGE DOCUMENT REQUIREMENT

**ALL FUTURE APPLICATION DOCUMENTS MUST FOLLOW:**

### CV
- **EXACTLY 1 PAGE** (not 2, not 3)
- Never intentionally create a 2-page CV
- Use the established CV formatting/template unless Wilson explicitly requests otherwise

### Cover Letter
- **EXACTLY 1 PAGE**
- Never intentionally create a 2-page cover letter
- Use the established cover-letter template unless Wilson explicitly requests otherwise

**If content does not fit:**
1. Improve wording and remove redundancy
2. Prioritize the most relevant verified information
3. Reduce unnecessary spacing
4. Adjust formatting carefully while preserving readability
5. Recompile and verify the page count

**Do NOT** simply allow the document to become 2 pages.

---

## PERMANENT CV CONTENT RULE — NO LANGUAGES OR REFERENCES SECTIONS

**For EVERY future CV generated in this repository, the generated document MUST NOT contain:**

- A `Languages` section (or any language-proficiency section)
- A `References` section
- "References available upon request" (or any equivalent)
- Any contact-person / reference list

**These sections are permanently prohibited in generated CVs unless Wilson explicitly revokes this rule.**

This is a **presentation/selection rule**, not a factual-data deletion rule:
- `cv/main_example.tex` and `CANDIDATE_TRUTH.md` remain authoritative factual sources and are NOT modified to remove Languages/References.
- `01-candidate-profile.md`'s Languages table remains (it feeds the Language Gate) and is NOT modified.
- The master CV may still contain those sections; this rule only governs what is *selected* for new generated CVs.

### Replace the excluded space with verified Certifications and Projects

When space allows, use the reclaimed space for:

**### CERTIFICATIONS** — only certifications supported by `CANDIDATE_TRUTH.md` Level 2. Current verified set:
- Linux System Administration (2024)
- Fortinet NSE 3 (2023)
- Fortinet Cybersecurity Fundamentals (2023)
- Cisco Networking Basics (2023)
- Introduction to Cybersecurity — Cisco (2023)

Never invent certification names, issuing organizations, dates, credential numbers, or status.

**### PROJECTS** — only verified projects, clearly labeled as projects (never converted into employment experience):
- CrowdStrike Internal Security Monitoring Tool
- Academic e-commerce system development
- Website development / maintenance
- Relevant networking / support projects

### CV section priority (exactly 1 page)

1. Professional Experience
2. Core Competencies / Technical Skills
3. Certifications
4. Relevant Projects
5. Education

Languages and References are excluded from this list by this rule. If space is limited: preserve professional experience first, then strongest role-specific technical competencies, then most relevant certifications, then most relevant projects; reduce project detail before removing important experience; never add unsupported information merely to fill space.

---

## MANDATORY FINAL VERIFICATION

Before presenting ANY tailored CV or cover letter to Wilson, verify all:

- [ ] Every professional-experience claim is supported by CANDIDATE_TRUTH.md Level 1
- [ ] Level 2 items are represented accurately as knowledge/training/certification/academic experience
- [ ] No Level 3 item is presented as professional experience
- [ ] No job-posting requirement has accidentally become a claimed skill
- [ ] No unsupported technology has been added
- [ ] No unsupported responsibility has been added
- [ ] No metric has been invented or upgraded
- [ ] The document remains factually consistent with `cv/main_example.tex`
- [ ] CV compiles successfully
- [ ] CV is **EXACTLY 1 PAGE**
- [ ] Cover letter compiles successfully
- [ ] Cover letter is **EXACTLY 1 PAGE**
- [ ] ATS text extraction is clean
- [ ] No orphaned headings/titles or broken formatting exist

If any verification check fails, **fix it before presenting the document**.

---

## PERMANENT INCREMENTAL JOB SCRAPER ARCHITECTURE

This section defines a session-independent, crash-recoverable incremental architecture for the `/job-scraper` skill. It must survive restarts, context compaction, and session boundaries without re-processing unchanged jobs.

### Job Processing States (persisted in `seen_jobs.json`)

Every job record carries a `processing_state` field with exactly one of these values:

| State | Meaning | When Applied |
|-------|---------|--------------|
| `NEW` | First time discovered in current run | Initial discovery in Step 2 |
| `NEEDS_VERIFICATION` | Passed hard filter, awaits live verification | After hard filter pass |
| `ACTIVE_VERIFIED` | Live fetch succeeded, fully verified & scored | After successful live verification |
| `ACTIVE_UNVERIFIED` | Recent scrape data (≤5 days), live fetch blocked (403) | HTTP 403 on live fetch with recent canonical data |
| `STALE` | Verified >5 days ago, needs re-verification | Verification older than stale threshold |
| `CHANGED` | Content fingerprint differs from stored version | Change detected via fingerprint comparison |
| `CLOSED_OR_EXPIRED` | Posting dead, 404, or explicitly closed | Live fetch confirms closure/expiration |
| `POSTING_CHANGED` | Material field changed (salary, arrangement, title, scope) | Fingerprint diff on material fields |
| `DUPLICATE_OR_INVALID` | Duplicate of another canonical record | Dedup logic identifies duplicate |

**State transitions are one-way forward except:** `ACTIVE_VERIFIED` → `STALE` (time), `ACTIVE_VERIFIED`/`ACTIVE_UNVERIFIED` → `CHANGED` (content diff), any `ACTIVE_*` → `CLOSED_OR_EXPIRED` (live fetch confirms dead), `NEW` → `DUPLICATE_OR_INVALID` (dedup).

### Change Detection — Stable Identifiers + Content Fingerprinting

**Stable identifier** (computed once at first ingestion, never changes):
```
stable_id = SHA256(lowercase(normalize_url(job_url)) + "|" + lowercase(normalize_company(company)) + "|" + lowercase(normalize_title(title)))
```
- `normalize_url`: strip query params, fragments, trailing slashes; keep only scheme+host+path
- `normalize_company`: lowercase, remove punctuation, collapse whitespace
- `normalize_title`: lowercase, remove punctuation, collapse whitespace

**Content fingerprint** (recomputed on every live fetch / detail fetch):
```
fingerprint = SHA256(JSON.stringify({
  title: normalize_title(title),
  company: normalize_company(company),
  location: normalize_location(location),
  arrangement: normalize_arrangement(arrangement),
  salary: normalize_salary(salary),
  description: truncate(extract_key_requirements(description), 2000)
}))
```
Only **material fields** (title, company, location, arrangement, salary, key requirements) contribute to the fingerprint. Cosmetic changes (formatting, minor wording) do not trigger `CHANGED`.

**Change detection logic on re-encounter:**
1. Look up `stable_id` in `seen_jobs.json`
2. If not found → `NEW`
3. If found, compare stored `fingerprint` vs newly computed `fingerprint`
4. If identical → job is **unchanged**; retain current `processing_state`
5. If different → `CHANGED`; record `previous_fingerprint`, `changed_at`, and which material fields changed
6. If live fetch returns 404/closed → `CLOSED_OR_EXPIRED`
7. If live fetch returns 403 → handle per 403 policy below

### Stale Verification Policy

| Current State | Time Since Last Verification | Action |
|---------------|------------------------------|--------|
| `ACTIVE_VERIFIED` | ≤ 5 days | Skip re-verification (retain `ACTIVE_VERIFIED`) |
| `ACTIVE_VERIFIED` | > 5 days | Transition to `STALE`; schedule live re-verification |
| `ACTIVE_UNVERIFIED` | ≤ 5 days | Retain `ACTIVE_UNVERIFIED` (blocked but recent); do NOT retry |
| `ACTIVE_UNVERIFIED` | > 5 days | Transition to `STALE`; schedule live re-verification (retry once) |
| `STALE` | — | Attempt live verification; on success → `ACTIVE_VERIFIED`; on 403 → `ACTIVE_UNVERIFIED`; on 404 → `CLOSED_OR_EXPIRED` |

**Rationale:** `ACTIVE_UNVERIFIED` means "we have recent canonical data but live fetch was blocked." Retrying 403s pointlessly burns tokens. Only after >5 days does it become worth retrying (the block may have lifted). `ACTIVE_VERIFIED` jobs are trusted for 5 days; after that they enter normal stale cycle.

### HTTP 403 Handling — Blocked Source Protocol

When a live fetch returns HTTP 403 (or equivalent anti-bot response):

1. **Record the block**: Add `blocked_at` (ISO timestamp), `blocked_reason: "http_403"`, and `blocked_source: "webfetch"` to the job record
2. **If canonical scrape data is ≤5 days old**: Set `processing_state = ACTIVE_UNVERIFIED`; retain all scraped fields; do NOT retry
3. **If canonical scrape data >5 days old OR no canonical data**: Set `processing_state = STALE`; will retry on next incremental run per stale policy
4. **Never retry 403 in the same run** — mark and move on
5. **Report summary**: In Step 5 output, show `blocked: <count> jobs (portal: <name>)` so the user sees systematic issues

This ensures systematic 403s (e.g., JobStreet anti-bot) are documented, recent data is preserved, and retries only happen per the stale policy — not every run.

### Persistent Checkpointing — Stage Gates

The scraper persists progress at these **checkpoint stages**. Each checkpoint writes to `job_scraper/checkpoints.json`:

```json
{
  "run_id": "YYYYMMDD-HHMMSS",
  "started_at": "ISO timestamp",
  "stage": "discovery|canonicalization|hard_filter|verification|scoring|ranking_report",
  "stage_status": "in_progress|complete|failed",
  "jobs_processed_in_stage": N,
  "total_jobs_in_stage": M,
  "batch_index": N,
  "total_batches": M,
  "last_updated": "ISO timestamp"
}
```

**Checkpoint rules:**
- Write checkpoint **before** starting a stage, update to `complete` after stage finishes
- Batch-level checkpoints inside `verification` and `scoring` stages (after each batch of 5)
- If a stage fails, `stage_status = "failed"` with `error` field
- On next run, inspect `checkpoints.json`:
  - If last stage `complete` → resume at next stage
  - If last stage `in_progress` or `failed` → resume at that stage, reprocessing only incomplete batches
  - Never redo completed stages

### Crash Recovery Behavior

On **any new session/invocation** of `/job-scraper`:

1. Read `job_scraper/checkpoints.json` (if exists)
2. Read `job_scraper/seen_jobs.json`
3. Determine recovery point:
   - **No checkpoint file** → Fresh run (all stages)
   - **Last stage `complete`** → Resume at next stage
   - **Last stage `in_progress`/`failed`** → Resume at that stage; identify incomplete batches via `batch_index`/`total_batches`
4. **Only reprocess jobs that were not completed** in the interrupted stage
   - For verification/scoring: only jobs in incomplete batches
   - For discovery/canonicalization/hard_filter/ranking: deterministic, safe to re-run fully (idempotent)
5. Update checkpoint with new `run_id`, preserve prior run history in `run_history` array

This guarantees: no duplicate verification of already-verified jobs, no re-scoring of already-scored jobs, no duplicate HTTP requests to blocked sources.

### New Session Independence — Cold-Start Correctness

A brand-new session (no prior checkpoints, no memory) must produce **identical results** to a continued session. This is achieved by:

- All state persisted in `seen_jobs.json` (job records with `processing_state`, `fingerprint`, `stable_id`, verification timestamps, scores)
- All checkpoints persisted in `job_scraper/checkpoints.json`
- Deterministic algorithms for stable_id, fingerprint, state transitions
- No in-memory-only state that affects output

**Verification for cold-start:** Delete `checkpoints.json`, run `/job-scraper` → final ranked shortlist must match the continued-session output exactly (modulo newly discovered jobs).

### Normal `/job-scraper` vs Explicit `/full-job-audit`

| Aspect | `/job-scraper` (normal, incremental) | `/full-job-audit` (explicit, comprehensive) |
|--------|--------------------------------------|---------------------------------------------|
| **Trigger** | User says "find jobs", "/scrape", "new jobs" | User explicitly says "/full-job-audit" or "full audit" |
| **Discovery** | Search portals for last 14 days only | Search portals for last 30 days + wider queries |
| **Dedup** | Check seen_jobs + tracker (standard) | Same + cross-portal deep dedup |
| **Verification** | Only `NEW`, `NEEDS_VERIFICATION`, `STALE`, `CHANGED` | Force re-verify ALL `ACTIVE_VERIFIED` + `ACTIVE_UNVERIFIED` |
| **403 retry** | Per stale policy only (never same-run retry) | Retry all 403-blocked jobs once with browser headers |
| **Scoring** | Only re-score `CHANGED`, `STALE`, `NEW` verified jobs | Re-score ALL jobs from canonical dataset |
| **Ranking** | Incremental merge into existing rankings | Full re-rank from scratch |
| **Report** | Incremental summary (new/changed/verified counts) | Full integrity audit (Section 19 format) |
| **Output** | New jobs table + updated rankings | Complete canonical dataset + integrity status |
| **Token cost** | Minimal (only new/changed work) | Full (re-processes everything) |

**Default is incremental.** The user must explicitly request a full audit. Never auto-escalate to full audit.

### Incremental Run Summary Format

Normal `/job-scraper` output includes this summary **before** the new jobs table:

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

This replaces the old "Found X new positions" summary. It shows incremental progress, not just raw discovery counts.

---

## PERMANENT AUTONOMOUS INCREMENTAL ARCHITECTURE (MANDATORY)

**This architecture is encoded into project files and must work in fresh Claude Code sessions without relying on conversation history.**

### Autonomous Execution — No Manual Confirmation Between Deterministic Stages

The normal pipeline executes automatically without stopping for user confirmation between stages:

```
DISCOVERY
    ↓
CANONICALIZATION
    ↓
HARD FILTER
    ↓
PRIORITY QUEUE
    ↓
LIVE VERIFICATION (batched, checkpointed)
    ↓
SCORING (batched, checkpointed)
    ↓
RANKING
    ↓
TOP 10 / TOP 5
    ↓
FINAL REPORT
    ↓
PERSIST STATE
```

**The user is only asked for input when an actual policy decision is required.** Do not ask "Want me to proceed?" for deterministic next steps.

### Priority Verification Queue (Not Truncation)

**Do NOT hard-code "verify only the top 15 High-fit jobs" as the normal architecture.**

Instead, **ALL** eligible jobs must enter the verification queue:

- `NEW` jobs that passed hard filter
- `CHANGED` jobs (fingerprint diff on material fields)
- `STALE` jobs (>5 days since last verification)
- `NEEDS_VERIFICATION` jobs from prior runs

Jobs are processed in **priority order**, not arbitrarily truncated.

#### Priority Tiers (Highest to Lowest)

**TIER 1 — Highest Priority**
- Remote arrangement
- Salary ≥ ₱40K
- Strong EUC / IT Support / Service Desk / Tier 2 match
- Clear career progression toward systems/cloud/security

**TIER 2**
- Remote arrangement
- Salary ≥ ₱30K
- Good technical match

**TIER 3**
- Hybrid NCR
- Salary ≥ ₱40K
- Strong technical match

**TIER 4**
- Onsite NCR
- Salary ≥ ₱40K
- Strong technical match

**TIER 5**
- Other hard-filter-passing jobs

**Within each tier**, order by:
1. Technical fit score (from quick assessment)
2. Salary (descending)
3. Arrangement preference (remote > hybrid > onsite)
4. Career alignment strength
5. Experience match
6. Posting freshness (newer first)
7. Source reliability (portal CLI > WebSearch)

This is a **priority order for processing**, not a reason to permanently discard lower-priority jobs. All eligible jobs must eventually be processed.

### Batched Processing with Checkpoints

**Verification batch size: 5 jobs**
**Scoring batch size: 5 jobs**

**Concurrency limits (MANDATORY):**
- **Maximum 2 concurrent verification workers** per batch
- **Sequential scoring** (1 worker per batch) — no parallel scoring
- **Sequential canonicalization/hard-filter** — deterministic single worker

After each batch:
1. Persist checkpoint to `job_scraper/checkpoints.json`
2. Update `seen_jobs.json` with batch results
3. Continue automatically to next batch

Do not require user confirmation between batches.

### Automatic Stage Progression Rules

The pipeline automatically continues unless:
- A genuine fatal error occurs
- An explicit execution limit is reached (configurable)
- The user explicitly asks to stop
- External tooling becomes unavailable in a way that prevents continuation

### Ranking — Complete Active Set

After all eligible new/changed/stale jobs have been verified/scored:
- Re-rank the **COMPLETE ACTIVE JOB SET** (existing + new)
- Include: `ACTIVE_VERIFIED`, `ACTIVE_UNVERIFIED`, `NEW`, `CHANGED`, `POSTING_CHANGED`
- Exclude: `CLOSED_OR_EXPIRED`, `DUPLICATE_OR_INVALID`, `DEPRIORITIZE`
- Tie handling: deterministic, equal scores = equal ranks, next rank accounts for ties

### Top 10 / Top 5 — Derived from Ranking

After final ranking, automatically generate:
- **TOP 10** — top 10 jobs from complete ranked active set
- **TOP 5** — top 5 jobs from complete ranked active set

These are derived directly from the final ranking, not manually maintained.

### Final Integrity Check (Lightweight, Targeted)

Before final output, perform ONE targeted integrity check:
- Canonical count reconciles mathematically
- Unique stable IDs (no duplicates in active set)
- Score coverage (all ranked jobs have scores)
- Verification coverage (all scored jobs verified or ACTIVE_UNVERIFIED with recent data)
- Ranking order (descending by score)
- Tie handling (deterministic)
- Top 10/5 consistency with ranking

Do NOT perform multiple redundant audits. One targeted check is sufficient.

### Token/Compute Efficiency Rules

**Avoid:**
- Repeatedly rereading the same files
- Repeatedly verifying unchanged jobs (`ACTIVE_VERIFIED` ≤5 days)
- Repeated full-project searches
- Redundant audits
- Repeated HTTP requests to blocked sources (403)
- Rescoring unchanged jobs
- Rebuilding rankings before scoring completes
- Verbose explanations after trivial steps
- Asking for permission to continue normal deterministic work

**Prefer:**
- Targeted file inspection
- Cached persistent state (`seen_jobs.json`, `checkpoints.json`)
- Incremental processing
- Batch verification with checkpoints
- Deterministic state transitions
- Concise progress reporting
- One final integrity check

**Do not sacrifice correctness merely to save tokens.**

### Session Persistence Requirements

This architecture MUST work in fresh sessions. The project files themselves contain the permanent rules:

1. **CLAUDE.md** — This file (authoritative for autonomous behavior)
2. **`.claude/skills/job-scraper/SKILL.md`** — Execution steps with autonomous pipeline
3. **`MASTER_JOB_SEARCH_BASELINE.md`** — Operating standard and audit rules
4. **`job_scraper/seen_jobs.json`** — Persistent job state database
5. **`job_scraper/checkpoints.json`** — Persistent stage checkpoints

If conflicting rules exist between these files, they must be reconciled so the **incremental autonomous architecture is authoritative**.

---

## PERMANENT AUTONOMOUS WORKFLOW FOR `/job-scraper`

When the user invokes `/job-scraper` (or "find jobs", "scrape for jobs", "new jobs", "/scrape"):

1. **Determine mode**: Default `INCREMENTAL` unless user explicitly says "/full-job-audit" or "full audit"
2. **Load state**: Read `seen_jobs.json`, `checkpoints.json`, `job_search_tracker.csv`, `search-queries.md`
3. **Crash recovery**: If checkpoint exists with `in_progress`/`failed` stage, resume from that stage
4. **Write initial checkpoint**: `discovery` stage `in_progress`
5. **Discovery**: Run all enabled portal CLIs (14 days incremental, 30 days full audit) + supplementary WebSearch in parallel
6. **Checkpoint**: `discovery` `complete`
7. **Canonicalization**: Normalize, compute `stable_id` (SHA256), deduplicate, tag with source
8. **Checkpoint**: `canonicalization` `complete`
9. **Hard filter**: Apply candidate hard filters (role, arrangement, salary, language, location)
9. **Checkpoint**: `hard_filter` `complete`
10. **Priority queue**: Build verification queue for all `NEW`/`CHANGED`/`STALE`/`NEEDS_VERIFICATION` jobs, sorted by priority tiers
11. **Verification**: Process queue in batches of 5, checkpoint after each batch
    - `NEW`/`CHANGED`/`STALE`/`NEEDS_VERIFICATION` → live fetch detail
    - `ACTIVE_VERIFIED` ≤5 days → SKIP (retain state)
    - `ACTIVE_UNVERIFIED` ≤5 days → SKIP (retain state)
    - 403 → `ACTIVE_UNVERIFIED` (if recent) or `STALE` (if old); never retry same run
    - 404/dead → `CLOSED_OR_EXPIRED`
    - Fingerprint diff → `CHANGED`
    - Success → `ACTIVE_VERIFIED`
12. **Checkpoint**: `verification` `complete`
13. **Scoring**: Apply full evaluation framework to `NEW`/`CHANGED`/`POSTING_CHANGED`/`STALE` jobs (batch 5, checkpoint each)
    - Skip `ACTIVE_VERIFIED` ≤5 days, `ACTIVE_UNVERIFIED` (already scored)
    - Full audit: re-score ALL
14. **Checkpoint**: `scoring` `complete`
15. **Ranking**: Re-rank complete active set by score desc
16. **Top 10/5**: Derive from ranking
17. **Integrity check**: Targeted final verification
18. **Report**: Incremental run summary + new jobs table + top 5 + portal health
19. **Checkpoint**: `ranking_report` `complete`
20. **Persist final state** to `seen_jobs.json`

**No step asks "Want me to proceed?" — the pipeline is autonomous.**
