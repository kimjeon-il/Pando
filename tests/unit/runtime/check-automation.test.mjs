import {createCheckImpactIndex} from '../../../scripts/lib/check-impact.mjs';
import {selectionRequest} from '../../../scripts/run-application-checks.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runInNewContext } from 'node:vm';
import { loadRepository, planApplicationChecks, matchesPattern } from "../../../scripts/plan-application-checks.mjs";

test('recursive test selectors include direct and domain-nested tests without crossing filename segments',()=>{
 const pattern='tests/unit/**/terrain-*.test.mjs';
 assert.equal(matchesPattern('tests/unit/terrain-one.test.mjs',pattern),true);
 assert.equal(matchesPattern('tests/unit/rendering/terrain-one.test.mjs',pattern),true);
 assert.equal(matchesPattern('tests/unit/rendering/deep/terrain-one.test.mjs',pattern),true);
 assert.equal(matchesPattern('tests/unit/rendering/terrain-one/nested.test.mjs',pattern),false);
});
import { auditWorkflowReferences } from "../../../scripts/lib/workflow-reference-integrity.mjs";


test('workflow reference validator catches missing scripts, retired products and local actions', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-workflow-reference-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, source = '') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  put('scripts/publish.mjs');
  put('tools/hydro-audit.py');
  put('tests/browser/viewer.spec.mjs');
  put('tests/integration/run-desktop.mjs');
  put('tests/integration/run-mobile.mjs');
  put('scripts/local-check.mjs');
  put('.github/actions/release/action.yml', [
    'name: Release', 'runs:', '  using: composite', '  steps:',
    '    - shell: bash', '      run: node scripts/local-check.mjs',
  ].join('\n'));
  const matrix = '$' + '{{ matrix.profile }}';
  const workflow = [
    'name: Valid source-owned automation',
    'on: { workflow_dispatch: {} }',
    'jobs:',
    '  validate:',
    '    runs-on: ubuntu-24.04',
    '    strategy:',
    '      matrix: { profile: [desktop, mobile] }',
    '    steps:',
    '      - uses: ./.github/actions/release',
    '      - shell: bash',
    '        run: |',
    '          node scripts/publish.mjs',
    '          python3 tools/hydro-audit.py',
    '          pnpm exec playwright test tests/browser/viewer.spec.mjs',
    '          node tests/integration/run-' + matrix + '.mjs',
  ].join('\n') + '\n';
  put('.github/workflows/check.yml', workflow);
  assert.deepEqual(auditWorkflowReferences(root), []);
  // Matrix substitutions in CLI args are not executable file paths.
  const shard = workflow.replace('node scripts/publish.mjs',
    'node scripts/publish.mjs --shard ' + matrix.replace('profile', 'current') + '/8');
  put('.github/workflows/check.yml', shard);
  assert.deepEqual(auditWorkflowReferences(root), []);

  // The Emscripten port is installed by the SDK and is not a repo source.
  const sdk = workflow.replace('node scripts/publish.mjs',
    'node scripts/publish.mjs' + String.fromCharCode(10) +
    '          port_file=build-native/emsdk/upstream/emscripten/tools/ports/zlib.py');
  put('.github/workflows/check.yml', sdk);
  assert.deepEqual(auditWorkflowReferences(root), []);


  put('.github/workflows/check.yml', workflow.replace('scripts/publish.mjs', 'scripts/missing.mjs'));
  assert.ok(auditWorkflowReferences(root).some(error => error.reference === 'scripts/missing.mjs'));

  put('.github/workflows/check.yml', workflow.replace('./.github/actions/release', './.github/actions/removed'));
  assert.ok(auditWorkflowReferences(root).some(error => error.reference === '.github/actions/removed'));

  put('.github/workflows/check.yml', workflow + '  # banned path: apps/editor/editor.html\n');
  assert.ok(auditWorkflowReferences(root).some(error => /Retired product path/.test(error.reason)));

  const triggered = workflow.replace('on: { workflow_dispatch: {} }',
    'on: { push: { paths: [tests/browser/viewer.spec.mjs] } }');
  put('.github/workflows/check.yml', triggered);
  assert.deepEqual(auditWorkflowReferences(root), []);
  put('.github/workflows/check.yml', triggered.replace(
    'tests/browser/viewer.spec.mjs] }', 'tests/unit/retired-gis.test.mjs] }'));
  assert.ok(auditWorkflowReferences(root).some(error => error.reference === 'tests/unit/retired-gis.test.mjs'
    && error.reason === 'Missing focused test path in workflow trigger'));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-check-plan-'));
  const put = (path, source = '') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  const catalog = { schema: 'pando-application-checks-v1', groups: [
    { id: 'units', kind: 'unit', testPatterns: ['tests/unit/**/*.test.mjs'], inputs: [] },
    { id: 'terrain', kind: 'browser', testPatterns: ['tests/browser/**/terrain-*.spec.mjs'], inputs: ['src/runtime/terrain.js'], requires: ['generated'] },
    { id: 'manual', kind: 'browser', mode: 'manual', reason: 'Controlled measurement', testPatterns: ['tests/browser/measure.spec.mjs'], inputs: [] },
  ], prerequisites: { generated: { argv: ['node', 'scripts/generate.mjs'] } }, productRoots: ['src/**', 'apps/**', 'scripts/**'] };
  put('src/runtime/terrain.js', "export { value } from './leaf.js';");
  put('src/runtime/leaf.js', 'export const value = 1;');
  put('src/runtime/other.js', 'export const unrelated = 2;');
  put('tests/unit/terrain.test.mjs', "import '../../src/runtime/terrain.js';");
  put('tests/unit/other.test.mjs', "import '../../src/runtime/other.js';");
  put('tests/browser/terrain-time.spec.mjs'); put('tests/browser/measure.spec.mjs');
  put('scripts/generate.mjs');
  return { root, put, catalog, repository: () => loadRepository(root, { catalog }) };
}

