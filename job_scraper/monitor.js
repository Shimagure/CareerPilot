#!/usr/bin/env node
// CareerPilot Progress Monitor & Run-History Recorder (CP15.4)
//
// NON-INVASIVE: observes completed/in-progress pipeline state through the
// existing checkpoints.json and ranked outputs. Does NOT modify the pipeline,
// orchestrator, scheduler, sync, or any data schemas.
//
// NOTIFICATIONS: PushNotification is a Claude Code session tool, not a Node
// runtime API. This module NEVER claims to create persistent scheduled
// notifications. It isolates the notification call behind an injectable
// notifier; the default degrades gracefully (WARN + continue) when
// PushNotification is unavailable, which is the normal case in Node.

const fs = require('fs');
const path = require('path');

const STAGES = [
  'discovery',
  'canonicalization',
  'hard_filter',
  'priority_queue',
  'verification',
  'scoring',
  'ranking_report'
];

const COUNT_KEYS = [
  'jobs_processed_in_stage',
  'total_jobs_in_stage',
  'batch_index',
  'total_batches',
  'passed',
  'deprioritized',
  'queue_length',
  'verified',
  'blocked',
  'changed',
  'closed',
  'top5_count',
  'top10_count'
];

const DEFAULT_PATHS = {
  checkpoints: path.join(__dirname, 'checkpoints.json'),
  top5: path.join(__dirname, 'top5_jobs.json'),
  seenJobs: path.join(__dirname, 'seen_jobs.json'),
  history: path.join(__dirname, 'run_history.json')
};

// ============================================================
// LOGGING
// ============================================================

function log(level, message, ctx = {}) {
  const parts = Object.entries(ctx).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`);
  console.log(`[${level}] ${message}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`);
}

// ============================================================
// FILE HELPERS
// ============================================================

function readJSON(filepath, description) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`Cannot load ${description} from ${filepath}: file not found`);
    }
    throw new Error(`Cannot load ${description} from ${filepath}: ${e.message}`);
  }
}

function saveJSON(filepath, data) {
  const tempPath = filepath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tempPath, filepath);
}

function parseTs(v) {
  if (v == null || typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function pickNumbers(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && typeof obj[k] === 'number' && Number.isFinite(obj[k])) out[k] = obj[k];
  }
  return out;
}

// ============================================================
// CHECKPOINT PARSING
// ============================================================

function loadCheckpoints(filepath = DEFAULT_PATHS.checkpoints) {
  const data = readJSON(filepath, 'checkpoints');
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid checkpoints.json: expected an object, got ${typeof data}`);
  }
  if (!data.current_checkpoint && !Array.isArray(data.run_history)) {
    throw new Error('Invalid checkpoints.json: missing both current_checkpoint and run_history');
  }
  if (data.run_history && !Array.isArray(data.run_history)) {
    throw new Error('Invalid checkpoints.json: run_history must be an array');
  }
  return data;
}

function identifyRun(checkpoints, requestedRunId = null) {
  const cc = checkpoints.current_checkpoint || {};
  const history = Array.isArray(checkpoints.run_history) ? checkpoints.run_history : [];

  if (requestedRunId) {
    const match = history.find(e => e && e.run_id === requestedRunId);
    if (!match) {
      throw new Error(`Run "${requestedRunId}" not found in run_history`);
    }
    return {
      runId: requestedRunId,
      mode: match.mode || cc.mode || null,
      anchorStartedAt: cc.started_at && cc.run_id === requestedRunId ? cc.started_at : null
    };
  }

  if (cc.run_id) {
    return {
      runId: cc.run_id,
      mode: cc.mode || null,
      anchorStartedAt: cc.started_at || null
    };
  }

  // Fall back to the most recent run in run_history by last_updated.
  let latest = null;
  for (const e of history) {
    if (!e || !e.run_id) continue;
    const ts = parseTs(e.last_updated) || parseTs(e.started_at) || 0;
    if (!latest || ts > (parseTs(latest.last_updated) || parseTs(latest.started_at) || 0)) latest = e;
  }
  if (latest) {
    return { runId: latest.run_id, mode: latest.mode || null, anchorStartedAt: parseTs(latest.started_at) ? latest.started_at : null };
  }

  throw new Error('Cannot identify a run: current_checkpoint.run_id is missing and run_history is empty');
}

