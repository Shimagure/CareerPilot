#!/usr/bin/env node

const fs = require('fs');

// ==================== Normalization Functions ====================

function normalizeArrangement(arrangement) {
  if (!arrangement) return 'unspecified';
  const a = arrangement.toLowerCase();
  if (a.includes('remote') || a.includes('wfh') || a.includes('work from home') || a.includes('work-from-home')) return 'remote';
  if (a.includes('hybrid')) return 'hybrid';
  if (a.includes('onsite') || a.includes('on-site') || a.includes('office')) return 'onsite';
  return 'unspecified';
}

function normalizeLocation(location) {
  if (!location) return 'unspecified';
  const loc = location.toLowerCase();
  // Check for NCR/Metro Manila areas
  const ncrAreas = [
    'manila', 'makati', 'taguig', 'pasig', 'quezon city', 'mandaluyong',
    'marikina', 'san juan', 'malabon', 'navotas', 'pateros', 'muntinlupa',
    'paranaque', 'las pinas', 'valenzuela', 'caloocan', 'national capital region',
    'metro manila', 'ncr', 'fort bonifacio', 'bgc', 'bonifacio global city',
    'ortigas', 'alabang', 'clark', 'pampanga', 'cavite', 'laguna', 'bulacan', 'rizal'
  ];
  const isNCR = ncrAreas.some(area => loc.includes(area));
  return { raw: location, isNCR, normalized: loc };
}

function extractSalary(salaryStr) {
  if (!salaryStr || salaryStr === 'unspecified' || salaryStr === 'negotiable' || salaryStr === 'Negotiable') {
    return { min: null, max: null, raw: salaryStr };
  }
  // Extract numbers from salary string (handles PHP, ₱, k, etc.)
  const matches = salaryStr.match(/[\d,.]+/g);
  if (!matches) return { min: null, max: null, raw: salaryStr };

  const numbers = matches.map(m => parseFloat(m.replace(/,/g, '')));
  // Handle "k" suffix (thousands)
  const hasK = salaryStr.toLowerCase().includes('k');
  const converted = hasK ? numbers.map(n => n * 1000) : numbers;

  return {
    min: converted.length > 0 ? Math.min(...converted) : null,
    max: converted.length > 1 ? Math.max(...converted) : (converted.length === 1 ? converted[0] : null),
    raw: salaryStr
  };
}

function isTargetRole(title) {
  const t = title.toLowerCase();
  const targetKeywords = [
    'end user computing', 'euc', 'desktop support', 'it support', 'technical support',
    'service desk', 'helpdesk', 'help desk', 'tier 2', 'tier 3', 'l2', 'l3',
    'systems admin', 'system admin', 'sysadmin', 'system administrator',
    'infrastructure', 'cloud support', 'cloud engineer', 'endpoint',
    'device management', 'intune', 'jamf', 'mdm', 'active directory',
    'identity', 'iam', 'security analyst', 'soc', 'noc', 'network operations'
  ];

  const excludeKeywords = [
    'sales', 'customer service representative', 'call center', 'csr',
    'field sales', 'marketing', 'accountant', 'hr', 'human resources',
    'receptionist', 'front desk', 'dishwasher', 'chef', 'driver',
    'cashier', 'clerk', 'encoder', 'data entry', 'transcription',
    'virtual assistant', 'admin assistant', 'office admin'
  ];

  // Check exclusions first
  for (const ex of excludeKeywords) {
    if (t.includes(ex)) return false;
  }

  // Check target keywords
  for (const kw of targetKeywords) {
    if (t.includes(kw)) return true;
  }

  return false;
}

function scoreArrangement(arrangement, location) {
  const arr = normalizeArrangement(arrangement);
  const loc = normalizeLocation(location);

  if (arr === 'remote') return { score: 100, tier: 1, reason: 'Remote' };
  if (arr === 'hybrid' && loc.isNCR) return { score: 80, tier: 2, reason: 'Hybrid NCR' };
  if (arr === 'onsite' && loc.isNCR) return { score: 60, tier: 3, reason: 'Onsite NCR' };
  if (arr === 'hybrid' && !loc.isNCR) return { score: 30, tier: 4, reason: 'Hybrid non-NCR' };
  if (arr === 'onsite' && !loc.isNCR) return { score: 10, tier: 5, reason: 'Onsite non-NCR' };
  return { score: 40, tier: 4, reason: 'Unspecified arrangement' };
}

