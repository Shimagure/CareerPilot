/**
 * Step 2.5: Live Verification, Change Detection & State Assignment
 *
 * Reads needs_verification_dedup.json, fetches fresh detail from portal CLIs,
 * merges fresh non-empty fields with consolidated fallback data, computes
 * canonical fingerprints, compares against seen_jobs.json, assigns processing
 * state, updates checkpoints, and persists results safely.
 *
 * Usage:
 *   bun run job_scraper/scripts/verify_jobs.ts --dry-run
 *   bun run job_scraper/scripts/verify_jobs.ts --batch 0 --size 5
 *   bun run job_scraper/scripts/verify_jobs.ts --all
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

import {
  computeFingerprintFromJob,
  buildFingerprintMaterial,
  getChangedFields,
} from "./canonical_fingerprint.js";

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

  description?: string;
  work_mode?: string;
  arrangement?: string;
  salary_text?: string;
  workType?: string;
  isRemote?: boolean;

  stable_id: string;
  processing_state: string;
  fingerprint?: string;
  previous_fingerprint?: string;
  last_verified?: string | null;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  blocked_source?: string;
  changed_at?: string | null;
  changed_fields?: string[];
  closed_at?: string | null;

  language_flags?: string[];

  [key: string]: unknown;
}

interface SeenJobEntry {
  stable_id: string;
  title: string;
  company: string;
  url: string;
  first_seen: string;
  fit: string;
  status: string;
  processing_state: string;
  fingerprint: string;

  previous_fingerprint?: string;

  last_verified: string | null;

  blocked_at: string | null;
  blocked_reason: string | null;

  changed_at: string | null;
  changed_fields: string[];

  closed_at: string | null;

  portal: string;

  location?: string | null;
  salary?: string | null;
  salary_text?: string | null;
  arrangement?: string | null;
  work_mode?: string | null;
  description?: string | null;

  rank_score: number | null;
  rank_verdict: string | null;
  rank_date: string | null;

  strengths: string[];
  gaps: string[];

  [key: string]: unknown;
}

interface PortalConfig {
  name: string;
  cliPath: string;
  idExtractor: (job: SearchCardJob) => string;
  detailParser: (
    detail: Record<string, unknown>
  ) => Partial<SearchCardJob>;
}

interface FetchResult {
  data: Record<string, unknown> | null;
  httpStatus: number | null;
  error?: string;
}

interface VerificationResult {
  job: SearchCardJob;
  success: boolean;
  httpStatus: number | null;
  error?: string;
}

interface BatchResult {
  processed: number;
  verified: number;
  blocked: number;
  changed: number;
  closed: number;
  failed: number;
}

interface Checkpoints {
  schema_version?: string;
  run_history: Array<Record<string, unknown>>;
  current_checkpoint: {
    run_id: string;
    started_at: string;
    mode: string;
    stage: string;
    stage_status: string;
    jobs_processed_in_stage: number;
    total_jobs_in_stage: number;
    batch_index: number;
    total_batches: number;
    last_updated: string;
    error?: string | null;
    [key: string]: unknown;
  };
  notes?: string;
}

const ROOT = process.cwd();

const NEEDS_VERIFICATION_PATH = join(
  ROOT,
  ".scrape_out",
  "needs_verification_dedup.json"
);

const CONSOLIDATED_PATH = join(
  ROOT,
  ".scrape_out",
  "consolidated_jobs.json"
);

const SEEN_JOBS_PATH = join(
  ROOT,
  "job_scraper",
  "seen_jobs.json"
);

const CHECKPOINTS_PATH = join(
  ROOT,
  "job_scraper",
  "checkpoints.json"
);

const CONCURRENCY = 2;
const DEFAULT_BATCH_SIZE = 5;
const VERIFICATION_DAYS = 5;

const PORTALS: PortalConfig[] = [
  {
    name: "jobstreet",
    cliPath:
      ".agents/skills/jobstreet-search/cli/src/cli.ts",

    idExtractor: (job) => {
      const match = job.url.match(/\/job\/(\d+)/i);
      return match?.[1] ?? job.id;
    },

    detailParser: (detail) => ({
      description:
        typeof detail.description === "string"
          ? detail.description
          : undefined,

      work_mode:
        typeof detail.workType === "string"
          ? detail.workType
          : undefined,

      salary_text:
        typeof detail.salary === "string"
          ? detail.salary
          : undefined,

      location:
        typeof detail.location === "string"
          ? detail.location
          : undefined,

      title:
        typeof detail.title === "string"
          ? detail.title
          : undefined,

      company:
        typeof detail.company === "string"
          ? detail.company
          : undefined,
    }),
  },

  {
    name: "indeed",
    cliPath:
      ".agents/skills/indeed-search/cli/src/cli.ts",

    idExtractor: (job) => {
      const match = job.url.match(/[?&]jk=([a-f0-9]+)/i);
      return match?.[1] ?? job.id;
    },

    detailParser: (detail) => ({
      description:
        typeof detail.description === "string"
          ? detail.description
          : undefined,

      work_mode:
        typeof detail.workType === "string"
          ? detail.workType
          : undefined,

      salary_text:
        typeof detail.salary === "string"
          ? detail.salary
          : undefined,

      location:
        typeof detail.location === "string"
          ? detail.location
          : undefined,

      title:
        typeof detail.title === "string"
          ? detail.title
          : undefined,

      company:
        typeof detail.company === "string"
          ? detail.company
          : undefined,
    }),
  },

  {
    name: "kalibrr",
    cliPath:
      ".agents/skills/kalibrr-search/cli/src/cli.ts",

    idExtractor: (job) => {
      const match = job.url.match(/\/jobs\/(\d+)\//i);
      return match?.[1] ?? job.id;
    },

    detailParser: (detail) => ({
      description:
        typeof detail.description === "string"
          ? detail.description
          : undefined,

      work_mode:
        typeof detail.tenure === "string"
          ? detail.tenure
          : undefined,

      arrangement:
        detail.isRemote === true
          ? "remote"
          : detail.isRemote === false
            ? "onsite"
            : undefined,

      salary_text:
        typeof detail.salary === "string"
          ? detail.salary
          : undefined,

      location:
        typeof detail.location === "string"
          ? detail.location
          : undefined,

      title:
        typeof detail.title === "string"
          ? detail.title
          : undefined,

      company:
        typeof detail.company === "string"
          ? detail.company
          : undefined,
    }),
  },

  {
    name: "linkedin",
    cliPath:
      ".agents/skills/linkedin-search/cli/src/cli.ts",

    idExtractor: (job) => {
      const match =
        job.url.match(/\/jobs\/view\/.*-(\d+)$/i) ??
        job.url.match(/urn:li:jobPosting:(\d+)/i);

      return match?.[1] ?? job.id;
    },

    detailParser: (detail) => ({
      description:
        typeof detail.description === "string"
          ? detail.description
          : undefined,

      work_mode:
        typeof detail.employmentType === "string"
          ? detail.employmentType
          : undefined,

      salary_text:
        typeof detail.salary === "string"
          ? detail.salary
          : undefined,

      location:
        typeof detail.location === "string"
          ? detail.location
          : undefined,

      title:
        typeof detail.title === "string"
          ? detail.title
          : undefined,

      company:
        typeof detail.company === "string"
          ? detail.company
          : undefined,
    }),
  },

  {
    name: "bossjob",
    cliPath:
      ".agents/skills/bossjob-search/cli/src/cli.ts",

    idExtractor: (job) => {
      const match = job.url.match(
        /\/job\/(?:[^/]+-)?(\d+)(?:\?|$)/i
      );

      return match?.[1] ?? job.id;
    },

    detailParser: (detail) => ({
      description:
        typeof detail.description === "string"
          ? detail.description
          : undefined,

      work_mode:
        typeof detail.workType === "string"
          ? detail.workType
          : undefined,

      salary_text:
        typeof detail.salary === "string"
          ? detail.salary
          : undefined,

      location:
        typeof detail.location === "string"
          ? detail.location
          : undefined,

      title:
        typeof detail.title === "string"
          ? detail.title
          : undefined,

      company:
        typeof detail.company === "string"
          ? detail.company
          : undefined,
    }),
  },
];

function getPortalForJob(
  job: SearchCardJob
): PortalConfig | null {
  const url = job.url.toLowerCase();

  if (url.includes("jobstreet.com")) {
    return PORTALS.find((p) => p.name === "jobstreet") ?? null;
  }

  if (url.includes("indeed.com")) {
    return PORTALS.find((p) => p.name === "indeed") ?? null;
  }

  if (url.includes("kalibrr.com")) {
    return PORTALS.find((p) => p.name === "kalibrr") ?? null;
  }

  if (url.includes("linkedin.com")) {
    return PORTALS.find((p) => p.name === "linkedin") ?? null;
  }

  if (url.includes("bossjob.ph")) {
    return PORTALS.find((p) => p.name === "bossjob") ?? null;
  }

  return null;
}

function isNonEmptyValue(
  value: unknown
): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

/**
 * Merge live detail over consolidated data.
 *
 * Critical rule:
 * null / undefined / empty-string live values NEVER overwrite
 * populated consolidated values.
 */
