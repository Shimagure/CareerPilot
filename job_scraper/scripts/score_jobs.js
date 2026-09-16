#!/usr/bin/env node

const fs = require('fs');

// ==================== Scoring Functions ====================

function scoreTechnicalSkills(job) {
  const title = job.title.toLowerCase();
  const description = (job.description || '').toLowerCase();
  const combined = title + ' ' + description;

  let score = 0;

  // Strong match areas (core requirements = primary skills)
  const strongKeywords = [
    'end user computing', 'euc', 'desktop support', 'it support', 'technical support',
    'tier 2', 'tier 3', 'l2', 'l3', 'microsoft 365', 'm365', 'active directory',
    'windows 10', 'windows 11', 'windows server', 'group policy', 'endpoint management',
    'intune', 'mdm', 'remote support', 'rdp', 'teamviewer', 'anydesk', 'crowdstrike'
  ];

  // Moderate match areas
  const moderateKeywords = [
    'powershell', 'python', 'linux', 'system administration', 'network troubleshooting',
    'cisco', 'networking', 'html', 'css', 'javascript', 'itsm', 'service desk', 'helpdesk',
    'help desk', 'device management', 'endpoint', 'azure', 'aws', 'cloud'
  ];

  // Weak match areas
  const weakKeywords = [
    'senior cloud architecture', 'soc analyst', 'security operations', 'server virtualization',
    'itil certification', 'virtualization', 'vmware', 'hyper-v', 'kubernetes', 'docker'
  ];

  let strongMatches = 0;
  let moderateMatches = 0;

  for (const kw of strongKeywords) {
    if (combined.includes(kw)) strongMatches++;
  }

  for (const kw of moderateKeywords) {
    if (combined.includes(kw)) moderateMatches++;
  }

  // Score calculation
  if (strongMatches >= 5) score = 90;
  else if (strongMatches >= 3) score = 80;
  else if (strongMatches >= 2) score = 70;
  else if (strongMatches >= 1) score = 60;
  else if (moderateMatches >= 4) score = 55;
  else if (moderateMatches >= 2) score = 45;
  else if (moderateMatches >= 1) score = 35;
  else score = 20;

  // Boost for Tier 2/3, senior, lead roles
  if (title.includes('tier 2') || title.includes('tier 3') || title.includes('l2') || title.includes('l3') ||
      title.includes('senior') || title.includes('lead') || title.includes('systems admin')) {
    score = Math.min(100, score + 10);
  }

  return Math.max(0, Math.min(100, score));
}

