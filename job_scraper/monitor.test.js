const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const {
  STAGES, readJSON, saveJSON, parseTs, pickNumbers,
  loadCheckpoints, identifyRun, reconstructStages,
  deriveStatus, extractCounts, loadTop5, normalizeTop5Item,
  derivePortalHealth, buildSummary, formatSummary,
  defaultNotifier, locateFailedStage, extractErrorContext, makeNotifier,
  upsertRun, persistRunHistory, monitor
} = require('./monitor.js');

const MONITOR_JS = path.join(__dirname, 'monitor.js');

// ============================================================
// TEST HELPERS
// ============================================================

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
}

function makeCheckpoint(runId, stage, status, overrides = {}) {
  return {
    current_checkpoint: {
      run_id: runId,
      started_at: '2026-09-11T10:00:00Z',
      mode: 'INCREMENTAL',
      stage,
      stage_status: status,
      jobs_processed_in_stage: 68,
      total_jobs_in_stage: 68,
      batch_index: 14,
      total_batches: 14,
      last_updated: '2026-09-11T10:10:00Z',
      passed: 123,
      deprioritized: 228,
      queue_length: 123,
      verified: 68,
      blocked: 0,
      changed: 0,
      closed: 1,
      top5_count: 5,
      top10_count: 10,
      ...overrides
    },
    run_history: []
  };
}

function makeCheckpointPath(dir, data) {
  const fp = path.join(dir, 'checkpoints.json');
  fs.writeFileSync(fp, JSON.stringify(data));
  return fp;
}

function makeTop5Path(dir, items) {
  const fp = path.join(dir, 'top5.json');
  fs.writeFileSync(fp, JSON.stringify(items));
  return fp;
}

function makeSeenJobsPath(dir, seen) {
  const fp = path.join(dir, 'seen_jobs.json');
  fs.writeFileSync(fp, JSON.stringify({ seen }));
  return fp;
}

// ============================================================
// 1. loadCheckpoints — valid file
// ============================================================

