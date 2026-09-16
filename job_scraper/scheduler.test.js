const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// TEST HELPERS
// ============================================================

const SCHEDULER_JS = path.join(__dirname, 'scheduler.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'schedules.json'), 'utf8'));
}

function run(args, cwd, env) {
  try {
    const result = execSync(`node "${SCHEDULER_JS}" ${args}`, {
      cwd: cwd || __dirname,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    return { stdout: result, exitCode: 0 };
  } catch (e) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status || 1
    };
  }
}

// ============================================================
// VALID SCHEDULE DEFINITIONS
// ============================================================

test('valid schedule definitions load', () => {
  const config = loadFixture();
  assert.ok(config.schema_version, 'has schema_version');
  assert.ok(config.schedules, 'has schedules');
  for (const [name, schedule] of Object.entries(config.schedules)) {
    assert.ok(schedule.name, `${name} has name`);
    assert.ok(schedule.cron, `${name} has cron`);
    assert.strictEqual(typeof schedule.recurring, 'boolean', `${name} has recurring`);
    assert.strictEqual(typeof schedule.enabled, 'boolean', `${name} has enabled`);
    assert.ok(schedule.description, `${name} has description`);
    assert.ok(schedule.prompt, `${name} has prompt`);
  }
});

test('exactly 3 schedules exist', () => {
  const config = loadFixture();
  assert.strictEqual(Object.keys(config.schedules).length, 3);
});

test('incremental defaults enabled', () => {
  const config = loadFixture();
  assert.strictEqual(config.schedules.incremental.enabled, true);
});

test('weekly audit defaults disabled', () => {
  const config = loadFixture();
  assert.strictEqual(config.schedules['weekly-audit'].enabled, false);
});

test('portal health defaults enabled', () => {
  const config = loadFixture();
  assert.strictEqual(config.schedules['portal-health'].enabled, true);
});

test('no stale-reverification schedule exists', () => {
  const config = loadFixture();
  const names = Object.keys(config.schedules);
  const hasStale = names.some(n => n.includes('stale') || n.includes('reverify'));
  assert.strictEqual(hasStale, false, 'no stale/reverify schedule should exist');
});

// ============================================================
// CLI: list
// ============================================================

test('list output', () => {
  const result = run('list');
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('incremental'), 'lists incremental');
  assert.ok(result.stdout.includes('weekly-audit'), 'lists weekly-audit');
  assert.ok(result.stdout.includes('portal-health'), 'lists portal-health');
  assert.ok(result.stdout.includes('57 8 * * *'), 'shows cron for incremental');
  assert.ok(result.stdout.includes('13 9 * * 6'), 'shows cron for weekly-audit');
  assert.ok(result.stdout.includes('47 11 * * *'), 'shows cron for portal-health');
  assert.ok(result.stdout.includes('CronCreate'), 'mentions session-scoped limitation');
});

// ============================================================
// CLI: get
// ============================================================

test('get known schedule', () => {
  const result = run('get incremental');
  assert.strictEqual(result.exitCode, 0);
  const schedule = JSON.parse(result.stdout);
  assert.strictEqual(schedule.name, 'incremental');
  assert.strictEqual(schedule.cron, '57 8 * * *');
  assert.strictEqual(schedule.enabled, true);
});

test('get unknown schedule fails nonzero', () => {
  const result = run('get nonexistent');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('not found'), 'error mentions not found');
});

// ============================================================
// CLI: enable/disable persistence
// ============================================================

