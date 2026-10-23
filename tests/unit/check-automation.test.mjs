import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadRepository, planApplicationChecks, matchesPattern } from '../../scripts/plan-application-checks.mjs';

test('every current browser workflow can be assigned before CI dependency planning', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url)));
  const groups = catalog.groups.filter(group => group.kind === 'browser');
  const unregistered = readdirSync(new URL('../browser/', import.meta.url)).filter(name => name.endsWith('.spec.mjs'))
    .map(name => 'tests/browser/' + name).filter(file => !groups.some(group => group.testPatterns.some(pattern => matchesPattern(file, pattern))));
  assert.deepEqual(unregistered, []);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-check-plan-'));
  const put = (path, source = '') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  const catalog = { schema: 'pando-application-checks-v1', groups: [
    { id: 'units', kind: 'unit', testPatterns: ['tests/unit/*.test.mjs'], inputs: [] },
    { id: 'terrain', kind: 'browser', testPatterns: ['tests/browser/terrain-*.spec.mjs'], inputs: ['assets/js/modules/terrain.js'], requires: ['generated'] },
    { id: 'manual', kind: 'browser', mode: 'manual', reason: 'Controlled measurement', testPatterns: ['tests/browser/measure.spec.mjs'], inputs: [] },
  ], prerequisites: { generated: { argv: ['node', 'scripts/generate.mjs'] } }, productRoots: ['assets/**', 'apps/**', 'scripts/**'] };
  put('assets/js/modules/terrain.js', "export { value } from './leaf.js';");
  put('assets/js/modules/leaf.js', 'export const value = 1;');
  put('assets/js/modules/other.js', 'export const unrelated = 2;');
  put('tests/unit/terrain.test.mjs', "import '../../assets/js/modules/terrain.js';");
  put('tests/unit/other.test.mjs', "import '../../assets/js/modules/other.js';");
  put('tests/browser/terrain-time.spec.mjs'); put('tests/browser/measure.spec.mjs');
  put('scripts/generate.mjs');
  return { root, put, catalog, repository: () => loadRepository(root, { catalog }) };
}

test('application CI prepares pinned data before planning and executing registered checks', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8'));
  for (const id of ['changes', 'checks']) {
    const steps = workflow.jobs[id].steps;
    const checkout = steps.findIndex(step => step.uses === 'actions/checkout@v4');
    const prepare = steps.findIndex(step => step.uses === './.github/actions/library-data');
    const plan = steps.findIndex(step => step.run?.includes('run-application-checks.mjs'));
    assert.ok(checkout >= 0 && prepare > checkout && plan > prepare, `${id} must prepare registered data inputs before loading the repository`);
  }
});

test('transitive source changes choose related units and declared HTTP browser consumers', () => {
  const f = fixture();
  const plan = planApplicationChecks({ changedFiles: ['assets/js/modules/leaf.js'], repository: f.repository() });
  assert.deepEqual(plan.unitTests, ['tests/unit/terrain.test.mjs']);
  assert.deepEqual(plan.browserSpecs, ['tests/browser/terrain-time.spec.mjs']);
  assert.deepEqual(plan.prerequisites, ['generated']);
  assert.ok(plan.reasons['tests/browser/terrain-time.spec.mjs'].some(reason => reason.includes('leaf.js')));
  assert.equal(plan.manualTests.includes('tests/browser/measure.spec.mjs'), true);
});

test('new and moved tests are discovered; an unregistered browser test fails coverage', () => {
  const f = fixture(); f.put('tests/unit/new.test.mjs', "import './terrain.test.mjs';");
  assert.ok(planApplicationChecks({ changedFiles: ['tests/unit/new.test.mjs'], repository: f.repository() }).unitTests.includes('tests/unit/new.test.mjs'));
  f.put('tests/browser/unlinked.spec.mjs');
  assert.throws(() => f.repository(), /unregistered.*unlinked/i);
});

