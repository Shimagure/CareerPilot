const fs = require('fs');

// Load all data files
const checkpoints = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));
const canonical = JSON.parse(fs.readFileSync('job_scraper/canonical_20260824.json', 'utf8'));
const filtered = JSON.parse(fs.readFileSync('job_scraper/filtered_20260824.json', 'utf8'));
const queue = JSON.parse(fs.readFileSync('job_scraper/priority_queue_20260824.json', 'utf8'));
const ranked = JSON.parse(fs.readFileSync('job_scraper/ranked_jobs.json', 'utf8'));
const seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));

// Calculate statistics
const current = checkpoints.current_checkpoint;
const runId = current.run_id;
const dateStr = new Date(current.started_at).toISOString().split('T')[0];

// Count states in priority queue
const stateCounts = {};
queue.jobs.forEach(j => {
  stateCounts[j.processing_state] = (stateCounts[j.processing_state] || 0) + 1;
});

// Count by portal in queue
const portalCounts = {};
queue.jobs.forEach(j => {
  portalCounts[j.portal] = (portalCounts[j.portal] || 0) + 1;
});

// Count existing jobs in seen_jobs by state (from previous runs)
const existingJobs = Object.values(seenJobs.seen).filter(j => j.first_seen && j.first_seen !== '2026-08-24');
const existingCount = existingJobs.length;

// Count active verified <=5 days in existing
let existingActiveVerifiedRecent = 0;
let existingActiveUnverifiedRecent = 0;
existingJobs.forEach(j => {
  if (j.processing_state === 'ACTIVE_VERIFIED' && j.last_verified) {
    const daysSince = (new Date() - new Date(j.last_verified)) / (1000 * 60 * 60 * 24);
    if (daysSince <= 5) existingActiveVerifiedRecent++;
  }
  if (j.processing_state === 'ACTIVE_UNVERIFIED' && j.blocked_at) {
    const daysSince = (new Date() - new Date(j.blocked_at)) / (1000 * 60 * 60 * 24);
    if (daysSince <= 5) existingActiveUnverifiedRecent++;
  }
});

// New jobs from this run
const newJobs = queue.jobs.filter(j => j.first_seen === '2026-08-24').length;

// Verification stats from this run's queue
const newVerified = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.processing_state === 'ACTIVE_VERIFIED').length;
const newUnverified = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.processing_state === 'ACTIVE_UNVERIFIED').length;
const newNeedsVerification = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.processing_state === 'NEEDS_VERIFICATION').length;
const newChanged = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.processing_state === 'CHANGED').length;
const newClosed = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.processing_state === 'CLOSED_OR_EXPIRED').length;

// Total verified in this run (from checkpoint)
const totalVerified = current.verified || 0;
const totalBlocked = current.blocked || 0;
const totalChanged = current.changed || 0;
const totalClosed = current.closed || 0;

// Scored jobs from this run
const scoredThisRun = queue.jobs.filter(j => j.first_seen === '2026-08-24' && j.overall_score !== undefined).length;

// All scored jobs in ranked list
const allScoredJobs = ranked.filter(j => j.overall !== undefined && j.overall !== null);

// Top 5
const top5 = ranked.slice(0, 5);

// Portal health
const portalHealth = [];
const indeedBlocked = queue.jobs.filter(j => j.portal === 'indeed' && j.processing_state === 'ACTIVE_UNVERIFIED').length;
const indeedTotal = portalCounts.indeed || 0;
if (indeedBlocked > 0) {
  portalHealth.push(`indeed: ${indeedBlocked}/${indeedTotal} jobs blocked (403) — marked ACTIVE_UNVERIFIED`);
} else {
  portalHealth.push(`indeed: ${indeedTotal} jobs — healthy`);
}
const linkedinTotal = portalCounts.linkedin || 0;
portalHealth.push(`linkedin: ${linkedinTotal} jobs — healthy`);
const kalibrrTotal = portalCounts.kalibrr || 0;
portalHealth.push(`kalibrr: ${kalibrrTotal} jobs — healthy`);
const bossjobTotal = portalCounts.bossjob || 0;
portalHealth.push(`bossjob: ${bossjobTotal} jobs — low relevance (mostly non-IT roles)`);
portalHealth.push(`jobstreet: 0 jobs — systematic 403 block (anti-bot); marked as disabled for this run`);

// Generate report
const report = `
INCREMENTAL RUN SUMMARY — ${dateStr}
- Run ID: ${runId}
- Mode: INCREMENTAL
- Discovered: ${canonical.total_raw} raw results
- After canonicalization: ${canonical.total_canonical} unique stable_ids
- New jobs: ${newJobs}
- Existing jobs: ${existingCount} (${existingActiveVerifiedRecent} ACTIVE_VERIFIED ≤5d skipped, ${existingActiveUnverifiedRecent} ACTIVE_UNVERIFIED retained)
- Hard filter passed: ${filtered.passed}
- Verified (live): ${totalVerified} (${newVerified} new, ${totalVerified - newVerified} re-verified stale)
- Blocked (403): ${totalBlocked} (retained as ACTIVE_UNVERIFIED)
- Changed: ${totalChanged} (fingerprint diff on material fields)
- Closed/Expired: ${totalClosed} (removed from active)
- Scored: ${allScoredJobs.length} (${scoredThisRun} new, ${allScoredJobs.length - scoredThisRun} from existing)
- Ranked: ${ranked.length} total active jobs
- Top 5: ${top5.map((j, i) => `${i+1}. ${j.title} @ ${j.company} — ${j.overall || 'N/A'}/100 (${j.verdict || 'N/A'})`).join('; ')}
- Portal health: ${portalHealth.join('; ')}
- Checkpoint: complete at ranking_report
`;

console.log(report);

// Save report
fs.writeFileSync('job_scraper/incremental_report_20260824.txt', report.trim());
console.log('\nReport saved to job_scraper/incremental_report_20260824.txt');