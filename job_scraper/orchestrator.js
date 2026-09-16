// Unified Job Pipeline Orchestrator
// Coordinates: discovery → canonicalization → hard_filter → verification → scoring → ranking
// Reuses existing pipeline scripts, adds checkpoint-based resume and error handling

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ============================================================
// CONFIGURATION
// ============================================================

const STAGES = [
  'discovery',
  'canonicalization',
  'hard_filter',
  'priority_queue',
  'verification',
  'scoring',
  'ranking_report'
];

const OUTPUTS = {
  discovery: ['job_scraper/canonical_jobs.json'],
  canonicalization: ['job_scraper/canonical_jobs.json', 'job_scraper/seen_jobs.json'],
  hard_filter: ['job_scraper/filtered_jobs.json'],
  priority_queue: ['job_scraper/priority_queue.json'],
  verification: ['job_scraper/seen_jobs.json'],
  scoring: ['job_scraper/seen_jobs.json'],
  ranking_report: ['job_scraper/seen_jobs.json']
};

const STAGE_DESCRIPTIONS = {
  discovery: 'Portal CLI searches (discovery)',
  canonicalization: 'Normalize, stable IDs, dedup, state assignment',
  hard_filter: 'Apply candidate hard filters (role, location, salary, arrangement, language)',
  priority_queue: 'Build verification priority queue with tiered ordering',
  verification: 'Live fetch & verify jobs (batched, 5 per batch)',
  scoring: 'Score verified jobs against candidate profile (batched, 5 per batch)',
  ranking_report: 'Rank, generate report, derive Top 5/10'
};

const BATCH_SIZE = 5;
const MAX_CONCURRENT_VERIFICATION = 2;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : '🔹';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function logStage(stage, status, details = '') {
  const icons = { start: '▶️', complete: '✅', skip: '⏭️', failed: '❌', resume: '🔄' };
  const icon = icons[status] || '🔹';
  console.log(`\n${icon} STAGE: ${stage.toUpperCase()} - ${status.toUpperCase()} ${details}`);
}

function loadJSON(filepath, defaultValue = null) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    if (defaultValue !== null) return defaultValue;
    throw new Error(`Failed to load ${filepath}: ${e.message}`);
  }
}

function saveJSON(filepath, data) {
  const tempPath = filepath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
}

function fileExists(filepath) {
  try {
    return fs.existsSync(filepath);
  } catch {
    return false;
  }
}

function validateStageOutput(stage, expectedFiles) {
  const missing = expectedFiles.filter(f => !fileExists(f));
  if (missing.length > 0) {
    throw new Error(`Stage ${stage} validation failed: missing output files: ${missing.join(', ')}`);
  }
}

// ============================================================
// CHECKPOINT MANAGEMENT
// ============================================================

function loadCheckpoints() {
  const cpPath = 'job_scraper/checkpoints.json';
  if (!fileExists(cpPath)) {
    return {
      schema_version: '1.0',
      current_checkpoint: {
        run_id: null,
        started_at: null,
        mode: 'INCREMENTAL',
        stage: null,
        stage_status: null,
        jobs_processed_in_stage: 0,
        total_jobs_in_stage: 0,
        batch_index: 0,
        total_batches: 0,
        last_updated: null
      },
      run_history: []
    };
  }
  return loadJSON(cpPath);
}

function saveCheckpoints(checkpoints) {
  saveJSON('job_scraper/checkpoints.json', checkpoints);
}

function getCurrentRunId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '').split('.')[0];
}

function writeCheckpoint(checkpoints, stage, status, data = {}) {
  const now = new Date().toISOString();
  const runId = checkpoints.current_checkpoint.run_id || getCurrentRunId();

  if (!checkpoints.current_checkpoint.run_id) {
    checkpoints.current_checkpoint.run_id = runId;
    checkpoints.current_checkpoint.started_at = now;
  }

  checkpoints.current_checkpoint.stage = stage;
  checkpoints.current_checkpoint.stage_status = status;
  checkpoints.current_checkpoint.last_updated = now;
  Object.assign(checkpoints.current_checkpoint, data);

  // Add to run history if completing a stage
  if (status === 'complete' || status === 'failed') {
    checkpoints.run_history.push({
      run_id: runId,
      started_at: checkpoints.current_checkpoint.started_at,
      mode: checkpoints.current_checkpoint.mode,
      stage: stage,
      stage_status: status,
      jobs_processed_in_stage: data.jobs_processed_in_stage || 0,
      total_jobs_in_stage: data.total_jobs_in_stage || 0,
      batch_index: data.batch_index || 0,
      total_batches: data.total_batches || 0,
      last_updated: now,
      ...data
    });
  }

  saveCheckpoints(checkpoints);
}

