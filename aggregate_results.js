const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ============================================================
// NORMALIZATION FUNCTIONS
// ============================================================

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        let clean = parsed.protocol + '//' + parsed.hostname + parsed.pathname;
        if (clean.endsWith('/')) clean = clean.slice(0, -1);
        return clean;
    } catch (e) {
        return url;
    }
}

function normalizeCompany(company) {
    if (!company) return '';
    return company.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLocation(location) {
    if (!location) return '';
    return location.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArrangement(arrangement) {
    if (!arrangement) return '';
    return arrangement.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSalary(salary) {
    if (!salary) return '';
    return String(salary).toLowerCase().replace(/[^\w\s\-\$₱]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractKeyRequirements(description, maxChars = 2000) {
    if (!description) return '';
    let desc = description.substring(0, maxChars);
    desc = desc.replace(/\s+/g, ' ').trim();
    return desc;
}

function computeStableId(url, company, title) {
    const normUrl = normalizeUrl(url);
    const normCompany = normalizeCompany(company);
    const normTitle = normalizeTitle(title);
    const combined = normUrl + '|' + normCompany + '|' + normTitle;
    return crypto.createHash('sha256').update(combined).digest('hex');
}

function computeFingerprint(job) {
    const data = {
        title: normalizeTitle(job.title || ''),
        company: normalizeCompany(job.company || ''),
        location: normalizeLocation(job.location || ''),
        arrangement: normalizeArrangement(job.work_mode || job.arrangement || ''),
        salary: normalizeSalary(job.salary || ''),
        description: extractKeyRequirements(job.description || '')
    };
    const combined = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(combined).digest('hex');
}

// ============================================================
// LOAD SEEN_JOBS AND TRACKER
// ============================================================

const seenJobsPath = path.join(__dirname, 'job_scraper', 'seen_jobs.json');
const trackerPath = path.join(__dirname, 'job_search_tracker.csv');

let seenJobs = {};
try {
    const seenContent = fs.readFileSync(seenJobsPath, 'utf8');
    const parsed = JSON.parse(seenContent);
    seenJobs = parsed.seen || {};
    console.log(`Loaded ${Object.keys(seenJobs).length} existing seen_jobs records`);
} catch (e) {
    console.log('No existing seen_jobs.json, starting fresh');
}

let trackerEntries = new Set();
try {
    const trackerContent = fs.readFileSync(trackerPath, 'utf8');
    const lines = trackerContent.trim().split('\n').slice(1); // skip header
    for (const line of lines) {
        const cols = line.split(',');
        if (cols.length >= 4) {
            const company = cols[1].trim().toLowerCase();
            const role = cols[3].trim().toLowerCase();
            trackerEntries.add(`${company}|${role}`);
        }
    }
    console.log(`Loaded ${trackerEntries.size} tracker entries`);
} catch (e) {
    console.log('No tracker file found');
}

// ============================================================
// RAW RESULTS FROM ALL PORTAL SEARCHES
// ============================================================

const rawResults = [];

// --- LINKEDIN SEARCHES ---
const linkedinQueries = [
    { query: 'End User Computing', location: 'Philippines' },
    { query: 'IT Support', location: 'Metro Manila' },
    { query: 'Desktop Support', location: 'Philippines' },
    { query: 'Service Desk', location: 'Philippines' },
    { query: 'Microsoft 365', location: 'Philippines' },
    { query: 'Systems Administrator', location: 'Philippines' },
    { query: 'Cloud Support Engineer', location: 'Philippines' },
    { query: 'IT Helpdesk', location: 'Philippines' },
    { query: 'IT Support remote', location: 'Philippines' }
];

// We'll add the actual results from the CLI runs below

// --- INDEED SEARCHES ---
const indeedQueries = [
    { query: 'IT Support Specialist', location: 'Philippines' },
    { query: 'Technical Support', location: 'Philippines' },
    { query: 'Active Directory', location: 'Philippines' },
    { query: 'Windows Server', location: 'Philippines' },
    { query: 'Cloud Support', location: 'Philippines' },
    { query: 'IT Administrator', location: 'Philippines' },
    { query: 'Endpoint Security', location: 'Philippines' },
    { query: 'Systems Administrator', location: 'Philippines' }
];

// --- KALIBRR SEARCHES ---
const kalibrrQueries = [
    { query: 'IT Support', location: 'Philippines' },
    { query: 'Service Desk', location: 'Philippines' },
    { query: 'Systems Administrator', location: 'Philippines' }
];

// --- BOSSJOB SEARCHES ---
const bossjobQueries = [
    { query: 'IT Support', location: 'Philippines' },
    { query: 'IT Support remote', location: 'Philippines' }
];

// --- FREEHIRE SEARCHES ---
const freehireQueries = [
    { query: 'IT Support', location: 'Philippines' },
    { query: 'IT Support', location: 'Manila' },
    { query: 'Systems Administrator', location: 'Philippines' }
];

// ============================================================
// FUNCTION TO ADD RESULTS FROM A CLI OUTPUT FILE
// ============================================================

function addResultsFromFile(filePath, portal, queryInfo) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        if (data.results && Array.isArray(data.results)) {
            for (const job of data.results) {
                rawResults.push({
                    ...job,
                    source_portal: portal,
                    source_query: queryInfo.query,
                    source_location: queryInfo.location
                });
            }
            console.log(`Added ${data.results.length} results from ${portal} - "${queryInfo.query}"`);
        }
    } catch (e) {
        console.log(`Could not read ${filePath}: ${e.message}`);
    }
}

// ============================================================
// PROCESS ALL RESULT FILES
// ============================================================

const resultsDir = path.join(__dirname, '93aa2f6c-8404-4df4-a791-14c6c7dbffdc', 'tool-results');

// Read all the output files and extract results
// The actual files have been saved with specific names, let's process them

// For now, let's manually add the results from the searches we did
// We'll read from the tool-results directory

const resultFiles = [
    // LinkedIn results
    { file: 'bza4g5owi.txt', portal: 'linkedin-search', query: 'End User Computing', location: 'Philippines' },
    // We'll add more as we find them
];

console.log('Result aggregation script ready. Now add actual results.');