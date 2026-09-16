// Job processing pipeline: canonicalize, deduplicate, hard filter, assign state
const fs = require('fs');
const crypto = require('crypto');

// Load data
const consolidatedJobs = JSON.parse(fs.readFileSync('.scrape_out/consolidated_jobs.json', 'utf8').replace(/^﻿/, ''));
const seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8').replace(/^﻿/, ''));
const trackerCsv = fs.readFileSync('job_search_tracker.csv', 'utf8');

// Parse tracker CSV to get applied/drafted/submitted URLs
const trackerLines = trackerCsv.trim().split('\n').slice(1); // skip header
const trackerUrls = new Set();
for (const line of trackerLines) {
  const parts = line.split(',');
  if (parts.length >= 13) {
    const url = parts[12].trim();
    if (url) trackerUrls.add(url);
  }
}

// Normalization functions
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/+$/, '').toLowerCase();
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
  if (!arrangement || !String(arrangement).trim()) return 'unknown';

  const arr = String(arrangement)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    arr.includes('remote') ||
    arr.includes('work from home') ||
    arr.includes('wfh')
  ) {
    return 'remote';
  }

  if (arr.includes('hybrid')) {
    return 'hybrid';
  }

  if (
    arr.includes('onsite') ||
    arr.includes('on site') ||
    arr.includes('office')
  ) {
    return 'onsite';
  }

  return 'unknown';
}

function normalizeSalary(salary) {
  if (!salary || salary.trim() === '') {
    return 'undisclosed';
  }

  const normalized = salary
    .toLowerCase()
    .replace(/[^\w\s\.\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const numbers = normalized.match(/\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 2) {
    const min = parseInt(numbers[0], 10);
    const max = parseInt(numbers[1], 10);
    const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/);
    const currency = currencyMatch ? currencyMatch[1] : 'php';
    return `${currency}:${min}:${max}`;
  } else if (numbers && numbers.length === 1) {
    const min = parseInt(numbers[0], 10);
    const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/);
    const currency = currencyMatch ? currencyMatch[1] : 'php';
    return `${currency}:${min}:${min}`;
  }

  return 'undisclosed';
}

function extractKeyRequirements(description) {
  if (!description) return '';
  return description.substring(0, 2000);
}

function buildFingerprintMaterial(job) {
  return {
    title: normalizeTitle(job.title || ''),
    company: normalizeCompany(job.company || ''),
    location: normalizeLocation(job.location || ''),
    arrangement: normalizeArrangement(job.work_mode || job.arrangement || ''),
    salary: normalizeSalary(job.salary || job.salary_text || ''),
    description: extractKeyRequirements(job.description || '')
  };
}

function computeFingerprint(material) {
  const data = JSON.stringify(material);
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// Compute stable_id
function computeStableId(job) {
  const urlNorm = normalizeUrl(job.url);
  const companyNorm = normalizeCompany(job.company);
  const titleNorm = normalizeTitle(job.title);
  const hash = crypto.createHash('sha256').update(`${urlNorm}|${companyNorm}|${titleNorm}`).digest('hex');
  return hash.substring(0, 16);
}

// Check if job matches target roles
function roleMatches(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const targetKeywords = [
    'end user computing', 'euc', 'it support', 'desktop support', 'technical support',
    'service desk', 'helpdesk', 'help desk', 'tier 2', 'tier ii', 'l2', 'level 2',
    'systems administrator', 'sysadmin', 'system admin', 'cloud support', 'cloud engineer',
    'it administrator', 'endpoint', 'security', 'soc', 'noc', 'infrastructure',
    'active directory', 'microsoft 365', 'm365', 'intune', 'endpoint management',
    'crowdstrike', 'cybersecurity', 'it operations', 'network support'
  ];
  return targetKeywords.some(kw => text.includes(kw));
}

// Check salary meets minimum (30K PHP/month)
function salaryMeetsMinimum(salary) {
  if (!salary) return true; // Unknown salary - don't filter out, flag instead
  const s = salary.toLowerCase();

  // Handle "per year" salaries
  if (s.includes('year') || s.includes('annum')) {
    const match = s.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*k?/);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (s.includes('k')) return val * 1000 / 12 >= 30000; // monthly equivalent
      return val / 12 >= 30000;
    }
  }

  // Handle "per month" salaries
  if (s.includes('month')) {
    const match = s.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*k?/);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (s.includes('k')) return val * 1000 >= 30000;
      return val >= 30000;
    }
  }

  // Handle range like "30,000 - 40,000"
  const numbers = s.match(/(\d+(?:,\d{3})*)/g);
  if (numbers) {
    const vals = numbers.map(n => parseFloat(n.replace(/,/g, '')));
    const maxVal = Math.max(...vals);
    // If looks like monthly (under 200K), check directly
    if (maxVal < 200000) return maxVal >= 30000;
    // If looks like yearly, convert
    if (maxVal >= 200000) return maxVal / 12 >= 30000;
  }

  return true; // Can't determine - don't filter out
}