function scoreExperienceMatch(job) {
  const title = job.title.toLowerCase();
  const description = (job.description || '').toLowerCase();
  const combined = title + ' ' + description;

  // Strong: Direct experience in same domain
  // Wilson: 3+ years Enterprise EUC/Tier 2 IT Support, AD & M365 admin, endpoint deployment/imaging
  // Moderate: Systems admin (Windows Server, Linux), network support, scripting/automation, security tooling (CrowdStrike)
  // Entry-level: Junior sysadmin, cloud support, SOC/NOC, endpoint security, IT operations

  let score = 40; // Base for adjacent experience

  // Check for strong match indicators
  if (combined.includes('end user computing') || combined.includes('euc') ||
      combined.includes('tier 2') || combined.includes('tier 3') ||
      combined.includes('desktop support') || combined.includes('it support') ||
      combined.includes('service desk') || combined.includes('helpdesk')) {
    score = 85;
  }

  // Moderate match
  if (score < 85) {
    if (combined.includes('systems admin') || combined.includes('sysadmin') ||
        combined.includes('system admin') || combined.includes('network') ||
        combined.includes('endpoint') || combined.includes('device management') ||
        combined.includes('intune') || combined.includes('mdm') ||
        combined.includes('active directory') || combined.includes('crowdstrike')) {
      score = 65;
    }
  }

  // Entry level
  if (score < 65) {
    if (combined.includes('junior') || combined.includes('entry') ||
        combined.includes('l1') || combined.includes('tier 1') ||
        combined.includes('trainee') || combined.includes('intern')) {
      score = 45;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function scoreBehavioralFit(job) {
  const title = job.title.toLowerCase();
  const description = (job.description || '').toLowerCase();
  const combined = title + ' ' + description;

  // Wilson's profile: Reliable executor, systematic problem-solver, initiative-driven
  // Thrives in: remote/hybrid NCR, enterprise infrastructure/security tooling, clear processes, technical growth path
  // Red flags: department disorganization, maintenance over development, poor chemistry, culture mismatches

  let score = 65; // Default mixed signals

  // Positive indicators
  if (combined.includes('remote') || combined.includes('work from home') || combined.includes('wfh')) score += 10;
  if (combined.includes('enterprise') || combined.includes('infrastructure') || combined.includes('security')) score += 5;
  if (combined.includes('automation') || combined.includes('scripting') || combined.includes('process improvement')) score += 5;
  if (combined.includes('growth') || combined.includes('career') || combined.includes('development') || combined.includes('learning')) score += 5;
  if (combined.includes('documentation') || combined.includes('standards') || combined.includes('procedures')) score += 5;
  if (combined.includes('mentor') || combined.includes('team') || combined.includes('collaborative')) score += 3;

  // Negative indicators
  if (combined.includes('break-fix') || combined.includes('reactive') || combined.includes('firefighting')) score -= 10;
  if (combined.includes('no growth') || combined.includes('dead end') || combined.includes('maintenance only')) score -= 15;

  return Math.max(0, Math.min(100, score));
}

function scoreLocation(job) {
  const location = (job.location || '').toLowerCase();
  const arrangement = (job.arrangement || '').toLowerCase();

  // Pass/Fail with notes
  if (arrangement === 'remote' || arrangement.includes('work from home') || arrangement.includes('wfh')) {
    return { pass: true, note: 'Remote' };
  }
  if (arrangement === 'hybrid') {
    const ncrAreas = ['manila', 'makati', 'taguig', 'pasig', 'quezon city', 'mandaluyong',
      'marikina', 'san juan', 'malabon', 'navotas', 'pateros', 'muntinlupa',
      'paranaque', 'las pinas', 'valenzuela', 'caloocan', 'national capital region',
      'metro manila', 'ncr', 'fort bonifacio', 'bgc', 'bonifacio global city',
      'ortigas', 'alabang', 'clark', 'pampanga', 'cavite', 'laguna', 'bulacan', 'rizal'];
    const isNCR = ncrAreas.some(area => location.includes(area));
    if (isNCR) return { pass: true, note: 'Hybrid NCR' };
    return { pass: false, note: 'Hybrid non-NCR (outside commute range)' };
  }
  if (arrangement === 'onsite' || arrangement.includes('on-site') || arrangement.includes('office')) {
    const ncrAreas = ['manila', 'makati', 'taguig', 'pasig', 'quezon city', 'mandaluyong',
      'marikina', 'san juan', 'malabon', 'navotas', 'pateros', 'muntinlupa',
      'paranaque', 'las pinas', 'valenzuela', 'caloocan', 'national capital region',
      'metro manila', 'ncr', 'fort bonifacio', 'bgc', 'bonifacio global city',
      'ortigas', 'alabang'];
    const isNCR = ncrAreas.some(area => location.includes(area));
    if (isNCR) return { pass: true, note: 'Onsite NCR' };
    return { pass: false, note: 'Onsite non-NCR (requires relocation)' };
  }
  return { pass: true, note: 'Unspecified arrangement' };
}

function scoreCareerAlignment(job) {
  const title = job.title.toLowerCase();
  const description = (job.description || '').toLowerCase();
  const combined = title + ' ' + description;

  // Career goals:
  // Near: EUC/IT Support/Desktop Support/Technical Support (Tier 2), enterprise infra/security tooling
  // Medium: Systems Admin, Cloud/Infrastructure, IT Security/Endpoint Security
  // Long: Specialized infrastructure/security; continuous technical development

  // Motivation: Energized by enterprise infra/security tooling, automating with PowerShell/Python,
  // endpoint/AD admin, learning systems/cloud/security. Drained by purely reactive break-fix, no growth path.

  let score = 50; // Base

  // Near-term alignment
  if (combined.includes('tier 2') || combined.includes('tier 3') || combined.includes('l2') || combined.includes('l3') ||
      combined.includes('end user computing') || combined.includes('euc') ||
      combined.includes('desktop support') || combined.includes('it support')) {
    score += 25;
  }

  // Medium-term alignment
  if (combined.includes('systems admin') || combined.includes('sysadmin') ||
      combined.includes('cloud') || combined.includes('infrastructure') ||
      combined.includes('endpoint') || combined.includes('security') ||
      combined.includes('intune') || combined.includes('mdm') ||
      combined.includes('active directory') || combined.includes('identity')) {
    score += 15;
  }

  // Growth indicators
  if (combined.includes('automation') || combined.includes('scripting') || combined.includes('powershell') ||
      combined.includes('python') || combined.includes('learning') || combined.includes('certification') ||
      combined.includes('growth') || combined.includes('career path') || combined.includes('development')) {
    score += 10;
  }

  // Drain indicators
  if (combined.includes('break-fix') || combined.includes('purely reactive') ||
      combined.includes('no growth') || combined.includes('dead end') ||
      combined.includes('maintenance only') || combined.includes('routine only')) {
    score -= 20;
  }

  // Life situation alignment
  const location = (job.location || '').toLowerCase();
  const arrangement = (job.arrangement || '').toLowerCase();
  if (arrangement === 'remote') score += 5;
  else if (arrangement === 'hybrid') {
    const ncrAreas = ['manila', 'makati', 'taguig', 'pasig', 'quezon city', 'mandaluyong',
      'marikina', 'san juan', 'malabon', 'navotas', 'pateros', 'muntinlupa',
      'paranaque', 'las pinas', 'valenzuela', 'caloocan', 'national capital region',
      'metro manila', 'ncr', 'fort bonifacio', 'bgc', 'bonifacio global city',
      'ortigas', 'alabang'];
    if (ncrAreas.some(area => location.includes(area))) score += 3;
  }

  // Salary alignment (if available)
  if (job.salary && job.salary !== 'unspecified' && job.salary !== 'Negotiable') {
    const extracted = extractSalary(job.salary);
    if (extracted.min && extracted.min >= 30000) score += 5;
    if (extracted.min && extracted.min >= 40000) score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

function extractSalary(salaryStr) {
  if (!salaryStr || salaryStr === 'unspecified' || salaryStr === 'Negotiable') {
    return { min: null, max: null, raw: salaryStr };
  }
  const matches = salaryStr.match(/[\d,.]+/g);
  if (!matches) return { min: null, max: null, raw: salaryStr };

  const numbers = matches.map(m => parseFloat(m.replace(/,/g, '')));
  const hasK = salaryStr.toLowerCase().includes('k');
  const converted = hasK ? numbers.map(n => n * 1000) : numbers;

  return {
    min: converted.length > 0 ? Math.min(...converted) : null,
    max: converted.length > 1 ? Math.max(...converted) : (converted.length === 1 ? converted[0] : null),
    raw: salaryStr
  };
}

function calculateOverallScore(scores) {
  // Weighting: Technical 30%, Experience 25%, Behavioral 15%, Career 30%
  const overall = Math.round(
    scores.technical * 0.30 +
    scores.experience * 0.25 +
    scores.behavioral * 0.15 +
    scores.career * 0.30
  );
  return overall;
}

function getVerdict(score) {
  if (score >= 75) return 'Strong Fit';
  if (score >= 60) return 'Good Fit';
  if (score >= 45) return 'Moderate Fit';
  if (score >= 30) return 'Weak Fit';
  return 'Poor Fit';
}

function generateKeyStrengths(job, scores) {
  const strengths = [];

  if (scores.technical >= 80) strengths.push('Core technical requirements match primary skills (EUC, Tier 2/3, M365, AD, Windows, Endpoint Management)');
  else if (scores.technical >= 60) strengths.push('Most technical requirements match with 1-2 learnable gaps');

  if (scores.experience >= 80) strengths.push('Direct experience in enterprise end-user computing / Tier 2 IT support (3+ years)');
  else if (scores.experience >= 60) strengths.push('Related experience with clear transferable skills (systems admin, scripting, security tooling)');

  if (scores.behavioral >= 80) strengths.push('Role culture strongly matches behavioral preferences (remote/hybrid NCR, enterprise infra, clear processes)');
  else if (scores.behavioral >= 60) strengths.push('Mostly compatible culture with some mixed signals');

  if (scores.career >= 80) strengths.push('Strongly aligned with career direction toward systems/cloud/security with clear growth path');
  else if (scores.career >= 60) strengths.push('Good role with partial alignment to long-term goals');

  if (job.arrangement === 'remote') strengths.push('Remote arrangement (strongly preferred)');
  else if (job.arrangement === 'hybrid') strengths.push('Hybrid arrangement within NCR/Metro Manila');

  return strengths.length > 0 ? strengths : ['Relevant IT support background'];
}

function generateGaps(job, scores) {
  const gaps = [];

  if (scores.technical < 60) gaps.push('Significant technical upskilling needed for core requirements');
  else if (scores.technical < 80) gaps.push('1-2 technical gaps that are learnable (highlight transferable skills in cover letter)');

  if (scores.experience < 60) gaps.push('Experience is adjacent; need to make the case for transferability');
  else if (scores.experience < 80) gaps.push('Related but not direct experience in exact role type');

  if (scores.behavioral < 60) gaps.push('Potential culture/behavioral friction areas to investigate');

  if (scores.career < 60) gaps.push('Role may not build strongly toward systems/cloud/security career goals');

  const location = scoreLocation(job);
  if (!location.pass) gaps.push(`Location deal-breaker: ${location.note}`);

  if (job.salary === 'unspecified' || job.salary === 'Negotiable') {
    gaps.push('Salary undisclosed - verify meets ₱30K-45K target range');
  } else {
    const extracted = extractSalary(job.salary);
    if (extracted.max && extracted.max < 30000) {
      gaps.push(`Salary below target: ${job.salary}`);
    }
  }

  if (job.processing_state === 'NEEDS_VERIFICATION' && job.verification_error) {
    gaps.push(`Live verification pending: ${job.verification_error}`);
  }
  if (job.processing_state === 'ACTIVE_UNVERIFIED') {
    gaps.push('Live verification blocked (403) - relying on scraped data');
  }
  if (job.processing_state === 'STALE') {
    gaps.push('Verification data >5 days old - needs re-verification');
  }

  return gaps.length > 0 ? gaps : ['No major gaps identified'];
}

function generateRecommendation(overall, locationPass, gaps) {
  if (!locationPass) return 'Skip - location deal-breaker';
  if (overall >= 75) return 'Definitely apply - tailor CV and cover letter to highlight EUC/Tier 2/AD/M365/endpoint experience';
  if (overall >= 60) return 'Apply - address gaps in cover letter, emphasize transferable skills';
  if (overall >= 45) return 'Consider carefully - discuss with Wilson before applying';
  if (overall >= 30) return 'Probably skip unless strategic reasons (e.g., foot in door at target company)';
  return 'Skip - poor fit';
}

async function main() {
  console.log('Starting scoring stage...');

  // Load verified jobs
  const verifiedJobs = JSON.parse(fs.readFileSync('job_scraper/verified_jobs.json', 'utf8'));
  console.log(`Loaded ${verifiedJobs.length} verified jobs`);

  // Load seen_jobs for updating
  const seenJobsData = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));
  const seenJobs = seenJobsData.seen || {};

  // Score only jobs that need scoring:
  // - ACTIVE_VERIFIED (newly verified this run)
  // - ACTIVE_UNVERIFIED (recent data, already scored before)
  // - CHANGED (material field changed)
  // - POSTING_CHANGED (material field changed)
  // - NEW (newly discovered)
  // Skip: ACTIVE_VERIFIED ≤5 days old (already scored in prior run), CLOSED_OR_EXPIRED, DUPLICATE_OR_INVALID
  const jobsToScore = verifiedJobs.filter(job => {
    if (job.processing_state === 'CLOSED_OR_EXPIRED') return false;
    if (job.processing_state === 'DUPLICATE_OR_INVALID') return false;

    // Find in seen_jobs
    let existingRecord = null;
    for (const [key, record] of Object.entries(seenJobs)) {
      if (record.stable_id === job.stable_id) {
        existingRecord = record;
        break;
      }
    }

    if (existingRecord) {
      const state = existingRecord.processing_state;
      const lastVerified = existingRecord.last_verified;

      if (state === 'ACTIVE_VERIFIED' && lastVerified) {
        const daysSince = (Date.now() - new Date(lastVerified).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 5 && existingRecord.evaluation_score) {
          // Already scored recently - skip
          console.log(`SKIP scoring (ACTIVE_VERIFIED ≤5d, already scored): ${job.title} @ ${job.company}`);
          return false;
        }
      }

      if (state === 'ACTIVE_UNVERIFIED' && existingRecord.evaluation_score) {
        // Already scored - skip (data unchanged)
        console.log(`SKIP scoring (ACTIVE_UNVERIFIED, already scored): ${job.title} @ ${job.company}`);
        return false;
      }
    }

    return true;
  });

  console.log(`Jobs to score this run: ${jobsToScore.length}`);

  // Score each job
  const scoredJobs = [];

  for (let i = 0; i < jobsToScore.length; i++) {
    const job = jobsToScore[i];
    console.log(`  [${i+1}/${jobsToScore.length}] Scoring: ${job.title} @ ${job.company}`);

    const technical = scoreTechnicalSkills(job);
    const experience = scoreExperienceMatch(job);
    const behavioral = scoreBehavioralFit(job);
    const location = scoreLocation(job);
    const career = scoreCareerAlignment(job);

    const scores = { technical, experience, behavioral, career };
    const overall = calculateOverallScore(scores);
    const verdict = getVerdict(overall);

    const keyStrengths = generateKeyStrengths(job, scores);
    const gaps = generateGaps(job, scores);
    const recommendation = generateRecommendation(overall, location.pass, gaps);

    const evaluatedJob = {
      ...job,
      evaluation: {
        technical,
        experience,
        behavioral,
        location: location.pass ? 'PASS' : 'FAIL',
        location_note: location.note,
        career,
        overall,
        verdict,
        key_strengths: keyStrengths,
        gaps,
        recommendation,
        evaluated_at: new Date().toISOString()
      }
    };

    scoredJobs.push(evaluatedJob);
    console.log(`    → Overall: ${overall}/100 (${verdict}) | Technical: ${technical} | Experience: ${experience} | Behavioral: ${behavioral} | Career: ${career} | Location: ${location.pass ? 'PASS' : 'FAIL'} (${location.note})`);
  }

  // Merge scored jobs back into full verified_jobs
  // Keep existing evaluation scores for skipped jobs
  const allScored = verifiedJobs.map(job => {
    const scored = scoredJobs.find(s => s.stable_id === job.stable_id);
    if (scored) return scored;

    // Check if job has existing evaluation in seen_jobs
    let existingRecord = null;
    for (const [key, record] of Object.entries(seenJobs)) {
      if (record.stable_id === job.stable_id) {
        existingRecord = record;
        break;
      }
    }
    if (existingRecord && existingRecord.evaluation) {
      return { ...job, evaluation: existingRecord.evaluation };
    }

    return job;
  });

  // Save scored jobs for ranking stage
  fs.writeFileSync('job_scraper/scored_jobs.json', JSON.stringify(allScored, null, 2));
  console.log('\nSaved scored_jobs.json for ranking stage');

  // Update seen_jobs with evaluation scores
  allScored.forEach(job => {
    let existingKey = null;
    for (const [key, record] of Object.entries(seenJobs)) {
      if (record.stable_id === job.stable_id) {
        existingKey = key;
        break;
      }
    }

    if (existingKey) {
      seenJobs[existingKey] = { ...seenJobs[existingKey], ...job };
    } else {
      seenJobs[job.id] = job;
    }
  });

  fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify({ seen: seenJobs, last_updated: new Date().toISOString() }, null, 2));
  console.log('Updated seen_jobs.json with evaluation scores');

  // Save checkpoint
  const checkpoint = {
    run_id: "20260822100000",
    started_at: "2026-08-22T10:00:00.000Z",
    mode: "INCREMENTAL",
    stage: "scoring",
    stage_status: "complete",
    jobs_processed_in_stage: jobsToScore.length,
    total_jobs_in_stage: verifiedJobs.length,
    batch_index: 1,
    total_batches: 1,
    last_updated: new Date().toISOString(),
    error: null
  };

  const checkpointsData = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));
  checkpointsData.current_checkpoint = checkpoint;
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpointsData, null, 2));

  // Summary
  console.log('\n=== SCORING COMPLETE ===');
  const verdictCounts = { 'Strong Fit': 0, 'Good Fit': 0, 'Moderate Fit': 0, 'Weak Fit': 0, 'Poor Fit': 0 };
  allScored.forEach(job => {
    if (job.evaluation && job.evaluation.verdict) {
      verdictCounts[job.evaluation.verdict]++;
    }
  });
  console.log('Verdict distribution:');
  Object.entries(verdictCounts).forEach(([verdict, count]) => {
    if (count > 0) console.log(`  ${verdict}: ${count}`);
  });

  // Show top 10 by overall score
  const withEvaluation = allScored.filter(j => j.evaluation).sort((a, b) => b.evaluation.overall - a.evaluation.overall);
  console.log('\nTop 10 jobs by overall score:');
  withEvaluation.slice(0, 10).forEach((job, i) => {
    console.log(`  ${i+1}. [${job.evaluation.overall}/100] ${job.title} @ ${job.company} (${job.evaluation.verdict})`);
  });
}

main().catch(console.error);