test('disable persists to schedules.json', () => {
  const dir = tmpDir();
  const fixtureFile = path.join(dir, 'schedules.json');
  const fixture = loadFixture();
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

  const result = run('disable incremental', dir, { SCHEDULER_FILE: fixtureFile });
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('Disabled'), 'reports disabled');

  const modified = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  assert.strictEqual(modified.schedules.incremental.enabled, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('enable persists to schedules.json', () => {
  const dir = tmpDir();
  const fixtureFile = path.join(dir, 'schedules.json');
  const fixture = loadFixture();
  fixture.schedules.incremental.enabled = false;
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

  const result = run('enable incremental', dir, { SCHEDULER_FILE: fixtureFile });
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('Enabled'), 'reports enabled');

  const modified = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  assert.strictEqual(modified.schedules.incremental.enabled, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('disable unknown schedule fails nonzero', () => {
  const result = run('disable nonexistent');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('not found'), 'error mentions not found');
});

test('enable unknown schedule fails nonzero', () => {
  const result = run('enable nonexistent');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('not found'), 'error mentions not found');
});

// ============================================================
// CLI: prompts
// ============================================================

test('prompts returns only enabled schedules', () => {
  const result = run('prompts');
  assert.strictEqual(result.exitCode, 0);
  const prompts = JSON.parse(result.stdout);
  assert.ok(Array.isArray(prompts), 'output is an array');
  assert.strictEqual(prompts.length, 2, 'only 2 enabled schedules');
  const names = prompts.map(p => p.name);
  assert.ok(names.includes('incremental'), 'includes incremental');
  assert.ok(names.includes('portal-health'), 'includes portal-health');
  assert.ok(!names.includes('weekly-audit'), 'excludes disabled weekly-audit');
});

test('prompts entries contain name, cron, recurring, prompt', () => {
  const result = run('prompts');
  assert.strictEqual(result.exitCode, 0);
  const prompts = JSON.parse(result.stdout);
  for (const entry of prompts) {
    assert.ok(entry.name, 'has name');
    assert.ok(entry.cron, 'has cron');
    assert.strictEqual(typeof entry.recurring, 'boolean', 'has recurring');
    assert.ok(entry.prompt, 'has prompt');
  }
});

test('prompts after disabling all schedules returns empty array', () => {
  const dir = tmpDir();
  const fixtureFile = path.join(dir, 'schedules.json');
  const fixture = loadFixture();
  fixture.schedules.incremental.enabled = false;
  fixture.schedules['portal-health'].enabled = false;
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));

  const result = run('prompts', dir, { SCHEDULER_FILE: fixtureFile });
  assert.strictEqual(result.exitCode, 0);
  const prompts = JSON.parse(result.stdout);
  assert.deepStrictEqual(prompts, []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('prompts preserve schedule names matching schedules.json', () => {
  const result = run('prompts');
  assert.strictEqual(result.exitCode, 0);
  const prompts = JSON.parse(result.stdout);
  const config = loadFixture();
  const enabledNames = Object.values(config.schedules)
    .filter(s => s.enabled)
    .map(s => s.name)
    .sort();
  const promptNames = prompts.map(p => p.name).sort();
  assert.deepStrictEqual(promptNames, enabledNames);
});

// ============================================================
// CLI: prompt content contracts
// ============================================================

test('incremental prompt references /scrape and sync_to_db', () => {
  const result = run('get incremental');
  const schedule = JSON.parse(result.stdout);
  assert.ok(schedule.prompt.includes('/scrape'), 'references /scrape');
  assert.ok(schedule.prompt.includes('sync_to_db.py'), 'references sync_to_db');
  assert.ok(schedule.prompt.includes('ranking_report'), 'references ranking_report');
  assert.ok(schedule.prompt.includes('checkpoints.json'), 'references checkpoints.json');
});

test('weekly-audit prompt references full-audit mode', () => {
  const result = run('get weekly-audit');
  const schedule = JSON.parse(result.stdout);
  assert.ok(schedule.prompt.includes('FULL_AUDIT') || schedule.prompt.includes('full-audit'), 'references full audit');
  assert.ok(schedule.prompt.includes('sync_to_db.py'), 'references sync_to_db');
});

test('portal-health prompt invokes the CP15.5 portal_health.js check CLI', () => {
  const result = run('get portal-health');
  const schedule = JSON.parse(result.stdout);
  assert.ok(schedule.prompt.includes('portal_health.js check'), 'invokes portal_health.js check');
  assert.ok(schedule.prompt.includes('--db backend/careerpilot.db'), 'arms the CP16.6 DB mirror');
  assert.ok(!schedule.prompt.includes('/scrape health'), 'does not route through /scrape health');
  assert.ok(!schedule.prompt.includes('sync_to_db'), 'does not reference sync_to_db');
});

test('no prompt claims scheduler.js calls CronCreate', () => {
  const config = loadFixture();
  for (const [name, schedule] of Object.entries(config.schedules)) {
    assert.ok(!schedule.prompt.includes('scheduler.js'), `${name} prompt does not mention scheduler.js`);
    assert.ok(!schedule.prompt.includes('CronCreate'), `${name} prompt does not mention CronCreate`);
  }
});

// ============================================================
// CLI: unknown command fails nonzero
// ============================================================

test('unknown command fails nonzero', () => {
  const result = run('foobar');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('unknown command'), 'error mentions unknown command');
});

test('no arguments shows help', () => {
  const result = run('');
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('Usage'), 'shows usage');
  assert.ok(result.stdout.includes('CronCreate'), 'mentions CronCreate limitation');
});

// ============================================================
// CLI: malformed schedules.json
// ============================================================

test('malformed schedules.json fails safely nonzero', () => {
  const dir = tmpDir();
  const fixtureFile = path.join(dir, 'schedules.json');
  fs.writeFileSync(fixtureFile, '{invalid json');

  const result = run('list', dir, { SCHEDULER_FILE: fixtureFile });
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('Error'), 'reports error');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing schedules field fails safely nonzero', () => {
  const dir = tmpDir();
  const fixtureFile = path.join(dir, 'schedules.json');
  fs.writeFileSync(fixtureFile, JSON.stringify({ schema_version: '1.0' }));

  const result = run('list', dir, { SCHEDULER_FILE: fixtureFile });
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('Error') || result.stderr.includes('missing'), 'reports error');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================
// CLI: get without name
// ============================================================

test('get without name fails nonzero', () => {
  const result = run('get');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('name required'), 'error mentions name required');
});

test('enable without name fails nonzero', () => {
  const result = run('enable');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('name required'), 'error mentions name required');
});

test('disable without name fails nonzero', () => {
  const result = run('disable');
  assert.notStrictEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes('name required'), 'error mentions name required');
});

// ============================================================
// SCHEMA: no stale schedule, session-scoped docs
// ============================================================

test('schema_version is 1.0', () => {
  const config = loadFixture();
  assert.strictEqual(config.schema_version, '1.0');
});

test('all cron expressions are 5-field format', () => {
  const config = loadFixture();
  for (const [name, schedule] of Object.entries(config.schedules)) {
    const fields = schedule.cron.split(' ');
    assert.strictEqual(fields.length, 5, `${name} cron has 5 fields`);
  }
});

test('all schedules have recurring=true', () => {
  const config = loadFixture();
  for (const [name, schedule] of Object.entries(config.schedules)) {
    assert.strictEqual(schedule.recurring, true, `${name} is recurring`);
  }
});
