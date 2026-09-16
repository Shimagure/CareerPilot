/**
 * Step 5: Job Scoring — Apply evaluation framework to verified jobs
 *
 * Reads seen_jobs.json, loads job descriptions from consolidated sources,
 * evaluates eligible jobs using the 04-job-evaluation.md framework, and
 * writes scoring fields back to seen_jobs.json.
 *
 * Usage:
 *   bun run job_scraper/scripts/score_jobs.ts --dry-run
 *   bun run job_scraper/scripts/score_jobs.ts --batch 0 --size 5
 *   bun run job_scraper/scripts/score_jobs.ts --all
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

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
  rank_score: number | null;
  rank_verdict: string | null;
  rank_date: string | null;
  strengths: string[];
  gaps: string[];
  [key: string]: unknown;
}

interface ConsolidatedJob {
  stable_id: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  salary_text?: string;
  work_mode?: string;
  arrangement?: string;
  description?: string;
  url?: string;
  teaser?: string;
  [key: string]: unknown;
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

interface ScoringResult {
  rank_score: number;
  rank_verdict: string;
  strengths: string[];
  gaps: string[];
  location_pass: boolean;
}

// ============================================================================
// Paths
// ============================================================================

const ROOT = process.cwd();
const SEEN_JOBS_PATH = join(ROOT, "job_scraper", "seen_jobs.json");
const CHECKPOINTS_PATH = join(ROOT, "job_scraper", "checkpoints.json");
const CONSOLIDATED_PATH = join(ROOT, ".scrape_out", "consolidated_jobs.json");
const NEEDS_VERIFICATION_PATH = join(ROOT, ".scrape_out", "needs_verification_dedup.json");

const DEFAULT_BATCH_SIZE = 5;
const SCORING_DAYS = 5;

// ============================================================================
// Candidate profile — hardcoded from CLAUDE.md / 04-job-evaluation.md
// ============================================================================

/** Strong match keywords — primary skills */
const STRONG_SKILLS = [
  "end user computing", "euc", "tier 2", "tier ii", "l2", "level 2",
  "it support", "desktop support", "technical support",
  "service desk", "helpdesk", "help desk",
  "active directory", "microsoft 365", "m365", "office 365",
  "windows 10", "windows 11", "windows server",
  "group policy", "endpoint management", "intune",
  "remote support", "rdp", "teamviewer", "anydesk",
  "crowdstrike", "endpoint security",
  "itsm", "ticketing", "ticket management",
];

/** Moderate match keywords — transferable skills */
const MODERATE_SKILLS = [
  "powershell", "python", "scripting", "automation",
  "linux", "network", "cisco", "tcp/ip", "dns", "dhcp", "vpn",
  "html", "css", "javascript",
  "windows", "os installation", "hardware",
  "printer", "mobile device", "ios", "android",
];

/** Career advancement keywords — roles that progress toward systems/cloud/security */
const CAREER_ADVANCEMENT_KEYWORDS = [
  "systems administrator", "sysadmin", "system admin",
  "cloud", "infrastructure", "devops",
  "security", "soc", "noc", "endpoint security", "iam",
  "network administrator", "network engineer",
  "windows server", "active directory", "azure", "aws",
  "powershell", "automation", "scripting",
];

/** Roles that signal career progression */
const CAREER_PROGRESSION_TITLES = [
  "tier 2", "tier ii", "l2", "level 2",
  "senior", "lead", "specialist",
  "engineer", "administrator", "admin",
  "analyst", "operations",
];

/** Red flag keywords — customer service, sales, non-IT */
const RED_FLAG_KEYWORDS = [
  "customer service", "customer care", "call center",
  "sales", "marketing", "business development",
  "administrative assistant", "receptionist",
  "accountant", "finance", "hr", "human resources",
  "content writer", "copywriter", "graphic designer",
];

/** Location acceptance rules */
const ACCEPTABLE_LOCATIONS = [
  "remote", "work from home", "wfh",
  "metro manila", "ncr", "manila", "makati",
  "taguig", "pasig", "mandaluyong", "quezon city", "ortigas", "bgc",
  "alabang", "muntinlupa", "san juan", "pasay", "las piñas", "paranaque",
  "navotas", "malabon", "valenzuela", "marikina", "caloocan",
  "bulacan", "cavite", "rizal", "laguna",
];