function determineResumePoint(checkpoints, mode) {
  const current = checkpoints.current_checkpoint;

  // Fresh run - no checkpoint or completed all stages
  if (!current.stage || current.stage_status === 'complete' && current.stage === 'ranking_report') {
    return { stage: 'discovery', reason: 'Fresh run - starting from discovery' };
  }

  // Resume from failed or in_progress stage
  if (current.stage_status === 'in_progress' || current.stage_status === 'failed') {
    return { stage: current.stage, reason: `Resuming from ${current.stage_status} stage: ${current.stage}` };
  }

  // Last stage complete - find next stage
  const lastStageIndex = STAGES.indexOf(current.stage);
  if (lastStageIndex >= 0 && lastStageIndex < STAGES.length - 1) {
    return { stage: STAGES[lastStageIndex + 1], reason: `Previous stage ${current.stage} complete, proceeding to next` };
  }

  return { stage: 'discovery', reason: 'Unknown state, starting fresh' };
}

function getCompletedStages(checkpoints) {
  const completed = new Set();
  for (const entry of checkpoints.run_history) {
    if (entry.stage_status === 'complete') {
      completed.add(entry.stage);
    }
  }
  // Also check current checkpoint
  if (checkpoints.current_checkpoint.stage_status === 'complete') {
    completed.add(checkpoints.current_checkpoint.stage);
  }
  return completed;
}

// ============================================================
// STAGE EXECUTION FUNCTIONS
// ============================================================

async function runDiscovery(checkpoints, mode) {
  logStage('discovery', 'start');
  writeCheckpoint(checkpoints, 'discovery', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run run_canonicalization.js which does discovery + canonicalization
    // But we need to split them - let's run the portal search part first
    log('Running portal searches...');
    execSync('node job_scraper/run_canonicalization.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 600000 // 10 minutes
    });

    validateStageOutput('discovery', OUTPUTS.discovery);

    // Count discovered jobs from the authoritative canonical_jobs.json
    const canonical = loadJSON('job_scraper/canonical_jobs.json');
    const totalDiscovered = Array.isArray(canonical) ? canonical.length : (canonical.total_discovered || canonical.canonical_jobs?.length || 0);

    writeCheckpoint(checkpoints, 'discovery', 'complete', {
      jobs_processed_in_stage: totalDiscovered,
      total_jobs_in_stage: totalDiscovered
    });

    logStage('discovery', 'complete', `(${totalDiscovered} jobs discovered)`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'discovery', 'failed', { error: error.message });
    logStage('discovery', 'failed', error.message);
    throw error;
  }
}

async function runCanonicalization(checkpoints, mode) {
  logStage('canonicalization', 'start');
  writeCheckpoint(checkpoints, 'canonicalization', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // The canonicalization is done inside run_canonicalization.js
    // But we need to run canonicalize.js for the processing of temp files
    // Actually run_canonicalization.js does the full canonicalization including dedup and state assignment
    // We just need to validate the output

    log('Validating canonicalization outputs...');
    validateStageOutput('canonicalization', OUTPUTS.canonicalization);

    const canonical = loadJSON('job_scraper/canonical_20260826.json');
    const uniqueJobs = canonical.canonical_jobs?.length || 0;

    writeCheckpoint(checkpoints, 'canonicalization', 'complete', {
      jobs_processed_in_stage: uniqueJobs,
      total_jobs_in_stage: uniqueJobs
    });

    logStage('canonicalization', 'complete', `(${uniqueJobs} unique jobs)`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'canonicalization', 'failed', { error: error.message });
    logStage('canonicalization', 'failed', error.message);
    throw error;
  }
}

