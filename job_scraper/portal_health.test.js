const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const {
  DEFAULT_PATHS, STANDARD_DISABLE_REASON, STANDARD_COMMENT,
  classifyBlockedReason, validatePortalName, normalizePortalName,
  parseEnabledFromContent, setEnabledInContent, readSkillEnabled, writeSkillEnabled,
  resolveDbPath, dbSyncRequested, syncJobSourceEnabled,
  defaultPortalState, validateHealth, loadHealth, persistHealth,
  collectSeenJobsEvidence, syncObservations, computeWindowStatus,
  runCheck, getStatus, manualDisable, manualEnable
} = require('./portal_health.js');

const PH_JS = path.join(__dirname, 'portal_health.js');

const STD_TRUE = '  # set to false to keep this portal installed but have /scrape skip it';
const STD_FALSE = '  # Danish demo portal - ships opt-in; /setup enables it when your market is Denmark, or set true here yourself';
const NOW = '2026-09-11T12:00:00Z';

// ============================================================
// TEST HELPERS
// ============================================================

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'portal-health-test-'));
}

function skillContent(name, enabled, comment = STD_TRUE) {
  return `---\nname: ${name}\nversion: 1.0.0\ndescription: >\n  Test portal skill.\nenabled: ${enabled}${comment}\nallowed-tools: Bash(bun run .agents/skills/${name}/cli/src/cli.ts *)\n---\n\n# ${name}\nBody line to preserve byte-for-byte.\n`;
}

function makeSkillsDir(dir, specs) {
  for (const [name, enabled, comment] of specs) {
    const p = path.join(dir, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'SKILL.md'), skillContent(name, enabled, comment));
  }
  return dir;
}

function makeSeenJobs(dir, recs) {
  const fp = path.join(dir, 'seen_jobs.json');
  fs.writeFileSync(fp, JSON.stringify({ seen: recs }));
  return fp;
}

function success(id, portal, firstSeen) {
  return { id, portal, first_seen: firstSeen };
}
function blocked403(id, portal, at) {
  return { id, portal, blocked_reason: 'http_403', blocked_at: at };
}
function blockedInconclusive(id, portal, reason, at) {
  return { id, portal, blocked_reason: reason, blocked_at: at };
}

function checkOpts(dir, seenRecs, override = {}) {
  return {
    healthFile: path.join(dir, override.healthFile || 'portal_health.json'),
    seenJobsPath: makeSeenJobs(dir, seenRecs),
    skillsDir: dir,
    now: NOW,
    ...override
  };
}

// ============================================================
// 1. health schema validation
// ============================================================

test('validateHealth accepts a valid health store', () => {
  const data = {
    schema_version: '1.0',
    rolling_window_days: 7,
    disable_threshold_percent: 50,
    updated_at: null,
    portals: { 'indeed-search': defaultPortalState('indeed-search') }
  };
  const v = validateHealth(data);
  assert.strictEqual(v.ok, true, `unexpected errors: ${v.errors.join('; ')}`);
});

