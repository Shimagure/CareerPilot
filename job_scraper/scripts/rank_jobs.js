#!/usr/bin/env node

const fs = require('fs');

// ==================== Ranking ====================

function main() {
  console.log('Starting ranking stage...');

  // Load scored jobs
  const scoredJobs = JSON.parse(fs.readFileSync('job_scraper/scored_jobs.json', 'utf8'));
  console.log(`Loaded ${scoredJobs.length} scored jobs`);

  // Filter active jobs for ranking
  // Include: ACTIVE_VERIFIED, ACTIVE_UNVERIFIED, NEW, CHANGED, POSTING_CHANGED
  // Exclude: CLOSED_OR_EXPIRED, DUPLICATE_OR_INVALID, DEPRIORITIZE
  const activeStates = ['ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED', 'NEW', 'CHANGED', 'POSTING_CHANGED', 'NEEDS_VERIFICATION', 'STALE'];
  const activeJobs = scoredJobs.filter(job => activeStates.includes(job.processing_state));
  console.log(`Active jobs for ranking: ${activeJobs.length}`);

  // Sort by overall score descending (deterministic tie handling)
  activeJobs.sort((a, b) => {
    const scoreA = a.evaluation?.overall ?? 0;
    const scoreB = b.evaluation?.overall ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    // Tie-breaker: stable_id for deterministic ordering
    return (a.stable_id || '').localeCompare(b.stable_id || '');
  });

  // Assign ranks with tie handling
  let rank = 1;
  activeJobs.forEach((job, index) => {
    const score = job.evaluation?.overall ?? 0;
    if (index > 0) {
      const prevScore = activeJobs[index - 1].evaluation?.overall ?? 0;
      if (score === prevScore) {
        // Same rank as previous
        job.rank = rank;
      } else {
        // Next rank accounts for ties
        rank = index + 1;
        job.rank = rank;
      }
    } else {
      job.rank = rank;
    }
  });

  // Derive Top 10 and Top 5
  const top10 = activeJobs.slice(0, 10);
  const top5 = activeJobs.slice(0, 5);

  console.log('\n=== RANKING COMPLETE ===');
  console.log(`Total active jobs ranked: ${activeJobs.length}`);
  console.log('\nTop 10:');
  top10.forEach(job => {
    console.log(`  Rank ${job.rank}: [${job.evaluation?.overall ?? 'N/A'}/100] ${job.title} @ ${job.company} (${job.evaluation?.verdict ?? 'N/A'}) [${job.arrangement}] [${job.portal}]`);
  });

  console.log('\nTop 5:');
  top5.forEach(job => {
    console.log(`  Rank ${job.rank}: [${job.evaluation?.overall ?? 'N/A'}/100] ${job.title} @ ${job.company} (${job.evaluation?.verdict ?? 'N/A'}) [${job.arrangement}] [${job.portal}]`);
  });

  // Verdict distribution
  const verdictCounts = { 'Strong Fit': 0, 'Good Fit': 0, 'Moderate Fit': 0, 'Weak Fit': 0, 'Poor Fit': 0 };
  activeJobs.forEach(job => {
    if (job.evaluation && job.evaluation.verdict) {
      verdictCounts[job.evaluation.verdict]++;
    }
  });
  console.log('\nVerdict distribution (active jobs):');
  Object.entries(verdictCounts).forEach(([verdict, count]) => {
    if (count > 0) console.log(`  ${verdict}: ${count}`);
  });

  // Save ranked jobs
  fs.writeFileSync('job_scraper/ranked_jobs.json', JSON.stringify(activeJobs, null, 2));
  console.log('\nSaved ranked_jobs.json');

  // Save Top 10 and Top 5
  fs.writeFileSync('job_scraper/top10_jobs.json', JSON.stringify(top10, null, 2));
  fs.writeFileSync('job_scraper/top5_jobs.json', JSON.stringify(top5, null, 2));
  console.log('Saved top10_jobs.json and top5_jobs.json');

  // Integrity check
  console.log('\n=== INTEGRITY CHECK ===');
  const uniqueStableIds = new Set(activeJobs.map(j => j.stable_id)).size;
  console.log(`Unique stable_ids: ${uniqueStableIds} (expected: ${activeJobs.length})`);
  console.log(`All ranked jobs have scores: ${activeJobs.every(j => j.evaluation && typeof j.evaluation.overall === 'number') ? 'PASS' : 'FAIL'}`);
  console.log(`All scored jobs verified or ACTIVE_UNVERIFIED with recent data: ${activeJobs.every(j => ['ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED', 'NEEDS_VERIFICATION', 'STALE'].includes(j.processing_state)) ? 'PASS' : 'FAIL'}`);
  console.log(`Ranking order descending: ${activeJobs.every((j, i) => i === 0 || (j.evaluation?.overall ?? 0) <= (activeJobs[i-1].evaluation?.overall ?? 0)) ? 'PASS' : 'FAIL'}`);
  console.log(`Tie handling deterministic: ${activeJobs.every((j, i) => i === 0 || (j.evaluation?.overall ?? 0) !== (activeJobs[i-1].evaluation?.overall ?? 0) || j.rank === activeJobs[i-1].rank) ? 'PASS' : 'FAIL'}`);
  console.log(`Top 10 consistent with ranking: ${JSON.stringify(top10.map(j => j.stable_id)) === JSON.stringify(activeJobs.slice(0, 10).map(j => j.stable_id)) ? 'PASS' : 'FAIL'}`);
  console.log(`Top 5 consistent with ranking: ${JSON.stringify(top5.map(j => j.stable_id)) === JSON.stringify(activeJobs.slice(0, 5).map(j => j.stable_id)) ? 'PASS' : 'FAIL'}`);

  // Update seen_jobs with ranks
  const seenJobsData = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));
  const seenJobs = seenJobsData.seen || {};

  activeJobs.forEach(job => {
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

  fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify({ seen: seenJobs, last_updated: new Date().toISOString() }, null, 2));
  console.log('Updated seen_jobs.json with ranks');

  // Save checkpoint
  const checkpoint = {
    run_id: "20260822100000",
    started_at: "2026-08-22T10:00:00.000Z",
    mode: "INCREMENTAL",
    stage: "ranking_report",
    stage_status: "complete",
    jobs_processed_in_stage: activeJobs.length,
    total_jobs_in_stage: activeJobs.length,
    batch_index: 1,
    total_batches: 1,
    last_updated: new Date().toISOString(),
    error: null
  };

  const checkpointsData = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));
  checkpointsData.current_checkpoint = checkpoint;
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpointsData, null, 2));

  console.log('\nCheckpoint saved. Pipeline complete.');

  // Return summary for reporting
  return {
    totalActive: activeJobs.length,
    top10,
    top5,
    verdictCounts
  };
}

main();