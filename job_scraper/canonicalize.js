// Canonicalization script for job scraper
// Computes stable_id, fingerprint, deduplicates, applies hard filters

const fs = require('fs');
const crypto = require('crypto');

// Normalization functions
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function normalizeCompany(company) {
  return company.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeLocation(location) {
  return location.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeArrangement(arrangement) {
  if (!arrangement) return 'unspecified';
  const arr = arrangement.toLowerCase();
  if (arr.includes('remote') || arr.includes('work from home') || arr.includes('wfh')) return 'remote';
  if (arr.includes('hybrid')) return 'hybrid';
  if (arr.includes('onsite') || arr.includes('on-site') || arr.includes('office')) return 'onsite';
  return 'unspecified';
}

function normalizeSalary(salary) {
  if (!salary) return '';
  // Extract numbers from salary string
  const matches = salary.match(/[\d,]+/g);
  if (matches) {
    return matches.map(m => parseInt(m.replace(/,/g, ''))).sort((a,b) => a-b).join('-');
  }
  return salary.toLowerCase().replace(/[^\d\-\w]/g, '').trim();
}

function extractKeyRequirements(description) {
  if (!description) return '';
  // Extract first 2000 chars of description, focus on requirements/skills
  const text = description.toLowerCase();
  // Look for requirement sections
  const reqMatch = text.match(/(?:requirements?|qualifications?|skills?|must have|need)[\s\S]{0,2000}/i);
  if (reqMatch) return reqMatch[0].substring(0, 2000);
  return text.substring(0, 2000);
}

function computeStableId(job) {
  const url = normalizeUrl(job.url || '');
  const company = normalizeCompany(job.company || '');
  const title = normalizeTitle(job.title || '');
  const input = `${url}|${company}|${title}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function computeFingerprint(job) {
  const data = {
    title: normalizeTitle(job.title || ''),
    company: normalizeCompany(job.company || ''),
    location: normalizeLocation(job.location || ''),
    arrangement: normalizeArrangement(job.arrangement || job.work_mode || job.workType || ''),
    salary: normalizeSalary(job.salary || ''),
    description: extractKeyRequirements(job.description || job.teaser || '')
  };
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// Load all data
const seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8')).seen;
const trackerLines = fs.readFileSync('job_search_tracker.csv', 'utf8').split('\n').slice(1);
const trackerUrls = new Set();
for (const line of trackerLines) {
  if (line.trim()) {
    const parts = line.split(',');
    if (parts.length > 12) {
      trackerUrls.add(parts[12].trim());
    }
  }
}

// Read temp files
const tempFiles = fs.readdirSync('job_scraper').filter(f => f.startsWith('.tmp_') && f.endsWith('.json'));
let allJobs = [];

for (const file of tempFiles) {
  const content = fs.readFileSync(`job_scraper/${file}`, 'utf8');
  try {
    const jobs = JSON.parse(content);
    if (Array.isArray(jobs)) {
      allJobs.push(...jobs);
    } else {
      allJobs.push(jobs);
    }
  } catch (e) {
    console.error(`Error parsing ${file}:`, e.message);
  }
}

// Add LinkedIn jobs from manual collection
const linkedInJobs = JSON.parse(fs.readFileSync('job_scraper/linkedin_jobs.json', 'utf8'));
allJobs.push(...linkedInJobs);

// Add FreeHire Philippines jobs (filter from the large result sets)
// FreeHire results are mostly non-PH, but we saved the raw outputs
// We'll manually add any PH ones we found
// Actually, the FreeHire searches didn't yield PH-specific results in the preview

console.log(`Total raw jobs collected: ${allJobs.length}`);

// Canonicalize each job
const canonicalJobs = [];
const seenStableIds = new Set();

for (const job of allJobs) {
  // Ensure required fields
  if (!job.url || !job.title || !job.company) continue;

  const stableId = computeStableId(job);
  const fingerprint = computeFingerprint(job);

  // Check if already in seen_jobs
  let existingState = 'NEW';
  let existingFingerprint = null;
  let existingRecord = null;

  for (const [key, record] of Object.entries(seenJobs)) {
    if (record.stable_id === stableId) {
      existingRecord = record;
      existingFingerprint = record.fingerprint;
      existingState = record.processing_state;
      break;
    }
  }

  // Check if in tracker
  const inTracker = trackerUrls.has(job.url);

  // Determine processing state
  let processingState = existingState;
  let changedFields = [];

  if (existingRecord) {
    if (existingFingerprint !== fingerprint) {
      // Check which material fields changed
      const oldJob = existingRecord;
      // We'd need the old material fields to compare - for now just mark CHANGED
      processingState = 'CHANGED';
      changedFields = ['material_fields'];
    } else if (existingState === 'ACTIVE_VERIFIED' || existingState === 'ACTIVE_UNVERIFIED') {
      // Check staleness
      const lastVerified = existingRecord.last_verified ? new Date(existingRecord.last_verified) : new Date(existingRecord.first_seen);
      const daysSince = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 5) {
        processingState = 'STALE';
      }
    }
  }

  // Extract arrangement from description if not present
  let arrangement = job.arrangement || job.work_mode || job.workType || 'unspecified';
  if (arrangement === 'unspecified' && job.description) {
    const desc = job.description.toLowerCase();
    if (desc.includes('remote') || desc.includes('work from home') || desc.includes('wfh')) arrangement = 'remote';
    else if (desc.includes('hybrid')) arrangement = 'hybrid';
    else if (desc.includes('onsite') || desc.includes('on-site') || desc.includes('office')) arrangement = 'onsite';
  }

  canonicalJobs.push({
    ...job,
    stable_id: stableId,
    fingerprint: fingerprint,
    processing_state: processingState,
    previous_fingerprint: existingRecord && existingFingerprint !== fingerprint ? existingFingerprint : null,
    changed_fields: changedFields,
    in_tracker: inTracker,
    arrangement: arrangement,
    portal: job.portal || (job.url.includes('linkedin') ? 'linkedin' :
                            job.url.includes('indeed') ? 'indeed' :
                            job.url.includes('kalibrr') ? 'kalibrr' :
                            job.url.includes('jobstreet') ? 'jobstreet' :
                            job.url.includes('bossjob') ? 'bossjob' :
                            job.url.includes('freehire') ? 'freehire' : 'unknown'),
    first_seen: existingRecord?.first_seen || new Date().toISOString().split('T')[0],
    last_verified: existingRecord?.last_verified || null,
    rank_score: existingRecord?.rank_score || null,
    rank_verdict: existingRecord?.rank_verdict || null,
    source_file: file
  });

  seenStableIds.add(stableId);
}

// Deduplicate by stable_id (keep first occurrence)
const uniqueJobs = [];
const seenIds = new Set();
for (const job of canonicalJobs) {
  if (!seenIds.has(job.stable_id)) {
    seenIds.add(job.stable_id);
    uniqueJobs.push(job);
  }
}

console.log(`Unique jobs after dedup: ${uniqueJobs.length}`);

// Apply hard filters
const hardFiltered = [];
const deprioritized = [];

for (const job of uniqueJobs) {
  // Hard filter rules from MASTER_JOB_SEARCH_BASELINE.md

  // 1. Role filter - must be relevant IT role
  const title = job.title.toLowerCase();
  const relevantRoles = [
    'end user computing', 'euc', 'it support', 'desktop support',
    'technical support', 'service desk', 'helpdesk', 'help desk',
    'tier 2', 'l2', 'level 2', 'systems administrator', 'system administrator',
    'sysadmin', 'cloud support', 'infrastructure', 'it administrator',
    'endpoint security', 'endpoint engineer', 'security analyst',
    'soc', 'identity', 'access management', 'iam', 'active directory',
    'microsoft 365', 'm365', 'intune', 'entra', 'azure ad',
    'field support', 'it operations', 'it specialist', 'noc'
  ];

  const isRelevant = relevantRoles.some(r => title.includes(r));

  // 2. Exclude non-IT roles
  const excludeRoles = [
    'receptionist', 'front desk', 'customer service', 'live chat',
    'sales', 'accounting', 'finance', 'hr', 'human resources',
    'marketing', 'content', 'writer', 'designer', 'creative',
    'teacher', 'trainer', 'instructor', 'nurse', 'medical',
    'driver', 'warehouse', 'logistics', 'manufacturing',
    'chef', 'cook', 'kitchen', 'retail', 'cashier'
  ];

  const isExcluded = excludeRoles.some(r => title.includes(r));

  // 3. Location filter
  const location = (job.location || '').toLowerCase();
  const acceptableLocations = [
    'philippines', 'metro manila', 'ncr', 'national capital region',
    'manila', 'makati', 'taguig', 'pasig', 'mandaluyong', 'quezon city',
    'ortigas', 'bgc', 'bonifacio', 'alabang', 'muntilupa',
    'caloocan', 'valenzuela', 'navotas', 'malabon', 'marikina',
    'san juan', 'pateros', 'las piñas', 'paranaque', 'pasay',
    'bulacan', 'cavite', 'laguna', 'rizal', 'remote', 'wfh',
    'work from home'
  ];

  const isAcceptableLocation = acceptableLocations.some(loc => location.includes(loc));

  // 4. Check tracker - if already applied/withdrawn, deprioritize
  const trackerStatus = job.in_tracker ? 'tracked' : 'new';

  if (!isRelevant || isExcluded || !isAcceptableLocation) {
    deprioritized.push({...job, filter_reason: !isRelevant ? 'irrelevant_role' : (isExcluded ? 'excluded_role' : 'location')});
  } else {
    hardFiltered.push(job);
  }
}

console.log(`Hard filter passed: ${hardFiltered.length}`);
console.log(`Deprioritized: ${deprioritized.length}`);

// Save canonical jobs
fs.writeFileSync('job_scraper/canonical_jobs.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total_raw: allJobs.length,
  unique_jobs: uniqueJobs.length,
  hard_filtered: hardFiltered.length,
  deprioritized: deprioritized.length,
  jobs: hardFiltered
}, null, 2));

// Save full canonical with all for reference
fs.writeFileSync('job_scraper/canonical_20260826.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total_raw: allJobs.length,
  unique_jobs: uniqueJobs.length,
  hard_filtered: hardFiltered.length,
  deprioritized: deprioritized.length,
  jobs: uniqueJobs
}, null, 2));

console.log('Canonicalization complete. Saved to job_scraper/canonical_jobs.json');