test('deleted imports and missing declared prerequisite commands fail, not silently pass', () => {
  const f = fixture(); f.put('tests/unit/broken.test.mjs', "import './deleted.test.mjs';");
  assert.throws(() => planApplicationChecks({ changedFiles: ['tests/unit/broken.test.mjs'], repository: f.repository() }), /missing.*deleted/i);
  const g = fixture(); g.catalog.prerequisites.generated.argv[1] = 'scripts/missing.mjs';
  assert.throws(() => g.repository(), /missing.*missing.mjs/i);
});

test('docs-only changes skip runtime work and unknown product code fails registration', () => {
  const f = fixture(); const repo = f.repository();
  const docs = planApplicationChecks({ changedFiles: ['reports/a.md'], repository: repo });
  assert.deepEqual(docs.unitTests, []); assert.deepEqual(docs.browserSpecs, []);
  f.put('assets/js/modules/unlinked.js', 'export const orphan = 1;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['assets/js/modules/unlinked.js'], repository: f.repository() }), /unclassified.*unlinked/i);
});

test('an unknown computed executable import fails with its owner and does not invent a dependency', () => {
  const f = fixture(); f.put('assets/js/modules/terrain.js', 'export const load = path => import(path);');
  assert.throws(() => planApplicationChecks({ changedFiles: ['assets/js/modules/terrain.js'], repository: f.repository() }), /dynamic.*terrain.js/i);
});

test('classic mixed arguments cannot hide a computed script behind a literal script', () => {
  const f = fixture();
  f.catalog.groups[1].inputs.push('assets/js/workers/canvas-render-worker.js');
  f.put('assets/js/workers/canvas-render-worker.js', "importScripts('./known.js', event.data.module);");
  f.put('assets/js/workers/known.js', 'self.known = true;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['assets/js/workers/canvas-render-worker.js'], repository: f.repository() }), /dynamic.*canvas-render-worker/i);
});

test('fixed fixture directories are data leaves and their child changes retain test consumers', () => {
  const f = fixture();
  f.put('tests/fixtures/oracle/frozen.js', "import './not-an-executable-input.js';");
  f.put('tests/unit/oracle.test.mjs', "const directory = new URL('../fixtures/oracle/', import.meta.url);");
  const plan = planApplicationChecks({ changedFiles: ['tests/fixtures/oracle/frozen.js'], repository: f.repository() });
  assert.ok(plan.unitTests.includes('tests/unit/oracle.test.mjs'));
});

test('cycles in prerequisites and missing fixture inputs fail inventory before execution', () => {
  const f = fixture();
  f.catalog.prerequisites.generated.requires = ['generated'];
  assert.throws(() => f.repository(), /cyclic/i);
  const g = fixture(); g.put('tests/unit/missing-fixture.test.mjs', "readFileSync('tests/fixtures/removed.json');");
  assert.throws(() => planApplicationChecks({ changedFiles: [], repository: g.repository() }), /missing.*removed.json/i);
});

test('a checker and its prerequisite implementation are inferred inputs, not copied file lists', () => {
  const f = fixture();
  f.put('scripts/check.mjs', "import './check-helper.mjs';");
  f.put('scripts/check-helper.mjs', 'export const check = true;');
  f.catalog.groups.push({ id: 'validation', kind: 'command', inputs: [], argv: ['node', 'scripts/check.mjs'] });
  assert.ok(planApplicationChecks({ changedFiles: ['scripts/check-helper.mjs'], repository: f.repository() }).commands.includes('validation'));
  assert.ok(planApplicationChecks({ changedFiles: ['scripts/generate.mjs'], repository: f.repository() }).browserSpecs.includes('tests/browser/terrain-time.spec.mjs'));
});

test('computing a script base URL does not make every sibling script a consumed input', () => {
  const f = fixture(); f.put('scripts/check.mjs', "const directory = new URL('.', import.meta.url);");
  f.put('scripts/unrelated.mjs');
  f.catalog.groups.push({ id: 'validation', kind: 'command', inputs: [], argv: ['node', 'scripts/check.mjs'] });
  assert.deepEqual(f.repository().dependencies('scripts/check.mjs'), []);
});
