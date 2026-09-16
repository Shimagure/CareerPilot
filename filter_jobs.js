#!/usr/bin/env node
/**
 * Hard filter for consolidated jobs per MASTER_JOB_SEARCH_BASELINE.md Section 1
 */

const fs = require('fs');
const path = require('path');

const jobsPath = path.join(__dirname, '.scrape_out', 'consolidated_jobs.json');
const outputPath = path.join(__dirname, '.scrape_out', 'hard_filtered_jobs.json');

const fileContent = fs.readFileSync(jobsPath, 'utf-8');
const cleanContent = fileContent.replace(/^﻿/, '');
const jobs = JSON.parse(cleanContent);
console.log(`Total jobs loaded: ${jobs.length}`);

// ============================================================
// HARD FILTERS from MASTER_JOB_SEARCH_BASELINE.md Section 1
// ============================================================

// Target role keywords (must match at least one)
const TARGET_ROLE_KEYWORDS = [
    'end user computing', 'euc', 'end user support', 'it support', 'desktop support',
    'technical support', 'service desk', 'helpdesk', 'help desk',
    'tier 2', 'tier2', 'l2 support', 'l2 ', 'level 2',
    'systems administrator', 'systems admin', 'sysadmin',
    'cloud support', 'cloud engineer', 'infrastructure',
    'endpoint security', 'endpoint engineer', 'endpoint management',
    'it security', 'security operations', 'soc analyst',
    'iam', 'identity', 'access management',
    'it operations', 'noc engineer',
    'it specialist', 'it administrator',
    'network support', 'network engineer',
    'solutions engineer', 'presales engineer',
    'application support', 'asset lifecycle'
];

// Excluded role patterns (non-IT, sales, accounting, etc.)
const EXCLUDED_ROLE_KEYWORDS = [
    'accountant', 'cashier', 'sales', 'marketing', 'receptionist',
    'customer service representative', 'csr ', 'customer support representative',
    'call center', 'branch supervisor', 'branch manager',
    'operations manager', 'sales representative', 'sales associate',
    'it sales', 'business development', 'club manager',
    'community manager', 'front desk', 'medical coder',
    'ecommerce', 'hr', 'human resources', 'hrss',
    'receptionist', 'office', 'admin assistant', 'executive assistant'
];

// NCR/Metro Manila locations
const NCR_LOCATIONS = [
    'metro manila', 'ncr', 'makati', 'taguig', 'bgc', 'bonifacio',
    'ortigas', 'pasig', 'mandaluyong', 'quezon city', 'qc ',
    'manila city', 'malate', 'san juan', 'greenhills',
    'alabang', 'muntinlupa', 'las pinas', 'paranaque',
    'valenzuela', 'navotas', 'caloocan', 'marikina', 'pasay',
    'pateros', 'taguig city', 'makati city', 'mandaluyong city',
    'quezon city', 'manila', 'fort bonifacio', 'eastwood',
    'libis', 'bagumbayan', 'cainta', 'taytay', 'san mateo',
    'bulacan', 'muzon', 'san jose del monte', 'sjm', 'cavite',
    'bacoor', 'dasmarinas', 'imuz', 'laguna', 'sta rosa', 'binan',
    'calamba', 'cabuyao', 'pampanga', 'clark', 'angeles',
    'rizal', 'antipolo', 'cainta', 'rodriguez'
];

// Remote indicators
const REMOTE_KEYWORDS = ['remote', 'work from home', 'wfh', 'work-from-home', 'fully remote'];

// Hybrid indicators
const HYBRID_KEYWORDS = ['hybrid', 'hybrid work', 'hybrid setup'];

function parseSalary(salaryStr) {
    if (!salaryStr) return { min: 0, max: 0, isAnnual: false };

    const clean = salaryStr.toLowerCase()
        .replace(/â‚±/g, '')
        .replace(/₱/g, '')
        .replace(/php/g, '')
        .replace(/,/g, '');
    const isAnnual = /year|annual/.test(clean);

    const numbers = clean.match(/[\d.]+/g) || [];
    if (numbers.length === 0) return { min: 0, max: 0, isAnnual };
    if (numbers.length === 1) return { min: parseFloat(numbers[0]), max: parseFloat(numbers[0]), isAnnual };
    const nums = numbers.map(n => parseFloat(n));
    return { min: Math.min(...nums), max: Math.max(...nums), isAnnual };
}

function convertToMonthly(min, max, isAnnual) {
    if (isAnnual) return { min: min / 12, max: max / 12 };
    return { min, max };
}

function checkRoleMatch(title) {
    const titleLower = title.toLowerCase();

    // Check excluded first
    for (const excl of EXCLUDED_ROLE_KEYWORDS) {
        if (titleLower.includes(excl)) {
            return { match: false, reason: `Excluded role: ${excl}` };
        }
    }

    // Check target
    for (const target of TARGET_ROLE_KEYWORDS) {
        if (titleLower.includes(target)) {
            return { match: true, reason: `Target role: ${target}` };
        }
    }

    return { match: false, reason: 'No target role match' };
}

