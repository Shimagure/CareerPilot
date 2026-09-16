/**
 * Step 6: Job Ranking & Report
 *
 * Reads seen_jobs.json, ranks all active scored jobs by score descending,
 * derives Top 10 / Top 5, performs integrity checks, and outputs a summary.
 *
 * Usage:
 *   bun run job_scraper/scripts/rank_jobs.ts
 *   bun run job_scraper/scripts/rank_jobs.ts --verbose
 *   bun run job_scraper/scripts/rank_jobs.ts --dry-run
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface SeenJobEntry {
  stable_id?: string;
  title?: string;
  company?: string;
  url?: string;
  processing_state?: string;
  portal?: string;
  rank_score?: number | null;
  rank_verdict?: string | null;
  rank_date?: string | null;
  strengths?: string[];
  gaps?: string[];
  location?: string;
  salary?: string;
  salary_text?: string;
  arrangement?: string;
  work_mode?: string;
  [key: string]: unknown;
}

interface Checkpoints {
  schema_version?: string;
  run_history: Array<Record<string, unknown>>;
  current_checkpoint: {
    run_id: string;
    started_at?: string;
    mode?: string;
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

interface RankedJob {
  key: string;
  stable_id: string;
  title: string;
  company: string;
  url: string;
  portal: string;
  processing_state: string;
  rank_score: number;
  rank_verdict: string;
  rank_date: string | null;
  strengths: string[];
  gaps: string[];
  location: string;
  salary: string;
  arrangement: string;
  rank: number;
}

interface IntegrityResult {
  canonical_count_reconciles: boolean;
  unique_stable_ids: boolean;
  score_coverage: boolean;
  verification_coverage: boolean;
  ranking_order: boolean;
  tie_handling: boolean;
  top_consistency: boolean;
  url_integrity: boolean;
  details: string[];
}

const ROOT = process.cwd();
const SEEN_JOBS_PATH = join(ROOT, "job_scraper", "seen_jobs.json");
const CHECKPOINTS_PATH = join(ROOT, "job_scraper", "checkpoints.json");

const ACTIVE_STATES = new Set([
  "ACTIVE_VERIFIED",
  "ACTIVE_UNVERIFIED",
  "NEW",
  "CHANGED",
  "POSTING_CHANGED",
]);

function loadJson<T>(path: string): T {
  const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(content) as T;
}

function loadSeenJobs(): Record<string, SeenJobEntry> {
  if (!existsSync(SEEN_JOBS_PATH)) return {};

  const parsed = loadJson<
    Record<string, SeenJobEntry> | { seen: Record<string, SeenJobEntry> }
  >(SEEN_JOBS_PATH);

  if (
    parsed &&
    typeof parsed === "object" &&
    "seen" in parsed &&
    parsed.seen &&
    typeof parsed.seen === "object"
  ) {
    return parsed.seen;
  }

  return parsed as Record<string, SeenJobEntry>;
}

function loadCheckpoints(): Checkpoints | null {
  if (!existsSync(CHECKPOINTS_PATH)) return null;
  return loadJson<Checkpoints>(CHECKPOINTS_PATH);
}

function saveCheckpoints(checkpoints: Checkpoints): void {
  writeFileSync(
    CHECKPOINTS_PATH,
    JSON.stringify(checkpoints, null, 2),
    "utf8",
  );
}

function updateCheckpoint(
  checkpoints: Checkpoints,
  updates: Partial<Checkpoints["current_checkpoint"]>,
): void {
  checkpoints.current_checkpoint = {
    ...checkpoints.current_checkpoint,
    ...updates,
    last_updated: new Date().toISOString(),
  };
  saveCheckpoints(checkpoints);
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((value): value is string => typeof value === "string");
}

function getScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildRankedJobs(
  seenJobs: Record<string, SeenJobEntry>,
): RankedJob[] {
  const jobs: RankedJob[] = [];

  for (const [key, entry] of Object.entries(seenJobs)) {
    const state = getString(entry.processing_state, "UNKNOWN");

    if (!ACTIVE_STATES.has(state)) continue;

    const score = getScore(entry.rank_score);
    if (score === null) continue;

    jobs.push({
      key,
      stable_id: getString(entry.stable_id, key),
      title: getString(entry.title, "Untitled"),
      company: getString(entry.company, "Unknown"),
      url: getString(entry.url, ""),
      portal: getString(entry.portal, "Unknown"),
      processing_state: state,
      rank_score: score,
      rank_verdict: getString(entry.rank_verdict, "Unknown"),
      rank_date:
        typeof entry.rank_date === "string" ? entry.rank_date : null,
      strengths: getStringArray(entry.strengths),
      gaps: getStringArray(entry.gaps),
      location: getString(entry.location, "Unknown"),
      salary: getString(
        entry.salary ?? entry.salary_text,
        "Undisclosed",
      ),
      arrangement: getString(
        entry.arrangement ?? entry.work_mode,
        "Unknown",
      ),
      rank: 0,
    });
  }

  jobs.sort((a, b) => {
    if (b.rank_score !== a.rank_score) {
      return b.rank_score - a.rank_score;
    }
    return a.stable_id.localeCompare(b.stable_id);
  });

  let currentRank = 1;

  for (let i = 0; i < jobs.length; i++) {
    if (
      i > 0 &&
      jobs[i].rank_score < jobs[i - 1].rank_score
    ) {
      currentRank = i + 1;
    }
    jobs[i].rank = currentRank;
  }

  return jobs;
}

function runIntegrityCheck(
  rankedJobs: RankedJob[],
  seenJobs: Record<string, SeenJobEntry>,
  top5: RankedJob[],
  top10: RankedJob[],
): IntegrityResult {
  const details: string[] = [];

  const activeCanonical = Object.values(seenJobs).filter((entry) =>
    ACTIVE_STATES.has(getString(entry.processing_state, "UNKNOWN")),
  );

  const activeScorable = activeCanonical.filter((entry) => {
    const score = getScore(entry.rank_score);
    return score !== null;
  });

  const canonicalCountReconciles =
    activeScorable.length === rankedJobs.length;

  details.push(
    canonicalCountReconciles
      ? `Canonical count reconciles: ${rankedJobs.length} active scored jobs`
      : `Canonical count mismatch: seen_jobs has ${activeScorable.length} active scorable jobs, ranked list has ${rankedJobs.length} scored jobs`,
  );

  const stableIds = rankedJobs.map((job) => job.stable_id);
  const uniqueStableIds =
    new Set(stableIds).size === stableIds.length;

  details.push(
    uniqueStableIds
      ? `Unique stable IDs: ${stableIds.length} jobs`
      : `Duplicate stable_ids detected: ${stableIds.length} jobs, ${new Set(stableIds).size} unique`,
  );

  const scoreCoverage = rankedJobs.every((job) =>
    Number.isFinite(job.rank_score),
  );

  details.push(
    scoreCoverage
      ? `Score coverage: 100% (${rankedJobs.length}/${rankedJobs.length})`
      : "Score coverage failed: invalid rank_score detected",
  );

  const verificationCoverage = rankedJobs.every((job) =>
    ACTIVE_STATES.has(job.processing_state),
  );

  details.push(
    verificationCoverage
      ? "Verification/state coverage: 100%"
      : "Verification/state coverage failed",
  );

  let rankingOrder = true;
  for (let i = 1; i < rankedJobs.length; i++) {
    if (rankedJobs[i].rank_score > rankedJobs[i - 1].rank_score) {
      rankingOrder = false;
      break;
    }
  }

  details.push(
    rankingOrder
      ? "Ranking order: descending by score"
      : "Ranking order violated: scores are not descending",
  );

  let tieHandling = true;
  for (let i = 1; i < rankedJobs.length; i++) {
    const previous = rankedJobs[i - 1];
    const current = rankedJobs[i];

    if (
      current.rank_score === previous.rank_score &&
      current.stable_id.localeCompare(previous.stable_id) < 0
    ) {
      tieHandling = false;
      break;
    }
  }

  details.push(
    tieHandling
      ? "Tie handling: deterministic by stable_id"
      : "Tie handling violated: equal-score jobs are not deterministic",
  );

  const top5Keys = new Set(top5.map((job) => job.key));
  const top10Keys = new Set(top10.map((job) => job.key));

  const top5IsSubsetOfTop10 = [...top5Keys].every((key) =>
    top10Keys.has(key),
  );

  const top10MatchesRanking = top10.every(
    (job, index) => rankedJobs[index]?.key === job.key,
  );

  const topConsistency =
    top5IsSubsetOfTop10 && top10MatchesRanking;

  details.push(
    topConsistency
      ? "Top 10/5 consistency: valid"
      : "Top 10/5 consistency violated",
  );

  // URL integrity check (permanent policy)
  const missingUrls = rankedJobs.filter((job) => !job.url || !job.url.trim());
  const urlIntegrity = missingUrls.length === 0;

  if (urlIntegrity) {
    details.push(
      `URL integrity: ${rankedJobs.length}/${rankedJobs.length} jobs have canonical URLs`
    );
  } else {
    details.push(
      `URL integrity FAILED: ${missingUrls.length} jobs missing canonical URLs — affected stable_ids: ${missingUrls.map((j) => j.stable_id).join(", ")}`
    );
  }

  return {
    canonical_count_reconciles: canonicalCountReconciles,
    unique_stable_ids: uniqueStableIds,
    score_coverage: scoreCoverage,
    verification_coverage: verificationCoverage,
    ranking_order: rankingOrder,
    tie_handling: tieHandling,
    top_consistency: topConsistency,
    url_integrity: urlIntegrity,
    details,
  };
}

function countBy(
  jobs: RankedJob[],
  selector: (job: RankedJob) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const job of jobs) {
    const key = selector(job);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function formatCounts(
  counts: Record<string, number>,
): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "None";

  return entries
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function formatUrl(url: string): string {
  return url && url.trim() ? url : "unavailable";
}

function printJob(job: RankedJob): void {
  console.log(
    `  #${job.rank} [${job.rank_score}] ${job.title} @ ${job.company} (${job.portal}) — ${job.arrangement} — ${job.salary}`,
  );
  console.log(`      URL: ${formatUrl(job.url)}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");

  const seenJobs = loadSeenJobs();
  const checkpoints = loadCheckpoints();

  const rankedJobs = buildRankedJobs(seenJobs);
  const top10 = rankedJobs.slice(0, 10);
  const top5 = rankedJobs.slice(0, 5);

  const integrity = runIntegrityCheck(
    rankedJobs,
    seenJobs,
    top5,
    top10,
  );

  const allPassed = [
    integrity.canonical_count_reconciles,
    integrity.unique_stable_ids,
    integrity.score_coverage,
    integrity.verification_coverage,
    integrity.ranking_order,
    integrity.tie_handling,
    integrity.top_consistency,
    integrity.url_integrity,
  ].every(Boolean);

  const stateCounts = countBy(
    rankedJobs,
    (job) => job.processing_state,
  );

  const verdictCounts = countBy(
    rankedJobs,
    (job) => job.rank_verdict,
  );

  const portalCounts = countBy(
    rankedJobs,
    (job) => job.portal,
  );

  const date = new Date().toISOString().split("T")[0];

  console.log(`\n=== JOB SEARCH RANKING REPORT — ${date} ===`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "INCREMENTAL"}`);
  console.log(`Total active jobs ranked: ${rankedJobs.length}`);
  console.log(`By state: ${formatCounts(stateCounts)}`);
  console.log(`By verdict: ${formatCounts(verdictCounts)}`);
  console.log(`By portal: ${formatCounts(portalCounts)}`);
  console.log("");

  console.log("=== INTEGRITY CHECK ===");
  for (const detail of integrity.details) {
    console.log(`  ${detail}`);
  }
  console.log(`All checks: ${allPassed ? "PASS" : "FAIL"}`);
  console.log("");

  console.log("=== TOP 10 ===");
  if (top10.length === 0) {
    console.log("  No scored active jobs found.");
  } else {
    for (const job of top10) printJob(job);
  }
  console.log("");

  console.log("=== TOP 5 ===");
  if (top5.length === 0) {
    console.log("  No scored active jobs found.");
  } else {
    for (const job of top5) printJob(job);
  }
  console.log("");

  if (verbose) {
    console.log("=== FULL RANKED LIST ===");

    for (const job of rankedJobs) {
      console.log(
        `  #${job.rank} [${job.rank_score}] ${job.title} @ ${job.company} (${job.portal}) — ${job.arrangement} — ${job.salary} — ${job.rank_verdict}`,
      );
      console.log(`      URL: ${formatUrl(job.url)}`);
    }

    console.log("");
  }

  if (checkpoints && !dryRun) {
    checkpoints.run_history.push({
      run_id: checkpoints.current_checkpoint.run_id,
      started_at: checkpoints.current_checkpoint.started_at,
      stage: "ranking_report",
      stage_status: "complete",
      jobs_processed_in_stage: rankedJobs.length,
      total_jobs_in_stage: rankedJobs.length,
      batch_index: 1,
      total_batches: 1,
      last_updated: new Date().toISOString(),
    });

    updateCheckpoint(checkpoints, {
      stage: "ranking_report",
      stage_status: "complete",
      jobs_processed_in_stage: rankedJobs.length,
      total_jobs_in_stage: rankedJobs.length,
      batch_index: 1,
      total_batches: 1,
      error: null,
    });
  }

  if (!allPassed) {
    console.error("\nIntegrity check failed!");
    process.exit(1);
  }

  console.log("\n=== RANKING COMPLETE ===");
}

main();