test('validateHealth rejects bad schema/portal fields', () => {
  const v = validateHealth({ schema_version: '9.9', rolling_window_days: 0, disable_threshold_percent: 200, portals: [] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some(e => /schema_version/.test(e)));
  assert.ok(v.errors.some(e => /rolling_window_days/.test(e)));
  assert.ok(v.errors.some(e => /disable_threshold_percent/.test(e)));
  assert.ok(v.errors.some(e => /portals/.test(e)));
});

// ============================================================
// 2. 7-day rolling window
// ============================================================

test('computeWindowStatus honors the 7-day rolling window', () => {
  const obs = [
    { evidence_id: 'old-1', observed_at: '2026-09-01T10:00:00Z', result: 'explicit_403_blocked' }, // outside window
    { evidence_id: 'old-2', observed_at: '2026-09-02T10:00:00Z', result: 'success' },              // outside window
    { evidence_id: 'new-1', observed_at: '2026-09-10T10:00:00Z', result: 'success' }               // inside window
  ];
  const cs = computeWindowStatus(obs, NOW, 7, 50);
  assert.strictEqual(cs.window.total_observed, 1, 'only in-window observations count');
  assert.strictEqual(cs.window.explicit_403_blocked, 0);
  assert.strictEqual(cs.status, 'ok');
});

// ============================================================
// 3. explicit 403 counting
// ============================================================

test('explicit 403 observations are counted toward the threshold', () => {
  const obs = [
    { evidence_id: '1', observed_at: '2026-09-10T10:00:00Z', result: 'explicit_403_blocked' },
    { evidence_id: '2', observed_at: '2026-09-10T10:00:00Z', result: 'explicit_403_blocked' },
    { evidence_id: '3', observed_at: '2026-09-10T10:00:00Z', result: 'explicit_403_blocked' },
    { evidence_id: '4', observed_at: '2026-09-10T10:00:00Z', result: 'success' }
  ];
  const cs = computeWindowStatus(obs, NOW, 7, 50);
  assert.strictEqual(cs.window.explicit_403_blocked, 3);
  assert.strictEqual(cs.window.total_observed, 4);
  assert.strictEqual(cs.status, 'blocked');
});

test('classifyBlockedReason maps explicit 403 markers only', () => {
  assert.strictEqual(classifyBlockedReason('http_403'), 'explicit_403_blocked');
  assert.strictEqual(classifyBlockedReason('403 Forbidden'), 'explicit_403_blocked');
  assert.strictEqual(classifyBlockedReason('forbidden HTTP response'), 'explicit_403_blocked');
});

// ============================================================
// 4. 429 / inconclusive exclusion
// ============================================================

test('429/rate-limit evidence is inconclusive and never counts as 403', () => {
  assert.strictEqual(classifyBlockedReason('rate limited (429)'), 'inconclusive');
  assert.strictEqual(classifyBlockedReason('429 too many requests'), 'inconclusive');
  const cs = computeWindowStatus([
    { evidence_id: '1', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' },
    { evidence_id: '2', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' },
    { evidence_id: '3', observed_at: '2026-09-10T10:00:00Z', result: 'success' }
  ], NOW, 7, 50);
  assert.strictEqual(cs.window.total_observed, 3, 'inconclusive still observed (denominator)');
  assert.strictEqual(cs.window.explicit_403_blocked, 0);
  assert.strictEqual(cs.status, 'ok');
});

// ============================================================
// 5. generic block-page exclusion
// ============================================================

test('generic block-page evidence is inconclusive, not 403 evidence', () => {
  assert.strictEqual(classifyBlockedReason('blocked_by_cloudflare'), 'inconclusive');
  assert.strictEqual(classifyBlockedReason('captcha_challenge'), 'inconclusive');
  assert.strictEqual(classifyBlockedReason('block page served'), 'inconclusive');
  const cs = computeWindowStatus([
    { evidence_id: '1', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' },
    { evidence_id: '2', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' },
    { evidence_id: '3', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' },
    { evidence_id: '4', observed_at: '2026-09-10T10:00:00Z', result: 'inconclusive' }
  ], NOW, 7, 50);
  assert.strictEqual(cs.window.explicit_403_blocked, 0, 'block pages never counted as 403');
  assert.strictEqual(cs.status, 'ok');
});

test('evidence with blocked_reason block_page does not disable via check', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const seen = {
    a1: blockedInconclusive('a1', 'indeed', 'blocked_by_cloudflare', '2026-09-10T10:00:00Z'),
    a2: blockedInconclusive('a2', 'indeed', 'blocked_by_cloudflare', '2026-09-10T10:00:00Z'),
    a3: blockedInconclusive('a3', 'indeed', 'blocked_by_cloudflare', '2026-09-10T10:00:00Z'),
    a4: blockedInconclusive('a4', 'indeed', 'blocked_by_cloudflare', '2026-09-10T10:00:00Z')
  };
  const result = runCheck(checkOpts(dir, seen));
  const entry = result.data.portals['indeed-search'];
  assert.strictEqual(entry.disabled, false, 'block pages must not auto-disable');
  assert.strictEqual(entry.status, 'ok');
  assert.strictEqual(readSkillEnabled(path.join(dir, 'indeed-search', 'SKILL.md')), true);
});

// ============================================================
// 6. >50% auto-disable
// ============================================================

test('check auto-disables a portal whose 7-day explicit-403 rate is >50%', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true], ['kalibrr-search', true]]);
  const seen = {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    b4: blocked403('b4', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z'),
    s2: success('s2', 'indeed', '2026-09-10T10:00:00Z')
  };
  const result = runCheck(checkOpts(dir, seen));
  const entry = result.data.portals['indeed-search'];
  assert.strictEqual(entry.status, 'blocked');
  assert.strictEqual(entry.disabled, true, 'auto-disable applied');
  assert.strictEqual(entry.disabled_reason, STANDARD_DISABLE_REASON);
  assert.ok(entry.disabled_at, 'disabled_at recorded');
  assert.strictEqual(readSkillEnabled(path.join(dir, 'indeed-search', 'SKILL.md')), false, 'SKILL.md enabled flipped to false');
  assert.deepStrictEqual(result.applied.map(a => a.action), ['disabled']);
});

// ============================================================
// 7. exactly 50% does NOT disable
// ============================================================

test('exactly 50% explicit-403 rate does NOT disable', () => {
  const dir = makeSkillsDir(tmpDir(), [['jobstreet-search', true]]);
  const seen = {
    b1: blocked403('b1', 'jobstreet', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'jobstreet', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'jobstreet', '2026-09-10T10:00:00Z'),
    s2: success('s2', 'jobstreet', '2026-09-10T10:00:00Z')
  };
  const result = runCheck(checkOpts(dir, seen));
  const entry = result.data.portals['jobstreet-search'];
  assert.strictEqual(entry.status, 'ok', '50% is not blocked (strictly greater required)');
  assert.strictEqual(entry.disabled, false);
  assert.strictEqual(entry.window.block_rate_percent, 50);
  assert.strictEqual(readSkillEnabled(path.join(dir, 'jobstreet-search', 'SKILL.md')), true);
});

// ============================================================
// 8. missing evidence does NOT disable
// ============================================================

test('missing evidence/insufficient data does NOT disable', () => {
  const dir = makeSkillsDir(tmpDir(), [['bossjob-search', true]]);
  const result = runCheck(checkOpts(dir, {}));
  const entry = result.data.portals['bossjob-search'];
  assert.strictEqual(entry.status, 'insufficient_evidence');
  assert.strictEqual(entry.disabled, false, 'no evidence -> no disable');
  assert.strictEqual(readSkillEnabled(path.join(dir, 'bossjob-search', 'SKILL.md')), true);
});

// ============================================================
// 9. health history update (evidence change)
// ============================================================

test('health history updates when evidence changes', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const seen1 = {
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z'),
    b1: blocked403('b1', 'indeed', '2026-09-10T11:00:00Z')
  };
  const result1 = runCheck(checkOpts(dir, seen1));
  const ids1 = result1.data.portals['indeed-search'].observations.map(o => o.evidence_id).sort();
  assert.deepStrictEqual(ids1, ['b1', 's1']);

  // b1 cleared from seen_jobs, b2 newly blocked
  const seen2 = {
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T12:00:00Z')
  };
  const result2 = runCheck(checkOpts(dir, seen2));
  const ids2 = result2.data.portals['indeed-search'].observations.map(o => o.evidence_id).sort();
  assert.deepStrictEqual(ids2, ['b2', 's1'], 'stale evidence dropped, new evidence observed');
});

// ============================================================
// 10. idempotent repeated check
// ============================================================

test('repeated check with identical evidence is a no-op (idempotent)', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const seen = {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  };
  const opts = checkOpts(dir, seen);
  const r1 = runCheck(opts);
  const snapshot = JSON.stringify(r1.data.portals['indeed-search'].observations);
  assert.strictEqual(r1.applied.length, 1, 'first run applies the disable once');
  const r2 = runCheck(opts);
  assert.strictEqual(JSON.stringify(r2.data.portals['indeed-search'].observations), snapshot, 'observations identical across runs');
  assert.strictEqual(r2.applied.length, 0, 're-running a check on an already-disabled portal applies nothing new');
  assert.strictEqual(r2.decisions[0].wouldDisable, false, 'no further disable demanded for an already-disabled portal');
  assert.strictEqual(r2.data.portals['indeed-search'].disabled, true);
});

