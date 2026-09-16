// Scoring of verified jobs using the evaluation framework
const fs = require('fs');
const path = require('path');

// Load seen_jobs
const seenJobs = JSON.parse(fs.readFileSync('job_scraper/seen_jobs.json', 'utf8'));

// Load checkpoints
const checkpoints = JSON.parse(fs.readFileSync('job_scraper/checkpoints.json', 'utf8'));

// Candidate profile from CLAUDE.md
const CANDIDATE = {
  skills: {
    primary: ['End User Computing', 'Microsoft 365', 'Active Directory', 'Windows 10/11', 'Windows Server', 'Group Policy', 'Endpoint Management', 'ITSM', 'Tier 2 support'],
    secondary: ['PowerShell', 'Python', 'Linux System Administration', 'HTML/CSS/JavaScript', 'Network Troubleshooting', 'CrowdStrike', 'Cisco Networking Basics'],
    domain: ['Enterprise IT support', 'endpoint management', 'desktop deployment', 'remote support'],
    software: ['Microsoft 365 admin tools', 'RDP', 'TeamViewer', 'AnyDesk', 'IT Service Management platforms']
  },
  experience: {
    years: 3, // July 2023 - May 2026 = ~3 years
    roles: ['End User Computing Technician', 'Web Design & Networking Trainee', 'Programmer / Researcher', 'Freelance Computer Technician'],
    ticketsPerDay: '20-30',
    devicesManaged: '800-1000+',
    achievements: ['Built CrowdStrike status tool', 'Managed AD users/groups/OUs', 'Deployed/imaged workstations']
  },
  certifications: [
    'Linux System Administration (2024)',
    'Fortinet NSE 3 (2023)',
    'Fortinet Cybersecurity Fundamentals (2023)',
    'Cisco Networking Basics (2023)',
    'Introduction to Cybersecurity - Cisco (2023)'
  ],
  education: 'BS Information Technology (2018-2022)',
  location: 'Muzon, San Jose del Monte, Bulacan, Philippines',
  preferences: {
    arrangement: ['remote', 'hybrid'],
    location: ['NCR/Metro Manila', 'Remote'],
    salaryMin: 30000,
    salaryMax: 45000,
    growthPath: true
  },
  behavioral: {
    strengths: ['enterprise IT support at scale', 'endpoint management', 'scripting to automate manual work', 'end-user communication'],
    growthAreas: ['formal systems/cloud and security credentials'],
    thrivesIn: ['remote or Metro Manila hybrid roles with enterprise infrastructure and security tooling', 'clear processes', 'technical growth path']
  }
};