function reconstructStages(runId, entries, anchorStartedAt, currentCheckpoint = null) {
  const perStage = {};
  for (const e of entries) {
    if (!e || e.run_id !== runId) continue;
    if (!STAGES.includes(e.stage)) continue; // ignore non-orchestrator stages (e.g. legacy 'deduplication')
    perStage[e.stage] = e; // terminal entry for the stage = last one in file order
  }
  // The current (possibly in-progress) stage lives only in current_checkpoint until
  // the pipeline marks it complete/failed and pushes a run_history record. Seed it so
  // an interrupted run reports the live stage instead of 'not_run'.
  if (currentCheckpoint && currentCheckpoint.run_id === runId && currentCheckpoint.stage
      && !perStage[currentCheckpoint.stage]) {
    perStage[currentCheckpoint.stage] = currentCheckpoint;
  }

  const stages = {};
  let prevTimestamp = anchorStartedAt ? parseTs(anchorStartedAt) : null;
  for (const stage of STAGES) {
    const e = perStage[stage];
    if (!e) {
      stages[stage] = { status: 'not_run', started_at: null, completed_at: null, duration_ms: null, counts: {} };
      continue;
    }
    const completedMs = parseTs(e.last_updated);
    const startedMs = prevTimestamp;
    let duration_ms = null;
    if (completedMs != null && startedMs != null && completedMs >= startedMs) {
      duration_ms = completedMs - startedMs;
    }
    stages[stage] = {
      status: e.stage_status || 'unknown',
      started_at: startedMs != null ? new Date(startedMs).toISOString() : null,
      completed_at: completedMs != null ? new Date(completedMs).toISOString() : null,
      duration_ms: duration_ms,
      counts: pickNumbers(e, COUNT_KEYS)
    };
    if (completedMs != null) prevTimestamp = completedMs;
  }
  return stages;
}

function deriveStatus(stages) {
  // SUCCESS only when the pipeline fully completed (terminal ranking_report). Anything
  // short (failed or still in progress) is represented as FAIL without inventing state.
  return stages.ranking_report && stages.ranking_report.status === 'complete' ? 'SUCCESS' : 'FAIL';
}

function extractCounts(checkpoints, runId, stages) {
  const cc = checkpoints.current_checkpoint || {};
  // Base: per-stage counts from the monitored run's own records (later stage wins).
  let counts = {};
  for (const stage of STAGES) {
    const s = stages[stage];
    if (s && s.counts) counts = { ...counts, ...s.counts };
  }
  // The live run's terminal snapshot carries aggregate counts (passed, verified,
  // blocked, top5_count, …) that individual stage records do not. Overlay only when
  // it belongs to THIS run so a historical --run-id never inherits another run's counts.
  if (cc.run_id === runId) {
    counts = { ...counts, ...pickNumbers(cc, COUNT_KEYS) };
  }
  // Add per-stage total when no aggregate total was captured.
  if (typeof counts.total_jobs_in_stage !== 'number' && stages.ranking_report && stages.ranking_report.status !== 'not_run') {
    const ranked = stages.ranking_report.counts.total_jobs_in_stage;
    if (typeof ranked === 'number') counts.ranked = ranked;
  }
  return counts;
}

// ============================================================
// RANKING / PORTAL EVIDENCE
// ============================================================

