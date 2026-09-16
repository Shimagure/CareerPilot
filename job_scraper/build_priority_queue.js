// Build Priority Queue for Verification
const fs = require('fs');

// Load filtered jobs
const filteredData = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/filtered_20260826.json', 'utf8'));
const filteredJobs = filteredData.filtered_jobs;

console.log('Loaded filtered jobs:', filteredJobs.length);

// Also load seen_jobs to check existing states
const seenJobsData = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/seen_jobs.json', 'utf8'));
const seenJobs = seenJobsData.seen;

// Priority tiers (from CLAUDE.md)
// TIER 1: Remote, salary >= 40k, strong EUC/IT Support match, clear career progression
// TIER 2: Remote, salary >= 30k, good technical match
// TIER 3: Hybrid NCR, salary >= 40k, strong technical match
// TIER 4: Onsite NCR, salary >= 40k, strong technical match
// TIER 5: Other hard-filter-passing jobs

function parseSalary(salaryStr) {
  if (!salaryStr) return null;
  const str = salaryStr.toLowerCase();
  if (str.includes('negotiable') || str.includes('competitive')) return null;
  const matches = str.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*[-\–]\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
  if (matches) {
    const min = parseFloat(matches[1].replace(/,/g, ''));
    const max = parseFloat(matches[2].replace(/,/g, ''));
    const unit = str.includes('k') || str.includes('K') ? 1000 : 1;
    return { min: min * unit, max: max * unit };
  }
  const singleMatch = str.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
  if (singleMatch) {
    const val = parseFloat(singleMatch[1].replace(/,/g, ''));
    const unit = str.includes('k') || str.includes('K') ? 1000 : 1;
    return { min: val * unit, max: val * unit };
  }
  return null;
}

function getArrangement(job) {
  return (job.arrangement || job.work_mode || '').toLowerCase();
}

function getLocation(job) {
  return (job.location || '').toLowerCase();
}

function getSalaryMax(job) {
  const parsed = parseSalary(job.salary);
  return parsed ? parsed.max : 0;
}

function assessTechnicalFit(job) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || job.teaser || '').toLowerCase();
  const text = title + ' ' + desc;

  // Strong EUC/IT Support keywords
  const strongKeywords = [
    'end user computing', 'euc', 'tier 2', 'tier ii', 'l2', 'level 2',
    'service desk', 'desktop support', 'technical support', 'it support',
    'active directory', 'microsoft 365', 'm365', 'intune', 'endpoint management',
    'crowdstrike', 'powershell', 'windows server', 'group policy'
  ];

  // Good technical keywords
  const goodKeywords = [
    'systems administrator', 'system administrator', 'sysadmin',
    'cloud support', 'azure', 'aws', 'infrastructure',
    'network', 'security', 'endpoint', 'device management',
    'identity', 'iam', 'helpdesk', 'help desk',
    'field support', 'field technician', 'desktop engineer',
    'pc support', 'workstation', 'laptop', 'device'
  ];

  let score = 0;
  for (const kw of strongKeywords) {
    if (text.includes(kw)) score += 3;
  }
  for (const kw of goodKeywords) {
    if (text.includes(kw)) score += 1;
  }
  return score;
}

function assessCareerAlignment(job) {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || job.teaser || '').toLowerCase();
  const text = title + ' ' + desc;

  // Career progression toward systems/cloud/security
  const progressionKeywords = [
    'systems administrator', 'system administrator', 'sysadmin',
    'cloud', 'azure', 'aws', 'infrastructure',
    'security', 'soc', 'cybersecurity', 'endpoint security',
    'identity', 'iam', 'intune', 'endpoint management',
    'junior', 'associate', 'trainee', 'entry', 'graduate'
  ];

  let score = 0;
  for (const kw of progressionKeywords) {
    if (text.includes(kw)) score += 1;
  }
  return score;
}

function getPostingFreshness(job) {
  // Try to parse date
  if (job.date) {
    const jobDate = new Date(job.date);
    const now = new Date();
    const diffDays = (now - jobDate) / (1000 * 60 * 60 * 24);
    return Math.max(0, 30 - diffDays); // Newer = higher score
  }
  return 15; // Default for unknown date
}

function getSourceReliability(portal) {
  // Portal CLI > WebSearch
  const cliPortals = ['jobstreet', 'indeed', 'kalibrr', 'bossjob', 'linkedin', 'freehire'];
  return cliPortals.includes(portal) ? 10 : 5;
}

// Assign priority tier to each job
const queue = [];