function extractSalary(salaryText) {
  if (!salaryText) return null;
  const match = salaryText.match(/[₱$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[-\s~]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?/i);
  if (match) {
    const min = parseFloat(match[1].replace(/,/g, ''));
    const max = parseFloat(match[2].replace(/,/g, ''));
    return { min, max, currency: salaryText.includes('$') ? 'USD' : 'PHP', raw: salaryText };
  }
  const single = salaryText.match(/[₱$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]/i);
  if (single) {
    const val = parseFloat(single[1].replace(/,/g, ''));
    return { min: val, max: val, currency: salaryText.includes('$') ? 'USD' : 'PHP', raw: salaryText };
  }
  return { raw: salaryText };
}

function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function checkSkillMatch(jobText, skills) {
  const text = normalizeText(jobText);
  let matched = [];
  let missing = [];
  for (const skill of skills) {
    const skillNorm = normalizeText(skill);
    if (text.includes(skillNorm)) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }
  return { matched, missing, score: matched.length / skills.length };
}

function scoreJob(job) {
  const text = `${job.title} ${job.description || job.teaser || ''} ${job.full_description || ''}`.toLowerCase();
  const title = job.title.toLowerCase();
  const company = job.company.toLowerCase();

  const scores = {
    technical_fit: 0,
    experience_fit: 0,
    location_fit: 0,
    salary_fit: 0,
    arrangement_fit: 0,
    growth_fit: 0,
    strengths_match: 0,
    certifications_bonus: 0
  };

  const details = {
    technical_matches: [],
    technical_gaps: [],
    experience_notes: '',
    location_notes: '',
    salary_notes: '',
    arrangement_notes: '',
    growth_notes: '',
    strengths_notes: []
  };

  // 1. Technical fit (30% weight)
  const allSkills = [
    ...CANDIDATE.skills.primary,
    ...CANDIDATE.skills.secondary,
    ...CANDIDATE.skills.domain,
    ...CANDIDATE.skills.software
  ];
  const techMatch = checkSkillMatch(text, allSkills);
  scores.technical_fit = Math.round(techMatch.score * 30);
  details.technical_matches = techMatch.matched;
  details.technical_gaps = techMatch.missing.slice(0, 10); // Top 10 gaps

  // 2. Experience fit (20% weight)
  let expScore = 0;
  if (title.includes('system admin') || title.includes('sysadmin')) expScore += 8;
  if (title.includes('service desk') || title.includes('helpdesk') || title.includes('help desk')) expScore += 8;
  if (title.includes('tier 2') || title.includes('tier ii') || title.includes('l2') || title.includes('level 2')) expScore += 8;
  if (title.includes('technical support') || title.includes('it support') || title.includes('desktop support')) expScore += 8;
  if (title.includes('endpoint') || title.includes('intune') || title.includes('m365') || title.includes('microsoft 365')) expScore += 6;
  if (title.includes('active directory') || title.includes('ad admin') || title.includes('identity') || title.includes('access management')) expScore += 6;
  if (title.includes('cloud') || title.includes('azure') || title.includes('aws') || title.includes('gcp')) expScore += 4;
  if (title.includes('linux') || title.includes('windows server') || title.includes('powershell')) expScore += 4;
  if (title.includes('senior') || title.includes('lead') || title.includes('team lead')) expScore -= 5; // May be overqualified
  if (title.includes('junior') || title.includes('entry') || title.includes('l1') || title.includes('level 1')) expScore += 2; // Good entry point

  // Years experience check
  const expMatch = text.match(/(\d+)\+?\s*years?/);
  if (expMatch) {
    const requiredYears = parseInt(expMatch[1]);
    if (requiredYears <= CANDIDATE.experience.years) expScore += 5;
    else if (requiredYears <= CANDIDATE.experience.years + 2) expScore += 2;
    else expScore -= 5;
  }

  scores.experience_fit = Math.max(0, Math.min(20, expScore));
  details.experience_notes = `Candidate has ${CANDIDATE.experience.years} years EUC experience`;

  // 3. Location fit (15% weight)
  const location = (job.location || '').toLowerCase();
  let locScore = 0;
  if (location.includes('remote') || location.includes('work from home') || location.includes('wfh')) {
    locScore = 15;
    details.location_notes = 'Remote - perfect match';
  } else if (location.includes('manila') || location.includes('makati') || location.includes('taguig') ||
             location.includes('pasig') || location.includes('mandaluyong') || location.includes('quezon city') ||
             location.includes('ortigas') || location.includes('ncr') || location.includes('metro manila')) {
    locScore = 12;
    details.location_notes = 'NCR/Metro Manila - acceptable hybrid/onsite';
  } else if (location.includes('bulacan') || location.includes('cavite') || location.includes('rizal') || location.includes('laguna')) {
    locScore = 10;
    details.location_notes = 'Near NCR - acceptable commute';
  } else if (location.includes('cebu')) {
    locScore = 5;
    details.location_notes = 'Cebu - not preferred';
  } else {
    locScore = 0;
    details.location_notes = 'Outside preferred locations';
  }
  scores.location_fit = locScore;

  // 4. Salary fit (15% weight)
  const salary = extractSalary(job.salary);
  let salScore = 0;
  if (!salary || !salary.min) {
    salScore = 10; // Unknown salary - neutral
    details.salary_notes = 'Salary not specified';
  } else if (salary.currency === 'PHP') {
    if (salary.max >= CANDIDATE.preferences.salaryMin && salary.min <= CANDIDATE.preferences.salaryMax) {
      salScore = 15;
      details.salary_notes = `Within target (${salary.raw})`;
    } else if (salary.max >= 25000 || salary.min <= 50000) {
      salScore = 10;
      details.salary_notes = `Near target (${salary.raw})`;
    } else if (salary.min > 50000) {
      salScore = 15; // Above target is good
      details.salary_notes = `Above target (${salary.raw})`;
    } else {
      salScore = 5;
      details.salary_notes = `Below target (${salary.raw})`;
    }
  } else if (salary.currency === 'USD') {
    const phpEquiv = salary.max * 56; // Rough conversion
    if (phpEquiv >= CANDIDATE.preferences.salaryMin) {
      salScore = 15;
      details.salary_notes = `USD salary converts well (${salary.raw})`;
    } else {
      salScore = 5;
      details.salary_notes = `USD salary may be low (${salary.raw})`;
    }
  }
  scores.salary_fit = salScore;

  // 5. Arrangement fit (10% weight)
  const arrangement = (job.arrangement || '').toLowerCase();
  let arrScore = 0;
  if (arrangement === 'remote') {
    arrScore = 10;
    details.arrangement_notes = 'Remote - preferred';
  } else if (arrangement === 'hybrid') {
    arrScore = 8;
    details.arrangement_notes = 'Hybrid - acceptable';
  } else if (arrangement === 'onsite') {
    arrScore = 5;
    details.arrangement_notes = 'Onsite - acceptable if NCR';
  } else {
    arrScore = 5;
    details.arrangement_notes = 'Unspecified - assume flexible';
  }
  scores.arrangement_fit = arrScore;

  // 6. Growth fit (10% weight)
  let growthScore = 0;
  if (text.includes('cloud') || text.includes('azure') || text.includes('aws') || text.includes('gcp')) growthScore += 3;
  if (text.includes('security') || text.includes('soc') || text.includes('endpoint security') || text.includes('crowdstrike') || text.includes('edr')) growthScore += 3;
  if (text.includes('automation') || text.includes('scripting') || text.includes('powershell') || text.includes('python')) growthScore += 2;
  if (text.includes('certification') || text.includes('training') || text.includes('development') || text.includes('career growth') || text.includes('progression')) growthScore += 2;
  if (text.includes('msp') || text.includes('managed service') || text.includes('multi-tenant')) growthScore += 2;
  scores.growth_fit = Math.min(10, growthScore);
  details.growth_notes = growthScore > 0 ? 'Growth indicators present' : 'Limited growth signals';

  // 7. Strengths match (bonus)
  let strengthScore = 0;
  for (const strength of CANDIDATE.behavioral.strengths) {
    const keywords = normalizeText(strength).split(' ');
    for (const kw of keywords) {
      if (text.includes(kw) && kw.length > 3) {
        strengthScore += 1;
        details.strengths_notes.push(strength);
        break;
      }
    }
  }
  scores.strengths_match = Math.min(5, strengthScore);

  // 8. Certifications bonus
  let certScore = 0;
  for (const cert of CANDIDATE.certifications) {
    const certName = cert.split(' (')[0].toLowerCase();
    if (text.includes(certName.toLowerCase())) {
      certScore += 1;
    }
  }
  scores.certifications_bonus = Math.min(3, certScore);

  // Total score (max 100)
  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  // Verdict
  let verdict = 'Low';
  if (total >= 80) verdict = 'Excellent';
  else if (total >= 70) verdict = 'High';
  else if (total >= 60) verdict = 'Good';
  else if (total >= 50) verdict = 'Moderate';

  return {
    total_score: total,
    verdict,
    breakdown: scores,
    details
  };
}

async function runScoring() {
  // Get ACTIVE_VERIFIED jobs from seen_jobs
  const verifiedJobs = Object.values(seenJobs).filter(job => job.processing_state === 'ACTIVE_VERIFIED');
  console.log(`Found ${verifiedJobs.length} ACTIVE_VERIFIED jobs to score`);

  // Update checkpoint - scoring started
  checkpoints.run_history.push({
    run_id: "20260826000000",
    started_at: new Date().toISOString(),
    mode: "INCREMENTAL",
    stage: "scoring",
    stage_status: "in_progress",
    jobs_processed_in_stage: 0,
    total_jobs_in_stage: verifiedJobs.length,
    batch_index: 0,
    total_batches: Math.ceil(verifiedJobs.length / 5),
    last_updated: new Date().toISOString()
  });
  checkpoints.current_checkpoint.stage = "scoring";
  checkpoints.current_checkpoint.stage_status = "in_progress";
  checkpoints.current_checkpoint.total_jobs_in_stage = verifiedJobs.length;
  checkpoints.current_checkpoint.total_batches = Math.ceil(verifiedJobs.length / 5);
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

  // Process in batches of 5 (sequential as per architecture)
  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < verifiedJobs.length; i += batchSize) {
    batches.push(verifiedJobs.slice(i, i + batchSize));
  }

  const scoredJobs = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`\n=== Scoring Batch ${batchIndex + 1}/${batches.length} (${batch.length} jobs) ===`);

    // Update batch checkpoint
    checkpoints.current_checkpoint.batch_index = batchIndex;
    checkpoints.current_checkpoint.jobs_processed_in_stage = batchIndex * batchSize;
    checkpoints.current_checkpoint.last_updated = new Date().toISOString();
    fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

    for (let i = 0; i < batch.length; i++) {
      const job = batch[i];
      console.log(`  [${i + 1}/${batch.length}] ${job.title} @ ${job.company}`);

      const scoring = scoreJob(job);
      job.rank_score = scoring.total_score;
      job.rank_verdict = scoring.verdict;
      job.rank_date = new Date().toISOString();
      job.rank_breakdown = scoring.breakdown;
      job.rank_details = scoring.details;

      scoredJobs.push(job);
      // Update in seen_jobs
      seenJobs[job.stable_id] = job;
    }

    // Save seen_jobs after each batch
    fs.writeFileSync('job_scraper/seen_jobs.json', JSON.stringify(seenJobs, null, 2));

    console.log(`Batch ${batchIndex + 1} complete. Progress: ${Math.min((batchIndex + 1) * batchSize, verifiedJobs.length)}/${verifiedJobs.length}`);
  }

  // Final checkpoint
  checkpoints.run_history.push({
    run_id: "20260826000000",
    started_at: new Date().toISOString(),
    mode: "INCREMENTAL",
    stage: "scoring",
    stage_status: "complete",
    jobs_processed_in_stage: verifiedJobs.length,
    total_jobs_in_stage: verifiedJobs.length,
    batch_index: batches.length,
    total_batches: batches.length,
    last_updated: new Date().toISOString()
  });
  checkpoints.current_checkpoint.stage = "scoring";
  checkpoints.current_checkpoint.stage_status = "complete";
  checkpoints.current_checkpoint.jobs_processed_in_stage = verifiedJobs.length;
  fs.writeFileSync('job_scraper/checkpoints.json', JSON.stringify(checkpoints, null, 2));

  console.log('\n=== SCORING COMPLETE ===');
  console.log(`Scored ${scoredJobs.length} jobs`);

  // Print summary by verdict
  const verdictCounts = {};
  for (const job of scoredJobs) {
    verdictCounts[job.rank_verdict] = (verdictCounts[job.rank_verdict] || 0) + 1;
  }
  console.log('\nVerdict breakdown:');
  for (const [verdict, count] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict}: ${count}`);
  }

  return scoredJobs;
}

runScoring().then(jobs => {
  console.log('\nScoring complete.');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});