const UNACCEPTABLE_LOCATIONS = [
  "cebu", "davao", "baguio", "iloilo", "bacolod",
  "cagayan", "zamboanga", "general santos", "tarlac",
  "pampanga", "clark", "la union", "dumaguete",
];

// ============================================================================
// Helpers
// ============================================================================

function loadJson<T>(path: string): T {
  const content = readFileSync(path, "utf-8").replace(/^﻿/, "");
  return JSON.parse(content) as T;
}

function loadSeenJobs(): Record<string, SeenJobEntry> {
  if (!existsSync(SEEN_JOBS_PATH)) return {};
  const parsed = loadJson<Record<string, SeenJobEntry> | { seen: Record<string, SeenJobEntry> }>(SEEN_JOBS_PATH);
  if (parsed && typeof parsed === "object" && "seen" in parsed) return parsed.seen;
  return parsed as Record<string, SeenJobEntry>;
}

function saveSeenJobs(seenJobs: Record<string, SeenJobEntry>): void {
  writeFileSync(SEEN_JOBS_PATH, JSON.stringify({ seen: seenJobs }, null, 2), "utf-8");
}

function backupSeenJobs(): void {
  if (!existsSync(SEEN_JOBS_PATH)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = SEEN_JOBS_PATH.replace(/\.json$/i, `.backup.${timestamp}.json`);
  copyFileSync(SEEN_JOBS_PATH, backupPath);
  console.log(`Created seen_jobs backup: ${backupPath}`);
}

function loadCheckpoints(): Checkpoints | null {
  if (!existsSync(CHECKPOINTS_PATH)) return null;
  return loadJson<Checkpoints>(CHECKPOINTS_PATH);
}

function saveCheckpoints(checkpoints: Checkpoints): void {
  writeFileSync(CHECKPOINTS_PATH, JSON.stringify(checkpoints, null, 2), "utf-8");
}

function updateCheckpoint(checkpoints: Checkpoints, patch: Record<string, unknown>): void {
  checkpoints.current_checkpoint = {
    ...checkpoints.current_checkpoint,
    ...patch,
    last_updated: new Date().toISOString(),
  };
  saveCheckpoints(checkpoints);
}

function loadConsolidatedJobs(): ConsolidatedJob[] {
  const jobs: ConsolidatedJob[] = [];

  if (existsSync(CONSOLIDATED_PATH)) {
    try {
      const consolidated = loadJson<ConsolidatedJob[]>(CONSOLIDATED_PATH);
      for (const job of consolidated) {
        if (job.stable_id) jobs.push(job);
      }
    } catch (e) {
      console.warn(`Failed to load consolidated_jobs.json: ${e}`);
    }
  }

  if (existsSync(NEEDS_VERIFICATION_PATH)) {
    try {
      const needsVerif = loadJson<ConsolidatedJob[]>(NEEDS_VERIFICATION_PATH);
      for (const job of needsVerif) {
        if (job.stable_id && !jobs.some(j => j.stable_id === job.stable_id)) {
          jobs.push(job);
        }
      }
    } catch (e) {
      console.warn(`Failed to load needs_verification_dedup.json: ${e}`);
    }
  }

  return jobs;
}

// ============================================================================
// Scoring logic — based on 04-job-evaluation.md
// ============================================================================

function textHasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function countKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw)).length;
}