function checkLocationArrangement(title, location) {
    const locLower = location.toLowerCase();
    const titleLower = title.toLowerCase();
    const combined = `${titleLower} ${locLower}`;

    // Check remote
    for (const rk of REMOTE_KEYWORDS) {
        if (combined.includes(rk)) {
            return { arrangement: 'remote', detail: 'Remote' };
        }
    }

    // Check hybrid
    for (const hk of HYBRID_KEYWORDS) {
        if (combined.includes(hk)) {
            return { arrangement: 'hybrid', detail: 'Hybrid' };
        }
    }

    // Check NCR locations
    for (const ncr of NCR_LOCATIONS) {
        if (locLower.includes(ncr)) {
            return { arrangement: 'onsite_ncr', detail: `Onsite NCR (${ncr})` };
        }
    }

    // Check if location mentions Philippines but not NCR
    if (locLower.includes('philippines') || locLower.includes('metro manila')) {
        return { arrangement: 'onsite_ncr', detail: 'Onsite NCR (general)' };
    }

    return { arrangement: 'other', detail: 'Other/Unknown' };
}

const results = [];

for (const job of jobs) {
    const title = job.title || '';
    const company = job.company || '';
    const location = job.location || '';
    const salary = job.salary || '';
    const url = job.url || '';
    const jobId = job.id || '';
    const source = job.source_file || '';

    // 1. Role filter
    const roleCheck = checkRoleMatch(title);
    if (!roleCheck.match) {
        results.push({
            ...job,
            filter_status: 'DEPRIORITIZE',
            filter_reason: roleCheck.reason,
            role_match: false
        });
        continue;
    }

    // 2. Location/Arrangement
    const locCheck = checkLocationArrangement(title, location);
    const arrangement = locCheck.arrangement;
    const locDetail = locCheck.detail;

    // 3. Salary
    const salaryParsed = parseSalary(salary);
    const monthly = convertToMonthly(salaryParsed.min, salaryParsed.max, salaryParsed.isAnnual);
    const minMonthly = monthly.min;
    const maxMonthly = monthly.max;

    let salaryStatus = 'unknown';
    if (minMonthly > 0) {
        if (maxMonthly >= 30000) salaryStatus = 'acceptable';
        else if (maxMonthly >= 25000) salaryStatus = 'borderline';
        else salaryStatus = 'below_target';
    } else {
        salaryStatus = 'undisclosed';
    }

    // Determine initial filter status
    let filterStatus, filterReason;
    if (arrangement === 'other') {
        filterStatus = 'DEPRIORITIZE';
        filterReason = `Location outside target area: ${locDetail}`;
    } else if (salaryStatus === 'below_target') {
        filterStatus = 'DEPRIORITIZE';
        filterReason = `Salary below target: ${salary}`;
    } else if (salaryStatus === 'undisclosed') {
        filterStatus = 'NEEDS_CLARIFICATION';
        filterReason = 'Salary undisclosed';
    } else {
        filterStatus = 'PASSED_HARD_FILTER';
        filterReason = `Role match: ${roleCheck.reason}, Arrangement: ${arrangement}, Salary: ${salaryStatus}`;
    }

    results.push({
        ...job,
        filter_status: filterStatus,
        filter_reason: filterReason,
        role_match: true,
        arrangement: arrangement,
        location_detail: locDetail,
        salary_monthly_min: Math.round(minMonthly),
        salary_monthly_max: Math.round(maxMonthly),
        salary_status: salaryStatus,
        salary_original: salary
    });
}

// Count by status
const statusCounts = {};
for (const job of results) {
    statusCounts[job.filter_status] = (statusCounts[job.filter_status] || 0) + 1;
}

console.log('\n=== HARD FILTER RESULTS ===');
for (const [status, count] of Object.entries(statusCounts).sort()) {
    console.log(`  ${status}: ${count}`);
}

// Save filtered results
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\nSaved ${results.length} filtered jobs to hard_filtered_jobs.json`);

// Show PASSED_HARD_FILTER jobs
const passed = results.filter(j => j.filter_status === 'PASSED_HARD_FILTER');
console.log(`\n=== ${passed.length} JOBS PASSED HARD FILTER ===`);
passed.forEach((job, i) => {
    console.log(`\n${i + 1}. ${job.title} @ ${job.company}`);
    console.log(`   Location: ${job.location} (${job.arrangement})`);
    console.log(`   Salary: ${job.salary_original} -> Monthly: ₱${job.salary_monthly_min.toLocaleString()}-₱${job.salary_monthly_max.toLocaleString()} (${job.salary_status})`);
    console.log(`   URL: ${job.url}`);
});

// Show NEEDS_CLARIFICATION
const needsClar = results.filter(j => j.filter_status === 'NEEDS_CLARIFICATION');
console.log(`\n=== ${needsClar.length} JOBS NEED CLARIFICATION ===`);
needsClar.forEach((job, i) => {
    console.log(`\n${i + 1}. ${job.title} @ ${job.company}`);
    console.log(`   Location: ${job.location} (${job.arrangement})`);
    console.log(`   Salary: ${job.salary_original} (${job.salary_status})`);
    console.log(`   Reason: ${job.filter_reason}`);
    console.log(`   URL: ${job.url}`);
});