// ============================================================
// 11/12. only the affected portal's SKILL.md changes; others byte-identical
// ============================================================

test('check edits only the affected portal; other portals byte-identical', () => {
  const dir = makeSkillsDir(tmpDir(), [
    ['indeed-search', true],
    ['kalibrr-search', true],
    ['linkedin-search', true]
  ]);
  const kalibrrPath = path.join(dir, 'kalibrr-search', 'SKILL.md');
  const linkedinPath = path.join(dir, 'linkedin-search', 'SKILL.md');
  const kalibrrBefore = fs.readFileSync(kalibrrPath, 'utf8');
  const linkedinBefore = fs.readFileSync(linkedinPath, 'utf8');
  const seen = {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z'),
    k1: success('k1', 'kalibrr', '2026-09-10T10:00:00Z'),
    l1: success('l1', 'linkedin', '2026-09-10T10:00:00Z')
  };
  runCheck(checkOpts(dir, seen));
  assert.strictEqual(readSkillEnabled(path.join(dir, 'indeed-search', 'SKILL.md')), false, 'affected portal disabled');
  assert.strictEqual(readSkillEnabled(kalibrrPath), true, 'unaffected portal unchanged');
  assert.strictEqual(readSkillEnabled(linkedinPath), true, 'unaffected portal unchanged');
  assert.strictEqual(fs.readFileSync(kalibrrPath, 'utf8'), kalibrrBefore, 'unaffected portal byte-identical');
  assert.strictEqual(fs.readFileSync(linkedinPath, 'utf8'), linkedinBefore, 'unaffected portal byte-identical');
});