async function runHardFilter(checkpoints, mode) {
  logStage('hard_filter', 'start');
  writeCheckpoint(checkpoints, 'hard_filter', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run hard_filter.js
    execSync('node job_scraper/hard_filter.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 120000 // 2 minutes
    });

    // Validate outputs
    validateStageOutput('hard_filter', OUTPUTS.hard_filter);

    const filtered = loadJSON('job_scraper/filtered_jobs.json');
    const passed = filtered.length || 0;

    writeCheckpoint(checkpoints, 'hard_filter', 'complete', {
      jobs_processed_in_stage: passed,
      total_jobs_in_stage: passed,
      passed: passed
    });

    logStage('hard_filter', 'complete', `(${passed} passed, ${filtered.rejected_jobs?.length || 0} deprioritized)`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'hard_filter', 'failed', { error: error.message });
    logStage('hard_filter', 'failed', error.message);
    throw error;
  }
}

async function runPriorityQueue(checkpoints, mode) {
  logStage('priority_queue', 'start');
  writeCheckpoint(checkpoints, 'priority_queue', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run build_priority_queue.js
    execSync('node job_scraper/build_priority_queue.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 60000 // 1 minute
    });

    validateStageOutput('priority_queue', OUTPUTS.priority_queue);

    const pq = loadJSON('job_scraper/priority_queue.json');
    const totalQueued = pq.length || 0;

    writeCheckpoint(checkpoints, 'priority_queue', 'complete', {
      jobs_processed_in_stage: totalQueued,
      total_jobs_in_stage: totalQueued,
      queue_length: totalQueued,
      tier_breakdown: pq.tier_breakdown
    });

    logStage('priority_queue', 'complete', `(${totalQueued} jobs queued)`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'priority_queue', 'failed', { error: error.message });
    logStage('priority_queue', 'failed', error.message);
    throw error;
  }
}

async function runVerification(checkpoints, mode) {
  logStage('verification', 'start');
  writeCheckpoint(checkpoints, 'verification', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run verify_jobs.js
    execSync('node job_scraper/verify_jobs.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 1200000 // 20 minutes for batched verification
    });

    // Validate outputs
    validateStageOutput('verification', OUTPUTS.verification);

    // Count results from checkpoint
    const cp = loadCheckpoints();
    const current = cp.current_checkpoint;
    const verified = current.verified || 0;
    const blocked = current.blocked || 0;
    const closed = current.closed || 0;
    const changed = current.changed || 0;

    writeCheckpoint(checkpoints, 'verification', 'complete', {
      jobs_processed_in_stage: current.total_jobs_in_stage || 0,
      total_jobs_in_stage: current.total_jobs_in_stage || 0,
      verified,
      blocked,
      closed,
      changed
    });

    logStage('verification', 'complete', `(verified: ${verified}, blocked: ${blocked}, closed: ${closed}, changed: ${changed})`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'verification', 'failed', { error: error.message });
    logStage('verification', 'failed', error.message);
    throw error;
  }
}

async function runScoring(checkpoints, mode) {
  logStage('scoring', 'start');
  writeCheckpoint(checkpoints, 'scoring', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run score_jobs.js
    execSync('node job_scraper/score_jobs.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 300000 // 5 minutes
    });

    // Validate outputs
    validateStageOutput('scoring', OUTPUTS.scoring);

    // Count from checkpoint
    const cp = loadCheckpoints();
    const current = cp.current_checkpoint;
    const scored = current.jobs_processed_in_stage || 0;

    writeCheckpoint(checkpoints, 'scoring', 'complete', {
      jobs_processed_in_stage: scored,
      total_jobs_in_stage: current.total_jobs_in_stage || 0
    });

    logStage('scoring', 'complete', `(${scored} jobs scored)`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'scoring', 'failed', { error: error.message });
    logStage('scoring', 'failed', error.message);
    throw error;
  }
}