test('exact check selection does not build the unrelated dependency graph', t => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const repo = f.repository();
  repo.impactIndex = () => { throw Error('unrelated dependency graph accessed'); };
  const plan = planApplicationChecks({ repository: repo, exactSelection: {
    unitTests: [], browserSpecs: ['tests/browser/terrain-time.spec.mjs'], commands: [], prerequisites: [],
  } });
  assert.deepEqual(plan.browserSpecs, ['tests/browser/terrain-time.spec.mjs']);
  assert.deepEqual(plan.browserPrerequisites, ['generated']);
});

test('dependency planning treats archived unprepared data as leaves without reading payloads', t => {
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const data='assets/data/selected/original.geojson';
  f.put('tests/unit/input.test.mjs',`import {readFileSync} from 'node:fs'; readFileSync('${data}');`);
  const repo=loadRepository(f.root,{catalog:f.catalog,libraryFiles:{[data]:{sha256:'a'.repeat(64),bytes:100}}});
  assert.ok(repo.dependencies('tests/unit/input.test.mjs').includes(data));
  assert.deepEqual(repo.dependencies(data),[]);
  assert.equal(existsSync(join(f.root,data)),false);
  assert.throws(()=>f.repository().dependencies('tests/unit/input.test.mjs'),/Missing dependency/);
});

test('shared tooling documentation is a passive CI input', t => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const catalog = JSON.parse(readFileSync(new URL("../../../scripts/contracts/application-checks.json", import.meta.url)));
  f.catalog.productRoots = catalog.productRoots;
  f.catalog.passiveInputs = catalog.passiveInputs;
  f.put('docs/reference-map-plugin.md', 'Map Toolkit owns analysis in its private repository.');
  const plan = planApplicationChecks({ changedFiles: ['docs/reference-map-plugin.md'], repository: f.repository() });
  assert.deepEqual(plan.unitTests, []);
  assert.deepEqual(plan.browserSpecs, []);
});