function normalizeLocation(loc: string | undefined): string {
  if (!loc) return "unknown";
  return loc.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeArrangement(job: ConsolidatedJob): string {
  const raw = (job.work_mode || job.arrangement || "").toLowerCase();
  if (raw.includes("remote") || raw.includes("work from home") || raw.includes("wfh")) return "remote";
  if (raw.includes("hybrid")) return "hybrid";
  if (raw.includes("onsite") || raw.includes("on site") || raw.includes("office")) return "onsite";
  // Check location for hints
  const loc = normalizeLocation(job.location);
  if (loc.includes("remote")) return "remote";
  return "unknown";
}

function parseSalaryMonthly(salaryStr: string | undefined): number | null {
  if (!salaryStr) return null;
  const s = salaryStr.toLowerCase();

  // Handle "per year" / "per annum"
  if (s.includes("year") || s.includes("annum")) {
    const match = s.match(/(\d[\d,]*(?:\.\d+)?)\s*k?/);
    if (match) {
      let val = parseFloat(match[1].replace(/,/g, ""));
      if (s.includes("k")) val *= 1000;
      return val / 12;
    }
  }

  // Handle "per month" / "a month" / "monthly"
  if (s.includes("month")) {
    const match = s.match(/(\d[\d,]*(?:\.\d+)?)\s*k?/);
    if (match) {
      let val = parseFloat(match[1].replace(/,/g, ""));
      if (s.includes("k")) val *= 1000;
      return val;
    }
  }

  // Range: "30,000 - 40,000"
  const numbers = s.match(/(\d[\d,]*)/g);
  if (numbers && numbers.length >= 2) {
    const vals = numbers.map(n => parseFloat(n.replace(/,/g, "")));
    const maxVal = Math.max(...vals);
    if (maxVal < 200000) return (vals[0] + vals[1]) / 2; // monthly
    return maxVal / 12; // yearly
  }

  // Single number
  if (numbers && numbers.length === 1) {
    const val = parseFloat(numbers[0].replace(/,/g, ""));
    if (val < 200000) return val;
    return val / 12;
  }

  return null;
}

function scoreTechnicalSkills(title: string, description: string, teaser: string): { score: number; matches: string[] } {
  const text = `${title} ${description} ${teaser}`;
  const strongCount = countKeywords(text, STRONG_SKILLS);
  const moderateCount = countKeywords(text, MODERATE_SKILLS);

  // Strong matches: 0-80 scale based on keyword density
  let score = Math.min(80, strongCount * 15);
  // Moderate matches add up to 20 points
  score += Math.min(20, moderateCount * 5);

  const matches: string[] = [];
  for (const kw of STRONG_SKILLS) {
    if (text.toLowerCase().includes(kw) && !matches.includes(kw)) {
      matches.push(kw);
    }
  }

  return { score: Math.min(100, score), matches: matches.slice(0, 8) };
}

function scoreExperienceMatch(title: string, description: string, teaser: string): { score: number; notes: string[] } {
  const text = `${title} ${description} ${teaser}`.toLowerCase();
  const notes: string[] = [];

  // Check for experience requirements
  const yearMatch = text.match(/(\d+)\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)/);
  const yearsRequired = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Wilson has 3+ years enterprise IT support
  let score = 50; // base

  if (yearsRequired !== null) {
    if (yearsRequired <= 1) { score += 30; notes.push(`${yearsRequired}yr requirement — well within range`); }
    else if (yearsRequired <= 3) { score += 25; notes.push(`${yearsRequired}yr requirement — meets requirement`); }
    else if (yearsRequired <= 5) { score += 10; notes.push(`${yearsRequired}yr requirement — close but slightly above`); }
    else { score -= 10; notes.push(`${yearsRequired}yr requirement — exceeds current experience`); }
  }

  // Enterprise environment signals
  const enterpriseSignals = ["enterprise", "corporate", "organization", "company-wide", "managed services", "bpo"];
  if (enterpriseSignals.some(s => text.includes(s))) {
    score += 15;
    notes.push("Enterprise/corporate environment — matches background");
  }

  // Tier 2 signals
  if (text.includes("tier 2") || text.includes("tier ii") || text.includes("l2") || text.includes("level 2")) {
    score += 15;
    notes.push("Tier 2 role — strong alignment");
  } else if (text.includes("tier 1") || text.includes("l1") || text.includes("level 1")) {
    score += 5;
    notes.push("Tier 1 role — below target but transferable");
  }

  // AD/M365 signals
  if (text.includes("active directory") || text.includes("microsoft 365") || text.includes("m365")) {
    score += 10;
    notes.push("Active Directory/M365 — core skill");
  }

  return { score: Math.min(100, score), notes: notes.slice(0, 4) };
}

