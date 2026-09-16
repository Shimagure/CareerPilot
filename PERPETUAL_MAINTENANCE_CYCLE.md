# CareerPilot — Perpetual Autonomous Maintenance Cycle

**Session plan for the long-lived CareerPilot Claude Code daemon**

---

## Operating Principles

1. **One long-lived, stateful Claude Code session** (`/loop`-aware, compaction-tolerant). State lives in files, never in conversation context. Survives context compaction and worker handoff.
2. **Multiple parallel worker agents**, each with its own context window. Scale workers against the pending queue. Low-judgment work runs autonomously at worker level; official language choices stay manual.
3. **Automated outputs are internal and templated.** Never amateur, never mistaken for a finished deliverable. Academic or over-polished formal language in automated outputs is normalized to generic template phrasing.
4. **Emergency mode**: gated Claude Code feature (not currently available in this environment). Contingency layout in §9 applies the moment it is enabled.

---

## 1. Session & Worker Model

| Element | Role |
|---------|------|
| **Daemon session** | One persistent Claude Code session, /loop-aware. Owns orchestration, scheduling, and decision gates. |
| **Worker pool** | Fresh subagents (isolated context windows) for low-judgment tasks. Fork subagents when parent context is needed. |
| **Pending queue** | `job_scraper/.queue/pending.jsonl` — append-only task log. Each entry: `{id, kind, params, judgment: "low"|"high", created_at}`. |
| **State files** | `checkpoints.json`, `seen_jobs.json`, `run_history.json`, `portal_health.json` (CP15.5), `schedules.json`, `top5_jobs.json`. All survive compaction. |

**Scaling rule**: pending queue length minus idle workers = spawn count (capped at 4 workers max). Low-judgment → fresh agent with template output. High-judgment → route to manual gate (§6).

---

## 2. Resource Schedule / Agenda

| Cadence | Time (approx) | Task | Source |
|---------|---------------|------|--------|
| **Idle tick** | Every 20–30 min | Drain maintenance queue, health probes, reconcile schedules vs CronCreate | /loop noop |
| **Daily** | ~08:57 | Incremental scrape → sync_to_db → monitor persist | CP15.3 `incremental` schedule |
| **Daily** | ~11:47 | Portal health check → auto-disable if >50% 403 (CP15.5) | CP15.3 `portal-health` + `portal_health.js check` |
| **Weekly** | Sat ~09:13 | Full audit (currently disabled; manual enable to activate) | CP15.3 `weekly-audit` |
| **Post-change** | On demand | Run test suites for modified modules | `node <module>.test.js` |

**Pacing**: ScheduleWakeup ≤270s for active waits (stays in prompt cache); 1200–1800s for idle ticks. Consecutive noop ticks collapsed in terminal output.

---

## 3. Monitoring Map

| Signal | Artifact | Check | Action if red |
|--------|----------|-------|---------------|
| Pipeline health | `checkpoints.json` + `run_history.json` | `monitor.js` status = FAIL | Investigate failed stage; do not auto-retry |
| Portal access health | `portal_health.json` (CP15.5) | 7-day rolling 403 rate >50% | Auto-disable portal SKILL.md `enabled: false` |
| Sync integrity | `run_history.json` counts vs backend | Discrepancy in job counts | Log warning; manual reconciliation |
| Schedule liveness | `schedules.json` + CronCreate status | Enabled schedule not installed | Reinstall from `scheduler.js prompts` |
| File integrity | Portal SKILL.md files | `enabled` key present and valid YAML | Fail-safe nonzero; never auto-fix formatting |
| Queue health | `.queue/pending.jsonl` | Stale entries >24h | Log warning; surface to Wilson |

---

## 4. Maintenance Map

| Chore | Cadence | How |
|-------|---------|-----|
| Prune `.claude/tmp/` | Daily idle tick | Remove files >24h old |
| Prune `.scratch_*` dirs | Weekly | Remove empty scratch dirs |
| Prune `.scrape_out/` | Weekly | Remove files >7 days old |
| Run test suites | After any module change | `node monitor.test.js`, `node scheduler.test.js`, `node portal_health.test.js` |
| Verify SKILL.md integrity | Weekly | Check all 10 portal SKILL.md files have valid `enabled:` key |
| Monitor `run_history.json` growth | Monthly | If >100 runs, flag for archival |
| Verify no fabricated data | After CP15.5 lands | Confirm `portal_health.json` has no invented history |

---

## 5. Automation Map (Low-Judgment, Templated)

| Task | Autonomy | Output template |
|------|----------|-----------------|
| Run status summary | Full auto (worker) | `[STATUS] run <id>: <SUCCESS|FAIL> | stages: <compact> | counts: <compact>` |
| Portal health status | Full auto (worker) | `[PORTAL] <portal>: <ok|blocked|disabled> | 403 rate: <pct>` |
| Sync status | Full auto (worker) | `[SYNC] run <id>: <synced|skipped> | jobs: <n>` |
| Queue drain report | Full auto (worker) | `[QUEUE] drained: <n> tasks | pending: <m>` |
| Test suite result | Full auto (worker) | `[TEST] <module>: <pass>/<total> PASS` |