function mergeJobData(
  consolidated: SearchCardJob,
  fresh: Partial<SearchCardJob>
): SearchCardJob {
  const merged: SearchCardJob = {
    ...consolidated,
  };

  for (const [key, value] of Object.entries(fresh)) {
    if (isNonEmptyValue(value)) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

function extractHttpStatus(
  stderr: string
): number | null {
  if (!stderr) {
    return null;
  }

  try {
    const parsed = JSON.parse(stderr);

    if (
      typeof parsed?.status === "number"
    ) {
      return parsed.status;
    }

    if (
      typeof parsed?.statusCode === "number"
    ) {
      return parsed.statusCode;
    }

    if (
      typeof parsed?.code === "number"
    ) {
      return parsed.code;
    }

    if (
      typeof parsed?.error === "string"
    ) {
      const match = parsed.error.match(
        /\b(401|403|404|408|429|500|502|503|504)\b/
      );

      if (match) {
        return Number(match[1]);
      }
    }
  } catch {
    // Continue with text matching below.
  }

  const match = stderr.match(
    /\b(401|403|404|408|429|500|502|503|504)\b/
  );

  return match ? Number(match[1]) : null;
}

function fetchJobDetail(
  portal: PortalConfig,
  job: SearchCardJob
): FetchResult {
  const id = portal.idExtractor(job);
  const cliPath = join(ROOT, portal.cliPath);

  if (!existsSync(cliPath)) {
    return {
      data: null,
      httpStatus: 500,
      error: `CLI not found: ${cliPath}`,
    };
  }

  console.log(
    `  [FETCH] ${job.title} @ ${job.company} via ${portal.name} (${id})`
  );

  const result = spawnSync(
    "bun",
    [
      "run",
      cliPath,
      "detail",
      id,
      "--format",
      "json",
    ],
    {
      cwd: ROOT,
      timeout: 30000,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (result.error) {
    return {
      data: null,
      httpStatus: 408,
      error: result.error.message,
    };
  }

  const stdout =
    typeof result.stdout === "string"
      ? result.stdout.trim()
      : "";

  const stderr =
    typeof result.stderr === "string"
      ? result.stderr.trim()
      : "";

  if (result.status !== 0) {
    const httpStatus =
      extractHttpStatus(stderr) ??
      (result.signal === "SIGTERM" ? 408 : 500);

    return {
      data: null,
      httpStatus,
      error:
        stderr ||
        `CLI exited with status ${result.status}`,
    };
  }

  if (!stdout) {
    return {
      data: null,
      httpStatus: 500,
      error: "CLI returned empty stdout",
    };
  }

  try {
    const parsed = JSON.parse(stdout) as Record<
      string,
      unknown
    >;

    if (
      parsed.error ||
      parsed.code === "DETAIL_FAILED"
    ) {
      return {
        data: null,
        httpStatus:
          typeof parsed.status === "number"
            ? parsed.status
            : extractHttpStatus(
                JSON.stringify(parsed)
              ) ?? 500,
        error: String(
          parsed.error ??
          parsed.message ??
          "Portal detail request failed"
        ),
      };
    }

    return {
      data: parsed,
      httpStatus: 200,
    };
  } catch (error) {
    return {
      data: null,
      httpStatus: 500,
      error: `Invalid JSON from portal CLI: ${String(error)}`,
    };
  }
}

function loadJson<T>(
  path: string
): T {
  const content = readFileSync(
    path,
    "utf-8"
  ).replace(/^﻿/, "");

  return JSON.parse(content) as T;
}

function loadSeenJobs(): Record<
  string,
  SeenJobEntry
> {
  if (!existsSync(SEEN_JOBS_PATH)) {
    return {};
  }

  const parsed = loadJson<
    | Record<string, SeenJobEntry>
    | { seen: Record<string, SeenJobEntry> }
  >(SEEN_JOBS_PATH);

  if (
    parsed &&
    typeof parsed === "object" &&
    "seen" in parsed
  ) {
    return parsed.seen;
  }

  return parsed as Record<
    string,
    SeenJobEntry
  >;
}

function backupSeenJobs(): void {
  if (!existsSync(SEEN_JOBS_PATH)) {
    return;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const backupPath = SEEN_JOBS_PATH.replace(
    /\.json$/i,
    `.backup.${timestamp}.json`
  );

  copyFileSync(
    SEEN_JOBS_PATH,
    backupPath
  );

  console.log(
    `Created seen_jobs backup: ${backupPath}`
  );
}

function saveSeenJobs(
  seenJobs: Record<string, SeenJobEntry>
): void {
  writeFileSync(
    SEEN_JOBS_PATH,
    JSON.stringify(
      { seen: seenJobs },
      null,
      2
    ),
    "utf-8"
  );
}

function loadCheckpoints(): Checkpoints | null {
  if (!existsSync(CHECKPOINTS_PATH)) {
    return null;
  }

  return loadJson<Checkpoints>(
    CHECKPOINTS_PATH
  );
}

function saveCheckpoints(
  checkpoints: Checkpoints
): void {
  writeFileSync(
    CHECKPOINTS_PATH,
    JSON.stringify(
      checkpoints,
      null,
      2
    ),
    "utf-8"
  );
}

function updateCheckpoint(
  checkpoints: Checkpoints,
  patch: Record<string, unknown>
): void {
  checkpoints.current_checkpoint = {
    ...checkpoints.current_checkpoint,
    ...patch,
    last_updated:
      new Date().toISOString(),
  };

  saveCheckpoints(checkpoints);
}

function isRecentlyVerified(
  entry: SeenJobEntry
): boolean {
  if (
    entry.processing_state ===
      "ACTIVE_VERIFIED" &&
    entry.last_verified
  ) {
    const timestamp = new Date(
      entry.last_verified
    ).getTime();

    if (!Number.isNaN(timestamp)) {
      return (
        timestamp >
        Date.now() -
          VERIFICATION_DAYS *
            24 *
            60 *
            60 *
            1000
      );
    }
  }

  if (
    entry.processing_state ===
      "ACTIVE_UNVERIFIED" &&
    entry.blocked_at
  ) {
    const timestamp = new Date(
      entry.blocked_at
    ).getTime();

    if (!Number.isNaN(timestamp)) {
      return (
        timestamp >
        Date.now() -
          VERIFICATION_DAYS *
            24 *
            60 *
            60 *
            1000
      );
    }
  }

  return false;
}

async function verifyJob(
  job: SearchCardJob,
  consolidatedJobs: SearchCardJob[],
  seenJobs: Record<string, SeenJobEntry>,
  forceRefetch = false
): Promise<VerificationResult> {
  const seenEntry =
    seenJobs[job.stable_id];

  const consolidated =
    consolidatedJobs.find(
      (candidate) =>
        candidate.stable_id ===
        job.stable_id
    ) ?? job;

  const now =
    new Date().toISOString();

  if (
    seenEntry &&
    isRecentlyVerified(seenEntry) &&
    !forceRefetch
  ) {
    console.log(
      `  [SKIP] ${job.title} @ ${job.company} - recently verified`
    );

    return {
      job: {
        ...job,
        processing_state:
          seenEntry.processing_state,
        fingerprint:
          seenEntry.fingerprint,
        last_verified:
          seenEntry.last_verified,
      },
      success: true,
      httpStatus:
        seenEntry.processing_state ===
        "ACTIVE_UNVERIFIED"
          ? 403
          : 200,
    };
  }

  const portal =
    getPortalForJob(job);

  if (!portal) {
    return {
      job: {
        ...job,
        processing_state:
          seenEntry?.processing_state ??
          "STALE",
        fingerprint:
          seenEntry?.fingerprint ??
          computeFingerprintFromJob(
            consolidated
          ),
      },
      success: false,
      httpStatus: 500,
      error: `No supported portal for ${job.url}`,
    };
  }

  const fetchResult =
    fetchJobDetail(
      portal,
      job
    );

  if (
    fetchResult.httpStatus === 403
  ) {
    console.log(
      `  [BLOCKED 403] ${job.title} @ ${job.company}`
    );

    return {
      job: {
        ...consolidated,
        processing_state:
          "ACTIVE_UNVERIFIED",
        fingerprint:
          seenEntry?.fingerprint ??
          consolidated.fingerprint ??
          computeFingerprintFromJob(
            consolidated
          ),
        blocked_at: now,
        blocked_reason: "http_403",
        blocked_source: portal.name,
      },
      success: true,
      httpStatus: 403,
    };
  }

  if (
    fetchResult.httpStatus === 404
  ) {
    console.log(
      `  [CLOSED] ${job.title} @ ${job.company}`
    );

    return {
      job: {
        ...consolidated,
        processing_state:
          "CLOSED_OR_EXPIRED",
        closed_at: now,
      },
      success: true,
      httpStatus: 404,
    };
  }

  if (
    fetchResult.httpStatus === 408
  ) {
    console.log(
      `  [TIMEOUT] ${job.title} @ ${job.company}`
    );

    return {
      job: {
        ...job,
        processing_state:
          seenEntry?.processing_state ??
          "STALE",
        fingerprint:
          seenEntry?.fingerprint ??
          consolidated.fingerprint ??
          computeFingerprintFromJob(
            consolidated
          ),
      },
      success: false,
      httpStatus: 408,
      error:
        fetchResult.error ??
        "Portal request timed out",
    };
  }

  if (
    fetchResult.httpStatus !== 200 ||
    !fetchResult.data
  ) {
    console.log(
      `  [FAILED] ${job.title} @ ${job.company} - HTTP ${
        fetchResult.httpStatus ??
        "unknown"
      }`
    );

    return {
      job: {
        ...job,
        processing_state:
          seenEntry?.processing_state ??
          "STALE",
        fingerprint:
          seenEntry?.fingerprint ??
          consolidated.fingerprint ??
          computeFingerprintFromJob(
            consolidated
          ),
      },
      success: false,
      httpStatus:
        fetchResult.httpStatus,
      error:
        fetchResult.error ??
        "Portal detail request failed",
    };
  }

  const fresh =
    portal.detailParser(
      fetchResult.data
    );

  /**
   * This is the key correctness point:
   *
   * Fresh portal detail is incomplete on some portals,
   * especially Indeed. Missing location/salary/work type
   * must fall back to consolidated data.
   */
  const merged =
    mergeJobData(
      consolidated,
      fresh
    );

  const newFingerprint =
    computeFingerprintFromJob(
      merged
    );

  /**
   * Determine if this job has a prior canonical fingerprint from a
   * successful live verification.
   *
   * A prior canonical fingerprint exists ONLY if:
   * - seenEntry exists AND
   * - seenEntry.last_verified is not null (was actually verified before)
   *
   * The job.fingerprint from needs_verification_dedup.json is the
   * 16-char stable_id, NOT the canonical 64-char fingerprint.
   * Do NOT use it as a comparison baseline.
   */
  const hasPriorCanonicalFingerprint =
    seenEntry !== undefined &&
    seenEntry.last_verified !== null &&
    seenEntry.fingerprint &&
    seenEntry.fingerprint.length === 64;

  const oldFingerprint = hasPriorCanonicalFingerprint
    ? seenEntry.fingerprint
    : "";

  const resultJob: SearchCardJob = {
    ...merged,
    fingerprint:
      newFingerprint,
    last_verified: now,
  };

  if (
    hasPriorCanonicalFingerprint &&
    oldFingerprint !== newFingerprint
  ) {
    const oldMaterial =
      buildFingerprintMaterial(
        seenEntry as never
      );

    const newMaterial =
      buildFingerprintMaterial(
        merged as never
      );

    const changedFields =
      getChangedFields(
        oldMaterial,
        newMaterial
      );

    console.log(
      `  [CHANGED] ${job.title} @ ${job.company} - ${
        changedFields.length > 0
          ? changedFields.join(", ")
          : "fingerprint changed"
      }`
    );

    resultJob.processing_state =
      "CHANGED";

    resultJob.previous_fingerprint =
      oldFingerprint;

    resultJob.changed_at =
      now;

    resultJob.changed_fields =
      changedFields;
  } else {
    console.log(
      `  [VERIFIED] ${job.title} @ ${job.company}${
        hasPriorCanonicalFingerprint ? " (unchanged)" : " (first verification)"
      }`
    );

    resultJob.processing_state =
      "ACTIVE_VERIFIED";
  }

  return {
    job: resultJob,
    success: true,
    httpStatus: 200,
  };
}

function buildSeenEntry(
  job: SearchCardJob,
  existing: SeenJobEntry | undefined
): SeenJobEntry {
  const portal =
    getPortalForJob(job);

  return {
    ...(existing ?? {}),

    stable_id:
      job.stable_id,

    title:
      job.title,

    company:
      job.company,

    url:
      job.url,

    first_seen:
      existing?.first_seen ??
      new Date()
        .toISOString()
        .split("T")[0],

    fit:
      existing?.fit ??
      "unknown",

    status:
      existing?.status ??
      "new",

    processing_state:
      job.processing_state,

    fingerprint:
      job.fingerprint ??
      existing?.fingerprint ??
      "",

    previous_fingerprint:
      job.previous_fingerprint ??
      existing?.previous_fingerprint,

    last_verified:
      job.last_verified ??
      existing?.last_verified ??
      null,

    blocked_at:
      job.blocked_at ??
      existing?.blocked_at ??
      null,

    blocked_reason:
      job.blocked_reason ??
      existing?.blocked_reason ??
      null,

    changed_at:
      job.changed_at ??
      existing?.changed_at ??
      null,

    changed_fields:
      job.changed_fields ??
      existing?.changed_fields ??
      [],

    closed_at:
      job.closed_at ??
      existing?.closed_at ??
      null,

    portal:
      existing?.portal ??
      portal?.name ??
      "unknown",

    // Persist material detail fields from live verification
    location:
      isNonEmptyValue(job.location)
        ? job.location
        : existing?.location ?? null,
    salary:
      isNonEmptyValue(job.salary)
        ? job.salary
        : existing?.salary ?? null,
    salary_text:
      isNonEmptyValue(job.salary_text)
        ? job.salary_text
        : existing?.salary_text ?? null,
    arrangement:
      isNonEmptyValue(job.arrangement)
        ? job.arrangement
        : existing?.arrangement ?? null,
    work_mode:
      isNonEmptyValue(job.work_mode)
        ? job.work_mode
        : existing?.work_mode ?? null,
    description:
      isNonEmptyValue(job.description)
        ? job.description
        : existing?.description ?? null,

    rank_score:
      existing?.rank_score ??
      null,

    rank_verdict:
      existing?.rank_verdict ??
      null,

    rank_date:
      existing?.rank_date ??
      null,

    strengths:
      existing?.strengths ??
      [],

    gaps:
      existing?.gaps ??
      [],
  };
}

async function processBatch(
  batch: SearchCardJob[],
  batchIndex: number,
  consolidatedJobs: SearchCardJob[],
  seenJobs: Record<string, SeenJobEntry>,
  checkpoints: Checkpoints
): Promise<BatchResult> {
  console.log(
    `\n=== Processing Batch ${
      batchIndex + 1
    } (${batch.length} jobs) ===`
  );

  const results: VerificationResult[] =
    [];

  for (
    let index = 0;
    index < batch.length;
    index += CONCURRENCY
  ) {
    const chunk =
      batch.slice(
        index,
        index + CONCURRENCY
      );

    const chunkResults =
      await Promise.all(
        chunk.map((job) =>
          verifyJob(
            job,
            consolidatedJobs,
            seenJobs,
            forceRefetch
          )
        )
      );

    results.push(
      ...chunkResults
    );
  }

  let verified = 0;
  let blocked = 0;
  let changed = 0;
  let closed = 0;
  let failed = 0;

  for (const result of results) {
    if (!result.success) {
      failed++;
      continue;
    }

    const job =
      result.job;

    const existing =
      seenJobs[
        job.stable_id
      ];

    seenJobs[
      job.stable_id
    ] = buildSeenEntry(
      job,
      existing
    );

    switch (
      job.processing_state
    ) {
      case "ACTIVE_VERIFIED":
        verified++;
        break;

      case "ACTIVE_UNVERIFIED":
        blocked++;
        break;

      case "CHANGED":
        changed++;
        break;

      case "CLOSED_OR_EXPIRED":
        closed++;
        break;
    }
  }

  saveSeenJobs(
    seenJobs
  );

  const previousProcessed =
    checkpoints
      .current_checkpoint
      .jobs_processed_in_stage;

  updateCheckpoint(
    checkpoints,
    {
      stage:
        "verification",
      stage_status:
        "in_progress",
      jobs_processed_in_stage:
        Math.min(
          previousProcessed +
            batch.length,
          checkpoints
            .current_checkpoint
            .total_jobs_in_stage
        ),
      batch_index:
        batchIndex + 1,
    }
  );

  console.log(
    `Batch ${
      batchIndex + 1
    } complete: verified=${verified}, blocked=${blocked}, changed=${changed}, closed=${closed}, failed=${failed}`
  );

  return {
    processed:
      batch.length,
    verified,
    blocked,
    changed,
    closed,
    failed,
  };
}

function createInitialCheckpoints(
  totalJobs: number,
  batchSize: number
): Checkpoints {
  const now =
    new Date().toISOString();

  return {
    schema_version:
      "1.0",

    run_history: [],

    current_checkpoint: {
      run_id:
        now
          .replace(
            /[-:T]/g,
            ""
          )
          .split(".")[0],

      started_at:
        now,

      mode:
        "INCREMENTAL",

      stage:
        "verification",

      stage_status:
        "in_progress",

      jobs_processed_in_stage:
        0,

      total_jobs_in_stage:
        totalJobs,

      batch_index:
        0,

      total_batches:
        Math.ceil(
          totalJobs /
            batchSize
        ),

      last_updated:
        now,

      error:
        null,
    },

    notes:
      "Persisted checkpoints for incremental /job-scraper runs.",
  };
}

async function main(): Promise<void> {
  const args =
    process.argv.slice(2);

  const dryRun =
    args.includes(
      "--dry-run"
    );

  const allFlag =
    args.includes(
      "--all"
    );

  const repairSeenFlag =
    args.includes(
      "--repair-seen"
    );

  const batchArgIndex =
    args.indexOf(
      "--batch"
    );

  const sizeArgIndex =
    args.indexOf(
      "--size"
    );

  const requestedBatch =
    batchArgIndex >= 0
      ? Number(
          args[
            batchArgIndex + 1
          ]
        )
      : null;

  const batchSize =
    sizeArgIndex >= 0
      ? Number(
          args[
            sizeArgIndex + 1
          ]
        )
      : DEFAULT_BATCH_SIZE;

  if (
    !Number.isInteger(
      batchSize
    ) ||
    batchSize <= 0
  ) {
    throw new Error(
      "--size must be a positive integer"
    );
  }

  if (
    requestedBatch !== null &&
    (!Number.isInteger(
      requestedBatch
    ) ||
      requestedBatch < 0)
  ) {
    throw new Error(
      "--batch must be a non-negative integer"
    );
  }

  if (
    !existsSync(
      NEEDS_VERIFICATION_PATH
    )
  ) {
    throw new Error(
      `Input file not found: ${NEEDS_VERIFICATION_PATH}`
    );
  }

  if (
    !existsSync(
      CONSOLIDATED_PATH
    )
  ) {
    throw new Error(
      `Consolidated jobs file not found: ${CONSOLIDATED_PATH}`
    );
  }

  const needsVerification =
    loadJson<SearchCardJob[]>(
      NEEDS_VERIFICATION_PATH
    );

  const consolidatedJobs =
    loadJson<SearchCardJob[]>(
      CONSOLIDATED_PATH
    );

  const seenJobs =
    loadSeenJobs();

  let eligibleJobs: SearchCardJob[];
  let forceRefetch = false;

  if (repairSeenFlag) {
    // Repair mode: re-verify ACTIVE_VERIFIED jobs with empty material fields
    // This bypasses the recent-verification guard but does NOT create checkpoints
    console.log("=== REPAIR MODE: re-fetching ACTIVE_VERIFIED jobs with empty detail fields ===");
    forceRefetch = true;

    // Get all ACTIVE_VERIFIED jobs from seen_jobs that have empty location/salary/arrangement/description
    const activeVerifiedJobs = Object.values(seenJobs).filter(
      (entry) =>
        entry.processing_state === "ACTIVE_VERIFIED" &&
        (!entry.location && !entry.salary && !entry.arrangement && !entry.description)
    );

    console.log(`Found ${activeVerifiedJobs.length} ACTIVE_VERIFIED jobs with empty material fields`);

    // Convert to SearchCardJob format for verifyJob
    eligibleJobs = activeVerifiedJobs.map((entry) => ({
      id: entry.url,
      title: entry.title,
      company: entry.company,
      location: entry.location ?? "",
      salary: entry.salary ?? null,
      date: null,
      dateLabel: null,
      teaser: null,
      url: entry.url,
      source_file: "repair-seen",
      stable_id: entry.stable_id,
      processing_state: entry.processing_state,
      fingerprint: entry.fingerprint,
      last_verified: entry.last_verified,
      blocked_at: entry.blocked_at,
      blocked_reason: entry.blocked_reason,
      blocked_source: entry.blocked_source,
      changed_at: entry.changed_at,
      changed_fields: entry.changed_fields,
      closed_at: entry.closed_at,
    }));
  } else {
    // Normal mode
    const eligibleStates =
      new Set([
        "NEW",
        "CHANGED",
        "STALE",
        "NEEDS_VERIFICATION",
        "POSTING_CHANGED",
      ]);

    eligibleJobs =
      needsVerification.filter(
        (job) =>
          eligibleStates.has(
            job.processing_state
          )
      );
  }

  console.log(
    `Loaded ${needsVerification.length} jobs needing verification`
  );

  console.log(
    `Eligible for live fetch: ${eligibleJobs.length} jobs`
  );

  console.log(
    `Consolidated jobs for fallback: ${consolidatedJobs.length}`
  );

  let checkpoints =
    loadCheckpoints();

  // REPAIR MODE: Early return - process all ACTIVE_VERIFIED jobs with empty detail fields
  // without polluting normal checkpoints or respecting recent-verification guards
  if (repairSeenFlag) {
    console.log(`Repair mode: processing ${eligibleJobs.length} jobs without checkpoint pollution`);

    let totalVerified = 0;
    let totalBlocked = 0;
    let totalChanged = 0;
    let totalClosed = 0;
    let totalFailed = 0;

    // Process in batches of 5 with max 2 concurrency (same as normal) but no checkpoint writes
    for (let batchIndex = 0; batchIndex < eligibleJobs.length; batchIndex += batchSize) {
      const batch = eligibleJobs.slice(batchIndex, batchIndex + batchSize);
      if (batch.length === 0) break;

      console.log(`\n=== Repair Batch ${Math.floor(batchIndex / batchSize) + 1} (${batch.length} jobs) ===`);

      const results: VerificationResult[] = [];
      for (let index = 0; index < batch.length; index += CONCURRENCY) {
        const chunk = batch.slice(index, index + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map((job) => verifyJob(job, consolidatedJobs, seenJobs, true))
        );
        results.push(...chunkResults);
      }

      for (const result of results) {
        if (!result.success) {
          totalFailed++;
          continue;
        }
        const job = result.job;
        const existing = seenJobs[job.stable_id];
        seenJobs[job.stable_id] = buildSeenEntry(job, existing);

        switch (job.processing_state) {
          case "ACTIVE_VERIFIED": totalVerified++; break;
          case "ACTIVE_UNVERIFIED": totalBlocked++; break;
          case "CHANGED": totalChanged++; break;
          case "CLOSED_OR_EXPIRED": totalClosed++; break;
        }
      }

      // Save seen_jobs after each batch for durability
      saveSeenJobs(seenJobs);
    }

    console.log("\n=== REPAIR COMPLETE ===");
    console.log(`Re-verified (ACTIVE_VERIFIED): ${totalVerified}`);
    console.log(`Blocked 403 (ACTIVE_UNVERIFIED): ${totalBlocked}`);
    console.log(`Changed (CHANGED): ${totalChanged}`);
    console.log(`Closed/Expired (CLOSED_OR_EXPIRED): ${totalClosed}`);
    console.log(`Failed: ${totalFailed}`);

    // Quick coverage summary
    const repairedJobs = Object.values(seenJobs).filter(e => e.processing_state === "ACTIVE_VERIFIED");
    const withLocation = repairedJobs.filter(e => e.location).length;
    const withSalary = repairedJobs.filter(e => e.salary || e.salary_text).length;
    const withArrangement = repairedJobs.filter(e => e.arrangement || e.work_mode).length;
    const withDescription = repairedJobs.filter(e => e.description).length;
    console.log(`\n--- FIELD COVERAGE AFTER REPAIR ---`);
    console.log(`ACTIVE_VERIFIED total: ${repairedJobs.length}`);
    console.log(`Location: ${withLocation}/${repairedJobs.length}`);
    console.log(`Salary: ${withSalary}/${repairedJobs.length}`);
    console.log(`Arrangement: ${withArrangement}/${repairedJobs.length}`);
    console.log(`Description: ${withDescription}/${repairedJobs.length}`);

    return;
  }

  if (
    !checkpoints
  ) {
    checkpoints =
      createInitialCheckpoints(
        eligibleJobs.length,
        batchSize
      );
  }

  /**
   * Back up seen_jobs exactly once before this execution
   * can mutate it.
   */
  backupSeenJobs();

  const totalBatches =
    Math.ceil(
      eligibleJobs.length /
        batchSize
    );

  checkpoints.current_checkpoint =
    {
      ...checkpoints
        .current_checkpoint,

      total_jobs_in_stage:
        eligibleJobs.length,

      total_batches:
        totalBatches,

      stage:
        "verification",

      stage_status:
        "in_progress",
    };

  saveCheckpoints(
    checkpoints
  );

  let startBatch =
    checkpoints
      .current_checkpoint
      .batch_index;

  let endBatch =
    totalBatches;

  if (
    requestedBatch !== null
  ) {
    startBatch =
      requestedBatch;

    endBatch =
      requestedBatch + 1;
  }

  if (
    dryRun
  ) {
    startBatch = 0;
    endBatch = 1;
  } else if (
    !allFlag &&
    requestedBatch === null
  ) {
    endBatch =
      startBatch + 1;
  }

  if (
    startBatch >=
    totalBatches
  ) {
    console.log(
      "No remaining verification batches."
    );

    updateCheckpoint(
      checkpoints,
      {
        stage_status:
          "complete",
        batch_index:
          totalBatches,
      }
    );

    return;
  }

  console.log(
    `Processing batches ${startBatch} to ${
      Math.min(
        endBatch,
        totalBatches
      ) - 1
    } (size: ${batchSize})`
  );

  let totalVerified =
    0;

  let totalBlocked =
    0;

  let totalChanged =
    0;

  let totalClosed =
    0;

  let totalFailed =
    0;

  for (
    let batchIndex =
      startBatch;
    batchIndex <
      Math.min(
        endBatch,
        totalBatches
      );
    batchIndex++
  ) {
    const start =
      batchIndex *
      batchSize;

    const end =
      Math.min(
        start +
          batchSize,
        eligibleJobs.length
      );

    const batch =
      eligibleJobs.slice(
        start,
        end
      );

    if (
      batch.length === 0
    ) {
      break;
    }

    const batchResult =
      await processBatch(
        batch,
        batchIndex,
        consolidatedJobs,
        seenJobs,
        checkpoints
      );

    totalVerified +=
      batchResult.verified;

    totalBlocked +=
      batchResult.blocked;

    totalChanged +=
      batchResult.changed;

    totalClosed +=
      batchResult.closed;

    totalFailed +=
      batchResult.failed;

    if (
      dryRun
    ) {
      console.log(
        "\n--- DRY RUN COMPLETE ---"
      );
      break;
    }
  }

  const completed =
    checkpoints
      .current_checkpoint
      .batch_index >=
      totalBatches;

  if (
    completed
  ) {
    checkpoints.run_history.push(
      {
        run_id:
          checkpoints
            .current_checkpoint
            .run_id,

        started_at:
          checkpoints
            .current_checkpoint
            .started_at,

        stage:
          "verification",

        stage_status:
          "complete",

        jobs_processed_in_stage:
          eligibleJobs.length,

        total_jobs_in_stage:
          eligibleJobs.length,

        last_updated:
          new Date().toISOString(),
      }
    );

    updateCheckpoint(
      checkpoints,
      {
        stage_status:
          "complete",
        jobs_processed_in_stage:
          eligibleJobs.length,
        batch_index:
          totalBatches,
      }
    );
  }

  console.log(
    "\n=== VERIFICATION COMPLETE ==="
  );

  console.log(
    `Verified (ACTIVE_VERIFIED): ${totalVerified}`
  );

  console.log(
    `Blocked 403 (ACTIVE_UNVERIFIED): ${totalBlocked}`
  );

  console.log(
    `Changed (CHANGED): ${totalChanged}`
  );

  console.log(
    `Closed/Expired (CLOSED_OR_EXPIRED): ${totalClosed}`
  );

  console.log(
    `Failed: ${totalFailed}`
  );
}

main().catch(
  (error) => {
    console.error(
      "Verification failed:",
      error
    );

    process.exit(1);
  }
);