function scoreBehavioralFit(title: string, description: string, teaser: string): { score: number; notes: string[] } {
  const text = `${title} ${description} ${teaser}`.toLowerCase();
  const notes: string[] = [];

  let score = 60; // baseline — most IT support roles require similar soft skills

  // Positive behavioral signals
  const positiveSignals = [
    "documentation", "knowledge base", "troubleshoot", "escalat",
    "communication", "customer service", "end user", "support",
    "ticketing", "incident", "problem management",
  ];
  const positiveCount = positiveSignals.filter(s => text.includes(s)).length;
  score += Math.min(20, positiveCount * 5);
  if (positiveCount >= 3) notes.push("Strong behavioral alignment — documentation, escalation, support");

  // Red flags
  const redFlags = RED_FLAG_KEYWORDS.filter(kw => text.includes(kw));
  if (redFlags.length > 0) {
    score -= redFlags.length * 10;
    notes.push(`Red flag keywords: ${redFlags.slice(0, 2).join(", ")}`);
  }

  return { score: Math.max(0, Math.min(100, score)), notes: notes.slice(0, 3) };
}

function scoreCareerAlignment(
  title: string,
  description: string,
  teaser: string,
  salaryMonthly: number | null,
  arrangement: string
): { score: number; notes: string[] } {
  const text = `${title} ${description} ${teaser}`.toLowerCase();
  const notes: string[] = [];

  let score = 40; // base

  // Career advancement keywords
  const advancementHits = CAREER_ADVANCEMENT_KEYWORDS.filter(kw => text.includes(kw));
  score += Math.min(25, advancementHits.length * 8);
  if (advancementHits.length >= 3) notes.push(`Strong career progression signals: ${advancementHits.slice(0, 3).join(", ")}`);

  // Title progression signals
  const titleLower = title.toLowerCase();
  const hasProgressionTitle = CAREER_PROGRESSION_TITLES.some(kw => titleLower.includes(kw));
  if (hasProgressionTitle) {
    score += 15;
    notes.push("Title suggests career progression");
  }

  // Salary incentive
  if (salaryMonthly !== null) {
    if (salaryMonthly >= 45000) { score += 10; notes.push(`Above-target salary: ₱${salaryMonthly.toLocaleString()}/mo`); }
    else if (salaryMonthly >= 35000) { score += 5; notes.push(`Competitive salary: ₱${salaryMonthly.toLocaleString()}/mo`); }
  }

  // Remote/hybrid preference
  if (arrangement === "remote") {
    score += 10;
    notes.push("Remote — preferred arrangement");
  } else if (arrangement === "hybrid") {
    score += 5;
    notes.push("Hybrid — acceptable");
  }

  return { score: Math.max(0, Math.min(100, score)), notes: notes.slice(0, 4) };
}

function checkLocationPass(job: ConsolidatedJob): { pass: boolean; reason: string } {
  const loc = normalizeLocation(job.location);
  const arrangement = normalizeArrangement(job);

  // Remote is always a pass
  if (arrangement === "remote" || loc.includes("remote")) {
    return { pass: true, reason: "Remote work — preferred" };
  }

  // Check unacceptable locations
  for (const u of UNACCEPTABLE_LOCATIONS) {
    if (loc.includes(u) && !loc.includes("metro") && !loc.includes("ncr")) {
      return { pass: false, reason: `Location outside acceptable area: ${u}` };
    }
  }

  // Check acceptable locations
  for (const a of ACCEPTABLE_LOCATIONS) {
    if (loc.includes(a)) {
      return { pass: true, reason: `Location acceptable: ${a}` };
    }
  }

  // Hybrid/onsite in unknown location — flag but don't auto-fail
  if (arrangement === "hybrid" || arrangement === "onsite") {
    return { pass: true, reason: "Location unverified — flag for review" };
  }

  return { pass: true, reason: "Location not specified — proceed with caution" };
}

