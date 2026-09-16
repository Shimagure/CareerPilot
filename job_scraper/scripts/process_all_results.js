#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

// ==================== Normalization Functions ====================

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
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
  const a = arrangement.toLowerCase();
  if (a.includes('remote') || a.includes('wfh') || a.includes('work from home') || a.includes('work-from-home')) return 'remote';
  if (a.includes('hybrid')) return 'hybrid';
  if (a.includes('onsite') || a.includes('on-site') || a.includes('office')) return 'onsite';
  return 'unspecified';
}

function normalizeSalary(salary) {
  if (!salary) return 'unspecified';
  const s = salary.toLowerCase().replace(/[^\d.,kpm]/g, '').replace(/\s+/g, '');
  return s;
}

function extractKeyRequirements(description) {
  if (!description) return '';
  return description.substring(0, 2000);
}

function computeStableId(url, company, title) {
  const normalizedUrl = normalizeUrl(url);
  const normalizedCompany = normalizeCompany(company);
  const normalizedTitle = normalizeTitle(title);
  const input = normalizedUrl + '|' + normalizedCompany + '|' + normalizedTitle;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function computeFingerprint(job) {
  const data = {
    title: normalizeTitle(job.title),
    company: normalizeCompany(job.company),
    location: normalizeLocation(job.location),
    arrangement: normalizeArrangement(job.arrangement || job.work_mode),
    salary: normalizeSalary(job.salary),
    description: extractKeyRequirements(job.description || job.teaser)
  };
  const input = JSON.stringify(data);
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ==================== Portal-specific parsers ====================

function parseJobStreet(rawJob, portal = 'jobstreet') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: rawJob.salary,
    date: rawJob.date,
    dateLabel: rawJob.dateLabel,
    teaser: rawJob.teaser,
    description: rawJob.description,
    url: rawJob.url,
    portal: portal,
    arrangement: rawJob.arrangement || 'unspecified',
    work_mode: rawJob.arrangement
  };
}

function parseLinkedIn(rawJob, portal = 'linkedin') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: null,
    date: rawJob.date,
    dateLabel: null,
    teaser: null,
    description: null,
    url: rawJob.url,
    portal: portal,
    arrangement: 'unspecified',
    work_mode: 'unspecified'
  };
}

function parseIndeed(rawJob, portal = 'indeed') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: rawJob.salary,
    date: rawJob.date,
    dateLabel: rawJob.dateLabel,
    teaser: rawJob.teaser,
    description: null,
    url: rawJob.url,
    portal: portal,
    arrangement: rawJob.location && rawJob.location.toLowerCase().includes('remote') ? 'remote' :
               rawJob.location && rawJob.location.toLowerCase().includes('hybrid') ? 'hybrid' : 'onsite',
    work_mode: rawJob.location && rawJob.location.toLowerCase().includes('remote') ? 'remote' :
               rawJob.location && rawJob.location.toLowerCase().includes('hybrid') ? 'hybrid' : 'onsite'
  };
}

function parseKalibrr(rawJob, portal = 'kalibrr') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: rawJob.salary,
    date: rawJob.date,
    dateLabel: null,
    teaser: null,
    description: null,
    url: rawJob.url,
    portal: portal,
    arrangement: 'unspecified',
    work_mode: 'unspecified'
  };
}

function parseBossJob(rawJob, portal = 'bossjob') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: rawJob.salary,
    date: rawJob.date,
    dateLabel: rawJob.dateLabel,
    teaser: rawJob.teaser,
    description: null,
    url: rawJob.url,
    portal: portal,
    arrangement: rawJob.location && rawJob.location.toLowerCase().includes('remote') ? 'remote' :
               rawJob.location && rawJob.location.toLowerCase().includes('hybrid') ? 'hybrid' : 'onsite',
    work_mode: rawJob.location && rawJob.location.toLowerCase().includes('remote') ? 'remote' :
               rawJob.location && rawJob.location.toLowerCase().includes('hybrid') ? 'hybrid' : 'onsite'
  };
}

