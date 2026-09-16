#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ==================== Live Verification ====================

function fetchJobDetails(url) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
        },
        timeout: 15000
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (err) => {
        resolve({ statusCode: 0, error: err.message, body: '' });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 408, error: 'Timeout', body: '' });
      });

      req.end();
    } catch (err) {
      resolve({ statusCode: 0, error: err.message, body: '' });
    }
  });
}

function extractJobDetails(html, url) {
  // Basic extraction - in real scenario would be more sophisticated
  const details = {
    title: null,
    company: null,
    location: null,
    arrangement: null,
    salary: null,
    description: null,
    requirements: [],
    isLive: true
  };

  // Try to extract from meta tags or common patterns
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) details.title = titleMatch[1].trim();

  // Check if job is closed/expired
  const closedIndicators = [
    'job has expired', 'position has been filled', 'no longer accepting',
    'this job is closed', 'job posting has expired', 'position closed',
    'we are no longer hiring', 'application closed'
  ];
  const lowerHtml = html.toLowerCase();
  for (const indicator of closedIndicators) {
    if (lowerHtml.includes(indicator)) {
      details.isLive = false;
      details.closedReason = indicator;
      break;
    }
  }

  // Try to find salary info
  const salaryPatterns = [
    /php\s*[\d,]+(?:\s*-\s*php\s*[\d,]+)?/gi,
    /₱\s*[\d,]+(?:\s*-\s*₱\s*[\d,]+)?/gi,
    /\$\s*[\d,]+(?:\s*-\s*\$\s*[\d,]+)?/gi,
    /salary[^<]*[\d,]+/gi
  ];
  for (const pattern of salaryPatterns) {
    const match = html.match(pattern);
    if (match) {
      details.salary = match[0];
      break;
    }
  }

  // Try to find arrangement
  const arrangementPatterns = [
    /remote/gi, /work.from.home/gi, /wfh/gi,
    /hybrid/gi, /on.site/gi, /onsite/gi
  ];
  for (const pattern of arrangementPatterns) {
    if (pattern.test(html)) {
      if (pattern.toString().includes('remote') || pattern.toString().includes('wfh') || pattern.toString().includes('work.from.home')) {
        details.arrangement = 'remote';
      } else if (pattern.toString().includes('hybrid')) {
        details.arrangement = 'hybrid';
      } else {
        details.arrangement = 'onsite';
      }
      break;
    }
  }

  return details;
}

async function verifyJob(job, index, total) {
  console.log(`  [${index}/${total}] Verifying: ${job.title} @ ${job.company}`);

  const result = await fetchJobDetails(job.url);

  if (result.statusCode === 0 || result.error) {
    console.log(`    → Network error: ${result.error}`);
    return { ...job, processing_state: 'NEEDS_VERIFICATION', verification_error: result.error };
  }

  if (result.statusCode === 403) {
    console.log(`    → HTTP 403 (blocked)`);
    // Record the block
    job.blocked_at = new Date().toISOString();
    job.blocked_reason = 'http_403';
    job.blocked_source = 'fetch';

    // Check if we have recent canonical data (last_verified ≤ 5 days)
    if (job.last_verified) {
      const daysSince = (Date.now() - new Date(job.last_verified).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 5) {
        job.processing_state = 'ACTIVE_UNVERIFIED';
        console.log(`    → Retained as ACTIVE_UNVERIFIED (recent data ≤5 days)`);
        return job;
      }
    }
    job.processing_state = 'STALE';
    console.log(`    → Marked STALE (no recent data or >5 days)`);
    return job;
  }

  if (result.statusCode === 404) {
    console.log(`    → HTTP 404 (not found)`);
    job.processing_state = 'CLOSED_OR_EXPIRED';
    job.closed_at = new Date().toISOString();
    return job;
  }

  if (result.statusCode !== 200) {
    console.log(`    → HTTP ${result.statusCode}`);
    job.processing_state = 'NEEDS_VERIFICATION';
    job.verification_error = `HTTP ${result.statusCode}`;
    return job;
  }

  // Extract details from HTML
  const extracted = extractJobDetails(result.body, job.url);

  if (!extracted.isLive) {
    console.log(`    → Job appears closed: ${extracted.closedReason}`);
    job.processing_state = 'CLOSED_OR_EXPIRED';
    job.closed_at = new Date().toISOString();
    job.closed_reason = extracted.closedReason;
    return job;
  }

  // Compare with stored data - check for material changes
  // For now, assume verification successful
  job.processing_state = 'ACTIVE_VERIFIED';
  job.last_verified = new Date().toISOString();
  job.verified_title = extracted.title;
  job.verified_company = extracted.company;
  job.verified_location = extracted.location;
  job.verified_arrangement = extracted.arrangement || job.arrangement;
  job.verified_salary = extracted.salary || job.salary;

  console.log(`    → VERIFIED (${job.verified_arrangement || 'unspecified'}, ${job.verified_salary || 'undisclosed'})`);
  return job;
}

