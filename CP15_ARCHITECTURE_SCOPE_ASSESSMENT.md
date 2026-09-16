# CP15 — Job Scraper Automation Layer Architecture Assessment

**Date:** 2026-09-10  
**Status:** ARCHITECTURE INSPECTION COMPLETE  
**Scope:** Determine CP15 logical scope, checkpoint breakdown, and implementation plan

---

## Executive Summary

The job_scraper pipeline is a **complete, functional incremental architecture** with robust state management, crash recovery, and retention logic. The system successfully processes jobs through discovery → canonicalization → hard_filter → verification → scoring → ranking with checkpoint-based recovery.

**What exists:**
- 17 Node.js scripts implementing all pipeline stages
- Checkpoint-based crash recovery system (checkpoints.json)
- State machine with 9 processing states (NEW, ACTIVE_VERIFIED, STALE, etc.)
- Stable identifiers (SHA256) + content fingerprinting for change detection
- 28-day retention policy with application-protected preservation
- HTTP 403 handling with ACTIVE_UNVERIFIED state
- Priority-based verification queue (Tier 1-5)
- Batched processing (5 jobs per batch)
- 12 portal CLI adapters in .agents/skills/

**What is missing:**
- **Autonomous scheduling/orchestration** — No CronCreate, ScheduleWakeup, or /loop automation
- **Unified orchestration script** — Individual scripts must be run manually in sequence
- **Automatic resume-from-checkpoint** — Crash recovery logic exists but requires manual invocation
- **Session-independent execution** — Pipeline depends on Claude skill invocation (/scrape)
- **Progress monitoring/notifications** — No proactive status updates during long runs
- **Error handling/retry logic** — Scripts fail silently without notification
- **Portal health monitoring automation** — Health checks are manual-only
- **Stale job re-verification automation** — >5-day jobs require manual re-run
- **Integration with backend API** — Pipeline outputs (ranked_jobs.json) not synced to careerpilot.db

**CP15 logical scope:** Build the autonomous orchestration and scheduling layer that makes the existing pipeline run automatically, recover from failures, and integrate with the frontend.

---

## 1. What CP15 Should Accomplish

Based on the architecture inspection, CP15 should deliver:

### 1.1 Autonomous Pipeline Orchestration
- Unified orchestration script that runs the complete pipeline end-to-end
- Automatic checkpoint-based recovery when resuming from failure
- Progress notifications at stage boundaries
- Error handling with meaningful failure messages
- Validation that each stage produced expected outputs before continuing

### 1.2 Scheduled Execution
- Recurring job search runs (daily incremental searches)
- Stale job re-verification (jobs >5 days old)
- Portal health checks (proactive 403/404 detection)
- Retention policy enforcement (28-day active pool cleanup)

### 1.3 Backend Integration
- Sync ranked_jobs.json → careerpilot.db after each successful run
- Update job records with processing_state, rank, scores
- Preserve application-protected jobs during sync
- Expose pipeline status via backend API endpoints

### 1.4 Monitoring & Observability
- Run history with success/failure status
- Stage-level timing metrics
- Portal health status tracking
- Error logging with context
- User notifications for completed runs and failures

---

## 2. Existing Functionality That Must Be Preserved

### 2.1 Core Pipeline Architecture (MANDATORY PRESERVATION)

