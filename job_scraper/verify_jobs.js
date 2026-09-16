// Live verification of jobs in priority queue - batched processing with checkpoints
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  updateLastActiveAtOnVerification,
  updateLastActiveAtOnBlocked,
  updateLastActiveAtOnChanged
} = require('./retention');

// Load priority queue
const pq = JSON.parse(fs.readFileSync('job_scraper/priority_queue_20260826.json', 'utf8'));
const queue = pq.queue;

// Load seen_jobs
let seenJobs = {};
try {
  seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));
} catch {
  seenJobs = {};
}

// Load checkpoints
let checkpoints = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));

function computeFingerprint(job) {
  const material = {
    title: job.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(),
    company: job.company.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(),
    location: (job.location || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(),
    arrangement: (job.arrangement || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(),
    salary: (job.salary || '').toLowerCase().replace(/[^\w\s\-\$\₱,\.]/g, '').replace(/\s+/g, ' ').trim(),
    description: ((job.description || job.teaser || '') || '').substring(0, 2000)
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/[^\w\s:\/\-\.]/g, '').replace(/\s+/g, ' ').trim();
  }
}

function normalizeCompany(company) {
  return company.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function computeStableId(url, company, title) {
  const input = normalizeUrl(url) + '|' + normalizeCompany(company) + '|' + normalizeTitle(title);
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Simple fetch function using native fetch (Node 18+)
async function fetchJobDetail(job) {
  try {
    const response = await fetch(job.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    if (response.status === 403) {
      return { status: 403, blocked: true };
    }
    if (response.status === 404 || response.status === 410) {
      return { status: response.status, closed: true };
    }
    if (!response.ok) {
      return { status: response.status, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return { status: 200, html };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

// Extract key info from HTML (basic extraction)
function extractJobDetails(html, originalJob) {
  // Very basic extraction - in practice we'd use more sophisticated parsing
  const details = { ...originalJob };

  // Try to extract salary if not present
  if (!details.salary || details.salary === '') {
    const salaryMatch = html.match(/[₱$]\s*[\d,]+(?:\s*[-~]\s*[\d,]+)?/i);
    if (salaryMatch) details.salary = salaryMatch[0];
  }

  // Try to extract arrangement
  if (!details.arrangement || details.arrangement === 'unspecified') {
    const text = html.toLowerCase();
    if (text.includes('remote') || text.includes('work from home') || text.includes('wfh')) {
      details.arrangement = 'remote';
    } else if (text.includes('hybrid')) {
      details.arrangement = 'hybrid';
    } else if (text.includes('on-site') || text.includes('onsite')) {
      details.arrangement = 'onsite';
    }
  }

  // Use full HTML as description for now
  details.full_description = html.substring(0, 10000);

  return details;
}

// Process a batch of jobs
async function processBatch(jobs, batchIndex, totalBatches) {
  console.log(`\n=== Processing Batch ${batchIndex + 1}/${totalBatches} (${jobs.length} jobs) ===`);

  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company} (${job.portal})`);

    const stableId = job.stable_id;
    const existingSeen = seenJobs[stableId];

    // Live fetch
    const fetchResult = await fetchJobDetail(job);

    let updatedJob = { ...job };
    let newState = job.processing_state || 'NEW';

    if (fetchResult.blocked) {
      console.log(`    -> BLOCKED (403)`);
      updatedJob.blocked_at = new Date().toISOString();
      updatedJob.blocked_reason = 'http_403';
      updatedJob.blocked_source = 'fetch';

      if (existingSeen && existingSeen.last_verified) {
        const daysSinceVerified = (Date.now() - new Date(existingSeen.last_verified).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceVerified <= 5) {
          newState = 'ACTIVE_UNVERIFIED';
          // Update last_active_at for ACTIVE_UNVERIFIED (recent canonical data)
          updateLastActiveAtOnBlocked(updatedJob);
        } else {
          newState = 'STALE';
        }
      } else {
        newState = 'STALE';
      }
    } else if (fetchResult.closed) {
      console.log(`    -> CLOSED/EXPIRED (${fetchResult.status})`);
      updatedJob.closed_at = new Date().toISOString();
      newState = 'CLOSED_OR_EXPIRED';
    } else if (fetchResult.error) {
      console.log(`    -> ERROR: ${fetchResult.error}`);
      newState = 'STALE'; // Treat errors as stale, will retry later
    } else {
      console.log(`    -> SUCCESS`);
      updatedJob = extractJobDetails(fetchResult.html, updatedJob);
      updatedJob.fingerprint = computeFingerprint(updatedJob);
      updatedJob.last_verified = new Date().toISOString();

      // Check if changed
      if (existingSeen && existingSeen.fingerprint && existingSeen.fingerprint !== updatedJob.fingerprint) {
        console.log(`    -> CHANGED (fingerprint diff)`);
        updatedJob.changed_at = new Date().toISOString();
        updatedJob.previous_fingerprint = existingSeen.fingerprint;
        newState = 'CHANGED';
        // Update last_active_at on CHANGED
        updateLastActiveAtOnChanged(updatedJob);
      } else {
        newState = 'ACTIVE_VERIFIED';
        // Update last_active_at on successful verification
        updateLastActiveAtOnVerification(updatedJob);
      }
    }

    updatedJob.processing_state = newState;
    updatedJob.verified_at = new Date().toISOString();

    // Update seen_jobs
    seenJobs[stableId] = updatedJob;
    results.push(updatedJob);

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

async function runVerification() {
  // Filter jobs that need verification: NEW, NEEDS_VERIFICATION, STALE, CHANGED
  const needsVerification = queue.filter(job => {
    const state = job.processing_state || 'NEW';
    return ['NEW', 'NEEDS_VERIFICATION', 'STALE', 'CHANGED'].includes(state);
  });

  console.log(`Total jobs in queue: ${queue.length}`);
  console.log(`Jobs needing verification: ${needsVerification.length}`);

  // Update checkpoint - verification started
  checkpoints.run_history.push({
    run_id: "20260826000000",
    started_at: new Date().toISOString(),
    mode: "INCREMENTAL",
    stage: "verification",
    stage_status: "in_progress",
    jobs_processed_in_stage: 0,
    total_jobs_in_stage: needsVerification.length,
    batch_index: 0,
    total_batches: Math.ceil(needsVerification.length / 5),
    last_updated: new Date().toISOString()
  });
  checkpoints.current_checkpoint.stage = "verification";
  checkpoints.current_checkpoint.stage_status = "in_progress";
  checkpoints.current_checkpoint.total_jobs_in_stage = needsVerification.length;
  checkpoints.current_checkpoint.total_batches = Math.ceil(needsVerification.length / 5);
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

  // Process in batches of 5
  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < needsVerification.length; i += batchSize) {
    batches.push(needsVerification.slice(i, i + batchSize));
  }

  let totalVerified = 0;
  let totalBlocked = 0;
  let totalClosed = 0;
  let totalChanged = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    // Update batch checkpoint
    checkpoints.current_checkpoint.batch_index = batchIndex;
    checkpoints.current_checkpoint.jobs_processed_in_stage = batchIndex * batchSize;
    checkpoints.current_checkpoint.last_updated = new Date().toISOString();
    fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

    const results = await processBatch(batch, batchIndex, batches.length);

    // Count results
    for (const job of results) {
      if (job.processing_state === 'ACTIVE_VERIFIED') totalVerified++;
      else if (job.processing_state === 'ACTIVE_UNVERIFIED') totalBlocked++;
      else if (job.processing_state === 'CLOSED_OR_EXPIRED') totalClosed++;
      else if (job.processing_state === 'CHANGED') totalChanged++;
    }

    // Save seen_jobs after each batch
    fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify(seenJobs, null, 2));

    console.log(`\nBatch ${batchIndex + 1} complete. Progress: ${Math.min((batchIndex + 1) * batchSize, needsVerification.length)}/${needsVerification.length}`);
  }

  // Final checkpoint
  checkpoints.run_history.push({
    run_id: "20260826000000",
    started_at: new Date().toISOString(),
    mode: "INCREMENTAL",
    stage: "verification",
    stage_status: "complete",
    jobs_processed_in_stage: needsVerification.length,
    total_jobs_in_stage: needsVerification.length,
    batch_index: batches.length,
    total_batches: batches.length,
    last_updated: new Date().toISOString()
  });
  checkpoints.current_checkpoint.stage = "verification";
  checkpoints.current_checkpoint.stage_status = "complete";
  checkpoints.current_checkpoint.jobs_processed_in_stage = needsVerification.length;
  checkpoints.current_checkpoint.verified = totalVerified;
  checkpoints.current_checkpoint.blocked = totalBlocked;
  checkpoints.current_checkpoint.changed = totalChanged;
  checkpoints.current_checkpoint.closed = totalClosed;
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log(`Verified: ${totalVerified}`);
  console.log(`Blocked (403): ${totalBlocked}`);
  console.log(`Closed/Expired: ${totalClosed}`);
  console.log(`Changed: ${totalChanged}`);
  console.log(`Total processed: ${needsVerification.length}`);

  return { verified: totalVerified, blocked: totalBlocked, closed: totalClosed, changed: totalChanged };
}

runVerification().then(result => {
  console.log('\nVerification complete.');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});