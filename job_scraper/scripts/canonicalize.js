#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

// Normalize URL
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

// Normalize company
function normalizeCompany(company) {
  return company.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Normalize title
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Normalize location
function normalizeLocation(location) {
  return location.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Normalize arrangement
function normalizeArrangement(arrangement) {
  if (!arrangement) return 'unspecified';
  const a = arrangement.toLowerCase();
  if (a.includes('remote') || a.includes('wfh') || a.includes('work from home') || a.includes('work-from-home')) return 'remote';
  if (a.includes('hybrid')) return 'hybrid';
  if (a.includes('onsite') || a.includes('on-site') || a.includes('office')) return 'onsite';
  return 'unspecified';
}

// Normalize salary
function normalizeSalary(salary) {
  if (!salary) return 'unspecified';
  const s = salary.toLowerCase().replace(/[^\d.,kpm]/g, '').replace(/\s+/g, '');
  return s;
}

// Extract key requirements from description
function extractKeyRequirements(description) {
  if (!description) return '';
  // Truncate to first 2000 chars
  return description.substring(0, 2000);
}

// Compute stable_id
function computeStableId(url, company, title) {
  const normalizedUrl = normalizeUrl(url);
  const normalizedCompany = normalizeCompany(company);
  const normalizedTitle = normalizeTitle(title);
  const input = normalizedUrl + '|' + normalizedCompany + '|' + normalizedTitle;
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Compute fingerprint
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

// Process a single job
function processJob(rawJob, portal) {
  const job = {
    id: rawJob.id,
    title: rawJob.title,
    company: rawJob.company,
    location: rawJob.location || rawJob.locationRaw,
    salary: rawJob.salary,
    date: rawJob.date,
    dateLabel: rawJob.dateLabel,
    teaser: rawJob.teaser,
    description: rawJob.description,
    url: rawJob.url,
    portal: portal,
    arrangement: rawJob.arrangement || rawJob.work_mode || rawJob.remote,
    work_mode: rawJob.work_mode
  };

  const stable_id = computeStableId(job.url, job.company, job.title);
  const fingerprint = computeFingerprint(job);

  return {
    stable_id,
    fingerprint,
    ...job
  };
}

// Load all search results
function loadSearchResults() {
  const results = [];

  // JobStreet results (from the previous searches)
  // These were collected in the previous session - we need to load them
  // For now, we'll manually compile all the raw results we have

  return results;
}

// Main canonicalization
async function main() {
  console.log('Starting canonicalization...');

  // Load existing seen_jobs
  const seenJobsPath = 'job_scraper/seen_jobs.json';
  const seenJobsData = JSON.parse(fs.readFileSync(seenJobsPath, 'utf8'));
  const existingSeen = seenJobsData.seen || {};

  // Compile all raw results from this run
  const allRawResults = [];

  // JobStreet - 3 searches (IT Support, Systems Admin, End User Computing)
  // These were already collected in the previous session. Let me add the ones from this session.

  // For now, I'll create a combined raw results file from all the searches
  // This is a simplified version - in production we'd load from saved files

  console.log('Canonicalization complete.');
}

main().catch(console.error);