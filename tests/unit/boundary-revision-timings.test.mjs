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

test('canonical scenario preserves the frozen control and audited current editor migrations', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const path = 'tests/browser/boundary-cut-snapping.spec.mjs';
  // The original control is also present at immutable 350e5ae8cf348e8244b355b688741831339ab519.
  // Keep its exact multiset hash; explicitly account for subsequent editor migrations
  // instead of replacing the historical oracle with the current result.
  const originalCallCount = 452;
  const originalCallsHash = 'f632fc786bd828305b6bb235c2b2f03957cd9ff2f71a2b32ce18da0d3a7ffe93';
  const current = readFileSync(join(root, path), 'utf8');
  const { parse } = createRequire(import.meta.resolve('eslint'))('espree');
  function calls(source, roots = ['page', 'expect']) {
    const results = [];
    const rootName = node => !node ? null : node.type === 'Identifier' ? node.name : rootName(node.object || node.callee);
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && roots.includes(rootName(node.callee))) {
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
  // e3133093: child-action helper; 22511064: ready Undo with a bounded native click;
  // 443c6ca3: explicit editor entry; 4590469a: flat-only UI;
  // ff50a41b: current discard wording and the real terrain fixture.
  const addedCalls = [
    "expect(page.locator('#confirmModalCancelBtn')).toHaveText('편집 계속')",
    "expect(page.locator('#confirmModalMessage')).toContainText('미적용 입력을 모두 버립니다')",
    "expect(page.locator('#undoBtn'))",
    "expect(page.locator('#undoBtn')).toBeEnabled({ timeout: 30_000 })",
    "page.addInitScript(project => localStorage.setItem('pandolab-editor-project', JSON.stringify(project)), staticAutosaveProject({}, [parent]))",
    "page.locator('#undoBtn')",
    "page.locator('#undoBtn').click({ timeout: 30_000, noWaitAfter: true })",
    "page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat')"
  ];
  const retiredCalls = [
    "expect(page.locator('#confirmModalCancelBtn')).toHaveText('계속 그리기')",
    "expect(page.locator('#confirmModalMessage')).toContainText('점 3개')",
    "expect(page.locator('#mapDisplaySurface'))",
    "expect(page.locator('#mapDisplaySurface')).toBeHidden()",
    "page.addInitScript(project => localStorage.setItem('pandolab-editor-project', JSON.stringify(project)), staticAutosaveProject({ physicalSettings: { terrainVisible: false } }, [parent]))",
    "page.goto('/?debug=1&demTerrain=raster')",
    "page.keyboard.press('Escape')",
    "page.locator('#addEntityChildBtn')",
    "page.locator('#addEntityChildBtn').click()",
    "page.locator('#flatBtn')",
    "page.locator('#flatBtn').click()",
    "page.locator('#mapDisplayBtn')",
    "page.locator('#mapDisplayBtn').click()",
    "page.locator('#mapDisplaySurface')",
    "page.locator('#mapDisplaySurface')",
    "page.locator('#mapDisplaySurface').isVisible()",
    "page.locator('#mapProjectionMenuTrigger')",
    "page.locator('#mapProjectionMenuTrigger').click()",
    "page.locator('#undoBtn').click()"
  ];
  assert.deepEqual(calls(current, ['gotoEditor', 'startChildCreation']), [
    "gotoEditor(page, '/?debug=1&demTerrain=raster')",
    'startChildCreation(page, parentId)',
  ]);
  const reconstructed = [...currentCalls];
  for (const call of addedCalls) {
    const index = reconstructed.indexOf(call);
    assert.notEqual(index, -1, `Missing audited editor operation: ${call}`);
    reconstructed.splice(index, 1);
  }
  reconstructed.push(...retiredCalls);
  reconstructed.sort();
  assert.equal(reconstructed.length, originalCallCount);
  assert.equal(createHash('sha256').update(JSON.stringify(reconstructed)).digest('hex'), originalCallsHash,
    'all browser calls and assertions outside the audited migrations must remain unchanged');
  assert.match(current, /const profiling = !comparison && process\.env\.PANDOLAB_TEST_PROFILING !== 'off';/);
  assert.match(current, /!profiling \? null : await import\('\.\/helpers\/long-animation-frame-diagnostics\.mjs'\)/);
  assert.match(current, /!profiling \? null : await import\('\.\/helpers\/native-action-diagnostics\.mjs'\)/);
  assert.match(current, /!profiling \? null : await import\('\.\/helpers\/native-action-timeline\.mjs'\)/);
  assert.match(current, /if \(profiling\) await page\.addInitScript\(installLongAnimationFrameProbe\)/);
});