// ============================================================
// 13/14. frontmatter formatting preservation
// ============================================================

test('enabled:true comment formatting preserved when auto-disabled', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const seen = {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  };
  runCheck(checkOpts(dir, seen));
  const content = fs.readFileSync(path.join(dir, 'indeed-search', 'SKILL.md'), 'utf8');
  assert.ok(content.includes(`enabled: false${STD_TRUE}`), 'comment suffix preserved identically');
  assert.ok(content.includes('Body line to preserve byte-for-byte.'), 'body preserved');
});

test('enabled:false comment formatting preserved when re-enabled', () => {
  const dir = makeSkillsDir(tmpDir(), [['jobbank-search', false, STD_FALSE]]);
  const fp = path.join(dir, 'jobbank-search', 'SKILL.md');
  manualEnable({ healthFile: path.join(dir, 'p.json'), skillsDir: dir, now: NOW }, 'jobbank-search');
  const content = fs.readFileSync(fp, 'utf8');
  assert.ok(content.includes(`enabled: true${STD_FALSE}`), 'danish-style comment suffix preserved');
  assert.ok(content.includes('# jobbank-search'), 'body preserved');
});

// ============================================================
// 15. missing enabled key handled safely
// ============================================================

test('manual enable inserts enabled:true when key is missing', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'freehire-search'), { recursive: true });
  const fp = path.join(dir, 'freehire-search', 'SKILL.md');
  const content = '---\nname: freehire-search\nversion: 1.0.0\n---\n\n# FreeHire\nBody.\n';
  fs.writeFileSync(fp, content);
  manualEnable({ healthFile: path.join(dir, 'p.json'), skillsDir: dir, now: NOW }, 'freehire-search');
  const after = fs.readFileSync(fp, 'utf8');
  assert.strictEqual(parseEnabledFromContent(after), true, 'enabled:true established');
  assert.ok(after.startsWith(`---\nenabled: true${STANDARD_COMMENT}\n`), 'inserted with project comment convention');
  assert.ok(after.endsWith('# FreeHire\nBody.\n'), 'body preserved');
});