test('loadCheckpoints reads valid file', () => {
  const dir = tmpDir();
  const data = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  const fp = makeCheckpointPath(dir, data);
  const result = loadCheckpoints(fp);
  assert.strictEqual(result.current_checkpoint.run_id, '20260911100000');
  assert.deepStrictEqual(result.run_history, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 2. loadCheckpoints — missing file throws
// ============================================================

test('loadCheckpoints throws on missing file', () => {
  assert.throws(() => {
    loadCheckpoints('/nonexistent/path/checkpoints.json');
  }, /file not found/);
});

// ============================================================
// 3. loadCheckpoints — missing both fields throws
// ============================================================

test('loadCheckpoints throws when both fields missing', () => {
  const dir = tmpDir();
  const fp = makeCheckpointPath(dir, { schema_version: '1.0' });
  assert.throws(() => {
    loadCheckpoints(fp);
  }, /missing both/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 4. identifyRun — uses current_checkpoint.run_id
// ============================================================

test('identifyRun uses current_checkpoint.run_id', () => {
  const cc = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  const result = identifyRun(cc);
  assert.strictEqual(result.runId, '20260911100000');
  assert.strictEqual(result.mode, 'INCREMENTAL');
  assert.strictEqual(result.anchorStartedAt, '2026-09-11T10:00:00Z');
});

// ============================================================
// 5. identifyRun — falls back to run_history latest
// ============================================================

test('identifyRun falls back to run_history when no current_checkpoint', () => {
  const checkpoints = {
    run_history: [
      { run_id: '20260909120000', last_updated: '2026-09-09T12:30:00Z', mode: 'INCREMENTAL' },
      { run_id: '20260911100000', last_updated: '2026-09-11T10:10:00Z', mode: 'FULL_AUDIT' }
    ]
  };
  const result = identifyRun(checkpoints);
  assert.strictEqual(result.runId, '20260911100000');
  assert.strictEqual(result.mode, 'FULL_AUDIT');
});

// ============================================================
// 6. identifyRun — explicit run_id from run_history
// ============================================================

test('identifyRun resolves explicit run_id from run_history', () => {
  const cc = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  cc.run_history = [
    { run_id: '20260909120000', last_updated: '2026-09-09T12:30:00Z', mode: 'INCREMENTAL', started_at: '2026-09-09T12:00:00Z' },
    { run_id: '20260910080000', last_updated: '2026-09-10T08:10:00Z', mode: 'INCREMENTAL', started_at: '2026-09-10T08:00:00Z' }
  ];
  const result = identifyRun(cc, '20260909120000');
  assert.strictEqual(result.runId, '20260909120000');
  assert.strictEqual(result.mode, 'INCREMENTAL');
  // anchor is null because cc.run_id !== requestedRunId
  assert.strictEqual(result.anchorStartedAt, null);
});

// ============================================================
// 7. identifyRun — requested run_id not found throws
// ============================================================

test('identifyRun throws when requested run_id not in run_history', () => {
  const cc = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  cc.run_history = [
    { run_id: '20260909120000', last_updated: '2026-09-09T12:30:00Z' }
  ];
  assert.throws(() => {
    identifyRun(cc, '20269999999999');
  }, /not found/);
});

// ============================================================
// 8. identifyRun — no run_id and empty history throws
// ============================================================

test('identifyRun throws when no run_id and empty run_history', () => {
  const checkpoints = { current_checkpoint: {}, run_history: [] };
  assert.throws(() => {
    identifyRun(checkpoints);
  }, /Cannot identify a run/);
});

// ============================================================
// 9. reconstructStages — all 7 stages present
// ============================================================

test('reconstructStages produces all 7 orchestrator stages', () => {
  const entries = [
    { run_id: 'r1', stage: 'discovery', stage_status: 'complete', last_updated: '2026-09-11T10:01:00Z', jobs_processed_in_stage: 50, total_jobs_in_stage: 50, passed: 40, deprioritized: 10 },
    { run_id: 'r1', stage: 'canonicalization', stage_status: 'complete', last_updated: '2026-09-11T10:02:00Z', jobs_processed_in_stage: 40, total_jobs_in_stage: 40 },
    { run_id: 'r1', stage: 'hard_filter', stage_status: 'complete', last_updated: '2026-09-11T10:03:00Z', jobs_processed_in_stage: 40, total_jobs_in_stage: 40, passed: 20, deprioritized: 20 },
    { run_id: 'r1', stage: 'priority_queue', stage_status: 'complete', last_updated: '2026-09-11T10:03:30Z', queue_length: 20 },
    { run_id: 'r1', stage: 'verification', stage_status: 'complete', last_updated: '2026-09-11T10:06:00Z', jobs_processed_in_stage: 20, total_jobs_in_stage: 20, verified: 18, blocked: 1, changed: 1 },
    { run_id: 'r1', stage: 'scoring', stage_status: 'complete', last_updated: '2026-09-11T10:08:00Z', jobs_processed_in_stage: 18, total_jobs_in_stage: 18 },
    { run_id: 'r1', stage: 'ranking_report', stage_status: 'complete', last_updated: '2026-09-11T10:10:00Z', total_jobs_in_stage: 18, top5_count: 5, top10_count: 10 }
  ];
  const stages = reconstructStages('r1', entries, '2026-09-11T10:00:00Z');
  assert.deepStrictEqual(Object.keys(stages), STAGES);
  assert.strictEqual(stages.discovery.status, 'complete');
  assert.strictEqual(stages.ranking_report.status, 'complete');
  assert.strictEqual(stages.discovery.completed_at, '2026-09-11T10:01:00.000Z');
  assert.strictEqual(stages.discovery.started_at, '2026-09-11T10:00:00.000Z');
  assert.strictEqual(stages.discovery.duration_ms, 60000);
  assert.strictEqual(stages.verification.counts.blocked, 1);
  assert.strictEqual(stages.ranking_report.counts.top5_count, 5);
});

// ============================================================
// 10. reconstructStages — duration null for missing timestamp
// ============================================================

test('reconstructStages duration_ms null when started_at missing', () => {
  const entries = [
    { run_id: 'r1', stage: 'discovery', stage_status: 'complete', last_updated: '2026-09-11T10:01:00Z' }
  ];
  const stages = reconstructStages('r1', entries, null);
  assert.strictEqual(stages.discovery.duration_ms, null);
  assert.strictEqual(stages.discovery.status, 'complete');
});

// ============================================================
// 11. reconstructStages — in_progress stage
// ============================================================

test('reconstructStages preserves in_progress status', () => {
  const entries = [
    { run_id: 'r1', stage: 'discovery', stage_status: 'complete', last_updated: '2026-09-11T10:01:00Z' },
    { run_id: 'r1', stage: 'hard_filter', stage_status: 'in_progress', last_updated: '2026-09-11T10:05:00Z' }
  ];
  const stages = reconstructStages('r1', entries, '2026-09-11T10:00:00Z');
  assert.strictEqual(stages.discovery.status, 'complete');
  assert.strictEqual(stages.hard_filter.status, 'in_progress');
  assert.strictEqual(stages.verification.status, 'not_run');
});

// ============================================================
// 12. reconstructStages — seeds live stage from current_checkpoint
// ============================================================

test('reconstructStages seeds live stage from current_checkpoint', () => {
  const cc = { run_id: 'r1', stage: 'verification', stage_status: 'in_progress', last_updated: '2026-09-11T10:05:00Z', jobs_processed_in_stage: 8, total_jobs_in_stage: 20 };
  const stages = reconstructStages('r1', [], '2026-09-11T10:00:00Z', cc);
  assert.strictEqual(stages.discovery.status, 'not_run');
  assert.strictEqual(stages.verification.status, 'in_progress');
  assert.strictEqual(stages.verification.counts.jobs_processed_in_stage, 8);
  assert.strictEqual(deriveStatus(stages), 'FAIL');
});

// ============================================================
// 12. deriveStatus — SUCCESS when ranking_report complete
// ============================================================

test('deriveStatus returns SUCCESS when ranking_report complete', () => {
  const stages = {};
  for (const s of STAGES) stages[s] = { status: 'complete' };
  assert.strictEqual(deriveStatus(stages), 'SUCCESS');
});

// ============================================================
// 13. deriveStatus — FAIL when ranking_report not complete
// ============================================================

test('deriveStatus returns FAIL when ranking_report not complete', () => {
  const stages = {};
  for (const s of STAGES) stages[s] = { status: 'complete' };
  stages.ranking_report = { status: 'in_progress' };
  assert.strictEqual(deriveStatus(stages), 'FAIL');
});

// ============================================================
// 14. extractCounts — live run gets terminal snapshot, historical run does not
// ============================================================

test('extractCounts overlays current_checkpoint only for the monitored run', () => {
  const cc = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  const stages = {};
  for (const s of STAGES) stages[s] = { status: 'complete', counts: {} };
  stages.discovery.counts = { jobs_processed_in_stage: 120, total_jobs_in_stage: 120 };
  stages.ranking_report.counts = { jobs_processed_in_stage: 68, total_jobs_in_stage: 68 };

  // Live run: match cc -> terminal aggregate counts included
  const live = extractCounts(cc, '20260911100000', stages);
  assert.strictEqual(live.passed, 123);
  assert.strictEqual(live.verified, 68);
  assert.strictEqual(live.top5_count, 5);
  assert.strictEqual(live.jobs_processed_in_stage, 68, 'terminal snapshot wins over discovery');

  // Historical run: cc belongs to another run -> only stage counts survive
  const hist = extractCounts(cc, '20260924100000', stages);
  assert.strictEqual(hist.passed, undefined, 'no cross-run count leakage');
  assert.strictEqual(hist.verified, undefined);
  assert.strictEqual(hist.jobs_processed_in_stage, 68, 'ranking stage total retained');
});

// ============================================================
// 14. upsertRun — idempotent insert and replace
// ============================================================

test('upsertRun inserts new run and replaces existing by run_id', () => {
  const history = { schema_version: '1.0', runs: [] };
  const rec1 = { run_id: 'r1', status: 'SUCCESS', stages: {} };
  const rec2 = { run_id: 'r2', status: 'FAIL', stages: {} };

  let result = upsertRun(history, rec1);
  assert.strictEqual(result.runs.length, 1);
  assert.strictEqual(result.runs[0].run_id, 'r1');

  result = upsertRun(result, rec2);
  assert.strictEqual(result.runs.length, 2);

  // Replace r1
  const rec1updated = { run_id: 'r1', status: 'SUCCESS', counts: { blocked: 1 } };
  result = upsertRun(result, rec1updated);
  assert.strictEqual(result.runs.length, 2);
  assert.deepStrictEqual(result.runs[0].counts, { blocked: 1 });
  assert.strictEqual(result.runs[1].run_id, 'r2');
});

// ============================================================
// 15. persistRunHistory — persists and creates file if absent
// ============================================================

test('persistRunHistory creates file when absent and persists summary', () => {
  const dir = tmpDir();
  const fp = path.join(dir, 'run_history.json');
  const summary = { run_id: 'r1', status: 'SUCCESS', stages: {}, counts: {}, top_5: [], portal_health: [] };

  const result = persistRunHistory(fp, summary);
  assert.strictEqual(result.runs.length, 1);
  assert.strictEqual(result.runs[0].run_id, 'r1');
  assert.strictEqual(result.schema_version, '1.0');

  const onDisk = JSON.parse(fs.readFileSync(fp, 'utf8'));
  assert.strictEqual(onDisk.runs.length, 1);
  assert.strictEqual(onDisk.runs[0].run_id, 'r1');

  // Second persist is idempotent
  persistRunHistory(fp, summary);
  const onDisk2 = JSON.parse(fs.readFileSync(fp, 'utf8'));
  assert.strictEqual(onDisk2.runs.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 16. persistRunHistory — idempotent by run_id
// ============================================================

test('persistRunHistory does not duplicate same run_id', () => {
  const dir = tmpDir();
  const fp = path.join(dir, 'run_history.json');
  fs.writeFileSync(fp, JSON.stringify({ schema_version: '1.0', runs: [{ run_id: 'r1', status: 'FAIL' }] }));

  const summary = { run_id: 'r1', status: 'SUCCESS', stages: {}, counts: {}, top_5: [], portal_health: [] };
  const result = persistRunHistory(fp, summary);
  assert.strictEqual(result.runs.length, 1);
  assert.strictEqual(result.runs[0].status, 'SUCCESS');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 17. CLI — --help exits 0 with usage
// ============================================================

test('CLI --help exits 0 with usage', () => {
  try {
    const out = execSync(`node "${MONITOR_JS}" --help`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.ok(out.includes('Usage'), 'shows usage');
    assert.ok(out.includes('PushNotification'), 'mentions notification limitation');
  } catch (e) {
    assert.fail(`--help should exit 0, got ${e.status}`);
  }
});

// ============================================================
// 18. CLI — dry-run builds summary, no history written
// ============================================================

test('CLI --dry-run builds summary without persisting', () => {
  const dir = tmpDir();
  const checkpoints = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  const cpPath = makeCheckpointPath(dir, checkpoints);
  const historyPath = path.join(dir, 'run_history.json');

  let out;
  try {
    out = execSync(`node "${MONITOR_JS}" --checkpoints "${cpPath}" --history "${historyPath}" --dry-run`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    assert.fail(`dry-run exec failed (${e.status}): ${String(e.stderr || e.message)}`);
  }
  assert.ok(out.includes('20260911100000'), 'output contains run_id');
  assert.ok(out.includes('SUCCESS'), 'output shows SUCCESS');
  assert.ok(!fs.existsSync(historyPath), 'run_history.json not created');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 19. CLI — non-dry-run persists to history
// ============================================================

test('CLI non-dry-run persists run to history file', () => {
  const dir = tmpDir();
  const checkpoints = makeCheckpoint('20260911100000', 'ranking_report', 'complete');
  const cpPath = makeCheckpointPath(dir, checkpoints);
  const historyPath = path.join(dir, 'run_history.json');

  let out;
  try {
    out = execSync(`node "${MONITOR_JS}" --checkpoints "${cpPath}" --history "${historyPath}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (e) {
    assert.fail(`non-dry-run exec failed (${e.status}): ${String(e.stderr || e.message)}`);
  }
  assert.ok(out.includes('SUCCESS'), 'output shows SUCCESS');
  assert.ok(fs.existsSync(historyPath), 'run_history.json created');
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  assert.strictEqual(history.runs.length, 1);
  assert.strictEqual(history.runs[0].run_id, '20260911100000');
  assert.strictEqual(history.runs[0].status, 'SUCCESS');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// 20. CLI — unknown option exits nonzero
// ============================================================

test('CLI unknown option exits nonzero', () => {
  try {
    execSync(`node "${MONITOR_JS}" --foobar`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.fail('should have exited nonzero');
  } catch (e) {
    assert.notStrictEqual(e.status, 0);
    assert.ok(e.stderr.includes('unknown option'), 'error mentions unknown option');
  }
});