// Check location is acceptable
function locationAcceptable(location) {
  if (!location) return true;
  const loc = location.toLowerCase();
  // Acceptable: Remote, Metro Manila, NCR, Bulacan, Cavite, Rizal, Laguna (near boundary)
  const acceptable = [
    'remote', 'work from home', 'wfh', 'metro manila', 'ncr', 'manila', 'makati',
    'taguig', 'pasig', 'mandaluyong', 'quezon city', 'ortigas', 'bgc', 'bonifacio',
    'alabang', 'muntilupa', 'san juan', 'pasay', 'las piñas', 'paranaque', 'navotas',
    'malabon', 'valenzuela', 'marikina', 'caloocan', 'bulacan', 'cavite', 'rizal', 'laguna'
  ];
  const unacceptable = ['cebu', 'davao', 'baguio', 'iloilo', 'bacolod', 'cagayan', 'zamboanga', 'general santos', 'tarlac', 'pampanga', 'clark', 'la union', 'dumaguete', 'rosario', 'san juan', 'pasacao', 'iloilo'];

  // Check if explicitly remote
  if (loc.includes('remote') || loc.includes('wfh') || loc.includes('work from home')) return true;

  // Check unacceptable locations
  for (const u of unacceptable) {
    if (loc.includes(u)) return false;
  }

  // Check acceptable locations
  for (const a of acceptable) {
    if (loc.includes(a)) return true;
  }

  return false; // Default reject unknown locations
}

// Check for language gate issues (postings requiring languages not in profile)
function checkLanguageGate(description) {
  if (!description) return { pass: true, flags: [] };
  const text = description.toLowerCase();
  const flags = [];

  // Wilson speaks: English (professional), Filipino/Tagalog (native)
  // Flag if posting requires other languages as condition
  const otherLanguages = ['japanese', 'mandarin', 'chinese', 'korean', 'spanish', 'french', 'german', 'arabic', 'thai', 'vietnamese', 'bahasa', 'indonesian', 'malay'];

  for (const lang of otherLanguages) {
    if (text.includes(lang) && (text.includes('required') || text.includes('must') || text.includes('fluent') || text.includes('native'))) {
      flags.push(`Requires ${lang}`);
    }
  }

  return { pass: flags.length === 0, flags };
}

// Main processing
const results = {
  new: [],
  duplicate: [],
  hardFiltered: [],
  needsVerification: [],
  stats: {
    total: consolidatedJobs.length,
    duplicates: 0,
    hardFiltered: 0,
    newUnique: 0,
    needsVerification: 0
  }
};

for (const job of consolidatedJobs) {
  // Compute stable_id
  const stable_id = computeStableId(job);
  job.stable_id = stable_id;

  // Check against seen_jobs
  const seenEntry = seenJobs[stable_id];
  if (seenEntry) {
    job.processing_state = seenEntry.processing_state || 'NEW';
    job.previous_fingerprint = seenEntry.fingerprint;
    results.duplicate.push(job);
    results.stats.duplicates++;
    continue;
  }

  // Check against tracker (already applied/drafted)
  if (trackerUrls.has(job.url)) {
    job.processing_state = 'DUPLICATE_OR_INVALID';
    results.duplicate.push(job);
    results.stats.duplicates++;
    continue;
  }

  // Hard filters
  const roleMatch = roleMatches(job.title, job.teaser);
  const salaryOk = salaryMeetsMinimum(job.salary);
  const locationOk = locationAcceptable(job.location);
  const languageCheck = checkLanguageGate(job.teaser);

  if (!roleMatch) {
    job.hard_filter_reason = 'Role mismatch';
    results.hardFiltered.push(job);
    results.stats.hardFiltered++;
    continue;
  }

  if (!salaryOk) {
    job.hard_filter_reason = 'Salary below ₱30K/month';
    results.hardFiltered.push(job);
    results.stats.hardFiltered++;
    continue;
  }

  if (!locationOk) {
    job.hard_filter_reason = 'Location outside acceptable area';
    results.hardFiltered.push(job);
    results.stats.hardFiltered++;
    continue;
  }

  if (!languageCheck.pass) {
    job.hard_filter_reason = `Language gate: ${languageCheck.flags.join(', ')}`;
    results.hardFiltered.push(job);
    results.stats.hardFiltered++;
    continue;
  }

  // Passed hard filters - needs verification
  job.processing_state = 'NEEDS_VERIFICATION';
  job.language_flags = languageCheck.flags;

  results.needsVerification.push(job);
  results.stats.newUnique++;
  results.stats.needsVerification++;
}

// Output results
fs.writeFileSync('.scrape_out/canonicalized_jobs.json', JSON.stringify(results, null, 2));
fs.writeFileSync('.scrape_out/hard_filtered_jobs.json', JSON.stringify(results.hardFiltered, null, 2));
fs.writeFileSync('.scrape_out/needs_verification.json', JSON.stringify(results.needsVerification, null, 2));

console.log('=== INCREMENTAL RUN SUMMARY ===');
console.log(`Run ID: ${new Date().toISOString().replace(/[-:T]/g, '').split('.')[0]}`);
console.log(`Discovered: ${results.stats.total} raw jobs`);
console.log(`After dedup: ${results.stats.newUnique} new unique jobs`);
console.log(`Hard filter passed: ${results.stats.needsVerification}`);
console.log(`Hard filtered out: ${results.stats.hardFiltered}`);
console.log(`Duplicates: ${results.stats.duplicates}`);
console.log('');

console.log('Top candidates for verification:');
for (const job of results.needsVerification.slice(0, 10)) {
  console.log(`  - ${job.title} @ ${job.company} (${job.location}) - ${job.salary || 'salary undisclosed'} [${job.source_file}]`);
}