| Component | Implementation | Status |
|-----------|---------------|--------|
| **State machine** | 9 processing states (NEW, ACTIVE_VERIFIED, ACTIVE_UNVERIFIED, STALE, CHANGED, POSTING_CHANGED, CLOSED_OR_EXPIRED, DUPLICATE_OR_INVALID, NEEDS_VERIFICATION) | ✅ Working |
| **Stable identifiers** | SHA256(url + company + title) | ✅ Working |
| **Content fingerprinting** | SHA256(material fields: title, company, location, arrangement, salary, description) | ✅ Working |
| **Checkpoints** | checkpoints.json with schema_version 1.0, run_history array, stage tracking | ✅ Working |
| **Crash recovery** | Resume from last incomplete stage, reprocess only incomplete batches | ✅ Implemented but manual |
| **Deduplication** | Across portals by stable_id, tracker URLs excluded | ✅ Working |
| **Hard filters** | Role, arrangement, salary, language, location gates | ✅ Working |
| **Priority queue** | Tier 1-5 based on remote/salary/technical match | ✅ Working |
| **Batched verification** | 5 jobs per batch with checkpoints | ✅ Working |
| **HTTP 403 handling** | ACTIVE_UNVERIFIED state, no same-run retry | ✅ Working |
| **Retention policy** | 28-day active pool, application protection | ✅ Working (retention.js) |
| **Scoring framework** | 8 dimensions (technical_fit, experience_fit, location_fit, salary_fit, arrangement_fit, growth_fit, strengths_match, certifications_bonus) | ✅ Working |
| **Ranking** | Descending by score, tie-breaker by date | ✅ Working |

### 2.2 Data Files (MUST NOT CORRUPT)

| File | Size | Purpose | Protection Required |
|------|------|---------|---------------------|
| **seen_jobs.json** | 49,252 lines | Primary state database with all job records | Critical — backup before writes |
| **canonical_jobs.json** | 14,643 lines | Canonicalized job records from last run | Overwrite per-run, preserve old as canonical_YYYYMMDD.json |
| **ranked_jobs.json** | 6,224 lines | Final ranked output | Overwrite per-run, preserve old as ranked_jobs_YYYYMMDD.json |
| **checkpoints.json** | Run history | Checkpoint tracking with run_history array | Append-only for run_history, overwrite current run fields |
| **priority_queue_*.json** | Per-run snapshots | Verification priority queue | Per-run timestamped files |
| **top5_jobs.json, top10_jobs.json** | Derived outputs | Top N from ranking | Regenerate from ranked_jobs.json |

### 2.3 Portal CLI Adapters (12 Portals)

All portal adapters in `.agents/skills/` must continue working:
- bossjob-search
- freehire-search (if exists)
- indeed-search
- jobbank-search (if exists)
- jobdanmark-search (if exists)
- jobindex-search (if exists)
- jobnet-search (if exists)
- jobstreet-search
- kalibrr-search
- linkedin-search
- (2 additional portals from grep results)

**Preserved behavior:**
- `enabled: true/false` toggle in SKILL.md frontmatter
- Portal-specific CLI flags and output formats
- 14-day scope for incremental, 30-day for full audit
- Result cap: ~20 per portal incremental, ~50 full audit
- JSON output via `--format json`
- Parallel execution where possible

### 2.4 Verification & Scoring Logic

**Must preserve:**
- Live fetch with HTTP 403/404 handling
- Fingerprint-based change detection
- Material fields only (title, company, location, arrangement, salary, description first 2000 chars)
- 5-day stale threshold for re-verification
- ACTIVE_UNVERIFIED retention (≤5 days, blocked but recent)
- Scoring against CANDIDATE profile from CLAUDE.md
- No fabrication of skills/experience not in CANDIDATE_TRUTH.md
- Evaluation framework from 04-job-evaluation.md

### 2.5 Anti-Fabrication & Factual Safety

**Permanent rules (cannot be changed by CP15):**
- CANDIDATE_TRUTH.md as factual authority
- Level 1/2/3 classification for skills
- No metric invention
- No responsibility upgrade
- Language Gate (automatic fail for non-English/Filipino requirements)
- Eligibility Gate (explicit verification required)

---

## 3. What Is Missing (CP15 Implementation Targets)

### 3.1 Orchestration Layer

**Current state:** 17 separate Node.js scripts, must be run manually in correct sequence

**Missing:**
```
job_scraper/
├── orchestrator.js        ❌ NOT EXISTS — unified pipeline runner
├── scheduler.js           ❌ NOT EXISTS — recurring execution via CronCreate
├── recovery.js            ❌ NOT EXISTS — automatic checkpoint recovery
└── monitor.js             ❌ NOT EXISTS — progress notifications
```