test('file without YAML frontmatter is refused (unsafe structure)', () => {
  assert.throws(() => setEnabledInContent('# no frontmatter\njust a body\n', false), /no YAML frontmatter/);
});

test('manual disable with missing enabled key inserts enabled:false safely', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'freehire-search'), { recursive: true });
  const fp = path.join(dir, 'freehire-search', 'SKILL.md');
  fs.writeFileSync(fp, '---\nname: freehire-search\nversion: 1.0.0\n---\n\nBody.\n');
  manualDisable({ healthFile: path.join(dir, 'p.json'), skillsDir: dir, now: NOW }, 'freehire-search');
  assert.strictEqual(parseEnabledFromContent(fs.readFileSync(fp, 'utf8')), false);
});

// ============================================================
// 16. manual enable
// ============================================================

test('manual enable turns a disabled portal back on without touching observations', () => {
  const dir = makeSkillsDir(tmpDir(), [['kalibrr-search', false, STD_FALSE]]);
  const fp = path.join(dir, 'kalibrr-search', 'SKILL.md');
  const opts = checkOpts(dir, {
    b1: blocked403('b1', 'kalibrr', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'kalibrr', '2026-09-10T10:00:00Z')
  });
  runCheck(opts);
  const beforeObs = JSON.stringify(JSON.parse(fs.readFileSync(opts.healthFile, 'utf8')).portals['kalibrr-search'].observations);
  manualEnable({ healthFile: opts.healthFile, skillsDir: dir, now: NOW }, 'kalibrr-search');
  const health = JSON.parse(fs.readFileSync(opts.healthFile, 'utf8')).portals['kalibrr-search'];
  assert.strictEqual(readSkillEnabled(fp), true, 'SKILL.md enabled:true');
  assert.strictEqual(health.disabled, false);
  assert.strictEqual(health.disabled_at, null);
  assert.strictEqual(health.disabled_reason, null);
  assert.strictEqual(JSON.stringify(health.observations), beforeObs, 'health history untouched');
});

// ============================================================
// 17. manual disable
// ============================================================

test('manual disable turns a portal off with reason, observations untouched', () => {
  const dir = makeSkillsDir(tmpDir(), [['linkedin-search', true]]);
  const fp = path.join(dir, 'linkedin-search', 'SKILL.md');
  const opts = checkOpts(dir, { s1: success('s1', 'linkedin', '2026-09-10T10:00:00Z') });
  runCheck(opts);
  const beforeObs = JSON.stringify(JSON.parse(fs.readFileSync(opts.healthFile, 'utf8')).portals['linkedin-search'].observations);
  manualDisable({ healthFile: opts.healthFile, skillsDir: dir, now: NOW }, 'linkedin-search');
  const health = JSON.parse(fs.readFileSync(opts.healthFile, 'utf8')).portals['linkedin-search'];
  assert.strictEqual(readSkillEnabled(fp), false, 'SKILL.md enabled:false');
  assert.strictEqual(health.disabled, true);
  assert.strictEqual(health.disabled_reason, 'manual disable');
  assert.strictEqual(JSON.stringify(health.observations), beforeObs, 'health history untouched');
});

// ============================================================
// 18. malformed portal_health.json
// ============================================================

test('malformed health JSON fails safely nonzero', () => {
  const dir = tmpDir();
  const hf = path.join(dir, 'portal_health.json');
  fs.writeFileSync(hf, '{not valid json');
  assert.throws(() => loadHealth(hf), /malformed JSON/);
  const skills = makeSkillsDir(dir, [['indeed-search', true]]);
  const opts = { healthFile: hf, seenJobsPath: makeSeenJobs(dir, { s1: success('s1', 'indeed', '2026-09-10T10:00:00Z') }), skillsDir: skills, now: NOW };
  assert.throws(() => runCheck(opts), /malformed JSON/);
});

