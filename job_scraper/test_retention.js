// Focused tests for the 28-day retention helper
const {
  STALE_JOB_DAYS,
  ACTIVE_POOL_STATES,
  getLastActiveAt,
  isActivePool,
  getActivePoolStats,
  initializeLastActiveAt,
  updateLastActiveAtOnVerification,
  updateLastActiveAtOnBlocked,
  updateLastActiveAtOnChanged
} = require('./retention');

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(val, msg) {
  if (!val) throw new Error(msg || 'expected true');
}

function assertFalse(val, msg) {
  if (val) throw new Error(msg || 'expected false');
}

// Test 1: Job active for 27 days -> active pool = true
test('Test 1: Job active for 27 days -> active pool = true', () => {
  const job = {
    stable_id: 'test1',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job));
});

// Test 2: Job exactly at 28-day cutoff -> convention: inclusive (<= 28 days)
test('Test 2: Job exactly at 28-day cutoff -> active pool = true (inclusive)', () => {
  const job = {
    stable_id: 'test2',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job));
});

// Test 3: Job older than 28 days -> active pool = false
test('Test 3: Job older than 28 days -> active pool = false', () => {
  const job = {
    stable_id: 'test3',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertFalse(isActivePool(job));
});

// Test 4: New job -> active pool = true
test('Test 4: New job -> active pool = true', () => {
  const job = {
    stable_id: 'test4',
    processing_state: 'ACTIVE_VERIFIED',
    first_seen: new Date().toISOString().split('T')[0],
    last_verified: new Date().toISOString()
  };
  assertTrue(isActivePool(job));
});

// Test 5: Missing last_active_at -> fallback to existing timestamps
test('Test 5: Missing last_active_at -> fallback to last_verified', () => {
  const job = {
    stable_id: 'test5',
    processing_state: 'ACTIVE_VERIFIED',
    last_verified: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job));
});

test('Test 5b: Missing last_active_at and last_verified -> fallback to blocked_at', () => {
  const job = {
    stable_id: 'test5b',
    processing_state: 'ACTIVE_UNVERIFIED',
    blocked_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job));
});

test('Test 5c: Missing all -> fallback to first_seen', () => {
  const job = {
    stable_id: 'test5c',
    processing_state: 'ACTIVE_VERIFIED',
    first_seen: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job));
});

// Test 6: Invalid timestamp -> safe handling
test('Test 6: Invalid timestamp -> safe handling', () => {
  const job = {
    stable_id: 'test6',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: 'not-a-date',
    last_verified: 'also-invalid',
    first_seen: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job)); // Should fall back to first_seen
});

test('Test 6b: All invalid timestamps -> false', () => {
  const job = {
    stable_id: 'test6b',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: 'not-a-date',
    last_verified: 'also-invalid',
    first_seen: 'also-invalid'
  };
  assertFalse(isActivePool(job)); // No valid timestamps
});

// Test 7: Job repeatedly appearing in search results -> last_active_at does NOT change merely from discovery
test('Test 7: Discovery alone does not update last_active_at', () => {
  const originalLastActive = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const job = {
    stable_id: 'test7',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: originalLastActive,
    last_seen: new Date().toISOString() // Discovery today
  };
  // last_active_at should still be 20 days ago, not today
  const lastActive = getLastActiveAt(job);
  assertEqual(lastActive.toISOString(), originalLastActive);
});

// Test 8: Application-linked stale job -> protected
test('Test 8: Application-linked stale job -> active pool = true (protected)', () => {
  const job = {
    stable_id: 'test8',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString() // 35 days old
  };
  const applicationStableIds = new Set(['test8']);
  assertTrue(isActivePool(job, applicationStableIds));
});