**Required functionality:**
- Single entry point that runs complete pipeline
- Reads checkpoints.json, determines resume point
- Executes stages in order: discovery → canonicalization → hard_filter → verification → scoring → ranking
- Validates stage outputs before continuing
- Writes checkpoints after each stage
- Catches errors, logs context, notifies user
- Returns final summary with counts, top 5, portal health

### 3.2 Scheduling Infrastructure

**Current state:** No automation — user must manually invoke `/scrape`

**Missing:**
- CronCreate integration for recurring runs
- Daily incremental search (14-day scope, top 3 query categories)
- Weekly full audit option (30-day scope, all query categories)
- Stale job re-verification (every 2 days, process jobs >5 days old)
- Portal health checks (daily, detect 403/404 patterns)
- Retention enforcement (weekly, apply 28-day policy)

**Proposed schedule:**
```javascript
// Daily incremental search at 8:57am local (off-peak)
CronCreate({ cron: "57 8 * * *", prompt: "/scrape incremental", recurring: true })

// Stale re-verification every 2 days at 2:17pm
CronCreate({ cron: "17 14 */2 * *", prompt: "/scrape reverify-stale", recurring: true })

// Weekly full audit Saturday 9:13am
CronCreate({ cron: "13 9 * * 6", prompt: "/scrape full-audit", recurring: true })

// Daily portal health check at 11:47am
CronCreate({ cron: "47 11 * * *", prompt: "/scrape health", recurring: true })
```

### 3.3 Backend Integration

**Current state:** Pipeline outputs to JSON files; frontend reads from careerpilot.db; no sync

**Missing:**
- Sync script: ranked_jobs.json → careerpilot.db `jobs` table
- State reconciliation: seen_jobs.json `processing_state` → db `processing_state`
- Application protection: preserve jobs with linked applications during updates
- API endpoints for pipeline status, run history, portal health
- WebSocket/SSE for live progress updates to frontend

**Required sync logic:**
```sql
-- Upsert jobs from ranked_jobs.json
INSERT INTO jobs (stable_id, title, company, ..., rank, rank_score, processing_state)
VALUES (?, ?, ?, ..., ?, ?, ?)
ON CONFLICT(stable_id) DO UPDATE SET
  title = excluded.title,
  rank = excluded.rank,
  rank_score = excluded.rank_score,
  processing_state = excluded.processing_state,
  updated_at = CURRENT_TIMESTAMP
WHERE jobs.stable_id NOT IN (
  SELECT job_stable_id FROM applications WHERE available = 1
);
-- Preserve application-protected jobs
```

### 3.4 Monitoring & Error Handling

**Current state:** Scripts log to stdout; failures are silent

**Missing:**
- Structured logging with log levels (INFO, WARN, ERROR)
- Error context preservation (stage, batch, job stable_id)
- User notifications via PushNotification for:
  - Run completion with summary
  - Stage failures with error message
  - Portal 403 blocks detected
  - Stale jobs requiring re-verification
- Run history table/file:
  ```json
  {
    "run_id": "20260910033000",
    "started_at": "2026-09-10T03:30:00.000Z",
    "completed_at": "2026-09-10T03:45:23.456Z",
    "mode": "INCREMENTAL",
    "status": "SUCCESS",
    "stages": {
      "discovery": { "status": "complete", "jobs": 45, "duration_ms": 12340 },
      "canonicalization": { "status": "complete", "jobs": 45, "duration_ms": 890 },
      "hard_filter": { "status": "complete", "passed": 32, "failed": 13, "duration_ms": 450 },
      "verification": { "status": "complete", "verified": 28, "blocked": 3, "closed": 1, "duration_ms": 156000 },
      "scoring": { "status": "complete", "scored": 28, "duration_ms": 8900 },
      "ranking": { "status": "complete", "ranked": 28, "duration_ms": 340 }
    },
    "top_5": [ /* top 5 jobs */ ],
    "portal_health": [ /* portal status */ ]
  }
  ```