test('invalid health schema fails safely nonzero', () => {
  const dir = tmpDir();
  const hf = path.join(dir, 'portal_health.json');
  fs.writeFileSync(hf, JSON.stringify({ schema_version: '1.0', rolling_window_days: 7, disable_threshold_percent: 50, portals: { x: 'not-an-object' } }));
  assert.throws(() => loadHealth(hf), /Invalid portal health data/);
});

// ============================================================
// 19. invalid/missing portal skill
// ============================================================

test('invalid portal name is rejected', () => {
  assert.strictEqual(validatePortalName('../../etc/passwd'), false);
  assert.strictEqual(validatePortalName('indeed_search!'), false);
  assert.strictEqual(validatePortalName('indeed-search'), true);
});

test('manual ops on a missing portal skill fail safely nonzero', () => {
  const dir = tmpDir();
  assert.throws(() => manualDisable({ healthFile: path.join(dir, 'p.json'), skillsDir: dir, now: NOW }, 'ghost-search'), /portal skill missing/);
});

test('discoverPortals fails safely for a missing skills dir', () => {
  const { discoverPortals } = require('./portal_health.js');
  assert.throws(() => discoverPortals(path.join(tmpDir(), 'nope')), /cannot list portal skills directory/);
});

// ============================================================
// 20. atomic / persistent update behavior
// ============================================================

test('updates are persisted atomically with no leftover temp files', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const opts = checkOpts(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  });
  runCheck(opts);
  const health = JSON.parse(fs.readFileSync(opts.healthFile, 'utf8'));
  assert.strictEqual(health.portals['indeed-search'].disabled, true, 'persisted on disk');
  assert.ok(typeof health.updated_at === 'string' && health.updated_at.endsWith('Z'), 'updated_at persisted as ISO timestamp');
  const leftovers = fs.readdirSync(dir).concat(fs.readdirSync(path.join(dir, 'indeed-search')));
  assert.ok(!leftovers.some(f => f.includes('.tmp')), `temp files left behind: ${leftovers.join(', ')}`);
});

// ============================================================
// 21. no duplicate rolling observations
// ============================================================

test('no duplicate observations for the same evidence across checks', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const seen = {
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z'),
    b1: blocked403('b1', 'indeed', '2026-09-10T11:00:00Z')
  };
  const opts = checkOpts(dir, seen);
  runCheck(opts);
  runCheck(opts);
  const health = JSON.parse(fs.readFileSync(opts.healthFile, 'utf8'));
  const obs = health.portals['indeed-search'].observations;
  const ids = obs.map(o => o.evidence_id);
  assert.strictEqual(new Set(ids).size, ids.length, 'evidence_ids unique');
  assert.strictEqual(obs.length, 2, 'no duplicates accumulated');
});

test('syncObservations deduplicates by evidence_id', () => {
  const existing = [{ evidence_id: 'x', observed_at: '2026-09-10T10:00:00Z', result: 'success' }];
  const incoming = [
    { evidence_id: 'x', observed_at: '2026-09-10T10:00:00Z', result: 'success' },
    { evidence_id: 'x', observed_at: '2026-09-10T10:00:00Z', result: 'success' },
    { evidence_id: 'y', observed_at: '2026-09-10T10:00:00Z', result: 'explicit_403_blocked' }
  ];
  const merged = syncObservations(existing, incoming);
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(new Set(merged.map(o => o.evidence_id)), new Set(['x', 'y']));
});

// ============================================================
// CLI level
// ============================================================

test('CLI --help exits 0 with usage', () => {
  try {
    const out = execSync(`node "${PH_JS}" --help`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.ok(out.includes('Usage'));
    assert.ok(out.includes('check'));
  } catch (e) {
    assert.fail(`--help should exit 0, got ${e.status}`);
  }
});

test('CLI check --dry-run writes nothing and disables nothing', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const fp = path.join(dir, 'indeed-search', 'SKILL.md');
  const before = fs.readFileSync(fp, 'utf8');
  const hf = path.join(dir, 'portal_health.json');
  execSync(`node "${PH_JS}" check --health-file "${hf}" --seen-jobs "${makeSeenJobs(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  })}" --skills-dir "${dir}" --now "${NOW}" --dry-run`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), before, 'SKILL.md untouched in dry-run');
  assert.ok(!fs.existsSync(hf), 'health file not created in dry-run');
});