function scoreSalary(salary) {
  const extracted = extractSalary(salary);
  if (!extracted.min && !extracted.max) return { score: 40, tier: 4, reason: 'Undisclosed' };

  const min = extracted.min || 0;
  const max = extracted.max || extracted.min || 0;
  const avg = (min + max) / 2;

  if (avg >= 45000) return { score: 100, tier: 1, reason: `₱${Math.round(avg/1000)}K+ avg` };
  if (avg >= 40000) return { score: 85, tier: 2, reason: `₱${Math.round(avg/1000)}K avg` };
  if (avg >= 30000) return { score: 70, tier: 3, reason: `₱${Math.round(avg/1000)}K avg` };
  if (avg > 0) return { score: 30, tier: 4, reason: `₱${Math.round(avg/1000)}K avg (below target)` };
  return { score: 40, tier: 4, reason: 'Undisclosed' };
}

function scoreRole(title) {
  const t = title.toLowerCase();

  // High priority roles
  const highPriority = ['tier 2', 'tier 3', 'l2', 'l3', 'senior', 'lead', 'systems admin', 'sysadmin', 'endpoint', 'cloud', 'security', 'infrastructure', 'euc', 'end user computing'];
  const midPriority = ['it support', 'technical support', 'service desk', 'helpdesk', 'help desk', 'desktop support', 'system admin', 'network', 'device management', 'intune', 'mdm', 'active directory'];
  const lowPriority = ['junior', 'entry', 'l1', 'tier 1', 'trainee', 'intern'];

  for (const kw of highPriority) {
    if (t.includes(kw)) return { score: 100, tier: 1, reason: `High-priority: ${kw}` };
  }
  for (const kw of midPriority) {
    if (t.includes(kw)) return { score: 75, tier: 2, reason: `Mid-priority: ${kw}` };
  }
  for (const kw of lowPriority) {
    if (t.includes(kw)) return { score: 50, tier: 3, reason: `Entry-level: ${kw}` };
  }

  return { score: 30, tier: 4, reason: 'Unclear role match' };
}

function main() {
  console.log('Starting hard filter stage...');

  // Load canonical jobs
  const canonicalJobs = JSON.parse(fs.readFileSync('job_scraper/canonical_jobs.json', 'utf8'));
  console.log(`Loaded ${canonicalJobs.length} canonical jobs`);

  // Apply hard filters
  const filteredJobs = [];
  const rejectedJobs = [];

  canonicalJobs.forEach(job => {
    // Filter 1: Target role
    if (!isTargetRole(job.title)) {
      rejectedJobs.push({ ...job, rejection_reason: 'Non-target role' });
      return;
    }

    // Filter 2: Location/Arrangement (must be remote, hybrid NCR, or onsite NCR)
    const loc = normalizeLocation(job.location);
    const arr = normalizeArrangement(job.arrangement);
    const arrScore = scoreArrangement(job.arrangement, job.location);

    if (arrScore.tier >= 5) {
      rejectedJobs.push({ ...job, rejection_reason: 'Non-NCR onsite/hybrid' });
      return;
    }

    // Filter 3: Salary (must be >= 30K or undisclosed)
    const salaryScore = scoreSalary(job.salary);
    if (salaryScore.tier >= 4 && job.salary && job.salary !== 'unspecified' && job.salary !== 'Negotiable') {
      // Only reject if salary is explicitly below 30K
      const extracted = extractSalary(job.salary);
      if (extracted.max && extracted.max < 30000) {
        rejectedJobs.push({ ...job, rejection_reason: `Salary below ₱30K: ${job.salary}` });
        return;
      }
    }

    // Passed hard filters
    filteredJobs.push({
      ...job,
      hard_filter: {
        role_match: true,
        arrangement_tier: arrScore.tier,
        arrangement_score: arrScore.score,
        arrangement_reason: arrScore.reason,
        salary_tier: salaryScore.tier,
        salary_score: salaryScore.score,
        salary_reason: salaryScore.reason,
        role_tier: scoreRole(job.title).tier,
        role_score: scoreRole(job.title).score,
        role_reason: scoreRole(job.title).reason
      }
    });
  });

  console.log(`Hard filter passed: ${filteredJobs.length} jobs`);
  console.log(`Hard filter rejected: ${rejectedJobs.length} jobs`);

  // Save filtered jobs for verification stage
  fs.writeFileSync('job_scraper/filtered_jobs.json', JSON.stringify(filteredJobs, null, 2));
  console.log('Saved filtered_jobs.json for verification stage');

  // Print summary
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  filteredJobs.forEach(j => {
    tierCounts[j.hard_filter.arrangement_tier]++;
  });
  console.log('\nArrangement tier distribution:');
  Object.entries(tierCounts).forEach(([tier, count]) => {
    console.log(`  Tier ${tier}: ${count} jobs`);
  });
}

main();