test('Architecture aggregate rejects missing failed or cancelled work and accepts only selected success or explicit empty phases', () => {
  const workflow = parse(readFileSync(new URL("../../../.github/workflows/application-architecture.yml", import.meta.url), 'utf8'));
  const aggregate = workflow.jobs.checks.steps.find(step => step.id === 'aggregate');
  assert.ok(aggregate, 'the existing checks job must aggregate every selected execution phase');
  const source = aggregate.run.match(/^node <<'NODE'\n([\s\S]*)\nNODE\s*$/)?.[1];
  assert.ok(source, 'exercise the actual inline gate, not a copy of its logic');
  const references = {
    SELECTION_RESULT: 'needs.changes.result', CHECKS_SELECTED: 'needs.changes.outputs.checks',
    NON_BROWSER_SELECTED: 'needs.changes.outputs.non_browser', BROWSER_SELECTED: 'needs.changes.outputs.browser',
    BROWSER_COUNT: 'needs.changes.outputs.browser_count', BROWSER_MATRIX: 'needs.changes.outputs.browser_matrix',
    NON_BROWSER_RESULT: 'needs.non-browser.result', BROWSER_RESULT: 'needs.browser.result',
  };
  for (const [key, reference] of Object.entries(references)) assert.equal(aggregate.env[key], '${{ ' + reference + ' }}');
  const matrix = count => JSON.stringify({ include: Array.from({ length: Math.min(8, Math.ceil(count / 4)) }, (_, i) => ({ current: i + 1, total: Math.min(8, Math.ceil(count / 4)) })) });
  const valid = { SELECTION_RESULT: 'success', CHECKS_SELECTED: 'true', NON_BROWSER_SELECTED: 'true', BROWSER_SELECTED: 'true',
    BROWSER_COUNT: '9', BROWSER_MATRIX: matrix(9), NON_BROWSER_RESULT: 'success', BROWSER_RESULT: 'success' };
  const run = overrides => runInNewContext(source, { process: { env: { ...valid, ...overrides } }, console: { log() {} } });
  assert.doesNotThrow(() => run({}));
  for (const key of Object.keys(valid)) assert.throws(() => run({ [key]: '' }), undefined, 'missing ' + key);
  for (const key of ['SELECTION_RESULT', 'NON_BROWSER_RESULT', 'BROWSER_RESULT'])
    for (const result of ['failure', 'cancelled', 'skipped']) assert.throws(() => run({ [key]: result }), undefined, key + ':' + result);
  for (const key of ['CHECKS_SELECTED', 'NON_BROWSER_SELECTED', 'BROWSER_SELECTED'])
    for (const value of ['yes', 'false', 'null']) assert.throws(() => run({ [key]: value }), undefined, key + ':' + value);
  for (const count of ['-1', '0', '1.5', '05', '9007199254740992']) assert.throws(() => run({ BROWSER_COUNT: count }));
  for (const badMatrix of ['missing', 'null', '[]', '{}', matrix(0), matrix(3),
    '{"include":[{"current":1,"total":1},{"current":1,"total":1}]}']) assert.throws(() => run({ BROWSER_MATRIX: badMatrix }));
  const noBrowser = { BROWSER_SELECTED: 'false', BROWSER_COUNT: '0', BROWSER_MATRIX: matrix(0), BROWSER_RESULT: 'skipped' };
  assert.doesNotThrow(() => run(noBrowser));
  assert.doesNotThrow(() => run({ NON_BROWSER_SELECTED: 'false', NON_BROWSER_RESULT: 'skipped' }));
  assert.doesNotThrow(() => run({ ...noBrowser, CHECKS_SELECTED: 'false', NON_BROWSER_SELECTED: 'false', NON_BROWSER_RESULT: 'skipped' }));
  assert.throws(() => run({ ...noBrowser, BROWSER_RESULT: 'success' }));
  assert.throws(() => run({ ...noBrowser, NON_BROWSER_RESULT: 'skipped' }));
});

test('transitive source changes choose related units and declared HTTP browser consumers', () => {
  const f = fixture();
  const plan = planApplicationChecks({ changedFiles: ['src/runtime/leaf.js'], repository: f.repository() });
  assert.deepEqual(plan.unitTests, ['tests/unit/terrain.test.mjs']);
  assert.deepEqual(plan.browserSpecs, ['tests/browser/terrain-time.spec.mjs']);
  assert.deepEqual(plan.prerequisites, ['generated']);
  assert.ok(plan.reasons['tests/browser/terrain-time.spec.mjs'].some(reason => reason.includes('leaf.js')));
  assert.equal(plan.manualTests.includes('tests/browser/measure.spec.mjs'), true);
});

test('current Viewer startup imports share the canonical frontend owner', t => {
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  f.put('src/app/viewer.js',"import '../runtime/runtime-context.js';");
  f.put('src/runtime/runtime-context.js',"import './platform-ports.js';");
  f.put('src/runtime/platform-ports.js','export const ports=true;');
  const repo=f.repository();
  assert.deepEqual(repo.dependencies('src/app/viewer.js'),
    ['src/runtime/runtime-context.js']);
  assert.deepEqual(repo.dependencies('src/runtime/runtime-context.js'),
    ['src/runtime/platform-ports.js']);
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
  assert.throws(() => f.repository().dependencies('apps/editor/missing.js'), /Missing dependency .*missing-dependency/);
  assert.throws(() => f.repository().dependencies('apps/editor/escape.js'), /outside repository|Missing dependency .*outside/);
});