### 3.5 Portal Health Automation

**Current state:** Manual health check via `/scrape health`

**Missing:**
- Automatic health monitoring every run
- 403 pattern detection (>50% of portal results blocked → disable portal)
- Portal enable/disable automation (update SKILL.md frontmatter `enabled: false`)
- Health status API endpoint for frontend dashboard
- Historical health tracking (success rate over time)

---

## 4. Recommended CP15 Checkpoint Breakdown

### Checkpoint 15.1 — Unified Orchestration Script
**Scope:** Single entry point that runs the complete pipeline end-to-end  
**Deliverables:**
- `job_scraper/orchestrator.js` — master pipeline runner
- Reads checkpoints.json, determines resume point (fresh vs recovery)
- Executes stages in sequence: discovery → canonicalization → hard_filter → verification → scoring → ranking
- Validates stage outputs (file exists, non-empty, valid JSON, expected schema)
- Writes checkpoint after each stage
- Error handling with context preservation
- Final summary output (incremental run format from baseline Section 15)

**Test criteria:**
- ✅ Fresh run completes all stages
- ✅ Interrupted run resumes from correct checkpoint
- ✅ Stage validation catches missing/corrupted output
- ✅ Error includes stage name, job stable_id if applicable
- ✅ Summary matches baseline format

**Dependencies:** None  
**Estimated complexity:** Medium (300-400 lines)  
**Risk:** Low — purely orchestration, no pipeline logic changes

---

### Checkpoint 15.2 — Backend Database Sync
**Scope:** Sync pipeline outputs to careerpilot.db after successful runs  
**Deliverables:**
- `job_scraper/sync_to_db.js` — sync ranked_jobs.json → db
- Upsert logic with application protection
- State reconciliation (processing_state, rank, rank_score)
- Dry-run mode for validation
- Sync verification (count reconciliation)

**Test criteria:**
- ✅ Jobs upserted correctly with rank, score, state
- ✅ Application-protected jobs NOT overwritten
- ✅ Dry-run shows changes without applying
- ✅ Count reconciliation matches (db count = active jobs in ranked_jobs.json)

**Dependencies:** CP15.1 (orchestrator produces ranked_jobs.json)  
**Estimated complexity:** Medium (250-300 lines)  
**Risk:** Medium — must preserve application data integrity

---

### Checkpoint 15.3 — Scheduling Infrastructure
**Scope:** Recurring execution via CronCreate for daily searches, stale re-verification  
**Deliverables:**
- `job_scraper/scheduler.js` — CronCreate wrapper
- Daily incremental search (8:57am, 14-day scope)
- Stale re-verification (every 2 days, 2:17pm)
- Optional weekly full audit (Saturday 9:13am)
- Daily portal health check (11:47am)
- Schedule status reporting (CronList integration)

**Test criteria:**
- ✅ Cron jobs created with correct schedules
- ✅ Incremental search runs at scheduled time
- ✅ Stale re-verification identifies >5-day jobs
- ✅ CronList shows active schedules
- ✅ User can disable schedules

**Dependencies:** CP15.1 (orchestrator), CP15.2 (sync)  
**Estimated complexity:** Small (150-200 lines)  
**Risk:** Low — CronCreate is stable

---

### Checkpoint 15.4 — Progress Monitoring & Notifications
**Scope:** Real-time progress updates and completion notifications  
**Deliverables:**
- Stage-boundary progress messages
- PushNotification on run completion/failure
- Error context logging
- Run history persistence (job_scraper/run_history.json)
- Summary format with portal health, top 5, counts

**Test criteria:**
- ✅ Progress messages at each stage boundary
- ✅ PushNotification on completion with summary
- ✅ Error notification includes stage + context
- ✅ Run history records success/failure with timing
- ✅ Portal health status included in summary