test('CLI check persists and disables, then CLI status reports it', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const hf = path.join(dir, 'portal_health.json');
  const sj = makeSeenJobs(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  });
  let out;
  try {
    out = execSync(`node "${PH_JS}" check --health-file "${hf}" --seen-jobs "${sj}" --skills-dir "${dir}" --now "${NOW}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    assert.fail(`check exec failed (${e.status}): ${String(e.stderr || e.message)}`);
  }
  assert.ok(out.includes('disabled'), 'log reports the disable');
  const status = getStatus({ healthFile: hf, skillsDir: dir, now: NOW });
  const row = status.rows.find(r => r.portal === 'indeed-search');
  assert.strictEqual(row.health_status, 'blocked');
  assert.strictEqual(row.disabled, true);
  assert.strictEqual(row.skill_enabled, false);
});

test('CLI unknown command exits nonzero', () => {
  try {
    execSync(`node "${PH_JS}" frobnicate`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.fail('should have exited nonzero');
  } catch (e) {
    assert.notStrictEqual(e.status, 0);
    assert.ok(e.stderr.includes('unknown command'));
  }
});

// ============================================================
// 22. CP16.6 database mirror (best-effort job_sources sync)
// ============================================================

function makeJobSourcesDb(dir, rows) {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(dir, 'careerpilot.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE job_sources (
    id TEXT PRIMARY KEY,
    name TEXT,
    display_name TEXT,
    base_url TEXT,
    domain TEXT,
    source_type TEXT,
    status TEXT,
    enabled INTEGER,
    adapter_name TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  const ins = db.prepare(`INSERT INTO job_sources (id, name, display_name, base_url, domain, source_type, status, enabled, adapter_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    ins.run(r.id, r.name, r.display_name || 'N', r.base_url || 'https://example.com/',
      r.domain || 'example.com', r.source_type || 'job_board', r.status || 'enabled',
      r.enabled ? 1 : 0, r.adapter_name, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
  }
  db.close();
  return dbPath;
}

function readRow(dbPath, name) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare(`SELECT enabled, status FROM job_sources WHERE name = ?`).get(name);
    // node:sqlite rows have a null prototype; normalize to a plain object.
    return row ? { enabled: row.enabled, status: row.status } : row;
  } finally {
    db.close();
  }
}

test('syncJobSourceEnabled auto-disable only touches enabled/status=enabled rows', () => {
  const dir = tmpDir();
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'indeed', adapter_name: 'indeed-search', enabled: true, status: 'enabled' },
    { id: '2', name: 'jobstreet', adapter_name: 'jobstreet-search', enabled: true, status: 'approved' },
    { id: '3', name: 'kalibrr', adapter_name: 'kalibrr-search', enabled: true, status: 'ready_for_review' },
    { id: '4', name: 'bossjob', adapter_name: 'bossjob-search', enabled: false, status: 'discovered' }
  ]);
  const res = syncJobSourceEnabled('indeed-search', false, { db: dbPath, guardEnabledOnly: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.changes, 1);
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 0, status: 'disabled' });
  assert.deepStrictEqual(readRow(dbPath, 'jobstreet'), { enabled: 1, status: 'approved' });
  assert.deepStrictEqual(readRow(dbPath, 'kalibrr'), { enabled: 1, status: 'ready_for_review' });
  assert.deepStrictEqual(readRow(dbPath, 'bossjob'), { enabled: 0, status: 'discovered' });
});