// Test 9: ACTIVE_VERIFIED verification -> last_active_at updates
test('Test 9: ACTIVE_VERIFIED verification -> last_active_at updates', () => {
  const job = {
    stable_id: 'test9',
    processing_state: 'ACTIVE_VERIFIED',
    last_active_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
  };
  const before = new Date();
  updateLastActiveAtOnVerification(job);
  const after = new Date();
  const updated = new Date(job.last_active_at);
  assertTrue(updated >= before && updated <= after);
});

// Test 10: Existing 5-day verification behavior unchanged
test('Test 10: 5-day rule states are separate from 28-day pool', () => {
  // ACTIVE_VERIFIED with last_verified 3 days ago -> should be in active pool
  const job1 = {
    stable_id: 'test10a',
    processing_state: 'ACTIVE_VERIFIED',
    last_verified: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job1));

  // ACTIVE_UNVERIFIED with blocked_at 3 days ago -> should be in active pool
  const job2 = {
    stable_id: 'test10b',
    processing_state: 'ACTIVE_UNVERIFIED',
    blocked_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  };
  assertTrue(isActivePool(job2));

  // STALE state -> should NOT be in active pool regardless of timestamps
  const job3 = {
    stable_id: 'test10c',
    processing_state: 'STALE',
    last_active_at: new Date().toISOString()
  };
  assertFalse(isActivePool(job3));

  // CLOSED_OR_EXPIRED -> should NOT be in active pool
  const job4 = {
    stable_id: 'test10d',
    processing_state: 'CLOSED_OR_EXPIRED',
    last_active_at: new Date().toISOString()
  };
  assertFalse(isActivePool(job4));
});

// Additional tests for helper functions
test('getActivePoolStats returns correct counts', () => {
  const jobs = {
    a: { stable_id: 'a', processing_state: 'ACTIVE_VERIFIED', last_active_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
    b: { stable_id: 'b', processing_state: 'ACTIVE_VERIFIED', last_active_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString() },
    c: { stable_id: 'c', processing_state: 'STALE', last_active_at: new Date().toISOString() },
    d: { stable_id: 'd', processing_state: 'ACTIVE_VERIFIED', last_active_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString() }
  };
  const appIds = new Set(['d']); // d is protected

  const stats = getActivePoolStats(jobs, appIds);
  assertEqual(stats.totalJobs, 4);
  assertEqual(stats.inPool, 2); // a + d (protected)
  assertEqual(stats.stale, 1); // b
  assertEqual(stats.protected, 1); // d
});

test('ACTIVE_POOL_STATES contains correct states', () => {
  assertTrue(ACTIVE_POOL_STATES.has('ACTIVE_VERIFIED'));
  assertTrue(ACTIVE_POOL_STATES.has('ACTIVE_UNVERIFIED'));
  assertTrue(ACTIVE_POOL_STATES.has('CHANGED'));
  assertTrue(ACTIVE_POOL_STATES.has('POSTING_CHANGED'));
  assertFalse(ACTIVE_POOL_STATES.has('STALE'));
  assertFalse(ACTIVE_POOL_STATES.has('CLOSED_OR_EXPIRED'));
  assertFalse(ACTIVE_POOL_STATES.has('NEW'));
  assertFalse(ACTIVE_POOL_STATES.has('NEEDS_VERIFICATION'));
});

test('STALE_JOB_DAYS constant is 28', () => {
  assertEqual(STALE_JOB_DAYS, 28);
});

test('initializeLastActiveAt sets field for new jobs', () => {
  const job = { stable_id: 'init1', processing_state: 'NEW', first_seen: '2026-08-01' };
  initializeLastActiveAt(job, job.first_seen);
  assertEqual(job.last_active_at, '2026-08-01');
});

test('initializeLastActiveAt does not overwrite existing', () => {
  const job = { stable_id: 'init2', processing_state: 'NEW', first_seen: '2026-08-01', last_active_at: '2026-07-15' };
  initializeLastActiveAt(job, job.first_seen);
  assertEqual(job.last_active_at, '2026-07-15');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}