**Dependencies:** CP15.1 (orchestrator)  
**Estimated complexity:** Small (100-150 lines)  
**Risk:** Low — pure monitoring, no pipeline changes

---

### Checkpoint 15.5 — Portal Health Automation
**Scope:** Automatic portal disable on repeated 403 blocks  
**Deliverables:**
- Portal health tracker (job_scraper/portal_health.json)
- 403 pattern detection (>50% blocked → disable)
- Automatic SKILL.md frontmatter update (`enabled: false`)
- Health history (7-day rolling window)
- Health status API endpoint for frontend

**Test criteria:**
- ✅ Portal disabled after >50% 403 rate
- ✅ SKILL.md frontmatter updated correctly
- ✅ Health history tracks success rate over time
- ✅ Frontend can query portal health status

**Dependencies:** CP15.1 (orchestrator), CP15.4 (monitoring)  
**Estimated complexity:** Medium (200-250 lines)  
**Risk:** Medium — modifies SKILL.md files

---

### Checkpoint 15.6 — Backend API Integration
**Scope:** Expose pipeline status, run history, portal health via API  
**Deliverables:**
- `backend/routes/pipeline.ts` — new routes
  - `GET /api/pipeline/status` — current run status
  - `GET /api/pipeline/runs` — run history with pagination
  - `GET /api/pipeline/portals` — portal health status
  - `POST /api/pipeline/trigger` — manual run trigger
- Frontend integration (optional, stretch goal)

**Test criteria:**
- ✅ API returns current pipeline status
- ✅ Run history paginated correctly
- ✅ Portal health status accurate
- ✅ Manual trigger starts orchestrator

**Dependencies:** CP15.1 (orchestrator), CP15.2 (sync), CP15.4 (monitoring), CP15.5 (health)  
**Estimated complexity:** Medium (200-250 lines backend + minimal frontend)  
**Risk:** Low — read-only API, no pipeline changes

---

## 5. Dependencies Between Checkpoints

```
CP15.1 Orchestrator (foundation)
    ├── CP15.2 Backend Sync (consumes orchestrator output)
    ├── CP15.3 Scheduling (invokes orchestrator)
    ├── CP15.4 Monitoring (hooks into orchestrator stages)
    └── CP15.5 Portal Health (consumes orchestrator run data)
            └── CP15.6 Backend API (aggregates all data for frontend)
```

**Critical path:** CP15.1 → CP15.2 → CP15.3  
**Parallel work possible:** CP15.4, CP15.5 can be developed concurrently after CP15.1  
**Final integration:** CP15.6 depends on all prior checkpoints

---

## 6. Risks to Existing Behavior

### 6.1 State Corruption Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **seen_jobs.json corruption** | CRITICAL — loss of all job state | Backup before every write; atomic writes via temp file + rename |
| **Checkpoint race condition** | Medium — duplicate processing | Single-writer pattern; lock file during orchestrator run |
| **Application data overwrite** | HIGH — user's tracked applications lost | Application protection in sync logic; dry-run validation |
| **Rank score regression** | Medium — incorrect job ordering | Validate scoring inputs match expected schema; test scoring on known jobs |

### 6.2 Behavioral Regression Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Incremental mode broken** | HIGH — re-processes all jobs every run | Preserve ACTIVE_VERIFIED ≤5-day skip logic; test incremental vs full audit |
| **Deduplication failure** | Medium — duplicate jobs in ranking | Test deduplication against known duplicates; validate stable_id computation |
| **Hard filter regression** | Medium — irrelevant jobs pass through | Test hard filter against baseline cases; preserve filter keyword lists |
| **403 handling changed** | Medium — repeated failed fetches | Preserve ACTIVE_UNVERIFIED state; no same-run retry logic |

### 6.3 Integration Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Backend sync breaks applications** | CRITICAL — frontend shows wrong data | Dry-run validation; count reconciliation; application protection tests |
| **Scheduling floods API** | Medium — too many concurrent runs | Single-instance enforcement; lock file; cron job spacing |
| **Portal disable cascades** | Low — all portals disabled | Conservative 403 threshold (>50%); manual re-enable mechanism |

