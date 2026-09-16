// Dry-run retention against existing seen_jobs.json
const fs = require('fs');
const path = require('path');

const {
  STALE_JOB_DAYS,
  ACTIVE_POOL_STATES,
  getLastActiveAt,
  isActivePool,
  getActivePoolStats,
  loadApplicationStableIds,
  resolveApplicationStableIds
} = require('./retention');

// Load seen_jobs.json
const seenJobsPath = path.join(__dirname, 'seen_jobs.json');
const seenData = JSON.parse(fs.readFileSync(seenJobsPath, 'utf8'));
const seenJobs = seenData.seen || seenData; // Handle both structures

console.log('=== DRY-RUN RETENTION AGAINST EXISTING DATA ===\n');
console.log(`Total jobs in seen_jobs: ${Object.keys(seenJobs).length}\n`);

// Load application tracker
const trackerPath = path.join(__dirname, '..', 'job_search_tracker.csv');
const trackerKeys = loadApplicationStableIds(trackerPath);
const applicationStableIds = resolveApplicationStableIds(trackerKeys, seenJobs);

console.log(`Application-linked stable_ids: ${applicationStableIds.size}`);
console.log(`Application keys from tracker: ${trackerKeys.size}\n`);

// Compute stats
const now = new Date();
const stats = getActivePoolStats(seenJobs, applicationStableIds, now);

console.log('=== ACTIVE POOL STATISTICS ===');
console.log(`Total jobs: ${stats.totalJobs}`);
console.log(`In active pool (<=28 days): ${stats.inPool}`);
console.log(`Stale (>28 days, no application): ${stats.stale}`);
console.log(`Protected by application: ${stats.protected}\n`);

// Breakdown by state
const stateCounts = {};
const statePoolCounts = {};

for (const job of Object.values(seenJobs)) {
  const state = job.processing_state || 'UNKNOWN';
  stateCounts[state] = (stateCounts[state] || 0) + 1;

  if (isActivePool(job, applicationStableIds, now)) {
    statePoolCounts[state] = (statePoolCounts[state] || 0) + 1;
  }
}

console.log('=== BREAKDOWN BY PROCESSING STATE ===');
console.log(`${'State'.padEnd(30)} | ${'Total'.padStart(6)} | ${'In Pool'.padStart(7)} | ${'In Pool %'.padStart(9)}`);
console.log('-'.repeat(60));
for (const state of Object.keys(stateCounts).sort()) {
  const total = stateCounts[state];
  const inPool = statePoolCounts[state] || 0;
  const pct = total > 0 ? ((inPool / total) * 100).toFixed(1) : '0.0';
  console.log(`${state.padEnd(30)} | ${total.toString().padStart(6)} | ${inPool.toString().padStart(7)} | ${pct.padStart(9)}%`);
}

console.log('\n=== SAMPLE STALE JOBS (>28 days, no application) ===');
let staleCount = 0;
for (const job of Object.values(seenJobs)) {
  if (ACTIVE_POOL_STATES.has(job.processing_state) && !isActivePool(job, applicationStableIds, now)) {
    if (staleCount < 10) {
      const lastActive = getLastActiveAt(job);
      const diffDays = lastActive ? ((now - lastActive) / (1000 * 60 * 60 * 24)).toFixed(1) : 'N/A';
      console.log(`  ${job.title} @ ${job.company} (${job.processing_state}) - last_active: ${diffDays} days ago`);
    }
    staleCount++;
  }
}
console.log(`  ... and ${staleCount - 10 > 0 ? staleCount - 10 : 0} more\n`);

console.log('=== SAMPLE PROTECTED JOBS (application-linked but >28 days) ===');
let protectedCount = 0;
for (const job of Object.values(seenJobs)) {
  if (ACTIVE_POOL_STATES.has(job.processing_state) && !isActivePool(job, new Set(), now) && applicationStableIds.has(job.stable_id)) {
    if (protectedCount < 10) {
      const lastActive = getLastActiveAt(job);
      const diffDays = lastActive ? ((now - lastActive) / (1000 * 60 * 60 * 24)).toFixed(1) : 'N/A';
      console.log(`  ${job.title} @ ${job.company} (${job.processing_state}) - last_active: ${diffDays} days ago [PROTECTED]`);
    }
    protectedCount++;
  }
}
if (protectedCount === 0) {
  console.log('  (none found)');
} else {
  console.log(`  ... and ${protectedCount - 10 > 0 ? protectedCount - 10 : 0} more`);
}

console.log('\n=== DRY-RUN COMPLETE ===');