async function runRanking(checkpoints, mode) {
  logStage('ranking_report', 'start');
  writeCheckpoint(checkpoints, 'ranking_report', 'in_progress', { total_jobs_in_stage: 0 });

  try {
    // Run rank_jobs.js
    execSync('node job_scraper/rank_jobs.js', {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 60000 // 1 minute
    });

    // Validate the persistent aggregate updated by rank_jobs.js.
    validateStageOutput('ranking_report', OUTPUTS.ranking_report);

    const seenJobsData = loadJSON('job_scraper/seen_jobs.json');
    const seenJobs = seenJobsData.seen || seenJobsData;
    const rankedJobs = Object.values(seenJobs).filter(job => job.rank_score !== undefined && job.rank_score !== null);
    rankedJobs.sort((a, b) => {
      if (b.rank_score !== a.rank_score) return b.rank_score - a.rank_score;
      return new Date(b.date || b.first_seen || 0).getTime() - new Date(a.date || a.first_seen || 0).getTime();
    });
    const totalRanked = rankedJobs.length;
    const top5 = rankedJobs.slice(0, 5).map(j => `${j.title} @ ${j.company} (${j.rank_score})`).join('; ');

    writeCheckpoint(checkpoints, 'ranking_report', 'complete', {
      jobs_processed_in_stage: totalRanked,
      total_jobs_in_stage: totalRanked,
      top5_count: Math.min(5, totalRanked),
      top10_count: Math.min(10, totalRanked)
    });

    logStage('ranking_report', 'complete', `(${totalRanked} ranked, Top 5: ${top5})`);
    return true;
  } catch (error) {
    writeCheckpoint(checkpoints, 'ranking_report', 'failed', { error: error.message });
    logStage('ranking_report', 'failed', error.message);
    throw error;
  }
}

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

