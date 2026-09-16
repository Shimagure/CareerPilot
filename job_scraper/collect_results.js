// Collect and normalize all portal search results
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

function processJobStreet(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'jobstreet',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.workType),
        workMode: job.workType,
        source: 'jobstreet-cli'
      });
    }
  }
  return results;
}

function processIndeed(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'indeed',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        dateLabel: job.dateLabel,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.workType),
        workMode: job.workType,
        source: 'indeed-cli'
      });
    }
  }
  return results;
}

function processLinkedIn(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'linkedin',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: null,
        date: job.date,
        url: job.url,
        description: null,
        arrangement: extractArrangement(job.location, null),
        workMode: null,
        source: 'linkedin-cli'
      });
    }
  }
  return results;
}

function processKalibrr(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'kalibrr',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        deadline: job.deadline,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.workType),
        workMode: job.workType,
        source: 'kalibrr-cli'
      });
    }
  }
  return results;
}

function processBossJob(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'bossjob',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        dateLabel: job.dateLabel,
        url: job.url,
        description: null,
        arrangement: extractArrangement(job.location, null),
        workMode: null,
        source: 'bossjob-cli'
      });
    }
  }
  return results;
}

function processFreehire(data) {
  const results = [];
  if (data && data.results) {
    for (const job of data.results) {
      results.push({
        portal: 'freehire',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: null,
        date: job.date,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.work_mode),
        workMode: job.work_mode,
        source: 'freehire-cli'
      });
    }
  }
  return results;
}

function processTempFile(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const job = JSON.parse(content);
    const filename = path.basename(filepath, '.json').replace('.tmp_', '');

    if (job.companyUrl) {
      // LinkedIn format
      return {
        portal: 'linkedin',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: null,
        date: job.date,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.employmentType),
        workMode: job.employmentType,
        source: 'linkedin-detail'
      };
    } else if (job.classifications) {
      // Indeed format
      return {
        portal: 'indeed',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.workType),
        workMode: job.workType,
        source: 'indeed-detail'
      };
    } else if (job.qualifications) {
      // Kalibrr format
      return {
        portal: 'kalibrr',
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        date: job.date,
        deadline: job.deadline,
        url: job.url,
        description: job.description,
        arrangement: extractArrangement(job.location, job.tenure),
        workMode: job.tenure,
        source: 'kalibrr-detail'
      };
    }
  } catch (e) {
    console.error(`Error processing ${filepath}:`, e.message);
  }
  return null;
}

// Main collection
async function collectAll() {
  const allJobs = [];

  // 1. Read temp files (detail pages from parallel agents)
  const tempFiles = fs.readdirSync('job_scraper').filter(f => f.startsWith('.tmp_') && f.endsWith('.json'));
  console.log(`Found ${tempFiles.length} temp detail files`);

  for (const file of tempFiles) {
    const job = processTempFile(path.join('job_scraper', file));
    if (job) {
      allJobs.push(job);
    }
  }

  // 2. Search result files from CLI outputs (need to capture them)
  // These were output to stdout earlier, we need to re-run or capture
  // For now, we'll note the counts from earlier runs

  console.log(`Total jobs collected: ${allJobs.length}`);

  // Compute stable_ids and deduplicate
  const seen = new Map();
  const unique = [];

  for (const job of allJobs) {
    const stableId = computeStableId(job.url, job.company, job.title);
    job.stable_id = stableId;

    if (!seen.has(stableId)) {
      seen.set(stableId, job);
      unique.push(job);
    } else {
      console.log(`Duplicate: ${job.title} at ${job.company} (${job.portal})`);
    }
  }

  console.log(`Unique jobs after deduplication: ${unique.length}`);

  // Save normalized results
  fs.writeFileSync('job_scraper/normalized_results.json', JSON.stringify({
    collected_at: new Date().toISOString(),
    total_raw: allJobs.length,
    total_unique: unique.length,
    jobs: unique
  }, null, 2));

  return unique;
}

collectAll().then(jobs => {
  console.log('Collection complete');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});