/**
 * Migration Script for seen_jobs.json
 *
 * Migrates old schema to new incremental architecture schema.
 * Uses the canonical stable ID and fingerprint implementations.
 *
 * Usage:
 *   tsx migrate_seen_jobs.ts --dry-run    # Report what would change
 *   tsx migrate_seen_jobs.ts --apply      # Apply migration
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { computeStableId, normalizeUrl, normalizeCompany, normalizeTitle } from './canonical_id.js';
import { computeFingerprintFromJob, buildFingerprintMaterial, FingerprintMaterial } from './canonical_fingerprint.js';

interface OldJobRecord {
  title: string;
  company: string;
  url: string;
  first_seen: string;
  fit: 'high' | 'medium' | 'low';
  status: string;
  portal: string;
  location?: string;
  salary?: string;
  work_mode?: string;
  arrangement?: string;
  description?: string;
  rank_score?: number;
  rank_verdict?: string;
  rank_date?: string;
  strengths?: string[];
  gaps?: string[];
  processing_state?: string;
  fingerprint?: string;
  stable_id?: string;
  last_verified?: string | null;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  changed_at?: string | null;
  changed_fields?: string[];
  closed_at?: string | null;
}

interface NewJobRecord {
  stable_id: string;
  title: string;
  company: string;
  url: string;
  first_seen: string;
  fit: 'high' | 'medium' | 'low';
  status: string;
  processing_state: 'NEW' | 'NEEDS_VERIFICATION' | 'ACTIVE_VERIFIED' | 'ACTIVE_UNVERIFIED' | 'STALE' | 'CHANGED' | 'CLOSED_OR_EXPIRED' | 'POSTING_CHANGED' | 'DUPLICATE_OR_INVALID';
  fingerprint: string;
  previous_fingerprint: string | null;
  last_verified: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  changed_at: string | null;
  changed_fields: string[];
  closed_at: string | null;
  portal: string;
  rank_score: number | null;
  rank_verdict: string | null;
  rank_date: string | null;
  strengths: string[];
  gaps: string[];
  fingerprint_material: FingerprintMaterial | null;
}

interface SeenJobsData {
  seen: Record<string, OldJobRecord>;
}

interface MigrationReport {
  totalRecords: number;
  stableIdsComputed: number;
  missingStableIds: number;
  stableIdCollisions: number;
  duplicateCanonicalRecords: number;
  stateDistribution: Record<string, number>;
  malformedRecords: number;
  missingCriticalFields: number;
  checkpointConsistency: boolean;
  wouldUpdate: number;
  sampleRecords: Array<{ key: string; stable_id: string; oldState: string; newState: string }>;
}

const LEGAL_STATES = [
  'NEW', 'NEEDS_VERIFICATION', 'ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED',
  'STALE', 'CHANGED', 'CLOSED_OR_EXPIRED', 'POSTING_CHANGED', 'DUPLICATE_OR_INVALID'
] as const;

const ILLEGAL_STATES = ['DEPRIORITIZE', 'SKIPPED', 'LOCATION_FAILED', 'TRACKER_EXCLUDED'];

function determineProcessingState(job: OldJobRecord): 'NEW' | 'NEEDS_VERIFICATION' | 'ACTIVE_VERIFIED' | 'ACTIVE_UNVERIFIED' | 'STALE' | 'CHANGED' | 'CLOSED_OR_EXPIRED' | 'POSTING_CHANGED' | 'DUPLICATE_OR_INVALID' {
  // If already has a valid processing_state, keep it
  if (job.processing_state && LEGAL_STATES.includes(job.processing_state as any)) {
    return job.processing_state as any;
  }

  // If has rank_score and rank_date, it's been verified
  if (job.rank_score !== undefined && job.rank_score !== null && job.rank_date) {
    return 'ACTIVE_VERIFIED';
  }

  // If status is "ranked" or "evaluated", it's verified
  if (job.status === 'ranked' || job.status === 'evaluated') {
    return 'ACTIVE_VERIFIED';
  }

  // If status is "skipped", it was deprioritized - but we use NEEDS_VERIFICATION for these
  // (DEPRIORITIZE is not a legal processing_state)
  if (job.status === 'skipped') {
    return 'NEEDS_VERIFICATION';
  }

  // If status is "new" and no rank_score, needs verification
  if (job.status === 'new') {
    return 'NEEDS_VERIFICATION';
  }

  // Default
  return 'NEEDS_VERIFICATION';
}

function loadSeenJobs(filePath: string): SeenJobsData {
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function saveSeenJobs(filePath: string, data: SeenJobsData): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function runMigration(filePath: string, dryRun: boolean): MigrationReport {
  const data = loadSeenJobs(filePath);
  const seen = data.seen || {};

  const report: MigrationReport = {
    totalRecords: 0,
    stableIdsComputed: 0,
    missingStableIds: 0,
    stableIdCollisions: 0,
    duplicateCanonicalRecords: 0,
    stateDistribution: {},
    malformedRecords: 0,
    missingCriticalFields: 0,
    checkpointConsistency: true,
    wouldUpdate: 0,
    sampleRecords: []
  };

  // Track stable_id collisions
  const stableIdMap = new Map<string, string[]>();

  // First pass: compute stable_ids and analyze
  for (const [key, job] of Object.entries(seen)) {
    report.totalRecords++;

    // Check critical fields
    if (!job.url || !job.company || !job.title) {
      report.missingCriticalFields++;
      report.malformedRecords++;
      continue;
    }

    // Compute stable_id
    const stableId = computeStableId(job.url, job.company, job.title);
    stableIdMap.set(stableId, [...(stableIdMap.get(stableId) || []), key]);

    if (!job.stable_id) {
      report.missingStableIds++;
    } else if (job.stable_id !== stableId) {
      report.stableIdCollisions++;
    } else {
      report.stableIdsComputed++;
    }

    // Determine processing state
    const newState = determineProcessingState(job);
    report.stateDistribution[newState] = (report.stateDistribution[newState] || 0) + 1;

    // Sample records for report
    if (report.sampleRecords.length < 10) {
      report.sampleRecords.push({
        key,
        stable_id: stableId,
        oldState: job.processing_state || job.status || 'unknown',
        newState
      });
    }
  }

  // Check for collisions
  for (const [stableId, keys] of stableIdMap.entries()) {
    if (keys.length > 1) {
      report.duplicateCanonicalRecords += keys.length - 1;
    }
  }

  // Second pass: apply updates if not dry run
  if (!dryRun) {
    let updated = 0;
    const newSeen: Record<string, NewJobRecord> = {};

    for (const [key, job] of Object.entries(seen)) {
      // Skip malformed
      if (!job.url || !job.company || !job.title) {
        newSeen[key] = job as any;
        continue;
      }

      // Compute canonical values
      const stableId = computeStableId(job.url, job.company, job.title);
      const newState = determineProcessingState(job);

      // Determine fingerprint handling
      let fingerprint: string;
      let fingerprintMaterial: FingerprintMaterial | null = null;
      let previousFingerprint: string | null = null;

      if (job.fingerprint && job.fingerprint.length > 0) {
        // Legacy fingerprint exists - PRESERVE IT EXACTLY
        fingerprint = job.fingerprint;
        previousFingerprint = job.fingerprint;
        fingerprintMaterial = null;
      } else {
        // No existing fingerprint - compute new canonical one
        fingerprintMaterial = buildFingerprintMaterial(job);
        fingerprint = computeFingerprintFromJob(job);
        previousFingerprint = null;
      }

      // Determine last_verified
      let lastVerified: string | null = null;
      if (newState === 'ACTIVE_VERIFIED' && job.rank_date) {
        lastVerified = job.rank_date;
      } else if (job.last_verified) {
        lastVerified = job.last_verified;
      }

      // Build new record
      const newRecord: NewJobRecord = {
        stable_id: stableId,
        title: job.title,
        company: job.company,
        url: job.url,
        first_seen: job.first_seen,
        fit: job.fit,
        status: job.status,
        processing_state: newState,
        fingerprint: fingerprint,
        previous_fingerprint: previousFingerprint,
        last_verified: lastVerified,
        blocked_at: job.blocked_at || null,
        blocked_reason: job.blocked_reason || null,
        changed_at: job.changed_at || null,
        changed_fields: job.changed_fields || [],
        closed_at: job.closed_at || null,
        portal: job.portal,
        rank_score: job.rank_score ?? null,
        rank_verdict: job.rank_verdict ?? null,
        rank_date: job.rank_date ?? null,
        strengths: job.strengths || [],
        gaps: job.gaps || [],
        fingerprint_material: fingerprintMaterial
      };

      newSeen[key] = newRecord;
      updated++;
    }

    report.wouldUpdate = updated;
    data.seen = newSeen as any;

    // Create backup
    const backupPath = filePath.replace('.json', `.backup.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backupPath, JSON.stringify(loadSeenJobs(filePath), null, 2), 'utf-8');
    console.log(`Backup created: ${backupPath}`);

    // Write migrated data
    saveSeenJobs(filePath, data);
    console.log(`Migration applied: ${updated} records updated`);
  } else {
    report.wouldUpdate = report.totalRecords;
  }

  return report;
}

// Main execution
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

if (!dryRun && !apply) {
  console.error('Usage: tsx migrate_seen_jobs.ts --dry-run|--apply');
  process.exit(1);
}

const filePath = join(process.cwd(), 'job_scraper', 'seen_jobs.json');

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

console.log(`${dryRun ? 'DRY RUN' : 'APPLYING'} migration...`);
console.log(`Reading: ${filePath}`);

const report = runMigration(filePath, dryRun);

console.log('\n=== MIGRATION REPORT ===');
console.log(`Total records: ${report.totalRecords}`);
console.log(`Stable IDs already present (matching): ${report.stableIdsComputed}`);
console.log(`Missing stable IDs: ${report.missingStableIds}`);
console.log(`Stable ID collisions (mismatch): ${report.stableIdCollisions}`);
console.log(`Duplicate canonical records: ${report.duplicateCanonicalRecords}`);
console.log(`Malformed records: ${report.malformedRecords}`);
console.log(`Missing critical fields: ${report.missingCriticalFields}`);
console.log(`Checkpoint consistency: ${report.checkpointConsistency ? 'OK' : 'CHECK NEEDED'}`);
console.log(`\nState distribution:`);
for (const [state, count] of Object.entries(report.stateDistribution)) {
  console.log(`  ${state}: ${count}`);
}
console.log(`\nSample records (first 10):`);
for (const sample of report.sampleRecords) {
  console.log(`  ${sample.key} -> ${sample.stable_id.substring(0, 16)}... | ${sample.oldState} -> ${sample.newState}`);
}

if (dryRun) {
  console.log('\n✓ Dry run complete. Run with --apply to execute migration.');
} else {
  console.log('\n✓ Migration applied successfully.');
}