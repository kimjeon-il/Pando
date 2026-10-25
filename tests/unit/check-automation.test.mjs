import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
    { id: 'terrain', kind: 'browser', testPatterns: ['tests/browser/terrain-*.spec.mjs'], inputs: ['shared/frontend/js/modules/terrain.js'], requires: ['generated'] },
    { id: 'manual', kind: 'browser', mode: 'manual', reason: 'Controlled measurement', testPatterns: ['tests/browser/measure.spec.mjs'], inputs: [] },
  ], prerequisites: { generated: { argv: ['node', 'scripts/generate.mjs'] } }, productRoots: ['shared/frontend/**', 'apps/**', 'scripts/**'] };
  put('shared/frontend/js/modules/terrain.js', "export { value } from './leaf.js';");
  put('shared/frontend/js/modules/leaf.js', 'export const value = 1;');
  put('shared/frontend/js/modules/other.js', 'export const unrelated = 2;');
  put('tests/unit/terrain.test.mjs', "import '../../shared/frontend/js/modules/terrain.js';");
  put('tests/unit/other.test.mjs', "import '../../shared/frontend/js/modules/other.js';");
  put('tests/browser/terrain-time.spec.mjs'); put('tests/browser/measure.spec.mjs');
  put('scripts/generate.mjs');
  return { root, put, catalog, repository: () => loadRepository(root, { catalog }) };
}

test('reference-analysis command documentation is a passive CI input', t => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url)));
  f.catalog.productRoots = catalog.productRoots;
  f.catalog.passiveInputs = catalog.passiveInputs;
  f.put('tools/reference-analysis/README.md', 'Use PANDOLAB_SHELL_PROFILE=map-data.');
  const plan = planApplicationChecks({ changedFiles: ['tools/reference-analysis/README.md'], repository: f.repository() });
  assert.deepEqual(plan.unitTests, []);
  assert.deepEqual(plan.browserSpecs, []);
});

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
  const plan = planApplicationChecks({ changedFiles: ['shared/frontend/js/modules/leaf.js'], repository: f.repository() });
  assert.deepEqual(plan.unitTests, ['tests/unit/terrain.test.mjs']);
  assert.deepEqual(plan.browserSpecs, ['tests/browser/terrain-time.spec.mjs']);
  assert.deepEqual(plan.prerequisites, ['generated']);
  assert.ok(plan.reasons['tests/browser/terrain-time.spec.mjs'].some(reason => reason.includes('leaf.js')));
  assert.equal(plan.manualTests.includes('tests/browser/measure.spec.mjs'), true);
});

test('staged shell imports, re-exports and module URLs resolve to their source owners', () => {
  const f = fixture();
  f.put('apps/editor/native.js');
  f.put('shared/frontend/js/workers/place-worker.js');
  f.put('apps/shared/frontend/js/modules/leaf.js', 'throw Error("wrong source owner");');
  f.put('apps/editor/reference-analysis-probe.js', `
    import './native.js';
    import { value } from '../../shared/frontend/js/modules/leaf.js';
    export { value as terrain } from '../../shared/frontend/js/modules/terrain.js';
    export * from './native.js';
    const load = () => import('../../shared/frontend/js/modules/other.js?revision=1');
    const worker = new URL('../../shared/frontend/js/workers/place-worker.js?cache=../../misleading#revision', import.meta.url);
  `);
  f.put('tests/unit/probe.test.mjs', "import '../../apps/editor/reference-analysis-probe.js';");
  const repo = f.repository();
  assert.deepEqual(repo.dependencies('apps/editor/reference-analysis-probe.js').sort(), [
    'apps/editor/native.js', 'shared/frontend/js/modules/leaf.js', 'shared/frontend/js/modules/other.js',
    'shared/frontend/js/modules/terrain.js', 'shared/frontend/js/workers/place-worker.js',
  ]);
  const plan = planApplicationChecks({ changedFiles: ['shared/frontend/js/workers/place-worker.js'], repository: repo });
  assert.deepEqual(plan.unitTests, ['tests/unit/probe.test.mjs']);
});

test('shell Node tools and nested tests keep source-relative paths', () => {
  const f = fixture();
  f.catalog.relocatedSources = [{ source: 'apps/editor/', output: 'shell/', files: ['apps/editor/*.js'] }];
  f.put('apps/editor/fixture.mjs', "import '../../shared/frontend/js/modules/leaf.js';");
  f.put('apps/editor/stage.mjs', "import './fixture.mjs'; const input = new URL('../../shared/frontend/js/modules/other.js', import.meta.url);");
  f.put('apps/editor/tests/probe.test.mjs', "import '../fixture.mjs';");
  const repo = f.repository();
  assert.deepEqual(repo.dependencies('apps/editor/stage.mjs').sort(), ['apps/editor/fixture.mjs', 'shared/frontend/js/modules/other.js']);
  assert.deepEqual(repo.dependencies('apps/editor/tests/probe.test.mjs'), ['apps/editor/fixture.mjs']);
});

