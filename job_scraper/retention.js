// Retention helper for 28-day active job pool
// Separate from the existing 5-day verification retry policy

const STALE_JOB_DAYS = 28;

// Active states eligible for the active pool
const ACTIVE_POOL_STATES = new Set([
  'ACTIVE_VERIFIED',
  'ACTIVE_UNVERIFIED',
  'CHANGED',
  'POSTING_CHANGED'
]);

// Get last_active_at with safe fallback chain
function getLastActiveAt(job) {
  if (!job) return null;

  // Use last_active_at if present and valid
  if (job.last_active_at && isValidISODate(job.last_active_at)) {
    return new Date(job.last_active_at);
  }

  // Fallback chain: last_verified -> blocked_at -> first_seen
  if (job.last_verified && isValidISODate(job.last_verified)) {
    return new Date(job.last_verified);
  }
  if (job.blocked_at && isValidISODate(job.blocked_at)) {
    return new Date(job.blocked_at);
  }
  if (job.first_seen && isValidISODate(job.first_seen)) {
    return new Date(job.first_seen);
  }

  return null;
}

// Validate ISO date string
function isValidISODate(dateString) {
  if (!dateString || typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

// Determine if job belongs to active pool
function isActivePool(job, applicationStableIds = new Set(), now = new Date()) {
  if (!job) return false;

  // Must be in an active state
  if (!ACTIVE_POOL_STATES.has(job.processing_state)) {
    return false;
  }

  // Get last_active_at with fallback
  const lastActive = getLastActiveAt(job);
  if (!lastActive) return false;

  // Check 28-day window
  const diffDays = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24);

  // Within retention window (inclusive at 28 days)
  if (diffDays <= STALE_JOB_DAYS) {
    return true;
  }

  // Outside window - but protect if linked to application history
  if (applicationStableIds.has(job.stable_id)) {
    return true;
  }

  return false;
}

// Get active pool statistics
function getActivePoolStats(jobs, applicationStableIds = new Set(), now = new Date()) {
  let totalJobs = 0;
  let inPool = 0;
  let stale = 0;
  let protected = 0;

  for (const job of Object.values(jobs)) {
    totalJobs++;

    // Skip non-active states entirely
    if (!ACTIVE_POOL_STATES.has(job.processing_state)) {
      continue;
    }

    const isActive = isActivePool(job, applicationStableIds, now);
    const lastActive = getLastActiveAt(job);
    const isProtected = applicationStableIds.has(job.stable_id);

    if (isActive) {
      inPool++;
      if (isProtected) protected++;
    } else {
      stale++;
      if (isProtected) protected++;
    }
  }

  return { totalJobs, inPool, stale, protected };
}

// Load application stable_ids from tracker CSV
function loadApplicationStableIds(trackerPath) {
  const fs = require('fs');
  const path = require('path');

  const fullPath = path.resolve(trackerPath);
  if (!fs.existsSync(fullPath)) {
    return new Set();
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n').slice(1); // Skip header

  const stableIds = new Set();

  // Normalize functions (must match canonicalization)
  function normalizeCompany(company) {
    return (company || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeTitle(title) {
    return (title || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  // We need to match tracker entries to canonical jobs via stable_id
  // Since tracker uses company|title, we build a lookup from seen_jobs
  // This function returns the company|title keys; actual stable_id resolution
  // happens by the caller using seen_jobs
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length >= 4) {
      const company = cols[1].trim();
      const title = cols[3].trim();
      const key = normalizeCompany(company) + '|' + normalizeTitle(title);
      stableIds.add(key);
    }
  }

  return stableIds;
}

// Resolve tracker keys to stable_ids using seen_jobs
function resolveApplicationStableIds(trackerKeys, seenJobs) {
  const stableIds = new Set();

  function normalizeCompany(company) {
    return (company || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeTitle(title) {
    return (title || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  for (const job of Object.values(seenJobs)) {
    const key = normalizeCompany(job.company) + '|' + normalizeTitle(job.title);
    if (trackerKeys.has(key)) {
      stableIds.add(job.stable_id);
    }
  }

  return stableIds;
}

// Initialize last_active_at for new jobs
function initializeLastActiveAt(job, firstSeen) {
  if (!job.last_active_at) {
    job.last_active_at = firstSeen;
  }
  return job;
}

// Update last_active_at on verification success
function updateLastActiveAtOnVerification(job) {
  job.last_active_at = new Date().toISOString();
  return job;
}

// Update last_active_at on 403 blocked (when canonical data exists)
function updateLastActiveAtOnBlocked(job) {
  job.last_active_at = new Date().toISOString();
  return job;
}

// Update last_active_at on CHANGED/POSTING_CHANGED
function updateLastActiveAtOnChanged(job) {
  job.last_active_at = new Date().toISOString();
  return job;
}

module.exports = {
  STALE_JOB_DAYS,
  ACTIVE_POOL_STATES,
  getLastActiveAt,
  isActivePool,
  getActivePoolStats,
  loadApplicationStableIds,
  resolveApplicationStableIds,
  initializeLastActiveAt,
  updateLastActiveAtOnVerification,
  updateLastActiveAtOnBlocked,
  updateLastActiveAtOnChanged
};