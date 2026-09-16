// Hard Filter - apply candidate hard filters to canonical jobs
const fs = require('fs');

// Load canonical jobs from this run
const runCanonical = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/canonical_20260826.json', 'utf8'));
const canonicalJobs = runCanonical.canonical_jobs;

console.log('Loaded canonical jobs:', canonicalJobs.length);

// Hard filter criteria from CLAUDE.md and MASTER_JOB_SEARCH_BASELINE.md
// Target roles: EUC, IT Support, Desktop Support, Technical Support, Service Desk, Tier 2/L2, Systems Administration, Cloud/Infrastructure, Endpoint/IT Security
// Work arrangement: remote → hybrid NCR → onsite NCR (if justified)
// Salary: ₱30,000–45,000 gross/month (flexible for technical growth)
// Location: Philippines, NCR/Metro Manila focus
// Language: English (professional) + Filipino/Tagalog (native) - hard gate on undeclared languages

const TARGET_ROLE_KEYWORDS = [
  'end user computing', 'euc', 'it support', 'desktop support', 'technical support',
  'service desk', 'tier 2', 'tier ii', 'l2', 'level 2', 'systems administrator',
  'system administrator', 'sysadmin', 'cloud support', 'cloud engineer',
  'infrastructure', 'endpoint', 'it security', 'cybersecurity', 'soc',
  'security operations', 'network', 'active directory', 'microsoft 365', 'm365',
  'intune', 'endpoint management', 'device management', 'identity', 'iam',
  'helpdesk', 'help desk', 'it specialist', 'it administrator', 'it engineer',
  'field support', 'field technician', 'desktop engineer', 'pc support',
  'workstation', 'laptop', 'device', 'endpoint security', 'crowdstrike'
];

const EXCLUDE_ROLE_KEYWORDS = [
  'sales', 'accountant', 'accounting', 'finance', 'hr', 'human resources',
  'recruitment', 'marketing', 'customer service', 'call center', 'bpo agent',
  'receptionist', 'admin', 'administrative', 'secretary', 'clerk',
  'data entry', 'encoder', 'teacher', 'instructor', 'trainer',
  'nurse', 'medical', 'healthcare', 'chef', 'cook', 'driver',
  'warehouse', 'logistics', 'supply chain', 'procurement',
  'real estate', 'property', 'insurance', 'bank teller',
  'dishwasher', 'waiter', 'waitress', 'server', 'bartender',
  'housekeeping', 'janitor', 'cleaner', 'security guard',
  'construction', 'electrician', 'plumber', 'mechanic',
  'manager', 'director', 'head of', 'vp ', 'vice president',
  'chief ', 'c-level', 'executive', 'principal architect',
  'lead ', 'senior manager', 'architect' // too senior
];

const PREFERRED_LOCATIONS = [
  'remote', 'work from home', 'wfh', 'philippines', 'metro manila',
  'manila', 'makati', 'taguig', 'pasig', 'mandaluyong', 'quezon city',
  'pasay', 'paranaque', 'las pinas', 'muntinlupa', 'marikina',
  'san juan', 'navotas', 'malabon', 'valenzuela', 'pateros',
  'bulacan', 'cavite', 'rizal', 'laguna'
];

const EXCLUDE_LOCATIONS = [
  'cebu', 'davao', 'zamboanga', 'bicol', 'ilocos', 'pampanga',
  'tarlac', 'pangasinan', 'nueva ecija', 'bataan', 'zambales',
  'aurora', 'quezon province', 'batangas', 'cavite province',
  'laguna province', 'rizal province', 'bulacan province',
  'overseas', 'abroad', 'international', 'singapore', 'malaysia',
  'indonesia', 'thailand', 'vietnam', 'japan', 'korea', 'china',
  'hong kong', 'taiwan', 'australia', 'new zealand', 'canada',
  'usa', 'united states', 'uk', 'united kingdom', 'europe',
  'middle east', 'dubai', 'qatar', 'saudi'
];

function parseSalary(salaryStr) {
  if (!salaryStr) return null;
  const str = salaryStr.toLowerCase();
  // Handle formats like "₱30-45K", "₱30,000-45,000", "30k-45k", "negotiable"
  if (str.includes('negotiable') || str.includes('competitive')) return null;

  const matches = str.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*[-\–]\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
  if (matches) {
    const min = parseFloat(matches[1].replace(/,/g, ''));
    const max = parseFloat(matches[2].replace(/,/g, ''));
    const unit = str.includes('k') || str.includes('K') ? 1000 : 1;
    return { min: min * unit, max: max * unit };
  }

  // Single value
  const singleMatch = str.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/);
  if (singleMatch) {
    const val = parseFloat(singleMatch[1].replace(/,/g, ''));
    const unit = str.includes('k') || str.includes('K') ? 1000 : 1;
    return { min: val * unit, max: val * unit };
  }

  return null;
}

function checkRoleMatch(title) {
  const t = title.toLowerCase();
  // Check exclude first
  for (const kw of EXCLUDE_ROLE_KEYWORDS) {
    if (t.includes(kw)) return { match: false, reason: `Excluded role keyword: ${kw}` };
  }
  // Check target
  for (const kw of TARGET_ROLE_KEYWORDS) {
    if (t.includes(kw)) return { match: true, matchedKeyword: kw };
  }
  return { match: false, reason: 'No target role keyword match' };
}

function checkLocationMatch(location) {
  const loc = location.toLowerCase();
  // Check exclude first
  for (const kw of EXCLUDE_LOCATIONS) {
    if (loc.includes(kw)) return { match: false, reason: `Excluded location: ${kw}` };
  }
  // Check preferred
  for (const kw of PREFERRED_LOCATIONS) {
    if (loc.includes(kw)) return { match: true, matchedKeyword: kw };
  }
  return { match: false, reason: 'Location not in preferred list' };
}