async function runPipeline(mode = 'INCREMENTAL', options = {}) {
  const { resume = false, dryRun = false, startFrom = null, stageRunners = null } = options;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       JOB SCRAPER PIPELINE ORCHESTRATOR v1.0                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Mode: ${mode}`);
  console.log(`Run ID: ${getCurrentRunId()}`);
  console.log(`Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log(`Resume: ${resume ? 'YES' : 'NO'}`);
  if (startFrom) console.log(`Start from: ${startFrom}`);

  const checkpoints = loadCheckpoints();
  const shouldStartNewRun = !resume && !startFrom;
  if (shouldStartNewRun) {
    checkpoints.current_checkpoint = {
      run_id: null,
      started_at: null,
      mode,
      stage: null,
      stage_status: null,
      jobs_processed_in_stage: 0,
      total_jobs_in_stage: 0,
      batch_index: 0,
      total_batches: 0,
      last_updated: null
    };
  } else {
    checkpoints.current_checkpoint.mode = mode;
  }

  // Determine resume point
  let resumeInfo = { stage: 'discovery', reason: 'Fresh run' };
  if (resume || startFrom) {
    if (startFrom && STAGES.includes(startFrom)) {
      resumeInfo = { stage: startFrom, reason: `Manual start from ${startFrom}` };
    } else {
      resumeInfo = determineResumePoint(checkpoints, mode);
    }
  }

  const completedStages = getCompletedStages(checkpoints);
  const startIndex = STAGES.indexOf(resumeInfo.stage);

  console.log(`\n📋 Pipeline Plan:`);
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];
    const desc = STAGE_DESCRIPTIONS[stage];
    let status = 'pending';
    if (i < startIndex) status = completedStages.has(stage) ? 'completed' : 'skipped';
    else if (i === startIndex) status = 'will run';
    console.log(`   ${i + 1}. ${stage.padEnd(20)} - ${desc} [${status}]`);
  }
  console.log(`\n${resumeInfo.reason}\n`);

  if (dryRun) {
    console.log('🔍 DRY RUN - No stages will be executed');
    return { success: true, dryRun: true };
  }

  // Execute stages from startIndex
  const defaultStageRunners = {
    discovery: runDiscovery,
    canonicalization: runCanonicalization,
    hard_filter: runHardFilter,
    priority_queue: runPriorityQueue,
    verification: runVerification,
    scoring: runScoring,
    ranking_report: runRanking
  };
  const runners = stageRunners || defaultStageRunners;

  for (let i = startIndex; i < STAGES.length; i++) {
    const stage = STAGES[i];
    const runner = runners[stage];

    if (!runner) {
      log(`No runner for stage: ${stage}`, 'WARN');
      continue;
    }

    // Skip if already completed and not resuming this stage
    if (i > startIndex && completedStages.has(stage)) {
      logStage(stage, 'skip', '(already completed)');
      continue;
    }

    try {
      await runner(checkpoints, mode);
    } catch (error) {
      // Error already logged by stage runner
      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    PIPELINE FAILED                            ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log(`Failed at stage: ${stage}`);
      console.log(`Error: ${error.message}`);
      console.log('\nCheckpoint state preserved. Resume with:');
      console.log(`  node job_scraper/orchestrator.js --resume`);
      console.log(`Or start from specific stage:`);
      console.log(`  node job_scraper/orchestrator.js --start-from ${stage}`);
      throw error;
    }
  }

  // Success
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 PIPELINE COMPLETE ✅                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Print final summary
  const finalCheckpoints = loadCheckpoints();
  const current = finalCheckpoints.current_checkpoint;
  console.log(`\nRun ID: ${current.run_id}`);
  console.log(`Mode: ${current.mode}`);
  console.log(`Completed at: ${new Date().toISOString()}`);

  // Print top 5 if available
  try {
    const seenJobsData = loadJSON('job_scraper/seen_jobs.json');
    const seenJobs = seenJobsData.seen || seenJobsData;
    const rankedJobs = Object.values(seenJobs).filter(job => job.rank_score !== undefined && job.rank_score !== null);
    rankedJobs.sort((a, b) => {
      if (b.rank_score !== a.rank_score) return b.rank_score - a.rank_score;
      return new Date(b.date || b.first_seen || 0).getTime() - new Date(a.date || a.first_seen || 0).getTime();
    });
    const top5 = rankedJobs.slice(0, 5);
    if (top5.length > 0) {
      console.log('\n🎯 TOP 5 JOBS:');
      top5.forEach((job, i) => {
        console.log(`  ${i + 1}. [Rank ${job.rank || i+1}] ${job.title} @ ${job.company}`);
        console.log(`     Score: ${job.rank_score}/100 (${job.rank_verdict}) | ${job.portal} | ${job.location} | ${job.arrangement}`);
      });
    }
  } catch (e) {
    // Report not available yet
  }

  return { success: true, runId: current.run_id };
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'INCREMENTAL',
    resume: false,
    dryRun: false,
    startFrom: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode' || arg === '-m') {
      options.mode = args[++i]?.toUpperCase() || 'INCREMENTAL';
    } else if (arg === '--resume' || arg === '-r') {
      options.resume = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--start-from' || arg === '-s') {
      options.startFrom = args[++i]?.toLowerCase();
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node job_scraper/orchestrator.js [options]

Options:
  --mode, -m <mode>       Pipeline mode: INCREMENTAL (default) or FULL_AUDIT
  --resume, -r            Resume from last checkpoint
  --start-from, -s <stage> Start from specific stage (discovery|canonicalization|hard_filter|priority_queue|verification|scoring|ranking_report)
  --dry-run, -d           Show execution plan without running
  --help, -h              Show this help

Examples:
  node job_scraper/orchestrator.js                    # Fresh incremental run
  node job_scraper/orchestrator.js --resume           # Resume from checkpoint
  node job_scraper/orchestrator.js --mode FULL_AUDIT  # Full audit run
  node job_scraper/orchestrator.js --start-from verification  # Start from verification
  node job_scraper/orchestrator.js --dry-run          # Show plan only
`);
      process.exit(0);
    }
  }

  // Validate mode
  if (!['INCREMENTAL', 'FULL_AUDIT'].includes(options.mode)) {
    console.error(`Invalid mode: ${options.mode}. Use INCREMENTAL or FULL_AUDIT`);
    process.exit(1);
  }

  // Validate startFrom
  if (options.startFrom && !STAGES.includes(options.startFrom)) {
    console.error(`Invalid stage: ${options.startFrom}. Valid stages: ${STAGES.join(', ')}`);
    process.exit(1);
  }

  return options;
}

// Run if executed directly
if (require.main === module) {
  const options = parseArgs();
  runPipeline(options.mode, options)
    .then(result => {
      if (result.success && !result.dryRun) {
        process.exit(0);
      } else if (result.dryRun) {
        process.exit(0);
      }
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runPipeline,
  STAGES,
  STAGE_DESCRIPTIONS,
  determineResumePoint,
  getCompletedStages,
  validateStageOutput,
  OUTPUTS
};