test('a Viewer browser test with a missing public module fails instead of being retired', () => {
  const f = fixture();
  const path = 'tests/browser/terrain-missing.spec.mjs';
  f.put(path, "await import('/assets/js/modules/missing-viewer-module.js');");
  assert.throws(() => planApplicationChecks({ changedFiles: [path], repository: f.repository() }),
    /Missing dependency .*missing-viewer-module\.js/);
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
  f.put('src/runtime/unlinked.js', 'export const orphan = 1;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['src/runtime/unlinked.js'], repository: f.repository() }), /unclassified.*unlinked/i);
});

test('an unknown computed executable import fails with its owner and does not invent a dependency', () => {
  const f = fixture(); f.put('src/runtime/terrain.js', 'export const load = path => import(path);');
  assert.throws(() => planApplicationChecks({ changedFiles: ['src/runtime/terrain.js'], repository: f.repository() }), /dynamic.*terrain.js/i);
});

test('classic mixed arguments cannot hide a computed script behind a literal script', () => {
  const f = fixture();
  f.catalog.groups[1].inputs.push('src/rendering/workers/canvas-render-worker.js');
  f.put('src/rendering/workers/canvas-render-worker.js', "importScripts('./known.js', event.data.module);");
  f.put('src/runtime/workers/known.js', 'self.known = true;');
  assert.throws(() => planApplicationChecks({ changedFiles: ['src/rendering/workers/canvas-render-worker.js'], repository: f.repository() }), /dynamic.*canvas-render-worker/i);
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
  const g = fixture(); g.put('tests/unit/missing-fixture.test.mjs', "import '../fixtures/removed.json';");
  assert.throws(() => planApplicationChecks({ changedFiles: ['tests/unit/missing-fixture.test.mjs'], repository: g.repository() }), /missing.*removed.json/i);
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
 const f=fixture(),worker='src/runtime/workers/generated-meta-worker.js',owner='scripts/lib/frontend-build.mjs';
 f.put(worker,"importScripts('../build-meta.js');");f.put(owner,'export const generated = true;');
 f.catalog.groups[1].inputs.push(worker);const repo=f.repository();
 assert.equal(repo.exists('assets/js/build-meta.js'),false);
 assert.ok(repo.dependencies(worker).includes(owner));
 assert.ok(planApplicationChecks({changedFiles:[owner],repository:repo}).browserSpecs.includes('tests/browser/terrain-time.spec.mjs'));
});

test('reverse dependency graph selects only consuming features', () => {
  const edges = {
    'tests/unit/terrain.test.mjs': ['shared/terrain.js'],
    'shared/terrain.js': ['shared/decoded.js'],
    'tests/unit/objects.test.mjs': ['shared/objects.js'],
  };
  const index = createCheckImpactIndex({
    roots: ['tests/unit/terrain.test.mjs', 'tests/unit/objects.test.mjs'],
    dependencies: file => edges[file] || [],
  });
  const affected = index.affectedBy(['shared/decoded.js']);
  assert.deepEqual([...affected.get('tests/unit/terrain.test.mjs')], ['shared/decoded.js']);
  assert.equal(affected.has('tests/unit/objects.test.mjs'), false);
});

test('deleted files and parent directory changes keep their consumers', () => {
  const index = createCheckImpactIndex({
    roots: ['tests/unit/loader.test.mjs'],
    dependencies: path => path === 'tests/unit/loader.test.mjs' ? ['assets/data/catalog/index.json'] : [],
  });
  for (const changed of ['assets/data/catalog/index.json', 'assets/data/catalog']) {
    const affected = index.affectedBy([changed]);
    assert.ok(affected.get('tests/unit/loader.test.mjs')?.has(changed));
  }
});

test('current group names select only requested work, unknown names fail closed', () => {
  const catalog = { groups: [{ id: 'viewer', kind: 'browser' }, { id: 'gis', kind: 'unit' }] };
  assert.deepEqual(selectionRequest(catalog, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_GROUPS: 'viewer, gis',
    BROWSER_SCOPE: 'default', CHECK_SCOPE: 'auto',
  }), { groups: ['viewer', 'gis'], diff: false });
  assert.throws(() => selectionRequest(catalog, { CHECK_GROUPS: 'obsolete' }), /Unknown check group/);
  assert.deepEqual(selectionRequest(catalog, {
    GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'default', CHECK_SCOPE: 'auto',
  }), { groups: [], diff: true });
});
