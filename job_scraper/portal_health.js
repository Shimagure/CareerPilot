#!/usr/bin/env node
// CareerPilot Portal Health Automation (CP15.5)
//
// Collects portal-level access evidence, tracks a rolling 7-day health window
// per portal, and AUTOMATICALLY disables a portal (its SKILL.md `enabled: false`)
// when more than 50% of its observed portal results in the rolling window are
// explicit HTTP 403 blocks. Manual enable/disable are explicit CLI operations;
// there is NO automatic re-enable.
//
// Classification:
//   - explicit_403_blocked : an explicit HTTP 403 / Forbidden response
//   - inconclusive         : 429/rate-limit, generic block page, captcha, or any
//                            non-403 evidence — never counts as a 403
//   - success              : the portal returned a usable portal result
//   - missing              : no evidence for the portal in a run (never an
//                            observation, never in the denominator; absence of
//                            evidence must not disable the portal)
//
// The ONLY existing files this module ever modifies are the per-portal
// SKILL.md frontmatter `enabled` key (during auto/manual disable and manual
// enable) and the CP15.5-owned job_scraper/portal_health.json.

const fs = require('fs');
const path = require('path');

const DEFAULT_PATHS = {
  health: path.join(__dirname, 'portal_health.json'),
  seenJobs: path.join(__dirname, 'seen_jobs.json'),
  skillsDir: path.resolve(__dirname, '..', '.agents', 'skills'),
  // CP16.6: job_sources mirror. Default to the API's SQLite DB (backend/
  // is the process cwd for the API engine). Override with PORTAL_DB_FILE.
  db: path.join(__dirname, '..', 'backend', 'careerpilot.db')
};

const STANDARD_DISABLE_REASON = 'threshold-based 403 access blocking';
const STANDARD_COMMENT = '  # set to false to keep this portal installed but have /scrape skip it';

// ============================================================
// LOGGING
// ============================================================