function loadTop5(filepath = DEFAULT_PATHS.top5) {
  if (!fs.existsSync(filepath)) {
    log('WARN', `top-5 ranking file missing, top_5 empty`, { file: filepath });
    return [];
  }
  const data = readJSON(filepath, 'top-5 ranking');
  if (!Array.isArray(data)) {
    log('WARN', 'top-5 ranking file is not an array, top_5 empty', { file: filepath });
    return [];
  }
  return data.slice(0, 5).map(normalizeTop5Item);
}

function normalizeTop5Item(rec) {
  if (!rec || typeof rec !== 'object') return { rank: null, title: null, company: null, location: null, salary: null, arrangement: null, score: null };
  return {
    rank: typeof rec.rank === 'number' ? rec.rank : null,
    title: rec.title || null,
    company: rec.company || null,
    location: rec.location || null,
    salary: rec.salary || null,
    arrangement: rec.arrangement || null,
    score: (typeof rec.overall === 'number') ? rec.overall : (typeof rec.rank_score === 'number' ? rec.rank_score : null)
  };
}

function derivePortalHealth(seenJobsPath, counts) {
  const result = [];
  if (seenJobsPath && fs.existsSync(seenJobsPath)) {
    try {
      const data = readJSON(seenJobsPath, 'seen_jobs');
      const seenMap = (data && data.seen) || data || {};
      const tally = {};
      let blockedCount = 0;
      for (const rec of Object.values(seenMap)) {
        if (rec && typeof rec === 'object' && rec.blocked_reason) {
          blockedCount += 1;
          const portal = rec.blocked_source || rec.portal || 'unknown';
          tally[portal] = (tally[portal] || 0) + 1;
        }
      }
      for (const [portal, blocked] of Object.entries(tally)) {
        result.push({ portal, blocked });
      }
      result.sort((a, b) => b.blocked - a.blocked);
      if (result.length > 10) result.length = 10;
    } catch (e) {
      log('WARN', `could not read seen_jobs for portal evidence: ${e.message}`);
    }
  }
  if (result.length === 0 && typeof counts.blocked === 'number' && counts.blocked > 0) {
    result.push({ note: 'blocked evidence from orchestration counts', blocked_total: counts.blocked });
  }
  return result;
}

// ============================================================
// SUMMARY
// ============================================================

function buildSummary({ runId, mode, anchorStartedAt, status, stages, counts, top5, portalHealth }) {
  const rankStage = stages.ranking_report;
  let completedAt = null;
  if (rankStage && rankStage.completed_at) completedAt = rankStage.completed_at;
  else {
    for (let i = STAGES.length - 1; i >= 0; i--) {
      const s = stages[STAGES[i]];
      if (s && s.completed_at) { completedAt = s.completed_at; break; }
    }
  }
  return {
    run_id: runId,
    started_at: anchorStartedAt || null,
    completed_at: completedAt,
    mode: mode || null,
    status: status,
    stages: stages,
    counts: counts,
    top_5: top5,
    portal_health: portalHealth
  };
}

