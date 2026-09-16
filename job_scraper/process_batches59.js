const fs = require('fs');
const crypto = require('crypto');

function computeFingerprint(job) {
  const normalizeTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
  const normalizeCompany = (c) => c.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
  const normalizeLocation = (l) => l.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
  const normalizeArrangement = (a) => {
    if (!a) return 'unknown';
    const arr = a.toLowerCase();
    if (arr.includes('remote') || arr.includes('work from home') || arr.includes('wfh') || arr.includes('virtual')) return 'remote';
    if (arr.includes('hybrid')) return 'hybrid';
    if (arr.includes('onsite') || arr.includes('on-site') || arr.includes('office') || arr.includes('in-person')) return 'onsite';
    return 'unknown';
  };
  const normalizeSalary = (s) => {
    if (!s) return 'unknown';
    const matches = s.toLowerCase().match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
    if (matches) {
      let val = parseFloat(matches[1].replace(/,/g, ''));
      if (s.toLowerCase().includes('k')) val *= 1000;
      if (val >= 10000 && val <= 500000) return val.toString();
    }
    return 'unknown';
  };
  const truncate = (str, maxLen) => str.length > maxLen ? str.substring(0, maxLen) : str;

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    title: normalizeTitle(job.title || ''),
    company: normalizeCompany(job.company || ''),
    location: normalizeLocation(job.location || ''),
    arrangement: normalizeArrangement(job.workType || job.description || ''),
    salary: normalizeSalary(job.salary || ''),
    description: truncate(job.description || '', 2000)
  })).digest('hex');

  return fingerprint;
}

function extractArrangement(job) {
  if (job.workType) {
    const wt = job.workType.toLowerCase();
    if (wt.includes('remote')) return 'remote';
    if (wt.includes('hybrid')) return 'hybrid';
    if (wt.includes('onsite') || wt.includes('on-site')) return 'onsite';
  }
  if (job.description) {
    const desc = job.description.toLowerCase();
    if (desc.includes('remote') || desc.includes('work from home') || desc.includes('wfh')) return 'remote';
    if (desc.includes('hybrid')) return 'hybrid';
    if (desc.includes('onsite') || desc.includes('on-site') || desc.includes('in-person')) return 'onsite';
  }
  return 'unknown';
}

// Load seen_jobs
const seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));

// Load priority queue
const queue = JSON.parse(fs.readFileSync('job_scraper/priority_queue_20260824.json', 'utf8'));

// Process batches 5-9 (jobs 20-42)
const batchJobs = queue.jobs.slice(20);
const batchResults = [];

// Blocked Indeed IDs
const blockedIndeedIds = ['c6f93918d7aeb758', 'd29e6193830db4dc', '97b8fbc141cda64a', '46887a2706bb3fb8', '3b48bfec293ba454', '0384e867f5afcba7', '1d3f64af4b3f7aca'];
// Empty Indeed results (Workday redirects)
const emptyIndeedIds = ['2f8505ca84d877fb', '123456789abcdef0', '90dd1050e6dfea96'];