test('verification startup resolves versioned fixture modules at the declared runtime base', () => {
  const f = fixture();
  const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url)));
  f.catalog.runtimeBases = catalog.runtimeBases;
  f.catalog.relocatedSources = catalog.relocatedSources;
  f.put('apps/editor/verification.js', "export function startFixture({ versionedAsset }) { return import(versionedAsset('./modules/leaf.js').href); }");
  f.put('tests/unit/verification.test.mjs', "import '../../apps/editor/verification.js';");
  const repo = f.repository();
  assert.deepEqual(repo.dependencies('apps/editor/verification.js'), ['shared/frontend/js/modules/leaf.js']);
  const plan = planApplicationChecks({ changedFiles: ['shared/frontend/js/modules/leaf.js'], repository: repo });
  assert.ok(plan.unitTests.includes('tests/unit/verification.test.mjs'));
});

test('module URL reads retain root configuration and workflow consumers', () => {
  const f = fixture();
  f.put('package.json', '{}'); f.put('playwright.config.js'); f.put('.github/workflows/application-architecture.yml');
  f.put('tests/unit/config.test.mjs', `
    readFileSync(new URL('../../package.json', import.meta.url));
    readFileSync(new URL('../../playwright.config.js', import.meta.url));
    readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url));
  `);
  const repo = f.repository();
  assert.deepEqual(repo.dependencies('tests/unit/config.test.mjs').sort(), [
    '.github/workflows/application-architecture.yml', 'package.json', 'playwright.config.js',
  ]);
  for (const file of ['package.json', 'playwright.config.js', '.github/workflows/application-architecture.yml'])
    assert.deepEqual(planApplicationChecks({ changedFiles: [file], repository: repo }).unitTests, ['tests/unit/config.test.mjs']);
});

test('staged dependencies still reject missing imports and paths outside the bundle root', () => {
  const f = fixture();
  f.catalog.relocatedSources = [{ source: 'apps/editor/', output: 'shell/', files: ['apps/editor/*.js'] }];
  f.put('apps/editor/missing.js', "import './missing-dependency.js';");
  f.put('apps/editor/escape.js', "import '../../../outside.js';");
  assert.throws(() => f.repository().dependencies('apps/editor/missing.js'), /unmapped frontend import.*missing-dependency/);
  assert.throws(() => f.repository().dependencies('apps/editor/escape.js'), /outside repository|unmapped frontend import.*outside/);
});

test('nested GIS Python changes select their existing external workflow', () => {
  const f = fixture();
  const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url)));
  const check = catalog.externalChecks.find(row => row.id === 'gis-python');
  f.catalog.externalChecks = [check]; f.put(check.workflow);
  const changedFiles = ['tools/gis/verify_osm_hydro_batch01_anchors.py', 'scripts/research/check.py', 'tests/test_hydro_independent_names.py'];
  changedFiles.forEach(file => f.put(file));
  const plan = planApplicationChecks({ changedFiles, repository: f.repository() });
  assert.deepEqual(plan.externalChecks.map(row => row.id), ['gis-python']);
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
  f.put('shared/frontend/js/modules/unlinked.js', 'export const orphan = 1;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['shared/frontend/js/modules/unlinked.js'], repository: f.repository() }), /unclassified.*unlinked/i);
});

test('an unknown computed executable import fails with its owner and does not invent a dependency', () => {
  const f = fixture(); f.put('shared/frontend/js/modules/terrain.js', 'export const load = path => import(path);');
  assert.throws(() => planApplicationChecks({ changedFiles: ['shared/frontend/js/modules/terrain.js'], repository: f.repository() }), /dynamic.*terrain.js/i);
});

test('classic mixed arguments cannot hide a computed script behind a literal script', () => {
  const f = fixture();
  f.catalog.groups[1].inputs.push('shared/frontend/js/workers/canvas-render-worker.js');
  f.put('shared/frontend/js/workers/canvas-render-worker.js', "importScripts('./known.js', event.data.module);");
  f.put('shared/frontend/js/workers/known.js', 'self.known = true;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['shared/frontend/js/workers/canvas-render-worker.js'], repository: f.repository() }), /dynamic.*canvas-render-worker/i);
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
test('classic generated metadata resolves to its source owner without a root output file',()=>{
 const f=fixture(),worker='shared/frontend/js/workers/generated-meta-worker.js',owner='scripts/lib/frontend-build.mjs';
 f.put(worker,"importScripts('../build-meta.js');");f.put(owner,'export const generated = true;');
 f.catalog.groups[1].inputs.push(worker);const repo=f.repository();
 assert.equal(repo.exists('assets/js/build-meta.js'),false);
 assert.ok(repo.dependencies(worker).includes(owner));
 assert.ok(planApplicationChecks({changedFiles:[owner],repository:repo}).browserSpecs.includes('tests/browser/terrain-time.spec.mjs'));
});
