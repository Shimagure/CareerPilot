// Consolidate and canonicalize all search results
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Read all tool-results files
const toolResultsDir = '/home/Soladm/.claude/projects/C--Users-Soladm-Downloads-Pilot-ai-job-search/cff5a8ae-e686-48c4-bd3a-5b641d7478c6/tool-results';
const files = fs.readdirSync(toolResultsDir).filter(f => f.endsWith('.txt'));

console.log(`Found ${files.length} result files`);

let allResults = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(toolResultsDir, file), 'utf8');
  try {
    const data = JSON.parse(content);
    if (data.results && Array.isArray(data.results)) {
      for (const r of data.results) {
        r._source_file = file;
      }
      allResults.push(...data.results);
    }
  } catch (e) {
    console.error(`Failed to parse ${file}:`, e.message);
  }
}

console.log(`Total raw results: ${allResults.length}`);

// Normalize functions
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function normalizeCompany(company) {
  return (company || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return (title || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeLocation(location) {
  return (location || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeArrangement(arr) {
  if (!arr) return 'unspecified';
  const a = arr.toLowerCase();
  if (a.includes('remote') || a.includes('work from home') || a.includes('wfh')) return 'remote';
  if (a.includes('hybrid')) return 'hybrid';
  if (a.includes('onsite') || a.includes('on-site') || a.includes('office')) return 'onsite';
  return 'unspecified';
}

function normalizeSalary(salary) {
  if (!salary) return null;
  return salary.toString().toLowerCase().replace(/[^\d\w\s\-\$€£₱.,]/g, '').replace(/\s+/g, ' ').trim();
}

function computeStableId(url, company, title) {
  const input = normalizeUrl(url) + '|' + normalizeCompany(company) + '|' + normalizeTitle(title);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function computeFingerprint(job) {
  const obj = {
    title: normalizeTitle(job.title),
    company: normalizeCompany(job.company),
    location: normalizeLocation(job.location),
    arrangement: normalizeArrangement(job.work_mode || job.arrangement),
    salary: normalizeSalary(job.salary),
    description: (job.description || '').slice(0, 2000)
  };
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// Load existing seen_jobs
const seenJobsPath = path.join(__dirname, 'seen_jobs.json');
let seenJobs = { seen: {} };
if (fs.existsSync(seenJobsPath)) {
  seenJobs = JSON.parse(fs.readFileSync(seenJobsPath, 'utf8'));
}

// Load tracker
const trackerPath = path.join(__dirname, '..', 'job_search_tracker.csv');
let trackerCompanies = new Set();
if (fs.existsSync(trackerPath)) {
  const trackerContent = fs.readFileSync(trackerPath, 'utf8');
  const lines = trackerContent.split('\n').slice(1);
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length >= 2) {
      trackerCompanies.add(normalizeCompany(cols[1]) + '|' + normalizeTitle(cols[3]));
    }
  }
}

console.log(`Existing seen jobs: ${Object.keys(seenJobs.seen).length}`);
console.log(`Tracker entries: ${trackerCompanies.size}`);

// Process each result
const now = new Date().toISOString();
const today = now.split('T')[0];
let newCount = 0;
let existingCount = 0;
let deprioritizedCount = 0;
let needsVerificationCount = 0;

for (const r of allResults) {
  // Skip non-PH results for PH portals, but keep for freehire/WebSearch
  const country = r.countries?.[0] || '';
  const region = r.regions?.[0] || '';
  const location = r.location || '';

  // Determine source portal from file name
  let portal = 'unknown';
  if (r._source_file) {
    if (r._source_file.includes('jobstreet')) portal = 'jobstreet';
    else if (r._source_file.includes('indeed')) portal = 'indeed';
    else if (r._source_file.includes('kalibrr')) portal = 'kalibrr';
    else if (r._source_file.includes('bossjob')) portal = 'bossjob';
    else if (r._source_file.includes('linkedin')) portal = 'linkedin';
    else if (r._source_file.includes('freehire')) portal = 'freehire';
    else if (r._source_file.includes('builtin') || r._source_file.includes('hiringcafe')) portal = 'websearch';
  }

  const url = r.url || '';
  const company = r.company || r.company_slug || '';
  const title = r.title || '';

  if (!url || !company || !title) continue;

  const stable_id = computeStableId(url, company, title);
  const fingerprint = computeFingerprint(r);
  const isPhilippines = country === 'ph' || location.toLowerCase().includes('philippines') || location.toLowerCase().includes('manila') || location.toLowerCase().includes('makati') || location.toLowerCase().includes('pasig') || location.toLowerCase().includes('quezon') || location.toLowerCase().includes('cebu') || location.toLowerCase().includes('mandaluyong');

  // Hard filter: only PH locations for PH portals, or remote-friendly for global portals
  let passesHardFilter = false;
  if (['jobstreet', 'indeed', 'kalibrr', 'bossjob'].includes(portal)) {
    passesHardFilter = isPhilippines;
  } else if (portal === 'linkedin') {
    passesHardFilter = isPhilippines || (r.work_mode && r.work_mode.toLowerCase().includes('remote'));
  } else if (portal === 'freehire' || portal === 'websearch') {
    passesHardFilter = isPhilippines || (r.work_mode && r.work_mode.toLowerCase().includes('remote')) || (r.url && (r.url.includes('remote') || r.url.includes('work-from-home')));
  }

  // Check tracker
  const trackerKey = normalizeCompany(company) + '|' + normalizeTitle(title);
  const inTracker = trackerCompanies.has(trackerKey);

  const existing = seenJobs.seen[stable_id];

  if (existing) {
    existingCount++;
    // Check for changes
    if (existing.fingerprint !== fingerprint) {
      existing.previous_fingerprint = existing.fingerprint;
      existing.fingerprint = fingerprint;
      existing.changed_at = now;
      existing.changed_fields = ['content'];
      existing.processing_state = 'CHANGED';
    }
    // Update last seen
    existing.last_seen = now;
  } else {
    // NEW job
    const jobRecord = {
      stable_id,
      fingerprint,
      id: r.id || stable_id.slice(0, 12),
      title,
      company,
      location,
      salary: r.salary || null,
      date: r.date ? r.date.split('T')[0] : today,
      url,
      portal,
      arrangement: normalizeArrangement(r.work_mode),
      work_mode: r.work_mode || 'unspecified',
      first_seen: today,
      fit: null,
      status: passesHardFilter ? 'new' : 'deprioritized',
      processing_state: passesHardFilter ? 'NEEDS_VERIFICATION' : 'DEPRIORITIZE',
      last_verified: null,
      blocked_at: null,
      blocked_reason: null,
      changed_at: null,
      changed_fields: [],
      closed_at: null,
      rank_score: null,
      rank_verdict: null,
      rank_date: null,
      strengths: [],
      gaps: [],
      in_tracker: inTracker,
      countries: r.countries || [],
      regions: r.regions || [],
      skills: r.skills || [],
      description: r.description || ''
    };

    seenJobs.seen[stable_id] = jobRecord;

    if (passesHardFilter) {
      newCount++;
      needsVerificationCount++;
    } else {
      deprioritizedCount++;
    }
  }
}

console.log(`\nResults:`);
console.log(`  New jobs (passed hard filter): ${newCount}`);
console.log(`  Existing jobs: ${existingCount}`);
console.log(`  Deprioritized (failed hard filter): ${deprioritizedCount}`);
console.log(`  Needs verification: ${needsVerificationCount}`);
console.log(`  Total in seen_jobs: ${Object.keys(seenJobs.seen).length}`);

// Save updated seen_jobs
fs.writeFileSync(seenJobsPath, JSON.stringify(seenJobs, null, 2));
console.log('\nUpdated seen_jobs.json saved.');

// Print summary of new jobs needing verification
const newJobs = Object.values(seenJobs.seen).filter(j => j.processing_state === 'NEEDS_VERIFICATION' && j.first_seen === today);
console.log(`\nNew jobs needing verification (${newJobs.length}):`);
for (const j of newJobs.slice(0, 20)) {
  console.log(`  - ${j.title} at ${j.company} [${j.location}] ${j.arrangement} ${j.salary || ''} (${j.portal})`);
}