for (const job of batchJobs) {
  let result = { stable_id: job.stable_id, ...job };

  if (job.portal === 'indeed') {
    const id = job.url.split('jk=')[1];
    // Check if blocked
    if (blockedIndeedIds.includes(id)) {
      result.processing_state = 'ACTIVE_UNVERIFIED';
      result.blocked_at = new Date().toISOString();
      result.blocked_reason = 'http_403';
      result.blocked_source = 'indeed';
      result.last_verified = null;
      batchResults.push(result);
      continue;
    }

    // Check for empty results (Workday redirects)
    if (emptyIndeedIds.includes(id)) {
      result.processing_state = 'NEEDS_VERIFICATION';
      batchResults.push(result);
      continue;
    }

    // Try to read detail
    try {
      const detailData = JSON.parse(fs.readFileSync('job_scraper/.tmp/' + id + '.json', 'utf8'));
      if (detailData.description && detailData.company) {
        result.processing_state = 'ACTIVE_VERIFIED';
        result.last_verified = new Date().toISOString();
        result.fingerprint = computeFingerprint(detailData);
        result.verified_detail = detailData;
        result.arrangement = extractArrangement(detailData);
        if (detailData.salary) result.salary = detailData.salary;
      } else {
        result.processing_state = 'NEEDS_VERIFICATION';
      }
    } catch (e) {
      result.processing_state = 'NEEDS_VERIFICATION';
    }
  } else if (job.portal === 'linkedin') {
    const id = job.url.split('/').pop().split('?')[0];
    try {
      const detailData = JSON.parse(fs.readFileSync('job_scraper/.tmp/' + id + '.json', 'utf8'));
      if (detailData.description && detailData.company) {
        result.processing_state = 'ACTIVE_VERIFIED';
        result.last_verified = new Date().toISOString();
        result.fingerprint = computeFingerprint(detailData);
        result.verified_detail = detailData;
        result.arrangement = extractArrangement(detailData);
        if (detailData.salary) result.salary = detailData.salary;
      } else {
        result.processing_state = 'NEEDS_VERIFICATION';
      }
    } catch (e) {
      result.processing_state = 'NEEDS_VERIFICATION';
    }
  } else if (job.portal === 'kalibrr') {
    const id = job.url.split('/').pop().split('?')[0];
    try {
      const detailData = JSON.parse(fs.readFileSync('job_scraper/.tmp/' + id + '.json', 'utf8'));
      if (detailData.description && detailData.company) {
        result.processing_state = 'ACTIVE_VERIFIED';
        result.last_verified = new Date().toISOString();
        result.fingerprint = computeFingerprint(detailData);
        result.verified_detail = detailData;
        result.arrangement = extractArrangement(detailData);
        if (detailData.salary) result.salary = detailData.salary;
      } else {
        result.processing_state = 'NEEDS_VERIFICATION';
      }
    } catch (e) {
      result.processing_state = 'NEEDS_VERIFICATION';
    }
  } else if (job.portal === 'bossjob') {
    const id = job.url.split('/').pop().split('?')[0];
    try {
      const detailData = JSON.parse(fs.readFileSync('job_scraper/.tmp/' + id + '.json', 'utf8'));
      if (detailData.description && detailData.company) {
        result.processing_state = 'ACTIVE_VERIFIED';
        result.last_verified = new Date().toISOString();
        result.fingerprint = computeFingerprint(detailData);
        result.verified_detail = detailData;
        result.arrangement = extractArrangement(detailData);
        if (detailData.salary) result.salary = detailData.salary;
      } else {
        result.processing_state = 'NEEDS_VERIFICATION';
      }
    } catch (e) {
      result.processing_state = 'NEEDS_VERIFICATION';
    }
  }

  batchResults.push(result);
}

console.log('Batches 5-9 results:');
batchResults.forEach(r => {
  console.log('  ' + r.title + ' @ ' + r.company + ' -> ' + r.processing_state + (r.fingerprint ? ' (fp: ' + r.fingerprint.substring(0, 8) + ')' : '') + ' | ' + r.arrangement);
});

// Update seen_jobs with batch results
for (const r of batchResults) {
  const existing = seenJobs.seen[r.stable_id] || {};
  seenJobs.seen[r.stable_id] = {
    ...existing,
    ...r,
    first_seen: existing.first_seen || '2026-08-24',
    portal: r.portal
  };
}

// Save updated seen_jobs
fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify(seenJobs, null, 2));
console.log('\nseen_jobs.json updated with batches 5-9 results');

// Update priority queue with processed jobs
for (let i = 0; i < batchResults.length; i++) {
  if (queue.jobs[i + 20]) {
    queue.jobs[i + 20] = batchResults[i];
  }
}

fs.writeFileSync('job_scraper/priority_queue_20260824.json', JSON.stringify(queue, null, 2));
console.log('priority_queue_20260824.json updated');

// Update checkpoint
const checkpoints = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));
checkpoints.current_checkpoint.jobs_processed_in_stage = 42;
checkpoints.current_checkpoint.batch_index = 9;
checkpoints.current_checkpoint.total_batches = Math.ceil(42 / 5);
checkpoints.current_checkpoint.last_updated = new Date().toISOString();
checkpoints.current_checkpoint.verified = queue.jobs.filter(r => r.processing_state === 'ACTIVE_VERIFIED').length;
checkpoints.current_checkpoint.blocked = queue.jobs.filter(r => r.processing_state === 'ACTIVE_UNVERIFIED').length;
checkpoints.current_checkpoint.changed = queue.jobs.filter(r => r.processing_state === 'CHANGED').length;
checkpoints.current_checkpoint.closed = queue.jobs.filter(r => r.processing_state === 'CLOSED_OR_EXPIRED').length;
checkpoints.current_checkpoint.stage_status = 'complete';
checkpoints.current_checkpoint.stage = 'scoring';
checkpoints.current_checkpoint.stage_status = 'in_progress';
fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));
console.log('Checkpoint updated after all verification batches - moving to scoring');