function computeScore(job: ConsolidatedJob, seenEntry: SeenJobEntry): ScoringResult {
  const title = job.title || seenEntry.title || "";
  const description = job.description || "";
  const teaser = job.teaser || "";
  const salary = job.salary || job.salary_text || "";

  const technical = scoreTechnicalSkills(title, description, teaser);
  const experience = scoreExperienceMatch(title, description, teaser);
  const behavioral = scoreBehavioralFit(title, description, teaser);
  const salaryMonthly = parseSalaryMonthly(salary);
  const arrangement = normalizeArrangement(job);
  const career = scoreCareerAlignment(title, description, teaser, salaryMonthly, arrangement);
  const location = checkLocationPass(job);

  // Weighted average: Technical 30%, Experience 25%, Behavioral 15%, Career 30%
  const weightedScore = (
    technical.score * 0.30 +
    experience.score * 0.25 +
    behavioral.score * 0.15 +
    career.score * 0.30
  );

  // Round to nearest integer
  const rank_score = Math.round(weightedScore);

  // Determine verdict
  let rank_verdict: string;
  if (rank_score >= 75) rank_verdict = "Strong Fit";
  else if (rank_score >= 60) rank_verdict = "Good Fit";
  else if (rank_score >= 45) rank_verdict = "Moderate Fit";
  else if (rank_score >= 30) rank_verdict = "Weak Fit";
  else rank_verdict = "Poor Fit";

  // Collect strengths and gaps
  const strengths: string[] = [];
  const gaps: string[] = [];

  if (technical.matches.length > 0) strengths.push(`Technical match: ${technical.matches.slice(0, 4).join(", ")}`);
  if (experience.notes.length > 0) strengths.push(...experience.notes.filter(n => n.includes("meets") || n.includes("within") || n.includes("alignment")));
  if (career.notes.length > 0) strengths.push(...career.notes.filter(n => n.includes("Strong") || n.includes("progression") || n.includes("preferred")));
  if (location.pass) strengths.push(location.reason);

  if (technical.score < 50) gaps.push("Technical skills partially aligned — upskilling needed");
  if (experience.notes.some(n => n.includes("exceeds"))) gaps.push(...experience.notes.filter(n => n.includes("exceeds")));
  if (!location.pass) gaps.push(location.reason);
  if (behavioral.notes.some(n => n.includes("Red flag"))) gaps.push(...behavioral.notes.filter(n => n.includes("Red flag")));
  if (career.score < 50) gaps.push("Limited career progression signals");

  // Limit lengths
  const maxStrengths = 5;
  const maxGaps = 3;

  return {
    rank_score,
    rank_verdict,
    strengths: strengths.slice(0, maxStrengths),
    gaps: gaps.slice(0, maxGaps),
    location_pass: location.pass,
  };
}

// ============================================================================
// Eligibility check
// ============================================================================

function needsScoring(entry: SeenJobEntry): boolean {
  // Exclude permanently inactive
  if (entry.processing_state === "CLOSED_OR_EXPIRED") return false;
  if (entry.processing_state === "DUPLICATE_OR_INVALID") return false;

  // ACTIVE_UNVERIFIED — preserve existing score, don't re-score
  if (entry.processing_state === "ACTIVE_UNVERIFIED") return false;

  // ACTIVE_VERIFIED with existing recent score — skip
  if (entry.processing_state === "ACTIVE_VERIFIED" && entry.rank_score !== null && entry.rank_date) {
    const rankDate = new Date(entry.rank_date).getTime();
    const cutoff = Date.now() - SCORING_DAYS * 24 * 60 * 60 * 1000;
    if (rankDate > cutoff) return false; // Recently scored
  }

  // ACTIVE_VERIFIED without rank_score — MUST be scored
  if (entry.processing_state === "ACTIVE_VERIFIED" && entry.rank_score === null) return true;

  // CHANGED, POSTING_CHANGED — re-score
  if (entry.processing_state === "CHANGED") return true;
  if (entry.processing_state === "POSTING_CHANGED") return true;

  // STALE — re-score after re-verification
  if (entry.processing_state === "STALE") return true;

  // NEW — first scoring
  if (entry.processing_state === "NEW") return true;
  if (entry.processing_state === "NEEDS_VERIFICATION") return true;

  return false;
}