**Output policy**: All automated outputs use generic template language. No academic prose, no over-polished phrasing, no external-facing content. Official language choices (CV, cover letters, applications, formal reports) remain manual gates (§6).

---

## 6. Manual Decision Gates — Never Automated

These operations STOP and require Wilson's explicit confirmation:

- Official language in external-facing artifacts (CVs, cover letters, applications)
- Enabling a portal that was auto-disabled by CP15.5 (manual CLI only, by Wilson's request)
- Salary, arrangement, or preference changes
- `git push`, `git commit` (unless pre-authorized in CLAUDE.md), PR creation/merge
- Any Level 2 → Level 1 skill upgrade in application documents
- Deploy or publish operations
- Anything the `MASTER_JOB_SEARCH_BASELINE.md` gate requires as "WAIT FOR APPROVAL"

Rule: automation never sends, submits, or publishes to outsiders.

---

## 7. Pending Queue & Worker-Scaling Runbook

**Queue file**: `job_scraper/.queue/pending.jsonl` (create if absent; append-only during operation; truncate on daily drain completion).

**Entry schema**:
```json
{"id":"<uuid>","kind":"<status|health|test|cleanup|scrape>","params":{},"judgment":"low","created_at":"<ISO>","status":"pending|running|done|failed"}
```

**Spawn logic** (each idle tick):
1. Count entries with `status: "pending"`.
2. Count currently running workers (spawned this session, not yet completed).
3. `to_spawn = min(pending_count - idle_workers, 4)`.
4. For each spawn: pick highest-priority pending entry, set `status: "running"`, launch fresh subagent with task-specific prompt + template output spec.
5. On worker completion: set entry `status: "done"`, log result to `.queue/done.jsonl`.

**High-judgment entries**: never spawned as workers. Routed to the daemon session's next manual gate checkpoint.

---

## 8. STEP 2 — Session Boot & Recovery Runbook

Execute this runbook at session start, after context compaction, after any interrupt, and whenever a maintenance prompt fires.

> **FALLTHROUGH: use all steps of step 2**

1. Load this document (`PERPETUAL_MAINTENANCE_CYCLE.md`).
2. `git status` — detect uncommitted or abandoned work. Investigate before any cleanup.
3. Read state files: `checkpoints.json`, `schedules.json`, `run_history.json`, `portal_health.json` (if exists), `seen_jobs.json`. Determine recovery point.
4. Reconcile `schedules.json` enabled entries vs live CronCreate jobs (session-scoped; reinstall enabled schedules from `scheduler.js prompts` output).
5. Drain maintenance queue from head (§7).
6. Checkpoints: if last stage `in_progress` or `failed` → resume per CLAUDE.md crash recovery rules.
7. Report compact status to Wilson (one summary line per active signal).
8. Resume normal idle-tick cadence (§2).

---

## 9. Emergency-Mode Layouts (Contingency)

Emergency Mode is a Claude Code feature gated behind user-provided tools. It is **not currently available** in this environment. The following layouts apply the moment it is enabled or a heavyweight session is needed.

| Class | Trigger | Layout |
|-------|---------|--------|
| **NORMAL** | Default operation | Long-lived daemon + worker pool (this document) |
| **HEAVYWEIGHT** | Complex multi-model reasoning needed "today" | Fork Claude onto heaviest-capable model; give isolated worktree + read-only inputs; suspend all other workers during its turn |
| **INSPECT** | Suspected data corruption or pipeline misbehavior | Suspend automation; read-only triage only; produce evidence document; no writes |
| **RESTORE** | State files damaged or missing | From surviving state files + git history, rebuild working set; never fabricate; verify each artifact before reuse |

**"Run today" map** (when Wilson is present and wants immediate action):
1. Run STEP 2 recovery (§8).
2. Execute any pending high-judgment queue entries.
3. Run incremental scrape if not yet run today.
4. Review portal health status.
5. Surface any red signals from the monitoring map (§3).

---

## 10. Living Document

This file is maintained alongside the pipeline. Update triggers:
- CP15.5 implementation complete → add `portal_health.js` references to monitoring/automation maps
- CP15.6 API landed → add backend health endpoint to monitoring map
- New portal added → update SKILL.md integrity check count
- Schedules changed → update §2 table
- Worker scaling rules adjusted → update §1 and §7

**Change log**:

| Date | Change | Author |
|------|--------|--------|
| 2026-09-11 | Initial creation | Claude (CP15.5 prep) |

---

*This document is the schedule. Wilson rests; the cycle runs.*