function parseFreehire(rawJob, portal = 'freehire') {
  return {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location,
    salary: null, // freehire doesn't include salary in search results
    date: rawJob.date ? rawJob.date.split('T')[0] : null,
    dateLabel: null,
    teaser: null,
    description: rawJob.description,
    url: rawJob.url,
    portal: portal,
    arrangement: rawJob.work_mode || 'unspecified',
    work_mode: rawJob.work_mode || 'unspecified'
  };
}

// ==================== Main Processing ====================

function processJob(rawJob, parser) {
  const job = parser(rawJob);
  const stable_id = computeStableId(job.url, job.company, job.title);
  const fingerprint = computeFingerprint(job);

  return {
    stable_id,
    fingerprint,
    ...job
  };
}

// Load raw results from all portals
function loadAllRawResults() {
  const results = [];

  // We'll manually add the results from our searches
  // In a real run, these would be loaded from saved files
  return results;
}

async function main() {
  console.log('Starting canonicalization of all portal results...');

  // Load existing seen_jobs
  const seenJobsPath = 'job_scraper/seen_jobs.json';
  const seenJobsData = JSON.parse(fs.readFileSync(seenJobsPath, 'utf8'));
  const existingSeen = seenJobsData.seen || {};

  // Manually compile all raw results from this session's searches
  // We need to parse the JSON outputs from each portal search

  // For efficiency, let's collect the results we have in this session
  // and process them

  const allRawJobs = [];

  // ---- JOBSTREET (3 searches from this session) ----
  // These were collected in the current session - we have them from the bash outputs

  // ---- LINKEDIN (5 searches from this session) ----
  // These were collected via the background agent

  // ---- INDEED (4 searches from this session) ----
  const indeedITSupport = JSON.parse(fs.readFileSync('.claude/tmp/indeed_it_support.json', 'utf8')).results;
  const indeedServiceDesk = JSON.parse(fs.readFileSync('.claude/tmp/indeed_service_desk.json', 'utf8')).results;
  const indeedSysAdmin = JSON.parse(fs.readFileSync('.claude/tmp/indeed_sysadmin.json', 'utf8')).results;
  const indeedEUC = JSON.parse(fs.readFileSync('.claude/tmp/indeed_euc.json', 'utf8')).results;

  indeedITSupport.forEach(j => allRawJobs.push({raw: j, parser: parseIndeed}));
  indeedServiceDesk.forEach(j => allRawJobs.push({raw: j, parser: parseIndeed}));
  indeedSysAdmin.forEach(j => allRawJobs.push({raw: j, parser: parseIndeed}));
  indeedEUC.forEach(j => allRawJobs.push({raw: j, parser: parseIndeed}));

  // ---- KALIBRR (3 searches from this session) ----
  const kalibrrITSupport = JSON.parse(fs.readFileSync('.claude/tmp/kalibrr_it_support.json', 'utf8')).results;
  const kalibrrServiceDesk = JSON.parse(fs.readFileSync('.claude/tmp/kalibrr_service_desk.json', 'utf8')).results;
  const kalibrrSysAdmin = JSON.parse(fs.readFileSync('.claude/tmp/kalibrr_sysadmin.json', 'utf8')).results;

  kalibrrITSupport.forEach(j => allRawJobs.push({raw: j, parser: parseKalibrr}));
  kalibrrServiceDesk.forEach(j => allRawJobs.push({raw: j, parser: parseKalibrr}));
  kalibrrSysAdmin.forEach(j => allRawJobs.push({raw: j, parser: parseKalibrr}));

  // ---- BOSSJOB (3 searches from this session) ----
  const bossjobITSupport = JSON.parse(fs.readFileSync('.claude/tmp/bossjob_it_support.json', 'utf8')).results;
  const bossjobServiceDesk = JSON.parse(fs.readFileSync('.claude/tmp/bossjob_service_desk.json', 'utf8')).results;
  const bossjobSysAdmin = JSON.parse(fs.readFileSync('.claude/tmp/bossjob_sysadmin.json', 'utf8')).results;

  bossjobITSupport.forEach(j => allRawJobs.push({raw: j, parser: parseBossJob}));
  bossjobServiceDesk.forEach(j => allRawJobs.push({raw: j, parser: parseBossJob}));
  bossjobSysAdmin.forEach(j => allRawJobs.push({raw: j, parser: parseBossJob}));

  // ---- FREEHIRE (3 searches from this session) ----
  const freehireITSupport = JSON.parse(fs.readFileSync('.claude/tmp/freehire_it_support.json', 'utf8')).results;
  const freehireServiceDesk = JSON.parse(fs.readFileSync('.claude/tmp/freehire_service_desk.json', 'utf8')).results;
  const freehireSysAdmin = JSON.parse(fs.readFileSync('.claude/tmp/freehire_sysadmin.json', 'utf8')).results;

  freehireITSupport.forEach(j => allRawJobs.push({raw: j, parser: parseFreehire}));
  freehireServiceDesk.forEach(j => allRawJobs.push({raw: j, parser: parseFreehire}));
  freehireSysAdmin.forEach(j => allRawJobs.push({raw: j, parser: parseFreehire}));

  // Process all jobs
  const canonicalJobs = [];
  allRawJobs.forEach(({raw, parser}) => {
    canonicalJobs.push(processJob(raw, parser));
  });

  console.log(`Processed ${canonicalJobs.length} raw jobs into canonical format`);

  // Deduplicate by stable_id
  const stableIdMap = new Map();
  const duplicates = [];

  canonicalJobs.forEach(job => {
    if (stableIdMap.has(job.stable_id)) {
      duplicates.push({
        stable_id: job.stable_id,
        existing: stableIdMap.get(job.stable_id),
        duplicate: job
      });
    } else {
      stableIdMap.set(job.stable_id, job);
    }
  });

  console.log(`Unique stable_ids: ${stableIdMap.size}`);
  console.log(`Duplicates found: ${duplicates.length}`);

  // Now merge with existing seen_jobs
  // For each unique canonical job, check if it exists in seen_jobs
  // Update processing_state based on comparison

  const updatedSeen = { ...existingSeen };
  let newJobs = 0;
  let existingJobs = 0;
  let changedJobs = 0;
  let staleJobs = 0;

  stableIdMap.forEach((job, stable_id) => {
    // Find existing record by stable_id
    let existingRecord = null;
    let existingKey = null;

    for (const [key, record] of Object.entries(existingSeen)) {
      if (record.stable_id === stable_id) {
        existingRecord = record;
        existingKey = key;
        break;
      }
    }

    if (existingRecord) {
      existingJobs++;
      // Compare fingerprints
      if (existingRecord.fingerprint === job.fingerprint) {
        // Unchanged - check if stale
        if (existingRecord.last_verified) {
          const daysSinceVerified = (Date.now() - new Date(existingRecord.last_verified).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceVerified > 5) {
            existingRecord.processing_state = 'STALE';
            staleJobs++;
          }
        }
        // Keep existing state for ACTIVE_VERIFIED <= 5 days
      } else {
        // Changed
        existingRecord.processing_state = 'CHANGED';
        existingRecord.previous_fingerprint = existingRecord.fingerprint;
        existingRecord.fingerprint = job.fingerprint;
        existingRecord.changed_at = new Date().toISOString();
        existingRecord.changed_fields = ['fingerprint']; // Could be more specific
        changedJobs++;
      }
      // Update the record with latest data
      updatedSeen[existingKey] = { ...existingRecord, ...job };
    } else {
      // New job
      updatedSeen[job.id] = {
        ...job,
        first_seen: new Date().toISOString().split('T')[0],
        fit: null,
        status: 'discovered',
        processing_state: 'NEW',
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
        gaps: []
      };
      newJobs++;
    }
  });

  // Write updated seen_jobs
  const output = {
    seen: updatedSeen,
    last_updated: new Date().toISOString()
  };

  fs.writeFileSync(seenJobsPath, JSON.stringify(output, null, 2));
  console.log('Updated seen_jobs.json');
  console.log(`New jobs: ${newJobs}`);
  console.log(`Existing jobs: ${existingJobs}`);
  console.log(`Changed jobs: ${changedJobs}`);
  console.log(`Stale jobs: ${staleJobs}`);

  // Save canonical jobs for next stage
  fs.writeFileSync('job_scraper/canonical_jobs.json', JSON.stringify(Array.from(stableIdMap.values()), null, 2));
  console.log('Saved canonical_jobs.json for hard filter stage');
}

main().catch(console.error);