for (const job of filteredJobs) {
  const arrangement = getArrangement(job);
  const location = getLocation(job);
  const salaryMax = getSalaryMax(job);
  const techFit = assessTechnicalFit(job);
  const careerAlign = assessCareerAlignment(job);
  const freshness = getPostingFreshness(job);
  const sourceRel = getSourceReliability(job.portal);

  // Determine if NCR
  const isNCR = location.includes('manila') || location.includes('makati') ||
                location.includes('taguig') || location.includes('pasig') ||
                location.includes('mandaluyong') || location.includes('quezon city') ||
                location.includes('pasay') || location.includes('paranaque') ||
                location.includes('las pinas') || location.includes('muntinlupa') ||
                location.includes('marikina') || location.includes('san juan') ||
                location.includes('navotas') || location.includes('malabon') ||
                location.includes('valenzuela') || location.includes('pateros');

  const isRemote = arrangement.includes('remote') || arrangement.includes('wfh') || arrangement.includes('work from home');
  const isHybrid = arrangement.includes('hybrid');
  const isOnsite = arrangement.includes('onsite') || arrangement.includes('on-site') || arrangement.includes('office');

  let tier = 5; // Default

  // TIER 1: Remote, salary >= 40k, strong EUC/IT Support match, clear career progression
  if (isRemote && salaryMax >= 40000 && techFit >= 6 && careerAlign >= 2) {
    tier = 1;
  }
  // TIER 2: Remote, salary >= 30k, good technical match
  else if (isRemote && salaryMax >= 30000 && techFit >= 4) {
    tier = 2;
  }
  // TIER 3: Hybrid NCR, salary >= 40k, strong technical match
  else if (isHybrid && isNCR && salaryMax >= 40000 && techFit >= 5) {
    tier = 3;
  }
  // TIER 4: Onsite NCR, salary >= 40k, strong technical match
  else if (isOnsite && isNCR && salaryMax >= 40000 && techFit >= 5) {
    tier = 4;
  }
  // TIER 5: Other hard-filter-passing jobs
  else {
    tier = 5;
  }

  // Priority score for sorting within tier (higher = more priority)
  const priorityScore = (techFit * 10) + (careerAlign * 5) + (salaryMax / 1000) + freshness + sourceRel;

  queue.push({
    ...job,
    priority_tier: tier,
    priority_score: priorityScore,
    arrangement: arrangement,
    location_normalized: location,
    salary_max: salaryMax,
    tech_fit_score: techFit,
    career_alignment_score: careerAlign,
    freshness_score: freshness,
    source_reliability: sourceRel,
    is_ncr: isNCR,
    is_remote: isRemote,
    is_hybrid: isHybrid,
    is_onsite: isOnsite
  });
}

// Sort by tier asc, then priority_score desc
queue.sort((a, b) => {
  if (a.priority_tier !== b.priority_tier) return a.priority_tier - b.priority_tier;
  return b.priority_score - a.priority_score;
});

// Count by tier
const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const job of queue) {
  tierCounts[job.priority_tier]++;
}

console.log('\n=== Priority Queue ===');
console.log('Total jobs in queue:', queue.length);
console.log('Tier breakdown:', tierCounts);

// Show top 10
console.log('\nTop 10 jobs:');
for (let i = 0; i < Math.min(10, queue.length); i++) {
  const job = queue[i];
  console.log(`${i+1}. [T${job.priority_tier}] ${job.title} @ ${job.company} (${job.arrangement}, ${job.location}) - Salary: ${job.salary} - TechFit: ${job.tech_fit_score} - Score: ${job.priority_score.toFixed(1)}`);
}

// Save priority queue
const queueOutput = {
  run_id: "20260826000000",
  timestamp: new Date().toISOString(),
  mode: "INCREMENTAL",
  total_queued: queue.length,
  tier_breakdown: tierCounts,
  queue: queue
};

fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/priority_queue_20260826.json', JSON.stringify(queueOutput, null, 2));
console.log('\nSaved priority_queue_20260826.json');

// Update main priority_queue
fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/priority_queue.json', JSON.stringify(queue, null, 2));
console.log('Updated priority_queue.json');

// Update checkpoint
const checkpoints = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', 'utf8'));
checkpoints.current_checkpoint.stage = 'priority_queue';
checkpoints.current_checkpoint.stage_status = 'complete';
checkpoints.current_checkpoint.jobs_processed_in_stage = queue.length;
checkpoints.current_checkpoint.total_jobs_in_stage = queue.length;
checkpoints.current_checkpoint.last_updated = new Date().toISOString();
checkpoints.current_checkpoint.queue_length = queue.length;
checkpoints.current_checkpoint.tier_breakdown = tierCounts;

checkpoints.run_history.push({
  run_id: "20260826000000",
  started_at: "2026-08-26T00:00:00.000Z",
  stage: "priority_queue",
  stage_status: "complete",
  jobs_processed_in_stage: queue.length,
  total_jobs_in_stage: queue.length,
  last_updated: new Date().toISOString()
});

fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));
console.log('Updated checkpoints.json');

console.log('\nPriority queue built!');