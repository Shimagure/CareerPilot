/**
 * Architecture Validation Script
 *
 * Validates that the job scraper architecture is correctly implemented
 * and all canonical components are in place.
 *
 * Usage:
 *   tsx validate_architecture.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}

function checkFileExists(filePath: string): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), filePath);
  const exists = existsSync(fullPath);
  return {
    passed: exists,
    message: exists ? `Found: ${filePath}` : `MISSING: ${filePath}`
  };
}

function checkFileContent(filePath: string, requiredExports: string[]): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), filePath);
  if (!existsSync(fullPath)) {
    return { passed: false, message: `File not found: ${filePath}` };
  }

  const content = readFileSync(fullPath, 'utf-8');
  const missing = requiredExports.filter(exp => !content.includes(exp));

  if (missing.length === 0) {
    return { passed: true, message: `All required exports present in ${filePath}` };
  }

  return {
    passed: false,
    message: `Missing exports in ${filePath}: ${missing.join(', ')}`
  };
}

function checkJsonSchema(filePath: string, requiredKeys: string[]): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), filePath);
  if (!existsSync(fullPath)) {
    return { passed: false, message: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);

    const missing = requiredKeys.filter(key => !(key in data));
    if (missing.length === 0) {
      return { passed: true, message: `All required keys present in ${filePath}` };
    }

    return {
      passed: false,
      message: `Missing keys in ${filePath}: ${missing.join(', ')}`
    };
  } catch (e) {
    return { passed: false, message: `Invalid JSON in ${filePath}: ${e}` };
  }
}

function checkIllegalStatesInSeenJobs(): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), 'job_scraper', 'seen_jobs.json');
  if (!existsSync(fullPath)) {
    return { passed: false, message: 'seen_jobs.json not found' };
  }

  const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const illegalStates = ['DEPRIORITIZE', 'SKIPPED', 'LOCATION_FAILED', 'TRACKER_EXCLUDED'];
  let violations = 0;

  for (const [key, job] of Object.entries(data.seen || {})) {
    const jobRecord = job as any;
    if (jobRecord.processing_state && illegalStates.includes(jobRecord.processing_state)) {
      violations++;
    }
  }

  return {
    passed: violations === 0,
    message: violations === 0
      ? 'No illegal processing_state values found'
      : `Found ${violations} records with illegal processing_state values`
  };
}

function checkStableIdsPresent(): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), 'job_scraper', 'seen_jobs.json');
  if (!existsSync(fullPath)) {
    return { passed: false, message: 'seen_jobs.json not found' };
  }

  const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
  let missing = 0;
  let total = 0;

  for (const [key, job] of Object.entries(data.seen || {})) {
    const jobRecord = job as any;
    total++;
    if (!jobRecord.stable_id) {
      missing++;
    }
  }

  return {
    passed: missing === 0,
    message: `Stable IDs: ${total - missing}/${total} records have stable_id`
  };
}

function checkFingerprintsPresent(): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), 'job_scraper', 'seen_jobs.json');
  if (!existsSync(fullPath)) {
    return { passed: false, message: 'seen_jobs.json not found' };
  }

  const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
  let missing = 0;
  let total = 0;

  for (const [key, job] of Object.entries(data.seen || {})) {
    const jobRecord = job as any;
    total++;
    if (!jobRecord.fingerprint) {
      missing++;
    }
  }

  return {
    passed: missing === 0,
    message: `Fingerprints: ${total - missing}/${total} records have fingerprint`
  };
}

function checkLegalStatesOnly(): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), 'job_scraper', 'seen_jobs.json');
  if (!existsSync(fullPath)) {
    return { passed: false, message: 'seen_jobs.json not found' };
  }

  const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const legalStates = [
    'NEW', 'NEEDS_VERIFICATION', 'ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED',
    'STALE', 'CHANGED', 'CLOSED_OR_EXPIRED', 'POSTING_CHANGED', 'DUPLICATE_OR_INVALID'
  ];
  let violations = 0;

  for (const [key, job] of Object.entries(data.seen || {})) {
    const jobRecord = job as any;
    if (jobRecord.processing_state && !legalStates.includes(jobRecord.processing_state)) {
      violations++;
    }
  }

  return {
    passed: violations === 0,
    message: violations === 0
      ? 'All processing_state values are legal'
      : `Found ${violations} records with illegal processing_state values`
  };
}

function checkCheckpointStructure(): { passed: boolean; message: string } {
  const fullPath = join(process.cwd(), 'job_scraper', 'checkpoints.json');
  if (!existsSync(fullPath)) {
    return { passed: false, message: 'checkpoints.json not found' };
  }

  try {
    const data = JSON.parse(readFileSync(fullPath, 'utf-8'));

    const requiredTopLevel = ['schema_version', 'run_history', 'current_checkpoint'];
    for (const key of requiredTopLevel) {
      if (!(key in data)) {
        return { passed: false, message: `Missing top-level key: ${key}` };
      }
    }

    const cp = data.current_checkpoint;
    const requiredCp = ['run_id', 'started_at', 'mode', 'stage', 'stage_status', 'jobs_processed_in_stage', 'total_jobs_in_stage', 'batch_index', 'total_batches', 'last_updated'];
    for (const key of requiredCp) {
      if (!(key in cp)) {
        return { passed: false, message: `Missing current_checkpoint key: ${key}` };
      }
    }

    return { passed: true, message: 'Checkpoint structure is valid' };
  } catch (e) {
    return { passed: false, message: `Invalid checkpoint JSON: ${e}` };
  }
}

function runValidation(): ValidationResult {
  const checks = [];

  // Check canonical implementation files
  checks.push({
    name: 'canonical_id.ts exists',
    ...checkFileExists('job_scraper/scripts/canonical_id.ts')
  });

  checks.push({
    name: 'canonical_fingerprint.ts exists',
    ...checkFileExists('job_scraper/scripts/canonical_fingerprint.ts')
  });

  checks.push({
    name: 'migrate_seen_jobs.ts exists',
    ...checkFileExists('job_scraper/scripts/migrate_seen_jobs.ts')
  });

  checks.push({
    name: 'canonical_id.ts exports',
    ...checkFileContent('job_scraper/scripts/canonical_id.ts', [
      'normalizeUrl',
      'normalizeCompany',
      'normalizeTitle',
      'computeStableId',
      'computeStableIdFromJob'
    ])
  });

  checks.push({
    name: 'canonical_fingerprint.ts exports',
    ...checkFileContent('job_scraper/scripts/canonical_fingerprint.ts', [
      'normalizeLocation',
      'normalizeArrangement',
      'normalizeSalary',
      'extractKeyRequirements',
      'buildFingerprintMaterial',
      'computeFingerprint',
      'computeFingerprintFromJob',
      'getChangedFields'
    ])
  });

  // Check architecture docs
  checks.push({
    name: 'ARCHITECTURE.md exists',
    ...checkFileExists('.ai/ARCHITECTURE.md')
  });

  checks.push({
    name: 'OPERATING_RULES.md exists',
    ...checkFileExists('.ai/OPERATING_RULES.md')
  });

  // Check seen_jobs.json schema
  checks.push({
    name: 'seen_jobs.json structure',
    ...checkJsonSchema('job_scraper/seen_jobs.json', ['seen'])
  });

  checks.push({
    name: 'No illegal processing_state values',
    ...checkIllegalStatesInSeenJobs()
  });

  checks.push({
    name: 'All records have stable_id',
    ...checkStableIdsPresent()
  });

  checks.push({
    name: 'All records have fingerprint',
    ...checkFingerprintsPresent()
  });

  checks.push({
    name: 'All processing_state values are legal',
    ...checkLegalStatesOnly()
  });

  // Check checkpoints.json
  checks.push({
    name: 'checkpoints.json structure',
    ...checkCheckpointStructure()
  });

  const allPassed = checks.every(c => c.passed);

  return {
    passed: allPassed,
    checks
  };
}

// Main execution
console.log('=== ARCHITECTURE VALIDATION ===\n');

const result = runValidation();

for (const check of result.checks) {
  const status = check.passed ? '✓' : '✗';
  console.log(`${status} ${check.name}: ${check.message}`);
}

console.log('\n=== SUMMARY ===');
if (result.passed) {
  console.log('✓ All architecture validation checks PASSED');
  process.exit(0);
} else {
  console.log('✗ Some architecture validation checks FAILED');
  process.exit(1);
}