/**
 * Consolidate Job Details
 *
 * Fetches full detail data from portal CLIs for jobs in consolidated_jobs.json,
 * merges detail fields (description, work_mode/arrangement, salary_text) into
 * canonical fields, and writes the enriched dataset back to consolidated_jobs.json.
 *
 * Usage:
 *   tsx consolidate_jobs.ts --dry-run    # Report what would change
 *   tsx consolidate_jobs.ts --apply      # Apply consolidation
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

interface SearchCardJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  date: string | null;
  dateLabel: string | null;
  teaser: string | null;
  url: string;
  source_file: string;
  // Enriched fields from detail fetch
  description?: string;
  work_mode?: string;
  arrangement?: string;
  salary_text?: string;
  workType?: string;
  isRemote?: boolean;
  [key: string]: unknown;
}

interface PortalConfig {
  name: string;
  cliPath: string;
  idExtractor: (job: SearchCardJob) => string;
  detailParser: (detail: Record<string, unknown>) => Partial<SearchCardJob>;
}

const PORTALS: PortalConfig[] = [
  {
    name: 'jobstreet',
    cliPath: '.agents/skills/jobstreet-search/cli/src/cli.ts',
    idExtractor: (job) => {
      // Extract numeric ID from JobStreet URL: https://ph.jobstreet.com/job/94011412
      const match = job.url.match(/\/job\/(\d+)/);
      return match ? match[1] : job.id;
    },
    detailParser: (detail) => ({
      description: detail.description as string | undefined,
      work_mode: detail.workType as string | undefined,
      salary_text: detail.salary as string | undefined,
    }),
  },
  {
    name: 'indeed',
    cliPath: '.agents/skills/indeed-search/cli/src/cli.ts',
    idExtractor: (job) => {
      // Extract hex jk from Indeed URL: https://ph.indeed.com/viewjob?jk=0934ca2326b03e16
      const match = job.url.match(/[?&]jk=([a-f0-9]+)/);
      return match ? match[1] : job.id;
    },
    detailParser: (detail) => ({
      description: detail.description as string | undefined,
      work_mode: detail.workType as string | undefined,
      salary_text: detail.salary as string | undefined,
    }),
  },
  {
    name: 'kalibrr',
    cliPath: '.agents/skills/kalibrr-search/cli/src/cli.ts',
    idExtractor: (job) => {
      // Extract numeric ID from Kalibrr URL: https://www.kalibrr.com/c/company/jobs/271303/...
      const match = job.url.match(/\/jobs\/(\d+)\//);
      return match ? match[1] : job.id;
    },
    detailParser: (detail) => ({
      description: detail.description as string | undefined,
      work_mode: detail.tenure as string | undefined,
      arrangement: detail.isRemote === true ? 'remote' : (detail.isRemote === false ? 'onsite' : undefined),
      salary_text: detail.salary as string | undefined,
    }),
  },
  {
    name: 'linkedin',
    cliPath: '.agents/skills/linkedin-search/cli/src/cli.ts',
    idExtractor: (job) => {
      // Extract numeric ID from LinkedIn URL: https://ph.linkedin.com/jobs/view/...-4416525035
      const match = job.url.match(/\/jobs\/view\/.*-(\d+)$/) || job.url.match(/urn:li:jobPosting:(\d+)/);
      return match ? match[1] : job.id;
    },
    detailParser: (detail) => ({
      description: detail.description as string | undefined,
      work_mode: detail.employmentType as string | undefined,
      salary_text: detail.salary as string | undefined,
    }),
  },
  {
    name: 'bossjob',
    cliPath: '.agents/skills/bossjob-search/cli/src/cli.ts',
    idExtractor: (job) => {
      // Extract numeric ID from BossJob URL: https://www.bossjob.ph/job/536072 or /job/slug-536073
      const match = job.url.match(/\/job\/(?:[^/]+-)?(\d+)(?:\?|$)/);
      return match ? match[1] : job.id;
    },
    detailParser: (detail) => ({
      description: detail.description as string | undefined,
      work_mode: detail.workType as string | undefined,
      // BossJob location already contains arrangement: "On-site - Laguna", "Hybrid - Quezon City"
      salary_text: detail.salary as string | undefined,
    }),
  },
];

function getPortalForJob(job: SearchCardJob): PortalConfig | null {
  const url = job.url.toLowerCase();
  if (url.includes('jobstreet.com')) return PORTALS[0];
  if (url.includes('indeed.com')) return PORTALS[1];
  if (url.includes('kalibrr.com')) return PORTALS[2];
  if (url.includes('linkedin.com')) return PORTALS[3];
  if (url.includes('bossjob.ph')) return PORTALS[4];
  return null;
}

function fetchJobDetail(portal: PortalConfig, job: SearchCardJob): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const id = portal.idExtractor(job);
    const cliPath = join(process.cwd(), portal.cliPath);

    if (!existsSync(cliPath)) {
      console.error(`[${portal.name}] CLI not found at ${cliPath}`);
      resolve(null);
      return;
    }

    const result = spawnSync('bun', ['run', cliPath, 'detail', id, '--format', 'json'], {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: 'utf-8',
    });

    if (result.error) {
      console.error(`[${portal.name}] Spawn error for ${id}: ${result.error.message}`);
      resolve(null);
      return;
    }

    if (result.status !== 0) {
      // Check if it's a timeout
      if (result.signal === 'SIGTERM' || (result.stderr && result.stderr.includes('timed out'))) {
        console.error(`[${portal.name}] Timeout fetching detail for ${id}`);
      } else {
        console.error(`[${portal.name}] Failed to fetch detail for ${id} (exit ${result.status}): ${result.stderr}`);
      }
      resolve(null);
      return;
    }

    try {
      const parsed = JSON.parse(result.stdout.trim());
      if (parsed.error) {
        console.error(`[${portal.name}] API error for ${id}: ${parsed.error} (${parsed.code})`);
        resolve(null);
        return;
      }
      resolve(parsed);
    } catch (e) {
      console.error(`[${portal.name}] Failed to parse JSON for ${id}: ${e}`);
      resolve(null);
    }
  });
}

async function runConsolidation(dryRun: boolean): Promise<void> {
  const inputPath = join(process.cwd(), '.scrape_out', 'consolidated_jobs.json');
  const backupPath = inputPath.replace('.json', `.backup.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const jobs: SearchCardJob[] = JSON.parse(readFileSync(inputPath, 'utf-8').replace(/^﻿/, ''));

  console.log(`Loaded ${jobs.length} jobs from ${inputPath}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  // Group jobs by portal
  const jobsByPortal = new Map<string, SearchCardJob[]>();
  for (const job of jobs) {
    const portal = getPortalForJob(job);
    if (!portal) {
      console.warn(`Unknown portal for job: ${job.url} (source: ${job.source_file})`);
      continue;
    }
    if (!jobsByPortal.has(portal.name)) {
      jobsByPortal.set(portal.name, []);
    }
    jobsByPortal.get(portal.name)!.push(job);
  }

  // Stats
  let totalFetched = 0;
  let totalEnriched = 0;
  let totalFailed = 0;
  const portalStats = new Map<string, { fetched: number; enriched: number; failed: number }>();

  // Process each portal
  for (const [portalName, portalJobs] of jobsByPortal.entries()) {
    const portal = PORTALS.find(p => p.name === portalName);
    if (!portal) continue;

    const stats = { fetched: 0, enriched: 0, failed: 0 };
    portalStats.set(portalName, stats);

    console.log(`\n[${portalName}] Processing ${portalJobs.length} jobs...`);

    for (const job of portalJobs) {
      stats.fetched++;
      totalFetched++;

      const detail = await fetchJobDetail(portal, job);
      if (!detail) {
        stats.failed++;
        totalFailed++;
        continue;
      }

      const parsed = portal.detailParser(detail);
      const hadChanges = Object.keys(parsed).some(key => parsed[key as keyof typeof parsed] !== undefined);

      if (hadChanges) {
        // Merge detail fields into job
        Object.assign(job, parsed);
        stats.enriched++;
        totalEnriched++;
      }
    }

    console.log(`[${portalName}] Fetched: ${stats.fetched}, Enriched: ${stats.enriched}, Failed: ${stats.failed}`);
  }

  console.log('\n=== CONSOLIDATION SUMMARY ===');
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Detail fetches attempted: ${totalFetched}`);
  console.log(`Jobs enriched with detail data: ${totalEnriched}`);
  console.log(`Detail fetches failed: ${totalFailed}`);

  for (const [portalName, stats] of portalStats.entries()) {
    console.log(`  ${portalName}: ${stats.enriched}/${stats.fetched} enriched, ${stats.failed} failed`);
  }

  if (!dryRun) {
    console.log(`\nCreating backup: ${backupPath}`);
    writeFileSync(backupPath, JSON.stringify(jobs, null, 2), 'utf-8');

    console.log(`Writing consolidated jobs to ${inputPath}`);
    writeFileSync(inputPath, JSON.stringify(jobs, null, 2), 'utf-8');
    console.log('Done.');
  } else {
    console.log('\n(Dry run - no files modified)');
  }
}

// Main
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

if (!dryRun && !apply) {
  console.error('Usage: tsx consolidate_jobs.ts --dry-run|--apply');
  process.exit(1);
}

console.log(`${dryRun ? 'DRY RUN' : 'APPLYING'} job detail consolidation...\n`);

runConsolidation(dryRun).catch((err) => {
  console.error('Consolidation failed:', err);
  process.exit(1);
});