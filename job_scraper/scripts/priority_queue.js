#!/usr/bin/env node

const fs = require('fs');

// ==================== Priority Scoring ====================

function scorePriority(job) {
  const hf = job.hard_filter;
  let priorityScore = 0;
  let tier = 5;

  // Base score from arrangement (most important)
  priorityScore += hf.arrangement_score;

  // Add salary score
  priorityScore += hf.salary_score;

  // Add role score
  priorityScore += hf.role_score;

  // Career alignment bonus
  const title = job.title.toLowerCase();
  if (title.includes('tier 2') || title.includes('tier 3') || title.includes('l2') || title.includes('l3') ||
      title.includes('senior') || title.includes('lead') || title.includes('systems admin') ||
      title.includes('endpoint') || title.includes('cloud') || title.includes('security') ||
      title.includes('infrastructure') || title.includes('euc') || title.includes('end user computing') ||
      title.includes('intune') || title.includes('mdm') || title.includes('active directory')) {
    priorityScore += 15;
  }

  // Source reliability bonus (portal CLI > WebSearch)
  const portalBonus = {
    'jobstreet': 10,
    'linkedin': 10,
    'indeed': 5,
    'kalibrr': 5,
    'bossjob': 3,
    'freehire': 3
  };
  priorityScore += portalBonus[job.portal] || 0;

  // Freshness bonus (newer postings first)
  if (job.date) {
    const daysOld = (Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld <= 1) priorityScore += 10;
    else if (daysOld <= 3) priorityScore += 7;
    else if (daysOld <= 7) priorityScore += 5;
    else if (daysOld <= 14) priorityScore += 2;
  }

  // Assign tier based on priority score
  if (priorityScore >= 250) tier = 1;
  else if (priorityScore >= 200) tier = 2;
  else if (priorityScore >= 150) tier = 3;
  else if (priorityScore >= 100) tier = 4;
  else tier = 5;

  return { priorityScore, tier, details: {
    arrangement: hf.arrangement_score,
    salary: hf.salary_score,
    role: hf.role_score,
    career: (title.includes('tier 2') || title.includes('tier 3') || title.includes('l2') || title.includes('l3') ||
      title.includes('senior') || title.includes('lead') || title.includes('systems admin') ||
      title.includes('endpoint') || title.includes('cloud') || title.includes('security') ||
      title.includes('infrastructure') || title.includes('euc') || title.includes('end user computing') ||
      title.includes('intune') || title.includes('mdm') || title.includes('active directory')) ? 15 : 0,
    portal: portalBonus[job.portal] || 0,
    freshness: job.date ? (() => {
      const daysOld = (Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld <= 1) return 10;
      else if (daysOld <= 3) return 7;
      else if (daysOld <= 7) return 5;
      else if (daysOld <= 14) return 2;
      return 0;
    })() : 0
  }};
}

function main() {
  console.log('Building priority verification queue...');

  // Load filtered jobs
  const filteredJobs = JSON.parse(fs.readFileSync('job_scraper/filtered_jobs.json', 'utf8'));
  console.log(`Loaded ${filteredJobs.length} filtered jobs`);

  // Load seen_jobs to check processing_state
  const seenJobsData = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));
  const seenJobs = seenJobsData.seen || {};

  // Build verification queue
  // Eligible: NEW, CHANGED, STALE, NEEDS_VERIFICATION
  // Skip: ACTIVE_VERIFIED ≤5 days, ACTIVE_UNVERIFIED ≤5 days
  const verificationQueue = [];

  filteredJobs.forEach(job => {
    // Find in seen_jobs by stable_id
    let existingRecord = null;
    for (const [key, record] of Object.entries(seenJobs)) {
      if (record.stable_id === job.stable_id) {
        existingRecord = record;
        break;
      }
    }

    if (existingRecord) {
      const state = existingRecord.processing_state;
      const lastVerified = existingRecord.last_verified;

      if (state === 'ACTIVE_VERIFIED' && lastVerified) {
        const daysSince = (Date.now() - new Date(lastVerified).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 5) {
          // Skip - already verified recently
          console.log(`SKIP (ACTIVE_VERIFIED ≤5d): ${job.title} @ ${job.company}`);
          return;
        }
      }

      if (state === 'ACTIVE_UNVERIFIED' && lastVerified) {
        const daysSince = (Date.now() - new Date(lastVerified).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 5) {
          // Skip - recent data, blocked but recent
          console.log(`SKIP (ACTIVE_UNVERIFIED ≤5d): ${job.title} @ ${job.company}`);
          return;
        }
      }

      // Eligible for verification
      job.processing_state = state;
      job.last_verified = lastVerified;
    } else {
      // New job
      job.processing_state = 'NEW';
      job.last_verified = null;
    }

    const priority = scorePriority(job);
    verificationQueue.push({
      ...job,
      priority_score: priority.priorityScore,
      priority_tier: priority.tier,
      priority_details: priority.details
    });
  });

  // Sort by priority tier (ascending = higher priority first), then by priority_score descending
  verificationQueue.sort((a, b) => {
    if (a.priority_tier !== b.priority_tier) return a.priority_tier - b.priority_tier;
    return b.priority_score - a.priority_score;
  });

  console.log(`\nVerification queue built: ${verificationQueue.length} jobs`);

  // Print tier distribution
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  verificationQueue.forEach(j => tierCounts[j.priority_tier]++);
  console.log('Priority tier distribution:');
  Object.entries(tierCounts).forEach(([tier, count]) => {
    console.log(`  Tier ${tier}: ${count} jobs`);
  });

  // Print top 10
  console.log('\nTop 10 jobs in verification queue:');
  verificationQueue.slice(0, 10).forEach((job, i) => {
    console.log(`  ${i+1}. [Tier ${job.priority_tier}, Score ${job.priority_score}] ${job.title} @ ${job.company} (${job.arrangement}, ${job.salary || 'undisclosed'}) [${job.portal}]`);
  });

  // Save verification queue
  fs.writeFileSync('job_scraper/verification_queue.json', JSON.stringify(verificationQueue, null, 2));
  console.log('\nSaved verification_queue.json');
}

main();