// Hard filter jobs against candidate criteria
const fs = require('fs');
const path = require('path');

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeCompany(company) {
  return company.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.hostname + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().replace(/[^\w\s:\/\-\.]/g, '').replace(/\s+/g, ' ').trim();
  }
}

function computeStableId(url, company, title) {
  const crypto = require('crypto');
  const input = normalizeUrl(url) + '|' + normalizeCompany(company) + '|' + normalizeTitle(title);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function extractLocation(loc) {
  if (!loc) return 'Unknown';
  const locLower = loc.toLowerCase();
  if (locLower.includes('remote') || locLower.includes('work from home') || locLower.includes('wfh')) {
    return 'Remote';
  }
  if (locLower.includes('manila') || locLower.includes('makati') || locLower.includes('taguig') ||
      locLower.includes('pasig') || locLower.includes('mandaluyong') || locLower.includes('quezon city') ||
      locLower.includes('ortigas') || locLower.includes('ncr') || locLower.includes('metro manila')) {
    return 'NCR/Metro Manila';
  }
  if (locLower.includes('cebu') || locLower.includes('mactan') || locLower.includes('lapu-lapu') || locLower.includes('mandaue')) {
    return 'Cebu';
  }
  if (locLower.includes('bulacan') || locLower.includes('cavite') || locLower.includes('rizal') || locLower.includes('laguna')) {
    return 'Near NCR';
  }
  return loc;
}

function extractArrangement(loc, workMode) {
  if (!loc && !workMode) return 'unspecified';
  const text = ((loc || '') + ' ' + (workMode || '')).toLowerCase();
  if (text.includes('remote') || text.includes('work from home') || text.includes('wfh') || text.includes('100% remote')) {
    return 'remote';
  }
  if (text.includes('hybrid')) {
    return 'hybrid';
  }
  if (text.includes('on-site') || text.includes('onsite') || text.includes('office')) {
    return 'onsite';
  }
  return 'unspecified';
}

function extractSalary(text) {
  if (!text) return null;
  const match = text.match(/[₱$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[-\s~]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
  if (match) {
    const min = parseFloat(match[1].replace(/,/g, ''));
    const max = parseFloat(match[2].replace(/,/g, ''));
    return { min, max, currency: text.includes('$') ? 'USD' : 'PHP', raw: text };
  }
  const single = text.match(/[₱$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]/);
  if (single) {
    const val = parseFloat(single[1].replace(/,/g, ''));
    return { min: val, max: val, currency: text.includes('$') ? 'USD' : 'PHP', raw: text };
  }
  return { raw: text };
}

// Target role families from MASTER_JOB_SEARCH_BASELINE.md Section 1
const TARGET_ROLE_KEYWORDS = [
  'end user computing', 'euc', 'it support', 'desktop support', 'technical support',
  'service desk', 'tier 2', 'tier ii', 'l2', 'l1.5', 'helpdesk', 'help desk',
  'systems administration', 'system administration', 'systems administrator', 'system administrator', 'sysadmin',
  'cloud support', 'cloud engineer', 'infrastructure',
  'endpoint', 'endpoint security', 'endpoint management', 'intune', 'm365', 'microsoft 365',
  'active directory', 'ad admin', 'identity', 'access management', 'iam',
  'crowdstrike', 'edr', 'antivirus', 'security analyst', 'soc', 'noc',
  'it operations', 'it administrator', 'it specialist', 'it technician',
  'network support', 'network administrator', 'network engineer',
  'windows server', 'windows admin', 'linux admin', 'linux administrator',
  'powershell', 'scripting', 'automation',
  'asset management', 'cmdb', 'itil', 'incident management', 'change management'
];

// Excluded roles (non-technical, sales, etc.)
const EXCLUDED_KEYWORDS = [
  'sales', 'marketing', 'accountant', 'hr', 'human resources', 'recruitment',
  'customer service', 'call center', 'receptionist', 'front desk',
  'admin assistant', 'administrative assistant', 'secretary',
  'content', 'writer', 'blog', 'social media', 'creative',
  'finance', 'accounting', 'bookkeeping', 'audit',
  'legal', 'compliance', 'paralegal',
  'teacher', 'trainer', 'instructor', 'tutor',
  'nurse', 'medical', 'healthcare', 'clinical',
  'chef', 'cook', 'kitchen', 'restaurant',
  'driver', 'logistics', 'warehouse', 'delivery',
  'construction', 'engineer civil', 'mechanical engineer',
  'dish washer', 'cleaner', 'janitor', 'housekeeping'
];

function matchesTargetRole(title) {
  const lower = title.toLowerCase();
  for (const keyword of TARGET_ROLE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isExcluded(title) {
  const lower = title.toLowerCase();
  for (const keyword of EXCLUDED_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function passesLocationFilter(location) {
  if (!location) return true; // Unknown, don't filter out
  const loc = location.toLowerCase();
  // Accept: Remote, NCR/Metro Manila, Near NCR (Bulacan, Cavite, Rizal, Laguna), Cebu
  // Reject: Overseas, outside Philippines without remote
  if (loc.includes('overseas') || loc.includes('abroad') || loc.includes('international')) {
    return false;
  }
  // Check for non-PH locations that aren't remote
  const nonPH = ['singapore', 'malaysia', 'indonesia', 'thailand', 'vietnam', 'japan', 'korea',
                 'hong kong', 'taiwan', 'australia', 'new zealand', 'canada', 'united states',
                 'usa', 'uk', 'london', 'dubai', 'uae', 'qatar', 'saudi', 'kuwait', 'bahrain',
                 'oman', 'china', 'india', 'pakistan', 'bangladesh'];
  for (const country of nonPH) {
    if (loc.includes(country) && !loc.includes('remote') && !loc.includes('philippines')) {
      return false;
    }
  }
  return true;
}

function passesSalaryFilter(salary) {
  if (!salary) return true; // Unknown salary, don't filter out
  const parsed = extractSalary(salary.raw || '');
  if (!parsed || !parsed.min) return true;

  // Target: PHP 30,000-45,000 gross/month
  // Flexible for growth roles
  if (parsed.currency === 'PHP') {
    // Accept if max >= 25000 (some flexibility) or min <= 50000
    return parsed.max >= 25000 || parsed.min <= 50000;
  }
  if (parsed.currency === 'USD') {
    // $500/month ≈ PHP 28,000, $800/month ≈ PHP 45,000
    return parsed.max >= 500 || parsed.min <= 1000;
  }
  return true;
}

function passesArrangementFilter(arrangement) {
  if (!arrangement || arrangement === 'unspecified') return true;
  // Accept: remote, hybrid, onsite (if NCR)
  return ['remote', 'hybrid', 'onsite'].includes(arrangement.toLowerCase());
}

function hardFilterJob(job) {
  const reasons = [];

  // 1. Role filter
  if (!matchesTargetRole(job.title)) {
    reasons.push('Role does not match target families');
  }

  // 2. Exclusion filter
  if (isExcluded(job.title)) {
    reasons.push('Role matches excluded keywords');
  }

  // 3. Location filter
  if (!passesLocationFilter(job.location)) {
    reasons.push('Location outside acceptable range');
  }

  // 4. Salary filter
  if (!passesSalaryFilter(job.salary)) {
    reasons.push('Salary outside target range');
  }

  // 5. Arrangement filter
  if (!passesArrangementFilter(job.arrangement)) {
    reasons.push('Work arrangement not acceptable');
  }

  return {
    passes: reasons.length === 0,
    reasons
  };
}

async function runHardFilter() {
  // Load normalized results
  const normalized = JSON.parse(fs.readFileSync('job_scraper/normalized_results.json', 'utf8'));
  const jobs = normalized.jobs;

  console.log(`Hard filtering ${jobs.length} unique jobs...`);

  // Also load search results from portal CLIs (we need to re-run or collect them)
  // For now, process what we have in normalized_results.json
  const passed = [];
  const failed = [];

  for (const job of jobs) {
    const result = hardFilterJob(job);
    job.hard_filter = result;
    if (result.passes) {
      passed.push(job);
    } else {
      failed.push({ job, reasons: result.reasons });
    }
  }

  console.log(`Passed: ${passed.length}, Failed: ${failed.length}`);

  // Print failed jobs with reasons
  console.log('\n--- FAILED JOBS ---');
  for (const { job, reasons } of failed) {
    console.log(`  ${job.title} @ ${job.company} (${job.portal})`);
    console.log(`    Reasons: ${reasons.join(', ')}`);
    console.log(`    Location: ${job.location}, Arrangement: ${job.arrangement}, Salary: ${job.salary?.raw || 'N/A'}`);
  }

  console.log('\n--- PASSED JOBS ---');
  for (const job of passed) {
    console.log(`  ${job.title} @ ${job.company} (${job.portal})`);
    console.log(`    Location: ${job.location}, Arrangement: ${job.arrangement}, Salary: ${job.salary?.raw || 'N/A'}`);
  }

  // Save results
  fs.writeFileSync('job_scraper/hard_filtered_results.json', JSON.stringify({
    filtered_at: new Date().toISOString(),
    total_input: jobs.length,
    total_passed: passed.length,
    total_failed: failed.length,
    passed: passed,
    failed: failed.map(f => ({ job: f.job, reasons: f.reasons }))
  }, null, 2));

  return { passed, failed };
}

runHardFilter().then(() => {
  console.log('Hard filter complete');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});