function checkSalaryMatch(salaryStr) {
  const parsed = parseSalary(salaryStr);
  if (!parsed) return { match: true, reason: 'Salary negotiable/unknown - pass' };
  // Target: 30k-45k, flexible for growth
  // Pass if max >= 25k (some flexibility) and min <= 60k (not too high for junior)
  if (parsed.max >= 25000 && parsed.min <= 60000) {
    return { match: true, parsed, reason: `Salary range ${parsed.min}-${parsed.max} within flexible range` };
  }
  return { match: false, parsed, reason: `Salary range ${parsed.min}-${parsed.max} outside flexible range` };
}

function checkLanguageGate(description) {
  // Language gate: exclude postings requiring languages not in Wilson's table
  // Wilson: English (professional), Filipino/Tagalog (native)
  // If posting requires Japanese, Mandarin, Korean, Spanish, French, German, etc. -> exclude
  const desc = (description || '').toLowerCase();
  const excludedLanguages = [
    'japanese', 'nihongo', 'mandarin', 'chinese', 'korean', 'spanish',
    'french', 'german', 'italian', 'portuguese', 'arabic', 'thai',
    'vietnamese', 'bahasa', 'indonesian', 'malay', 'hindi', 'tamil'
  ];
  for (const lang of excludedLanguages) {
    // Check for "requires X", "must speak X", "fluent in X", "X speaker", "X language"
    const patterns = [
      `require.*${lang}`, `must.*${lang}`, `fluent.*${lang}`, `${lang}.*speaker`,
      `${lang}.*language`, `${lang}.*proficiency`, `${lang}.*required`
    ];
    for (const pattern of patterns) {
      const regex = new RegExp(pattern);
      if (regex.test(desc)) {
        return { match: false, reason: `Requires excluded language: ${lang}` };
      }
    }
  }
  return { match: true, reason: 'No excluded language requirements' };
}

function applyHardFilter(job) {
  const results = {
    role: checkRoleMatch(job.title),
    location: checkLocationMatch(job.location),
    salary: checkSalaryMatch(job.salary),
    language: checkLanguageGate(job.description || job.teaser || '')
  };

  const passed = results.role.match && results.location.match && results.salary.match && results.language.match;

  return {
    passed,
    results,
    job
  };
}

// Apply hard filter
const filteredJobs = [];
const rejectedJobs = [];
const filterStats = {
  total: canonicalJobs.length,
  passed: 0,
  rejected: 0,
  byReason: {}
};

for (const job of canonicalJobs) {
  const filterResult = applyHardFilter(job);
  if (filterResult.passed) {
    filteredJobs.push({ ...job, filter_results: filterResult.results });
    filterStats.passed++;
  } else {
    rejectedJobs.push({ ...job, filter_results: filterResult.results });
    filterStats.rejected++;
    // Track rejection reasons
    for (const [key, result] of Object.entries(filterResult.results)) {
      if (!result.match) {
        const reason = `${key}: ${result.reason}`;
        filterStats.byReason[reason] = (filterStats.byReason[reason] || 0) + 1;
      }
    }
  }
}

console.log('\n=== Hard Filter Results ===');
console.log('Total:', filterStats.total);
console.log('Passed:', filterStats.passed);
console.log('Rejected:', filterStats.rejected);
console.log('Rejection reasons:', JSON.stringify(filterStats.byReason, null, 2));

// Save filtered jobs
const filteredOutput = {
  run_id: "20260826000000",
  timestamp: new Date().toISOString(),
  mode: "INCREMENTAL",
  total_input: canonicalJobs.length,
  filtered_jobs: filteredJobs,
  rejected_jobs: rejectedJobs,
  stats: filterStats
};

fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/filtered_20260826.json', JSON.stringify(filteredOutput, null, 2));
console.log('\nSaved filtered_20260826.json');

// Update main filtered_jobs.json (merge)
let existingFiltered = [];
try {
  existingFiltered = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/filtered_jobs.json', 'utf8'));
} catch (e) {
  existingFiltered = [];
}

// Merge by stable_id
const mergedFiltered = [...existingFiltered];
const mergedStableIds = new Set(mergedFiltered.map(j => j.stable_id).filter(Boolean));

for (const job of filteredJobs) {
  if (!mergedStableIds.has(job.stable_id)) {
    mergedFiltered.push(job);
    mergedStableIds.add(job.stable_id);
  }
}

fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/filtered_jobs.json', JSON.stringify(mergedFiltered, null, 2));
console.log(`Updated filtered_jobs.json: ${mergedFiltered.length} total filtered jobs`);

// Update checkpoint
const checkpoints = JSON.parse(fs.readFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', 'utf8'));
checkpoints.current_checkpoint.stage = 'hard_filter';
checkpoints.current_checkpoint.stage_status = 'complete';
checkpoints.current_checkpoint.jobs_processed_in_stage = filteredJobs.length;
checkpoints.current_checkpoint.total_jobs_in_stage = canonicalJobs.length;
checkpoints.current_checkpoint.last_updated = new Date().toISOString();
checkpoints.current_checkpoint.passed = filteredJobs.length;
checkpoints.current_checkpoint.deprioritized = rejectedJobs.length;

checkpoints.run_history.push({
  run_id: "20260826000000",
  started_at: "2026-08-26T00:00:00.000Z",
  stage: "hard_filter",
  stage_status: "complete",
  jobs_processed_in_stage: filteredJobs.length,
  total_jobs_in_stage: canonicalJobs.length,
  last_updated: new Date().toISOString()
});

fs.writeFileSync('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));
console.log('Updated checkpoints.json');

console.log('\nHard filter complete!');