---

## 7. Smallest Sensible First Checkpoint

**Recommendation: Start with CP15.1 (Unified Orchestration Script)**

**Rationale:**
- Foundation for all other checkpoints
- Independently testable without backend/scheduling changes
- Demonstrates complete pipeline execution
- Validates crash recovery logic
- Low risk — no schema changes, no application data touched
- Immediate value — user can run `/scrape orchestrated` instead of manual sequence

**Success criteria for CP15.1:**
1. Fresh run completes discovery → canonicalization → hard_filter → verification → scoring → ranking
2. Interrupted run (kill mid-verification) resumes from verification checkpoint
3. Stage validation catches corrupted output and fails gracefully
4. Error message includes stage name and context
5. Final summary matches baseline incremental run format
6. No changes to seen_jobs.json schema or existing job records
7. Top 5 jobs match manual pipeline run

**Deliverable:** `job_scraper/orchestrator.js` (~350 lines)

**Test plan:**
```bash
# Fresh run
node job_scraper/orchestrator.js --mode incremental

# Interrupted run (Ctrl+C during verification)
node job_scraper/orchestrator.js --mode incremental
# Resume
node job_scraper/orchestrator.js --mode incremental --resume

# Dry run (no writes)
node job_scraper/orchestrator.js --mode incremental --dry-run

# Full audit
node job_scraper/orchestrator.js --mode full-audit
```

---

## 8. Token Efficiency & Reduced Verification

CP15 must honor the **reduced-verification rule** (baseline Section 14.1):

**DO NOT:**
- Re-verify ACTIVE_VERIFIED jobs ≤5 days old
- Re-fetch unchanged canonical data
- Re-run completed pipeline stages
- Repeatedly check unchanged configuration
- Verbose progress narration (concise stage boundaries only)

**DO:**
- Reuse checkpoints.json state
- Skip already-verified jobs in incremental mode
- Resume from last incomplete stage on crash
- Validate stage outputs once per stage
- Concise final summary only

---

## 9. What CP15 Will NOT Do (Out of Scope)

- ❌ Modify existing pipeline scripts (canonicalize.js, verify_jobs.js, score_jobs.js, etc.)
- ❌ Change state machine definitions or processing_state values
- ❌ Alter stable_id or fingerprint computation
- ❌ Modify hard filter keywords or scoring weights
- ❌ Change 5-day stale threshold or 28-day retention policy
- ❌ Add new portal adapters (use `/add-portal` skill)
- ❌ Modify MASTER_JOB_SEARCH_BASELINE.md rules
- ❌ Change CANDIDATE_TRUTH.md or anti-fabrication policy
- ❌ Frontend redesign (CP14 complete)
- ❌ Application document generation (existing `/apply` skill)
- ❌ CV/cover letter templates (out of scope)

---

## 10. Conclusion

**CP15 is a pure orchestration and automation layer.** The job_scraper pipeline is architecturally complete and functionally correct. CP15's role is to make it autonomous, scheduled, monitored, and integrated with the frontend — without touching the core pipeline logic.

**Recommended approach:**
1. Start with CP15.1 (orchestrator) — validates the complete pipeline
2. Add CP15.2 (backend sync) — integrates with frontend
3. Add CP15.3 (scheduling) — makes it autonomous
4. Polish with CP15.4 (monitoring) and CP15.5 (portal health)
5. Optional CP15.6 (backend API) for frontend dashboard

**Estimated total scope:** 1,200-1,400 lines across 6 checkpoints  
**Estimated time:** 3-5 sessions (1 checkpoint per session, testing between)  
**Risk level:** Low to Medium — no pipeline logic changes, careful state preservation

**Next step:** User approval to begin CP15.1 implementation.

---

*Assessment complete. Stop after this report per user instructions.*