// ============================================================================
// Batch processing
// ============================================================================

interface BatchResult {
  processed: number;
  scored: number;
  skipped: number;
  failed: number;
}

function processBatch(
  jobs: EligibleEntry[],
  batchIndex: number,
  consolidatedMap: Map<string, ConsolidatedJob>,
  seenJobs: Record<string, SeenJobEntry>,
  checkpoints: Checkpoints
): BatchResult {
  console.log(`\n=== Scoring Batch ${batchIndex + 1} (${jobs.length} jobs) ===`);

  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const { key, entry } of jobs) {
    const consolidated = consolidatedMap.get(entry.stable_id);

    if (!consolidated && !entry.title) {
      console.log(`  [SKIP] ${entry.stable_id.substring(0, 16)} — no consolidated data and no title`);
      skipped++;
      continue;
    }

    try {
      const result = computeScore(
        consolidated || {
          stable_id: entry.stable_id,
          title: entry.title,
          company: entry.company,
          url: entry.url,
        },
        entry
      );

      // Update seen_jobs entry using the original portal job ID key
      const existing = seenJobs[key];
      if (existing) {
        existing.rank_score = result.rank_score;
        existing.rank_verdict = result.rank_verdict;
        existing.rank_date = new Date().toISOString().split("T")[0];
        existing.strengths = result.strengths;
        existing.gaps = result.gaps;
        existing.status = "ranked";
        scored++;

        console.log(`  [SCORED] ${entry.title} @ ${entry.company} — ${result.rank_score}/100 (${result.rank_verdict})`);
      } else {
        console.log(`  [ERROR] ${entry.stable_id.substring(0, 16)} — not found in seen_jobs (key: ${key})`);
        failed++;
      }
    } catch (e) {
      console.error(`  [ERROR] ${entry.title} @ ${entry.company} — ${e}`);
      failed++;
    }
  }

  // Persist after batch
  saveSeenJobs(seenJobs);

  const previousProcessed = checkpoints.current_checkpoint.jobs_processed_in_stage;
  updateCheckpoint(checkpoints, {
    stage: "scoring",
    stage_status: "in_progress",
    jobs_processed_in_stage: Math.min(
      previousProcessed + jobs.length,
      checkpoints.current_checkpoint.total_jobs_in_stage
    ),
    batch_index: batchIndex + 1,
  });

  console.log(`Batch ${batchIndex + 1} complete: scored=${scored}, skipped=${skipped}, failed=${failed}`);

  return {
    processed: jobs.length,
    scored,
    skipped,
    failed,
  };
}

// ============================================================================
// Main
// ============================================================================

