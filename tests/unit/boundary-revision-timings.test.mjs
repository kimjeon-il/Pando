import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helperUrl = new URL('../browser/helpers/boundary-revision-timings.mjs', import.meta.url);
async function helper() {
  assert.ok(existsSync(helperUrl), 'the host-only timing helper must exist');
  return import(helperUrl.href);
}

test('timing preserves original operation values, errors and exactly one invocation', async () => {
  const { createBoundaryRevisionTimings } = await helper();
  let now = 10, calls = 0;
  const recorder = createBoundaryRevisionTimings(() => now++);
  const value = {};
  assert.equal(await recorder.measure('undo-click', () => { calls++; return value; }), value);
  const error = new Error('original functional failure');
  await assert.rejects(recorder.measure('child-observation', () => { calls++; throw error; }), failure => failure === error);
  assert.equal(calls, 2);
  const report = recorder.finish('failed');
  assert.deepEqual(report.stages.slice(0, 2).map(stage => [stage.name, stage.status, stage.durationMs]),
    [['undo-click', 'fulfilled', 1], ['child-observation', 'rejected', 1]]);
  assert.equal(report.stages[2].status, 'not-reached');
});

test('final snapshot distinguishes pending at timeout from completed and not reached', async () => {
  const { createBoundaryRevisionTimings } = await helper();
  const recorder = createBoundaryRevisionTimings(() => 7);
  let resolve;
  const pending = recorder.measure('undo-click', () => new Promise(done => { resolve = done; }));
  const report = recorder.finish('timedOut');
  assert.equal(report.stages[0].status, 'pending-at-failure');
  assert.equal(report.stages[0].endMs, null);
  assert.equal(report.stages[1].status, 'not-reached');
  resolve('late value');
  assert.equal(await pending, 'late value');
  assert.equal(report.stages[0].status, 'pending-at-failure', 'late work cannot rewrite failure evidence');
});

test('host-only fixture writes in finally without masking the original functional failure', async t => {
  const { boundaryRevisionTimingFixture } = await helper();
  const directory = mkdtempSync(join(tmpdir(), 'boundary-host-stages-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'timings.json');
  const error = new Error('functional');
  const testInfo = { title: 'desktop', status: 'failed', config: { metadata: { boundaryRevisionComparison: true } } };
  const env = { PANDOLAB_BOUNDARY_REVISION_COMPARISON: '1', PANDOLAB_BOUNDARY_TIMINGS_PATH: path };
  await assert.rejects(boundaryRevisionTimingFixture({}, async recorder => {
    await recorder.measure('undo-click', () => { throw error; });
  }, testInfo, env), failure => failure === error);
  assert.equal(JSON.parse(readFileSync(path)).stages[0].status, 'rejected');
  env.PANDOLAB_BOUNDARY_TIMINGS_PATH = join(directory, 'missing', 'timings.json');
  await assert.rejects(boundaryRevisionTimingFixture({}, async () => { throw error; }, testInfo, env),
    failure => failure === error);
  env.PANDOLAB_BOUNDARY_TIMINGS_PATH = path;
  await assert.rejects(boundaryRevisionTimingFixture({}, async () => { throw error; }, testInfo, env),
    failure => failure === error);
  assert.equal(JSON.parse(readFileSync(path)).stages.every(stage => stage.status === 'not-reached'), true);
});

test('normal fixture neither collects nor writes and explicit off mode requires isolated metadata', async () => {
  const { boundaryRevisionTimingFixture, isBoundaryRevisionComparison } = await helper();
  let calls = 0;
  await boundaryRevisionTimingFixture({}, async value => { calls++; assert.equal(value, null); }, {}, {});
  assert.equal(calls, 1);
  assert.equal(isBoundaryRevisionComparison({}), false);
  for (const value of ['', 'true', '0']) assert.throws(() => isBoundaryRevisionComparison({ PANDOLAB_BOUNDARY_REVISION_COMPARISON: value }), /exactly 1/);
  await assert.rejects(boundaryRevisionTimingFixture({}, async () => { calls++; }, { config: {} },
    { PANDOLAB_BOUNDARY_REVISION_COMPARISON: '1' }), /isolated comparison config/);
  assert.equal(calls, 1);
});

test('canonical scenario retains every original browser call and assertion, with helpers off only in isolated mode', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const path = 'tests/browser/boundary-cut-snapping.spec.mjs';
  // Frozen multiset from the original bd7ccd67 spec: preserve the control
  // without requiring that historical object in ordinary depth-one CI.
  const originalCallCount = 452;
  const originalCallsHash = 'f632fc786bd828305b6bb235c2b2f03957cd9ff2f71a2b32ce18da0d3a7ffe93';
  const current = readFileSync(join(root, path), 'utf8');
  const { parse } = createRequire(import.meta.resolve('eslint'))('espree');
  function calls(source) {
    const results = [];
    const rootName = node => !node ? null : node.type === 'Identifier' ? node.name : rootName(node.object || node.callee);
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && ['page', 'expect'].includes(rootName(node.callee))) {
        results.push(source.slice(...node.range).replace(/\s+/g, ' '));
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true }));
    return results.sort();
  }
  const currentCalls = calls(current);
  assert.equal(currentCalls.length, originalCallCount);
  assert.equal(createHash('sha256').update(JSON.stringify(currentCalls)).digest('hex'), originalCallsHash,
    'measurement may only wrap the original operations');
  assert.match(current, /comparison \? null : await import\('\.\/helpers\/long-animation-frame-diagnostics\.mjs'\)/);
  assert.match(current, /comparison \? null : await import\('\.\/helpers\/native-action-diagnostics\.mjs'\)/);
  assert.match(current, /comparison \? null : await import\('\.\/helpers\/native-action-timeline\.mjs'\)/);
  assert.match(current, /if \(!comparison\) await page\.addInitScript\(installLongAnimationFrameProbe\)/);
});
