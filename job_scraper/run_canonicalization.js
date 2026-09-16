// Full canonicalization: run portal CLIs, save results, normalize, deduplicate
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { initializeLastActiveAt } = require('./retention');

const PORTAL_CLI_COMMANDS = {
  jobstreet: [
    { query: "End User Computing", location: "Philippines" },
    { query: "IT Support Tier 2", location: "Metro Manila" },
    { query: "Desktop Support", location: "Philippines" },
    { query: "Microsoft 365 Active Directory", location: "Metro Manila" },
    { query: "Endpoint Management Intune", location: "Philippines" },
    { query: "Systems Administrator", location: "Metro Manila" },
    { query: "Cloud Support", location: "Philippines" }
  ],
  indeed: [
    { query: "IT Support Specialist", location: "Philippines" },
    { query: "Technical Support", location: "Metro Manila" },
    { query: "Active Directory Windows Server", location: "Metro Manila" },
    { query: "CrowdStrike endpoint security", location: "Philippines" },
    { query: "Systems Administrator Windows Server", location: "Metro Manila" },
    { query: "Azure AWS IT Support", location: "Philippines" },
    { query: "IT Helpdesk Service Desk", location: "Philippines" }
  ],
  kalibrr: [
    { query: "IT Support", location: "Philippines" },
    { query: "Desktop Support", location: "Philippines" },
    { query: "Systems Administrator", location: "Philippines" },
    { query: "Microsoft 365 Active Directory", location: "Philippines" },
    { query: "Endpoint Management Intune", location: "Philippines" },
    { query: "Cloud Support", location: "Philippines" },
    { query: "Service Desk", location: "Philippines" }
  ],
  bossjob: [
    { query: "IT Support", location: "Metro Manila" },
    { query: "Service Desk", location: "Philippines" },
    { query: "Desktop Support", location: "Philippines" },
    { query: "Microsoft 365 Active Directory", location: "Metro Manila" },
    { query: "Endpoint Management", location: "Philippines" },
    { query: "Systems Administrator", location: "Philippines" },
    { query: "Cloud Support", location: "Philippines" }
  ],
  linkedin: [
    { query: "End User Computing", location: "Philippines" },
    { query: "IT Support", location: "Metro Manila" },
    { query: "Desktop Support", location: "Philippines" },
    { query: "Systems Administrator", location: "Philippines" },
    { query: "Microsoft 365 Active Directory", location: "Philippines" },
    { query: "Cloud Support", location: "Philippines" },
    { query: "Service Desk", location: "Philippines" }
  ],
  freehire: [
    { query: "IT Support", country: "ph" },
    { query: "Desktop Support", country: "ph" },
    { query: "Systems Administrator", country: "ph" },
    { query: "Technical Support", country: "ph" },
    { query: "Service Desk", country: "ph" },
    { query: "End User Computing", country: "ph" },
    { query: "Microsoft 365", country: "ph" }
  ]
};

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch (e) {
    return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function normalizeCompany(company) {
  return company.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return title.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocation(location) {
  return location.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArrangement(arrangement) {
  const arr = (arrangement || '').toLowerCase().trim();
  if (arr.includes('remote') || arr.includes('work from home') || arr.includes('wfh')) return 'remote';
  if (arr.includes('hybrid')) return 'hybrid';
  if (arr.includes('onsite') || arr.includes('on-site') || arr.includes('office')) return 'onsite';
  return 'unspecified';
}

function normalizeSalary(salary) {
  if (!salary) return '';
  return salary.toLowerCase()
    .replace(/[^\d\-\s\.k]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeStableId(url, company, title) {
  const input = normalizeUrl(url) + '|' + normalizeCompany(company) + '|' + normalizeTitle(title);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function computeFingerprint(job) {
  const material = {
    title: normalizeTitle(job.title || ''),
    company: normalizeCompany(job.company || ''),
    location: normalizeLocation(job.location || ''),
    arrangement: normalizeArrangement(job.arrangement || job.work_mode || ''),
    salary: normalizeSalary(job.salary || ''),
    description: (job.description || job.teaser || '').substring(0, 2000)
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

// Load seen_jobs.json
const seenJobsData = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/seen_jobs.json', 'utf8'));
const seenJobs = seenJobsData.seen;

const seenByStableId = new Map();
for (const [id, job] of Object.entries(seenJobs)) {
  if (job.stable_id) seenByStableId.set(job.stable_id, job);
}

console.log('Loaded seen_jobs:', Object.keys(seenJobs).length, 'jobs,', seenByStableId.size, 'unique stable_ids');

// Run portal searches and collect results
async function runPortalSearch(portal, queries) {
  const results = [];
  const cliPath = `C:/Users/Soladm/Downloads/Pilot/ai-job-search/.agents/skills/${portal}-search/cli/src/cli.ts`;

  for (const q of queries) {
    try {
      let cmd;
      if (portal === 'freehire') {
        cmd = `bun run ${cliPath} search -q "${q.query}" --country "${q.country}" --days 14 --limit 20 --format json`;
      } else if (portal === 'linkedin') {
        cmd = `bun run ${cliPath} search -q "${q.query}" -l "${q.location}" --days 14 --limit 20 --format json`;
      } else {
        cmd = `bun run ${cliPath} search -q "${q.query}" -l "${q.location}" --jobage 14 --limit 20 --format json`;
      }

      console.log(`Running: ${portal} - "${q.query}"`);
      const output = execSync(cmd, { timeout: 120000, encoding: 'utf8' });
      const parsed = JSON.parse(output);

      if (parsed.results && parsed.results.length > 0) {
        for (const job of parsed.results) {
          results.push({
            ...job,
            portal: portal,
            search_query: q.query,
            search_location: q.location || q.country
          });
        }
      }

      // Small delay between queries
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`Error searching ${portal} for "${q.query}":`, e.message);
    }
  }

  return results;
}

async function main() {
  const allRawResults = [];

  // Run all portal searches
  for (const [portal, queries] of Object.entries(PORTAL_CLI_COMMANDS)) {
    console.log(`\n=== Searching ${portal} ===`);
    const results = await runPortalSearch(portal, queries);
    console.log(`${portal}: ${results.length} results`);
    allRawResults.push(...results);

    // Save portal results
    fs.writeFileSync(
      `C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/raw_${portal}_20260826.json`,
      JSON.stringify({ portal, results, timestamp: new Date().toISOString() }, null, 2)
    );
  }

  console.log(`\nTotal raw results: ${allRawResults.length}`);

  // Save all raw results
  fs.writeFileSync(
    'C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/raw_results_20260826_full.json',
    JSON.stringify({ run_id: "20260826000000", timestamp: new Date().toISOString(), total: allRawResults.length, results: allRawResults }, null, 2)
  );

  // Canonicalization: normalize, compute stable_ids, deduplicate
  const canonicalJobs = [];
  const stableIdMap = new Map();
  const stats = {
    total_input: allRawResults.length,
    duplicates_within_run: 0,
    duplicates_with_seen: 0,
    new_stable_ids: 0,
    by_portal: {}
  };

  for (const rawJob of allRawResults) {
    const portal = rawJob.portal;
    if (!stats.by_portal[portal]) stats.by_portal[portal] = { input: 0, new: 0, dup_seen: 0, dup_run: 0 };
    stats.by_portal[portal].input++;

    // Normalize
    const job = {
      title: rawJob.title || '',
      company: rawJob.company || '',
      location: rawJob.location || '',
      salary: rawJob.salary || '',
      date: rawJob.date || null,
      dateLabel: rawJob.dateLabel || null,
      teaser: rawJob.teaser || '',
      description: rawJob.description || '',
      url: rawJob.url || '',
      portal: portal,
      arrangement: normalizeArrangement(rawJob.arrangement || rawJob.work_mode || ''),
      work_mode: rawJob.work_mode || '',
      search_query: rawJob.search_query,
      search_location: rawJob.search_location
    };

    // Compute stable_id
    const stable_id = computeStableId(job.url, job.company, job.title);
    job.stable_id = stable_id;

    // Compute fingerprint
    const fingerprint = computeFingerprint(job);
    job.fingerprint = fingerprint;

    // Check duplicates within this run
    if (stableIdMap.has(stable_id)) {
      stats.duplicates_within_run++;
      stats.by_portal[portal].dup_run++;
      continue;
    }

    // Check against seen_jobs
    if (seenByStableId.has(stable_id)) {
      stats.duplicates_with_seen++;
      stats.by_portal[portal].dup_seen++;

      // Update existing seen_job with new fingerprint if changed
      const existing = seenByStableId.get(stable_id);
      if (existing.fingerprint !== fingerprint) {
        // Job content changed
        existing.previous_fingerprint = existing.fingerprint;
        existing.fingerprint = fingerprint;
        existing.changed_at = new Date().toISOString();
        existing.changed_fields = detectChangedFields(existing, job);
        existing.processing_state = 'CHANGED';
      }
      // Update last_seen
      existing.last_seen = new Date().toISOString().split('T')[0];
      continue;
    }

    // New job
    job.first_seen = new Date().toISOString().split('T')[0];
    job.processing_state = 'NEW';
    job.last_verified = null;
    job.blocked_at = null;
    job.blocked_reason = null;
    job.changed_at = null;
    job.changed_fields = [];
    job.closed_at = null;
    job.rank_score = null;
    job.rank_verdict = null;
    job.rank_date = null;
    job.strengths = [];
    job.gaps = [];
    job.fit = null;
    job.status = 'discovered';

    // Initialize last_active_at for new jobs
    initializeLastActiveAt(job, job.first_seen);

    canonicalJobs.push(job);
    stableIdMap.set(stable_id, canonicalJobs.length - 1);
    seenByStableId.set(stable_id, job); // Add to seen map for subsequent checks
    stats.new_stable_ids++;
    stats.by_portal[portal].new++;
  }

  console.log('\n=== Canonicalization Stats ===');
  console.log('Total input:', stats.total_input);
  console.log('Duplicates within run:', stats.duplicates_within_run);
  console.log('Duplicates with seen_jobs:', stats.duplicates_with_seen);
  console.log('New stable_ids:', stats.new_stable_ids);
  console.log('By portal:', JSON.stringify(stats.by_portal, null, 2));

  // Save canonical jobs for this run
  const runCanonical = {
    run_id: "20260826000000",
    timestamp: new Date().toISOString(),
    mode: "INCREMENTAL",
    total_discovered: stats.total_input,
    canonical_jobs: canonicalJobs,
    dedup_stats: stats
  };

  fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/canonical_20260826.json', JSON.stringify(runCanonical, null, 2));
  console.log('\nSaved canonical_20260826.json');

  // Update main canonical_jobs.json (merge with existing)
  let existingCanonical = [];
  try {
    existingCanonical = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/canonical_jobs.json', 'utf8'));
  } catch (e) {
    existingCanonical = [];
  }

  // Merge: existing canonical + new canonical (avoiding duplicates by stable_id)
  const mergedCanonical = [...existingCanonical];
  const mergedStableIds = new Set(mergedCanonical.map(j => j.stable_id).filter(Boolean));

  for (const job of canonicalJobs) {
    if (!mergedStableIds.has(job.stable_id)) {
      mergedCanonical.push(job);
      mergedStableIds.add(job.stable_id);
    }
  }

  fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/canonical_jobs.json', JSON.stringify(mergedCanonical, null, 2));
  console.log(`Updated canonical_jobs.json: ${mergedCanonical.length} total jobs`);

  // Update seen_jobs.json with new jobs
  for (const job of canonicalJobs) {
    seenJobs[job.stable_id] = job; // Use stable_id as key
  }

  seenJobsData.seen = seenJobs;
  fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/seen_jobs.json', JSON.stringify(seenJobsData, null, 2));
  console.log(`Updated seen_jobs.json: ${Object.keys(seenJobs).length} total jobs`);

  // Update checkpoint
  const checkpoints = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', 'utf8'));
  checkpoints.current_checkpoint.stage = 'canonicalization';
  checkpoints.current_checkpoint.stage_status = 'complete';
  checkpoints.current_checkpoint.jobs_processed_in_stage = canonicalJobs.length;
  checkpoints.current_checkpoint.total_jobs_in_stage = canonicalJobs.length;
  checkpoints.current_checkpoint.last_updated = new Date().toISOString();

  checkpoints.run_history.push({
    run_id: "20260826000000",
    started_at: "2026-08-26T00:00:00.000Z",
    stage: "canonicalization",
    stage_status: "complete",
    jobs_processed_in_stage: canonicalJobs.length,
    total_jobs_in_stage: canonicalJobs.length,
    last_updated: new Date().toISOString()
  });

  fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));
  console.log('Updated checkpoints.json');

  console.log('\nCanonicalization complete!');
}

function detectChangedFields(oldJob, newJob) {
  const fields = [];
  const materialFields = ['title', 'company', 'location', 'arrangement', 'salary'];
  for (const field of materialFields) {
    const oldVal = normalizeField(oldJob[field], field);
    const newVal = normalizeField(newJob[field], field);
    if (oldVal !== newVal) fields.push(field);
  }
  return fields;
}

function normalizeField(val, field) {
  if (!val) return '';
  switch (field) {
    case 'title': return normalizeTitle(val);
    case 'company': return normalizeCompany(val);
    case 'location': return normalizeLocation(val);
    case 'arrangement': return normalizeArrangement(val);
    case 'salary': return normalizeSalary(val);
    default: return val.toLowerCase().trim();
  }
}

main().catch(console.error);