function log(level, message, ctx = {}) {
  const parts = Object.entries(ctx).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`);
  console.log(`[${level}] ${message}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`);
}

// ============================================================
// FILE HELPERS
// ============================================================

function readJSON(filepath, description) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`Cannot load ${description} from ${filepath}: file not found`);
    }
    if (e instanceof SyntaxError) {
      throw new Error(`Cannot load ${description} from ${filepath}: malformed JSON (${e.message})`);
    }
    throw new Error(`Cannot load ${description} from ${filepath}: ${e.message}`);
  }
}

function saveJSONAtomic(filepath, data) {
  const tmpPath = filepath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, filepath);
}

function atomicWrite(filepath, content) {
  const tmpPath = filepath + '.tmp-' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filepath);
}

function parseTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function toMs(v) {
  if (v instanceof Date) return v.getTime();
  return parseTs(v instanceof Date ? v.toISOString() : v);
}

function toISO(v) {
  const ms = toMs(v);
  return ms == null ? null : new Date(ms).toISOString();
}

function normalizeNow(now) {
  return now == null ? new Date() : new Date(toMs(now));
}

// ============================================================
// BLOCKED-REASON CLASSIFICATION
// ============================================================

// Returns 'explicit_403_blocked' ONLY for an explicit HTTP 403 / Forbidden
// marker. 429s, rate-limits, generic block pages and captchas are INCONCLUSIVE
// and — per the CP15.5 policy reconciliation — must never count as 403 evidence.
function classifyBlockedReason(reason) {
  const r = String(reason == null ? '' : reason).toLowerCase();
  if (!r) return null;
  if (r.includes('403') || r.includes('http_403') || r.includes('forbidden')) {
    return 'explicit_403_blocked';
  }
  return 'inconclusive';
}

// ============================================================
// PORTAL NAMES / PATHS
// ============================================================

const SAFE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validatePortalName(name) {
  return typeof name === 'string' && SAFE_NAME_RE.test(name) && name.length <= 64 && !name.includes('..');
}

// seen_jobs evidence stores base names ("indeed") while SKILL dirs are named
// "indeed-search". Normalize any evidence portal to its -search SKILL name.
function normalizePortalName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return null;
  return /-search$/i.test(n) ? n : n + '-search';
}

function discoverPortals(skillsDir) {
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`cannot list portal skills directory ${skillsDir}: ${e.message}`);
  }
  const portals = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!/-search$/.test(ent.name)) continue;
    if (!validatePortalName(ent.name)) continue;
    if (!fs.existsSync(skillPathFor(skillsDir, ent.name))) continue;
    portals.push(ent.name);
  }
  return portals.sort();
}

function skillPathFor(skillsDir, portal) {
  if (!validatePortalName(portal)) {
    throw new Error(`invalid portal name "${portal}"`);
  }
  return path.join(skillsDir, portal, 'SKILL.md');
}

// ============================================================
// SKILL.md FRONTMATTER (YAML `enabled` key only)
// ============================================================

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ENABLED_LINE_RE = /^(enabled:)(\s*)(true|false)([^\r\n]*)$/m;

function makeEnabledLine(enabled, suffix = STANDARD_COMMENT) {
  return `enabled: ${enabled ? 'true' : 'false'}${suffix}`;
}

// Read the frontmatter `enabled` boolean; null when absent or no frontmatter.
function parseEnabledFromContent(content) {
  const fm = FM_RE.exec(content);
  if (!fm) return null;
  const lm = ENABLED_LINE_RE.exec(fm[1]);
  if (!lm) return null;
  return lm[3] === 'true';
}

// Change ONLY the `enabled` boolean. Preserves the existing line's comment
// suffix byte-for-byte (test: formatting preserved). When the key is missing it
// is inserted as the first frontmatter key (required for manual enable/disable
// of a portal whose SKILL.md has no enabled key). When there is no YAML
// frontmatter at all the structure is unsafe: throw (fail safely, nonzero).
function setEnabledInContent(content, enabled) {
  const fm = FM_RE.exec(content);
  if (!fm) {
    throw new Error('portal SKILL.md has no YAML frontmatter; refusing to edit (unsafe)');
  }
  const prefixLen = fm[0].indexOf('\n') + 1; // length of the opening "---\n"
  const bodyStart = fm.index + prefixLen;
  const body = fm[1];
  const lm = ENABLED_LINE_RE.exec(body);
  const boolStr = enabled ? 'true' : 'false';
  if (lm) {
    const absStart = bodyStart + lm.index;
    const absEnd = absStart + lm[0].length;
    const replacement = `${lm[1]}${lm[2]}${boolStr}${lm[4]}`;
    return content.slice(0, absStart) + replacement + content.slice(absEnd);
  }
  const line = makeEnabledLine(enabled);
  return content.slice(0, bodyStart) + line + '\n' + content.slice(bodyStart);
}

function readSkillEnabled(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`cannot read SKILL.md ${filePath}: ${e.message}`);
  }
  return parseEnabledFromContent(content);
}

// Atomic write + verify. Throws on any failure so an unsafe structure or a
// failed write never leaves a silently-half-updated file.
function writeSkillEnabled(filePath, enabled) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`cannot read SKILL.md ${filePath}: ${e.message}`);
  }
  const next = setEnabledInContent(content, enabled);
  atomicWrite(filePath, next);
  const verified = readSkillEnabled(filePath);
  if (verified !== enabled) {
    throw new Error(`SKILL.md enabled verification failed for ${filePath}: got ${verified}, want ${enabled}`);
  }
  return enabled;
}

// ============================================================
// DATABASE MIRROR (CP16.6 best-effort job_sources sync)
// ============================================================

// Resolve the SQLite DB path: options > PORTAL_DB_FILE > backend/careerpilot.db.
function resolveDbPath(options) {
  return options.db || process.env.PORTAL_DB_FILE || DEFAULT_PATHS.db;
}

// DB sync is best-effort and must never make CP15.5 fail. It only fires when a
// SQLite job_sources target was explicitly provided (library `db` option, CLI
// `--db`, or PORTAL_DB_FILE), so existing SKILL.md/health-only callers and runs
// without a DB choreograph never require — or touch — a database.
function dbSyncRequested(options) {
  return options.db != null || !!process.env.PORTAL_DB_FILE;
}

// Best-effort mirror of a portal's DB `enabled` flag so CP15.5 auto-disable and
// manual toggles keep job_sources consistent with the SKILL.md runtime gate.
// Never throws: an unavailable node:sqlite, missing DB/table, or bad row all
// degrade to a logged no-op. Auto-disable (`guardEnabledOnly`) only changes rows
// currently enabled=1/status='enabled' (never APPROVED/READY_FOR_REVIEW/DISCOVERED).
function syncJobSourceEnabled(portalName, enabled, options = {}) {
  let DatabaseSync;
  try {
    DatabaseSync = require('node:sqlite').DatabaseSync;
  } catch (e) {
    log('WARN', 'node:sqlite unavailable; skipping job_sources sync', { portal: portalName });
    return { ok: false, reason: 'sqlite_unavailable' };
  }
  if (!validatePortalName(portalName)) {
    return { ok: false, reason: 'invalid_portal_name' };
  }
  const dbPath = resolveDbPath(options);
  if (!fs.existsSync(dbPath)) {
    log('WARN', 'job_sources DB not found; skipping sync', { portal: portalName, db: dbPath });
    return { ok: false, reason: 'db_missing' };
  }
  let db;
  try {
    db = new DatabaseSync(dbPath);
  } catch (e) {
    log('WARN', 'cannot open job_sources DB; skipping sync', { portal: portalName, error: e.message });
    return { ok: false, reason: 'db_unavailable' };
  }
  try {
    const sql = enabled
      ? `UPDATE job_sources SET enabled = 1, status = 'enabled' WHERE adapter_name = ?`
      : options.guardEnabledOnly
        ? `UPDATE job_sources SET enabled = 0, status = 'disabled' WHERE adapter_name = ? AND enabled = 1 AND status = 'enabled'`
        : `UPDATE job_sources SET enabled = 0, status = 'disabled' WHERE adapter_name = ?`;
    const changes = db.prepare(sql).run(portalName).changes;
    return { ok: true, changes };
  } catch (e) {
    log('WARN', 'job_sources sync failed', { portal: portalName, error: e.message });
    return { ok: false, reason: 'sync_error' };
  } finally {
    try { db.close(); } catch (_) { /* ignore */ }
  }
}

// ============================================================
// HEALTH DATA MODEL
// ============================================================

function defaultPortalState(name) {
  return {
    name,
    observations: [],
    counts: { success: 0, explicit_403_blocked: 0, inconclusive: 0, total_observed: 0 },
    status: 'insufficient_evidence',
    window: { explicit_403_blocked: 0, success: 0, inconclusive: 0, total_observed: 0, block_rate_percent: null },
    disabled: false,
    disabled_at: null,
    disabled_reason: null
  };
}

function validateHealth(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['portal_health.json is not an object'] };
  }
  if (data.schema_version !== '1.0') errors.push(`unsupported schema_version ${JSON.stringify(data.schema_version)}`);
  if (typeof data.rolling_window_days !== 'number' || !(data.rolling_window_days >= 1)) {
    errors.push('rolling_window_days must be a positive number');
  }
  if (typeof data.disable_threshold_percent !== 'number'
      || data.disable_threshold_percent < 0
      || data.disable_threshold_percent > 100) {
    errors.push('disable_threshold_percent must be a number in [0,100]');
  }
  if (!data.portals || typeof data.portals !== 'object' || Array.isArray(data.portals)) {
    errors.push('portals must be an object');
  } else {
    for (const [name, p] of Object.entries(data.portals)) {
      if (!p || typeof p !== 'object') {
        errors.push(`portal ${name} is not an object`);
        continue;
      }
      if (p.name !== name) errors.push(`portal ${name}: name field mismatch`);
      if (!Array.isArray(p.observations)) errors.push(`portal ${name}: observations must be an array`);
      for (const o of p.observations) {
        if (!o || typeof o !== 'object' || !o.evidence_id || !['success', 'explicit_403_blocked', 'inconclusive'].includes(o.result)) {
          errors.push(`portal ${name}: malformed observation ${JSON.stringify(o)}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadHealth(filepath, { create = false } = {}) {
  let data;
  if (fs.existsSync(filepath)) {
    data = readJSON(filepath, 'portal health');
    const v = validateHealth(data);
    if (!v.ok) {
      throw new Error('Invalid portal health data: ' + v.errors.join('; '));
    }
    return data;
  }
  if (!create) {
    throw new Error(`portal health file ${filepath} not found; run \`check\` first`);
  }
  const base = { schema_version: '1.0', rolling_window_days: 7, disable_threshold_percent: 50, updated_at: null, portals: {} };
  return base;
}

function ensurePortalEntry(data, name) {
  if (!data.portals) data.portals = {};
  if (!data.portals[name]) data.portals[name] = defaultPortalState(name);
  return data.portals[name];
}

function persistHealth(filepath, data) {
  const v = validateHealth(data);
  if (!v.ok) {
    throw new Error('Refusing to persist invalid portal health data: ' + v.errors.join('; '));
  }
  saveJSONAtomic(filepath, data);
  return data;
}

// ============================================================
// EVIDENCE COLLECTION (reuses CP15.4 / pipeline artifacts)
// ============================================================

// seen_jobs.json is the pipeline artifact that carries portal-level evidence:
// a record with `blocked_reason` is an access-block event; every other record
// with a usable timestamp is a "portal returned a usable result" success event.
// CP15.4 run_history.json currently carries no per-portal evidence, so it is not
// an evidence source yet (documented in the CP15.5 report).
//
// Returns Map<normalizedPortalName, observation[]> where each observation is
// { evidence_id, observed_at, result }. Records without a parseable timestamp
// or without a portal designation are skipped (unattributable evidence).
function collectSeenJobsEvidence(seenJobsPath) {
  const data = readJSON(seenJobsPath, 'seen_jobs');
  const seen = (data && data.seen) || data || {};
  const byPortal = new Map();
  for (const [id, rec] of Object.entries(seen)) {
    if (!rec || typeof rec !== 'object') continue;
    const rawPortal = rec.portal || rec.blocked_source || null;
    const portal = normalizePortalName(rawPortal);
    if (!portal) continue;
    const ts = pickTs(rec);
    if (ts == null) continue;
    let result = 'success';
    if (rec.blocked_reason) result = classifyBlockedReason(rec.blocked_reason) || 'inconclusive';
    const evidenceId = rec.stable_id || String(id) || rec.url;
    if (!byPortal.has(portal)) byPortal.set(portal, []);
    byPortal.get(portal).push({ evidence_id: evidenceId, observed_at: ts, result });
  }
  return byPortal;
}

function pickTs(rec) {
  for (const k of ['blocked_at', 'last_verified', 'changed_at', 'first_seen']) {
    if (rec[k] != null && parseTs(rec[k]) != null) return rec[k];
  }
  return null;
}

// ============================================================
// OBSERVATION SYNC (idempotent, duplicate-free)
// ============================================================

// Align the stored observations with the current evidence: drop evidence_ids no
// longer present, append new ones. Deduplicated by evidence_id. Running this
// twice with identical evidence is a no-op (CP15.5 test: idempotent check, and
// no duplicate rolling observations).
function syncObservations(existing, incoming) {
  const presentIds = new Set();
  for (const o of incoming) {
    if (o && o.evidence_id) presentIds.add(o.evidence_id);
  }
  const seen = new Set();
  const merged = [];
  for (const o of (Array.isArray(existing) ? existing : [])) {
    if (!o || !o.evidence_id) continue;
    if (!presentIds.has(o.evidence_id)) continue; // evidence no longer present
    if (seen.has(o.evidence_id)) continue;        // de-duplicate stored
    seen.add(o.evidence_id);
    merged.push(o);
  }
  for (const o of incoming) {
    if (!o || !o.evidence_id) continue;
    if (seen.has(o.evidence_id)) continue;
    seen.add(o.evidence_id);
    merged.push({
      evidence_id: o.evidence_id,
      observed_at: toISO(o.observed_at),
      result: o.result
    });
  }
  return merged;
}

// ============================================================
// WINDOW STATUS
// ============================================================

// Rolling 7-day window. Denominator = observed portal results in the window
// (success + explicit_403_blocked + inconclusive). "More than 50% of observed
// portal results are explicit 403-blocked" is the ONLY disable trigger:
//   server: block_rate * 100 > disable_threshold_percent  (exact 50% does NOT disable)
// Missing/unavailable evidence yields total 0 -> insufficient_evidence -> no
// disable. Missing data is not failure.
function computeWindowStatus(observations, now, windowDays, thresholdPercent) {
  const nowMs = toMs(now);
  const cutoffMs = nowMs - windowDays * 86400000;
  const list = Array.isArray(observations) ? observations : [];
  let success = 0;
  let blocked = 0;
  let inconclusive = 0;
  for (const o of list) {
    if (!o) continue;
    const ms = toMs(o.observed_at);
    if (ms == null || ms < cutoffMs || ms > nowMs) continue;
    if (o.result === 'explicit_403_blocked') blocked += 1;
    else if (o.result === 'success') success += 1;
    else if (o.result === 'inconclusive') inconclusive += 1;
  }
  const total = success + blocked + inconclusive;
  let status;
  if (total === 0) status = 'insufficient_evidence';
  else if (blocked / total * 100 > thresholdPercent) status = 'blocked';
  else status = 'ok';
  const rate = total > 0 ? Math.round(blocked / total * 10000) / 100 : null;
  return {
    status,
    window: { explicit_403_blocked: blocked, success, inconclusive, total_observed: total, block_rate_percent: rate },
    counts: { success, explicit_403_blocked: blocked, inconclusive, total_observed: total }
  };
}

// ============================================================
// CHECK (ingest + evaluate + AUTO-DISABLE)
// ============================================================

// Applies auto-disable per portal in-memory. Returns decisions array. SKILL.md
// writes for all blocked portals are made transactionally (transform all first —
// any unsafe structure aborts before a single write) then applied atomically.
function planCheckSummary(data, portals, evidence, now, skillsDir) {
  const decisions = [];
  const edits = []; // {filePath, enabled, portal}
  for (const portal of portals) {
    const entry = ensurePortalEntry(data, portal);
    entry.observations = syncObservations(entry.observations, evidence.get(portal) || []);
    const cs = computeWindowStatus(entry.observations, now, data.rolling_window_days, data.disable_threshold_percent);
    entry.window = cs.window;
    entry.counts = cs.counts;
    entry.status = cs.status;
    if (cs.status === 'blocked' && !entry.disabled) {
      edits.push({ filePath: skillPathFor(skillsDir, portal), enabled: false, portal });
      decisions.push({ portal, action: 'blocked', wouldDisable: true });
    } else {
      decisions.push({ portal, action: cs.status, wouldDisable: false });
    }
  }
  return { decisions, edits };
}

function resolveSkillsDir(options) {
  return options.skillsDir || process.env.PORTAL_SKILL_DIR || DEFAULT_PATHS.skillsDir;
}

function runCheck(options = {}) {
  const healthFile = options.healthFile || process.env.PORTAL_HEALTH_FILE || DEFAULT_PATHS.health;
  const seenJobsPath = options.seenJobsPath || process.env.PORTAL_SEEN_JOBS || DEFAULT_PATHS.seenJobs;
  const skillsDir = resolveSkillsDir(options);
  const now = normalizeNow(options.now);
  const dryRun = options.dryRun === true;

  const data = loadHealth(healthFile, { create: true });
  if (data.schema_version !== '1.0') data.schema_version = '1.0';
  const portals = discoverPortals(skillsDir);
  if (portals.length === 0) {
    throw new Error(`no -search portal skills found in ${skillsDir}`);
  }
  const evidence = collectSeenJobsEvidence(seenJobsPath);
  const { decisions, edits } = planCheckSummary(data, portals, evidence, now, skillsDir);

  const skips = new Set();
  if (dryRun) {
    skips.add('persist');
    skips.add('skillWrites');
  }

  const applied = [];
  if (!skips.has('skillWrites')) {
    if (edits.length > 0) {
      // Transactional: transform each file first; any unsafe structure aborts with
      // no writes at all, then apply all writes atomically.
      const prepared = edits.map(e => {
        let content;
        try {
          content = fs.readFileSync(e.filePath, 'utf8');
        } catch (err) {
          throw new Error(`cannot read SKILL.md ${e.filePath}: ${err.message}`);
        }
        return { ...e, next: setEnabledInContent(content, e.enabled) };
      });
      for (const p of prepared) {
        atomicWrite(p.filePath, p.next);
        const verified = readSkillEnabled(p.filePath);
        if (verified !== p.enabled) {
          throw new Error(`SKILL.md enabled verification failed for ${p.filePath} (auto-disable)`);
        }
      }
      const nowIso = toISO(now);
      for (const p of prepared) {
        const entry = data.portals[p.portal];
        entry.disabled = true;
        entry.disabled_at = nowIso;
        entry.disabled_reason = STANDARD_DISABLE_REASON;
        applied.push({ portal: p.portal, action: 'disabled' });
        if (dbSyncRequested(options)) {
          syncJobSourceEnabled(p.portal, false, { ...options, guardEnabledOnly: true });
        }
        log('INFO', `portal disabled by 403 threshold`, { portal: p.portal, reason: STANDARD_DISABLE_REASON });
      }
    }
  }

  data.updated_at = toISO(now);
  if (!skips.has('persist')) persistHealth(healthFile, data);

  return {
    data,
    decisions,
    applied,
    updated_at: data.updated_at,
    dryRun,
    skillWritesApplied: applied.length
  };
}

// ============================================================
// STATUS (read-only)
// ============================================================

function getStatus(options = {}) {
  const healthFile = options.healthFile || process.env.PORTAL_HEALTH_FILE || DEFAULT_PATHS.health;
  const skillsDir = resolveSkillsDir(options);
  const now = normalizeNow(options.now);
  const data = loadHealth(healthFile, { create: false });
  const skillNames = discoverPortals(skillsDir);
  const rows = [];
  for (const name of Object.keys(data.portals)) {
    const entry = data.portals[name];
    const cs = computeWindowStatus(entry.observations, now, data.rolling_window_days, data.disable_threshold_percent);
    const hasSkill = skillNames.includes(name);
    let skillEnabled = null;
    if (hasSkill) {
      try {
        skillEnabled = readSkillEnabled(skillPathFor(skillsDir, name));
      } catch (e) {
        skillEnabled = null;
      }
    }
    rows.push({
      portal: name,
      health_status: cs.status,
      window: cs.window,
      disabled: entry.disabled === true,
      disabled_at: entry.disabled_at,
      disabled_reason: entry.disabled_reason,
      skill_enabled: skillEnabled,
      skill_present: hasSkill
    });
  }
  return { rows, updated_at: data.updated_at, now: toISO(now) };
}

// ============================================================
// MANUAL ENABLE / DISABLE
// ============================================================

// Manual ops modify ONLY the target portal's SKILL.md `enabled` key and the
// CP15.5-owned portal_health.json disabled-state fields. Health history
// (observations) is never altered by enable/disable. No automatic re-enable.
function manualDisable(options = {}, portal) {
  return manualToggle(options, portal, false, 'manual disable');
}

function manualEnable(options = {}, portal) {
  return manualToggle(options, portal, true, 'manual enable');
}

function manualToggle(options, portal, enabled, op) {
  if (!validatePortalName(portal)) {
    throw new Error(`invalid portal name "${portal}"`);
  }
  const healthFile = options.healthFile || process.env.PORTAL_HEALTH_FILE || DEFAULT_PATHS.health;
  const skillsDir = resolveSkillsDir(options);
  const now = normalizeNow(options.now);

  const filePath = skillPathFor(skillsDir, portal);
  if (!fs.existsSync(filePath)) {
    throw new Error(`portal skill missing: ${filePath}`);
  }
  writeSkillEnabled(filePath, enabled);

  const data = loadHealth(healthFile, { create: true });
  ensurePortalEntry(data, portal);
  const entry = data.portals[portal];
  entry.disabled = !enabled;
  entry.disabled_at = enabled ? null : toISO(now);
  entry.disabled_reason = enabled ? null : op;
  // Recompute derived status from existing observations without touching them.
  const cs = computeWindowStatus(entry.observations, now, data.rolling_window_days, data.disable_threshold_percent);
  entry.window = cs.window;
  entry.counts = cs.counts;
  entry.status = cs.status;
  data.updated_at = toISO(now);
  persistHealth(healthFile, data);

  if (dbSyncRequested(options)) {
    syncJobSourceEnabled(portal, enabled, options);
  }

  log('INFO', `portal ${op}`, { portal, enabled });
  return { portal, enabled, filePath, health: entry };
}

// ============================================================
// CLI
// ============================================================

const CLI_HELP = `Usage: node job_scraper/portal_health.js <command> [options]

Commands:
  check                   Ingest evidence, evaluate the rolling 7-day window,
                          and auto-disable any portal whose explicit-403 block
                          rate is > ${50}% (strictly). Persists portal_health.json.
  status                  Read-only: show per-portal health window + current
                          SKILL.md enabled state. Writes nothing.
  disable <portal>        Manual: set the portal's SKILL.md enabled:false.
  enable <portal>         Manual: set the portal's SKILL.md enabled:true. No
                          automatic re-enable exists.
  --help, -h              Show this help. Exit 0.

Options (defaults in parentheses):
  --health-file <path>    portal_health.json path (job_scraper/portal_health.json)
  --seen-jobs <path>      seen_jobs.json evidence path (job_scraper/seen_jobs.json)
  --skills-dir <path>     .agents/skills directory (env PORTAL_SKILL_DIR)
  --now <ISO>             override the evaluation clock (tests)
  --db <path>             SQLite job_sources mirror (env PORTAL_DB_FILE; default
                          backend/careerpilot.db). When provided, auto/manual
                          enable-disable writes through to matching rows.
                          Best-effort: a missing SQLite DB/table never fails a run.
  --dry-run               check only: compute + print, write nothing, edit nothing

Rules:
  - Only an EXplicit HTTP 403 counts toward the disable threshold. 429s, generic
    block pages and captchas are inconclusive and never count as 403s.
  - Missing data is not failure: insufficient evidence never disables.
  - Auto-disable edits ONLY the affected portal's SKILL.md \`enabled\` key.
  - Safe failure: malformed health data, missing files, invalid portal names and
    unsafe SKILL.md structures exit non-zero without writing.`;

function parseArgs(argv) {
  const options = { skillsDir: null, seenJobsPath: null, healthFile: null, now: null, dryRun: false, db: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skills-dir') options.skillsDir = argv[++i];
    else if (arg === '--seen-jobs') options.seenJobsPath = argv[++i];
    else if (arg === '--health-file') options.healthFile = argv[++i];
    else if (arg === '--now') options.now = argv[++i];
    else if (arg === '--db') options.db = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') { console.log(CLI_HELP); process.exit(0); }
    else if (arg.startsWith('-')) {
      console.error(`Error: unknown option "${arg}". Use --help for usage.`);
      process.exit(1);
    } else positional.push(arg);
  }
  return { options, positional };
}

function formatStatus(status) {
  const lines = [`PORTAL HEALTH STATUS — ${status.now}`];
  for (const r of status.rows) {
    const rate = r.window.block_rate_percent != null ? `${r.window.block_rate_percent}%` : 'n/a';
    lines.push(
      `- ${r.portal}: health=${r.health_status} | observed=${r.window.total_observed} ` +
      `| 403=${r.window.explicit_403_blocked} | rate=${rate} ` +
      `| disabled=${r.disabled}${r.disabled_reason ? ` (${r.disabled_reason})` : ''} ` +
      `| skill_enabled=${r.skill_enabled == null ? 'unknown' : r.skill_enabled}${r.skill_present ? '' : ' (missing SKILL)'}`
    );
  }
  return lines.join('\n');
}

function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd) {
    console.error('Error: missing command. Use --help for usage.');
    process.exit(1);
  }
  if (cmd === 'status') {
    const status = getStatus(options);
    console.log(formatStatus(status));
    return;
  }
  if (cmd === 'check') {
    const result = runCheck(options);
    for (const d of result.decisions) {
      log('INFO', `portal ${d.portal}: status=${d.action}${d.wouldDisable ? ' (would disable: 403 rate > 50%)' : ''}`);
    }
    log('INFO', `check complete`, {
      dry_run: result.dryRun ? 'true' : 'false',
      skill_writes: result.skillWritesApplied,
      updated_at: result.updated_at
    });
    return;
  }
  if (cmd === 'disable' || cmd === 'enable') {
    const portal = positional[1];
    if (!portal) {
      console.error(`Error: missing portal name for ${cmd}. Usage: portal_health.js ${cmd} <portal>`);
      process.exit(1);
    }
    const result = cmd === 'disable'
      ? manualDisable(options, portal)
      : manualEnable(options, portal);
    console.log(`${cmd === 'disable' ? 'DISABLED' : 'ENABLED'} ${result.portal} (${result.health.status}, observed=${result.health.window.total_observed}, 403-rate=${result.health.window.block_rate_percent})`);
    return;
  }
  console.error(`Error: unknown command "${cmd}". Use --help for usage.`);
  process.exit(1);
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_PATHS,
  STANDARD_DISABLE_REASON,
  STANDARD_COMMENT,
  log,
  readJSON,
  saveJSONAtomic,
  atomicWrite,
  parseTs,
  toMs,
  toISO,
  normalizeNow,
  classifyBlockedReason,
  validatePortalName,
  normalizePortalName,
  discoverPortals,
  skillPathFor,
  makeEnabledLine,
  parseEnabledFromContent,
  setEnabledInContent,
  readSkillEnabled,
  writeSkillEnabled,
  resolveDbPath,
  dbSyncRequested,
  syncJobSourceEnabled,
  defaultPortalState,
  validateHealth,
  loadHealth,
  ensurePortalEntry,
  persistHealth,
  collectSeenJobsEvidence,
  pickTs,
  syncObservations,
  computeWindowStatus,
  planCheckSummary,
  runCheck,
  getStatus,
  manualDisable,
  manualEnable,
  parseArgs,
  formatStatus,
  main,
  CLI_HELP
};