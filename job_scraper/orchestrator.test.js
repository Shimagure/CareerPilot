const assert = require('assert');
const fs = require('fs');
const {
  STAGES,
  OUTPUTS,
  determineResumePoint,
  getCompletedStages,
  validateStageOutput
} = require('./orchestrator');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

test('stage order includes priority queue', () => {
  assert.deepStrictEqual(STAGES, [
    'discovery',
    'canonicalization',
    'hard_filter',
    'priority_queue',
    'verification',
    'scoring',
    'ranking_report'
  ]);
});

test('stage outputs use existing pipeline artifacts', () => {
  assert.deepStrictEqual(OUTPUTS.discovery, ['job_scraper/canonical_jobs.json']);
  assert.deepStrictEqual(OUTPUTS.canonicalization, ['job_scraper/canonical_jobs.json', 'job_scraper/seen_jobs.json']);
  assert.deepStrictEqual(OUTPUTS.hard_filter, ['job_scraper/filtered_jobs.json']);
  assert.deepStrictEqual(OUTPUTS.priority_queue, ['job_scraper/priority_queue.json']);
  assert.deepStrictEqual(OUTPUTS.ranking_report, ['job_scraper/seen_jobs.json']);
});

test('fresh checkpoint starts at discovery', () => {
  const result = determineResumePoint({
    current_checkpoint: { stage: null, stage_status: null },
    run_history: []
  }, 'INCREMENTAL');
  assert.strictEqual(result.stage, 'discovery');
});

test('completed stage resumes at next stage', () => {
  const result = determineResumePoint({
    current_checkpoint: { stage: 'canonicalization', stage_status: 'complete' },
    run_history: []
  }, 'INCREMENTAL');
  assert.strictEqual(result.stage, 'hard_filter');
});

test('failed stage resumes at failed stage', () => {
  const result = determineResumePoint({
    current_checkpoint: { stage: 'verification', stage_status: 'failed' },
    run_history: []
  }, 'INCREMENTAL');
  assert.strictEqual(result.stage, 'verification');
});

test('completed stage set excludes failures', () => {
  const completed = getCompletedStages({
    current_checkpoint: { stage: 'verification', stage_status: 'in_progress' },
    run_history: [
      { stage: 'discovery', stage_status: 'complete' },
      { stage: 'hard_filter', stage_status: 'failed' },
      { stage: 'priority_queue', stage_status: 'complete' }
    ]
  });
  assert.strictEqual(completed.has('discovery'), true);
  assert.strictEqual(completed.has('priority_queue'), true);
  assert.strictEqual(completed.has('hard_filter'), false);
});

test('output validation rejects missing files', () => {
  assert.throws(
    () => validateStageOutput('fixture', ['job_scraper/does-not-exist.json']),
    /missing output files/
  );
});

test('output validation accepts fixture files', () => {
  assert.doesNotThrow(() => validateStageOutput('fixture', [
    'job_scraper/seen_jobs.json',
    'job_scraper/checkpoints.json'
  ]));
});

if (process.exitCode) process.exit(process.exitCode);