function formatSummary(summary) {
  const lines = [`RUN SUMMARY — ${summary.run_id || 'unknown'}`];
  lines.push(`- Mode: ${summary.mode || 'unknown'}`);
  lines.push(`- Status: ${summary.status || 'unknown'}`);
  const stageLine = STAGES.map(s => {
    const st = (summary.stages && summary.stages[s]) || {};
    return `${s}(${st.status || 'unknown'})`;
  }).join(' → ');
  lines.push(`- Stages: ${stageLine}`);
  if (summary.counts && Object.keys(summary.counts).length) {
    lines.push(`- Counts: ${Object.entries(summary.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  if (summary.top_5 && summary.top_5.length) {
    lines.push('- Top 5:');
    summary.top_5.forEach((j, i) => {
      const score = j.score != null ? ` (${j.score})` : '';
      lines.push(`  ${i + 1}. ${j.title} — ${j.company || 'unknown'}${score}`);
    });
  }
  if (summary.portal_health && summary.portal_health.length) {
    lines.push(`- Portal: ${summary.portal_health.map(p => p.portal ? `${p.portal}:${p.blocked}` : (p.note || 'evidence')).join(', ')}`);
  } else {
    lines.push('- Portal: none recorded');
  }
  return lines.join('\n');
}

// ============================================================
// NOTIFICATIONS (isolated, mockable, degradable)
// ============================================================

function defaultNotifier(kind, payload) {
  const runId = payload && payload.run_id ? payload.run_id : '';
  log('WARN', `PushNotification unavailable in Node runtime; ${kind} notification for run ${runId} not sent`, { run_id: runId, kind });
  return { sent: false, unavailable: true, kind };
}

function locateFailedStage(stages) {
  // First non-terminal stage in orchestrator order is the failure/incomplete point.
  let firstIncomplete = null;
  for (const stage of STAGES) {
    const st = stages[stage];
    if (!st) continue;
    if (st.status === 'failed') return { stage, reason: 'stage failed' };
    if (st.status !== 'complete' && st.status !== 'not_run' && !firstIncomplete) {
      firstIncomplete = { stage, reason: `stage ${st.status}` };
    }
  }
  if (!firstIncomplete) {
    for (const stage of STAGES) {
      if (stages[stage] && stages[stage].status === 'not_run') return { stage, reason: 'stage not run' };
    }
  }
  return firstIncomplete || null;
}

function extractErrorContext(checkpoints, failedStage) {
  const cc = checkpoints.current_checkpoint || {};
  if (cc.error) return `checkpoint error: ${cc.error}`;
  if (failedStage) return `stage ${failedStage.stage} terminal state: ${failedStage.reason}`;
  return 'no stage context available';
}

function makeNotifier(impl) {
  return impl || defaultNotifier;
}

// ============================================================
// PERSISTENCE (idempotent by run_id)
// ============================================================

function upsertRun(history, runRecord) {
  const runs = Array.isArray(history.runs) ? history.runs : [];
  const idx = runs.findIndex(r => r && r.run_id === runRecord.run_id);
  if (idx !== -1) runs[idx] = runRecord; // deterministic replace, never duplicate
  else runs.push(runRecord);
  return {
    schema_version: history.schema_version || '1.0',
    runs
  };
}

function persistRunHistory(historyPath, summary) {
  let history;
  try {
    history = readJSON(historyPath, 'run history');
  } catch (e) {
    history = { schema_version: '1.0', runs: [] };
  }
  if (!history || typeof history !== 'object' || !Array.isArray(history.runs)) {
    history = { schema_version: '1.0', runs: [] };
  }
  const updated = upsertRun(history, summary);
  saveJSON(historyPath, updated);
  return updated;
}

// ============================================================
// MAIN MONITOR
// ============================================================

function monitor(options = {}) {
  const checkpointsPath = options.checkpointsPath || DEFAULT_PATHS.checkpoints;
  const top5Path = options.top5Path || DEFAULT_PATHS.top5;
  const seenJobsPath = options.seenJobsPath || DEFAULT_PATHS.seenJobs;
  const historyPath = options.historyPath || DEFAULT_PATHS.history;

  const checkpoints = loadCheckpoints(checkpointsPath);
  const { runId, mode, anchorStartedAt } = identifyRun(checkpoints, options.runId || null);

  log('INFO', `monitoring run`, { run_id: runId, mode: mode || 'unknown' });

  const stages = reconstructStages(runId, checkpoints.run_history || [], anchorStartedAt, checkpoints.current_checkpoint || null);
  const status = deriveStatus(stages);
  const counts = extractCounts(checkpoints, runId, stages);
  const top5 = loadTop5(top5Path);
  const portalHealth = derivePortalHealth(seenJobsPath, counts);
  const summary = buildSummary({ runId, mode, anchorStartedAt, status, stages, counts, top5, portalHealth });
  const summaryText = formatSummary(summary);

  let notification = null;
  let persisted = false;

  if (!options.dryRun) {
    const notifier = makeNotifier(options.notifier);
    if (status === 'SUCCESS') {
      notification = notifier('completion', { kind: 'completion', run_id: runId, summary: summaryText, summaryObject: summary });
    } else {
      const failed = locateFailedStage(stages);
      const context = extractErrorContext(checkpoints, failed);
      notification = notifier('failure', {
        kind: 'failure',
        run_id: runId,
        failed_stage: failed ? failed.stage : null,
        context,
        summary: summaryText,
        summaryObject: summary
      });
    }
    const updated = persistRunHistory(historyPath, summary);
    persisted = Array.isArray(updated.runs) && updated.runs.some(r => r.run_id === runId);
    log('INFO', `run history persisted${options.historyPath ? ` to ${historyPath}` : ''}`, { run_id: runId });
  } else {
    log('INFO', 'dry-run: summary built, nothing persisted, no notification', { run_id: runId });
  }

  log('INFO', `monitor complete`, { run_id: runId, status });
  return { summary, summaryText, status, notification, persisted, historyPath };
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    checkpointsPath: DEFAULT_PATHS.checkpoints,
    top5Path: DEFAULT_PATHS.top5,
    seenJobsPath: DEFAULT_PATHS.seenJobs,
    historyPath: DEFAULT_PATHS.history,
    runId: null,
    dryRun: false
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--checkpoints') options.checkpointsPath = args[++i] || DEFAULT_PATHS.checkpoints;
    else if (arg === '--top5') options.top5Path = args[++i] || DEFAULT_PATHS.top5;
    else if (arg === '--seen-jobs') options.seenJobsPath = args[++i] || DEFAULT_PATHS.seenJobs;
    else if (arg === '--history') options.historyPath = args[++i] || DEFAULT_PATHS.history;
    else if (arg === '--run-id') options.runId = args[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(CLI_HELP);
      process.exit(0);
    } else {
      console.error(`Error: unknown option "${arg}". Use --help for available options.`);
      process.exit(1);
    }
  }
  return options;
}

const CLI_HELP = `Usage: node job_scraper/monitor.js [options]

Options:
  --checkpoints <path>   checkpoints.json path (default: job_scraper/checkpoints.json)
  --top5 <path>          top-5 ranking output path (default: job_scraper/top5_jobs.json)
  --seen-jobs <path>     seen_jobs.json path for portal/blocked evidence (default: job_scraper/seen_jobs.json)
  --history <path>       run history output path (default: job_scraper/run_history.json)
  --run-id <id>          monitor a specific run_id from run_history
  --dry-run              build the summary only; do not persist history or notify
  --help, -h             show this help

Non-invasive monitor: reads only. Reconstructs the 7 orchestrator stages
(discovery → canonicalization → hard_filter → priority_queue → verification →
scoring → ranking_report) from existing checkpoint data and persists an
idempotent per-run record to run_history.json.

Notifications: PushNotification is a Claude Code session tool, not a Node API.
This CLI does NOT create persistent scheduled notifications; if a notifier is
unavailable the monitor emits a WARN and completes successfully.`;

if (require.main === module) {
  try {
    const options = parseArgs();
    const result = monitor(options);
    console.log('\n' + result.summaryText + '\n');
    process.exit(0);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  STAGES,
  DEFAULT_PATHS,
  log,
  readJSON,
  saveJSON,
  parseTs,
  pickNumbers,
  loadCheckpoints,
  identifyRun,
  reconstructStages,
  deriveStatus,
  extractCounts,
  loadTop5,
  normalizeTop5Item,
  derivePortalHealth,
  buildSummary,
  formatSummary,
  defaultNotifier,
  locateFailedStage,
  extractErrorContext,
  makeNotifier,
  upsertRun,
  persistRunHistory,
  monitor,
  parseArgs,
  CLI_HELP
};