async function processBatch(batch, batchIndex, totalBatches) {
  console.log(`\n=== Batch ${batchIndex + 1}/${totalBatches} (${batch.length} jobs) ===`);

  // Process with max 2 concurrent workers
  const results = [];
  const concurrency = 2;

  for (let i = 0; i < batch.length; i += concurrency) {
    const chunk = batch.slice(i, i + concurrency);
    const promises = chunk.map((job, idx) =>
      verifyJob(job, batchIndex * 5 + i + idx + 1, batch.length)
    );
    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }

  return results;
}

async function main() {
  console.log('Starting live verification stage...');

  // Load verification queue
  const verificationQueue = JSON.parse(fs.readFileSync('job_scraper/verification_queue.json', 'utf8'));
  console.log(`Loaded ${verificationQueue.length} jobs for verification`);

  // Load seen_jobs for updating
  const seenJobsData = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));
  const seenJobs = seenJobsData.seen || {};

  // Process in batches of 5
  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < verificationQueue.length; i += batchSize) {
    batches.push(verificationQueue.slice(i, i + batchSize));
  }

  console.log(`Total batches: ${batches.length}`);

  let allVerified = [];
  let blockedCount = 0;
  let verifiedCount = 0;
  let closedCount = 0;
  let errorCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchResults = await processBatch(batch, batchIndex, batches.length);

    // Count results
    batchResults.forEach(job => {
      if (job.processing_state === 'ACTIVE_VERIFIED') verifiedCount++;
      else if (job.processing_state === 'ACTIVE_UNVERIFIED') blockedCount++;
      else if (job.processing_state === 'CLOSED_OR_EXPIRED') closedCount++;
      else if (job.processing_state === 'STALE') blockedCount++;
      else errorCount++;
    });

    allVerified.push(...batchResults);

    // Update seen_jobs with batch results
    batchResults.forEach(job => {
      // Find existing record by stable_id
      let existingKey = null;
      for (const [key, record] of Object.entries(seenJobs)) {
        if (record.stable_id === job.stable_id) {
          existingKey = key;
          break;
        }
      }

      if (existingKey) {
        seenJobs[existingKey] = { ...seenJobs[existingKey], ...job };
      } else {
        seenJobs[job.id] = job;
      }
    });

    // Save checkpoint after each batch
    const checkpoint = {
      run_id: "20260822100000",
      started_at: "2026-08-22T10:00:00.000Z",
      mode: "INCREMENTAL",
      stage: "verification",
      stage_status: batchIndex === batches.length - 1 ? "complete" : "in_progress",
      jobs_processed_in_stage: (batchIndex + 1) * batchSize,
      total_jobs_in_stage: verificationQueue.length,
      batch_index: batchIndex + 1,
      total_batches: batches.length,
      last_updated: new Date().toISOString(),
      error: null
    };

    const checkpointsData = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));
    checkpointsData.current_checkpoint = checkpoint;
    fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpointsData, null, 2));

    // Save updated seen_jobs
    fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify({ seen: seenJobs, last_updated: new Date().toISOString() }, null, 2));

    console.log(`\nBatch ${batchIndex + 1} complete. Checkpoint saved.`);
    console.log(`Running totals: Verified=${verifiedCount}, Blocked=${blockedCount}, Closed=${closedCount}, Errors=${errorCount}`);
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log(`Total processed: ${allVerified.length}`);
  console.log(`ACTIVE_VERIFIED: ${verifiedCount}`);
  console.log(`ACTIVE_UNVERIFIED (403): ${blockedCount}`);
  console.log(`CLOSED_OR_EXPIRED: ${closedCount}`);
  console.log(`Other errors: ${errorCount}`);

  // Save verified jobs for scoring stage
  fs.writeFileSync('job_scraper/verified_jobs.json', JSON.stringify(allVerified, null, 2));
  console.log('Saved verified_jobs.json for scoring stage');
}

main().catch(console.error);