test('syncJobSourceEnabled manual disable then enable restores the DB row', () => {
  const dir = tmpDir();
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'indeed', adapter_name: 'indeed-search', enabled: true, status: 'enabled' }
  ]);
  const d = syncJobSourceEnabled('indeed-search', false, { db: dbPath });
  assert.strictEqual(d.ok, true);
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 0, status: 'disabled' });
  const e = syncJobSourceEnabled('indeed-search', true, { db: dbPath });
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 1, status: 'enabled' });
});

test('syncJobSourceEnabled with no matching row succeeds', () => {
  const dir = tmpDir();
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'jobstreet', adapter_name: 'jobstreet-search', enabled: true, status: 'enabled' }
  ]);
  const res = syncJobSourceEnabled('indeed-search', false, { db: dbPath, guardEnabledOnly: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.changes, 0);
});

test('syncJobSourceEnabled with a missing DB is a safe no-op', () => {
  const dir = tmpDir();
  const res = syncJobSourceEnabled('indeed-search', false, { db: path.join(dir, 'nope.db') });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'db_missing');
});

test('runCheck auto-disable syncs a matching enabled DB row and never touches others', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'indeed', adapter_name: 'indeed-search', enabled: true, status: 'enabled' },
    { id: '2', name: 'jobstreet', adapter_name: 'jobstreet-search', enabled: true, status: 'approved' }
  ]);
  const opts = checkOpts(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  }, { db: dbPath });
  const result = runCheck(opts);
  assert.strictEqual(result.applied.length, 1);
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 0, status: 'disabled' });
  assert.deepStrictEqual(readRow(dbPath, 'jobstreet'), { enabled: 1, status: 'approved' });
  const health = JSON.parse(fs.readFileSync(opts.healthFile, 'utf8'));
  assert.strictEqual(health.portals['indeed-search'].disabled, true);
});

test('runCheck succeeds when the DB is missing (best-effort mirror)', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const opts = checkOpts(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  }, { db: path.join(dir, 'missing.db') });
  const result = runCheck(opts);
  assert.strictEqual(result.applied.length, 1);
  const skill = fs.readFileSync(path.join(dir, 'indeed-search', 'SKILL.md'), 'utf8');
  assert.ok(/enabled: false/.test(skill));
});

test('manualToggle mirrors to the DB', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'indeed', adapter_name: 'indeed-search', enabled: true, status: 'enabled' }
  ]);
  const opts = { healthFile: path.join(dir, 'p.json'), skillsDir: dir, now: NOW, db: dbPath };
  manualDisable(opts, 'indeed-search');
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 0, status: 'disabled' });
  manualEnable(opts, 'indeed-search');
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 1, status: 'enabled' });
});

test('CLI check --dry-run does not write DB, SKILL.md, or health state', () => {
  const dir = makeSkillsDir(tmpDir(), [['indeed-search', true]]);
  const dbPath = makeJobSourcesDb(dir, [
    { id: '1', name: 'indeed', adapter_name: 'indeed-search', enabled: true, status: 'enabled' }
  ]);
  const fp = path.join(dir, 'indeed-search', 'SKILL.md');
  const before = fs.readFileSync(fp, 'utf8');
  const hf = path.join(dir, 'portal_health.json');
  execSync(`node "${PH_JS}" check --health-file "${hf}" --seen-jobs "${makeSeenJobs(dir, {
    b1: blocked403('b1', 'indeed', '2026-09-10T10:00:00Z'),
    b2: blocked403('b2', 'indeed', '2026-09-10T10:00:00Z'),
    b3: blocked403('b3', 'indeed', '2026-09-10T10:00:00Z'),
    s1: success('s1', 'indeed', '2026-09-10T10:00:00Z')
  })}" --skills-dir "${dir}" --now "${NOW}" --dry-run`, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PORTAL_DB_FILE: dbPath }
  });
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), before, 'SKILL.md untouched in dry-run');
  assert.ok(!fs.existsSync(hf), 'health file not created in dry-run');
  assert.deepStrictEqual(readRow(dbPath, 'indeed'), { enabled: 1, status: 'enabled' }, 'DB untouched in dry-run');
});