function createInitialCheckpoints(totalJobs: number, batchSize: number): Checkpoints {
  const now = new Date().toISOString();
  return {
    schema_version: "1.0",
    run_history: [],
    current_checkpoint: {
      run_id: now.replace(/[-:T]/g, "").split(".")[0],
      started_at: now,
      mode: "INCREMENTAL",
      stage: "scoring",
      stage_status: "in_progress",
      jobs_processed_in_stage: 0,
      total_jobs_in_stage: totalJobs,
      batch_index: 0,
      total_batches: Math.ceil(totalJobs / batchSize),
      last_updated: now,
      error: null,
    },
    notes: "Persisted checkpoints for incremental /job-scraper runs.",
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const dryRun = args.includes("--dry-run");
  const allFlag = args.includes("--all");

  const batchArgIndex = args.indexOf("--batch");
  const sizeArgIndex = args.indexOf("--size");

  const requestedBatch = batchArgIndex >= 0 ? Number(args[batchArgIndex + 1]) : null;
  const batchSize = sizeArgIndex >= 0 ? Number(args[sizeArgIndex + 1]) : DEFAULT_BATCH_SIZE;

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("--size must be a positive integer");
  }

  if (requestedBatch !== null && (!Number.isInteger(requestedBatch) || requestedBatch < 0)) {
    throw new Error("--batch must be a non-negative integer");
  }

  // Load state
  const seenJobs = loadSeenJobs();
  const consolidatedJobs = loadConsolidatedJobs();

  // Build lookup map: stable_id → consolidated job
  const consolidatedMap = new Map<string, ConsolidatedJob>();
  for (const job of consolidatedJobs) {
    if (job.stable_id) consolidatedMap.set(job.stable_id, job);
  }

  console.log(`Loaded ${Object.keys(seenJobs).length} jobs from seen_jobs.json`);
  console.log(`Loaded ${consolidatedJobs.length} consolidated jobs for descriptions`);

  // Find eligible jobs
  interface EligibleEntry {
    key: string;          // portal job ID key in seen_jobs
    entry: SeenJobEntry;  // the job entry value
  }
  const eligibleEntries: EligibleEntry[] = [];
  let skippedCount = 0;

  for (const [key, entry] of Object.entries(seenJobs)) {
    if (needsScoring(entry)) {
      eligibleEntries.push({ key, entry });
    } else {
      skippedCount++;
    }
  }

  console.log(`Eligible for scoring: ${eligibleEntries.length} jobs`);
  console.log(`Skipped (inactive/recently scored): ${skippedCount} jobs`);

  if (eligibleEntries.length === 0) {
    console.log("No jobs need scoring.");
    return;
  }

  // Set up checkpoints
  let checkpoints = loadCheckpoints();
  if (!checkpoints) {
    checkpoints = createInitialCheckpoints(eligibleEntries.length, batchSize);
  }

  // Back up seen_jobs once before mutation
  if (!dryRun) {
    backupSeenJobs();
  }

  const totalBatches = Math.ceil(eligibleEntries.length / batchSize);
  checkpoints.current_checkpoint = {
    ...checkpoints.current_checkpoint,
    total_jobs_in_stage: eligibleEntries.length,
    total_batches: totalBatches,
    stage: "scoring",
    stage_status: "in_progress",
  };
  saveCheckpoints(checkpoints);

  // Determine batch range
  let startBatch = checkpoints.current_checkpoint.batch_index;
  let endBatch = totalBatches;

  if (requestedBatch !== null) {
    startBatch = requestedBatch;
    endBatch = requestedBatch + 1;
  }

  if (dryRun) {
    startBatch = 0;
    endBatch = 1;
  } else if (!allFlag && requestedBatch === null) {
    endBatch = startBatch + 1;
  }

  if (startBatch >= totalBatches) {
    console.log("No remaining scoring batches.");
    updateCheckpoint(checkpoints, {
      stage_status: "complete",
      batch_index: totalBatches,
    });
    return;
  }

  console.log(`Processing batches ${startBatch} to ${Math.min(endBatch, totalBatches) - 1} (size: ${batchSize})`);

  let totalScored = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let batchIndex = startBatch; batchIndex < Math.min(endBatch, totalBatches); batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, eligibleEntries.length);
    const batch = eligibleEntries.slice(start, end);

    if (batch.length === 0) break;

    const batchResult = processBatch(batch, batchIndex, consolidatedMap, seenJobs, checkpoints);

    totalScored += batchResult.scored;
    totalSkipped += batchResult.skipped;
    totalFailed += batchResult.failed;

    if (dryRun) {
      console.log("\n--- DRY RUN COMPLETE ---");
      break;
    }
  }

  // Update final checkpoint
  const completed = checkpoints.current_checkpoint.batch_index >= totalBatches;
  if (completed) {
    checkpoints.run_history.push({
      run_id: checkpoints.current_checkpoint.run_id,
      started_at: checkpoints.current_checkpoint.started_at,
      stage: "scoring",
      stage_status: "complete",
      jobs_processed_in_stage: eligibleEntries.length,
      total_jobs_in_stage: eligibleEntries.length,
      last_updated: new Date().toISOString(),
    });

    updateCheckpoint(checkpoints, {
      stage_status: "complete",
      jobs_processed_in_stage: eligibleEntries.length,
      batch_index: totalBatches,
    });
  }

  console.log("\n=== SCORING COMPLETE ===");
  console.log(`Scored: ${totalScored}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Failed: ${totalFailed}`);
}

main().catch((error) => {
  console.error("Scoring failed:", error);
  process.exit(1);
});
