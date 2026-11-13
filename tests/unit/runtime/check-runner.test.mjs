import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isolatedTestWorkspace } from "../../helpers/check-workspace-fixture.mjs";
import { join } from 'node:path';
import { collectChanges } from "../../../scripts/lib/check-changes.mjs";
import {planUnitTestBatches, UNIT_BATCH_LIMIT} from "../../../scripts/lib/unit-test-batches.mjs";
import {unitIsolationResource, requiresUnitIsolation} from "../../../scripts/lib/unit-test-isolation.mjs";
import { executePlan as executeCiPlan, executionOutputs, selectionRequest } from "../../../scripts/run-application-checks.mjs";
import * as runner from "../../../scripts/run-application-checks.mjs";

const executePlan=(plan,options)=>executeCiPlan(plan,{...options,environment:{GITHUB_ACTIONS:'true'}});

test('Playwright imports in selected unit suites request a browser only in their non-browser phase',()=>{
 const repository={catalog:{groups:[],prerequisites:{},metadataOnlyTests:[]},
   read:file=>file.endsWith('with-browser.test.mjs')
     ? "import {chromium} from '@playwright/test';" : "import test from 'node:test';"};
 const plan={prerequisites:[],commands:[],
   unitTests:['tests/unit/rendering/with-browser.test.mjs'],browserSpecs:[]};
 assert.equal(executionOutputs(plan,{repository,phase:'non-browser'}).unit_browser,true);
 assert.equal(executionOutputs(plan,{repository,phase:'browser'}).unit_browser,false);
 assert.equal(executionOutputs({...plan,unitTests:['tests/unit/ordinary.test.mjs']},
   {repository,phase:'non-browser'}).unit_browser,false);
});

test('only proven metadata-only unit selections omit runtime data preparation',()=>{
 const repository={catalog:{groups:[],prerequisites:{},metadataOnlyTests:['tests/unit/planner.test.mjs']}};
 const plan={prerequisites:[],commands:[],unitTests:['tests/unit/planner.test.mjs'],browserSpecs:[]};
 assert.equal(executionOutputs(plan,{repository}).runtime_data,false);
 assert.equal(executionOutputs({...plan,unitTests:['tests/unit/unknown.test.mjs']},{repository}).runtime_data,true);
 assert.equal(executionOutputs({...plan,browserSpecs:['tests/browser/startup.spec.mjs'],browserPrerequisites:[]},{repository}).runtime_data,true);
 assert.equal(executionOutputs({...plan,browserSpecs:['tests/browser/startup.spec.mjs'],browserPrerequisites:[]},{repository,phase:'non-browser'}).runtime_data,false);
 assert.equal(executionOutputs({...plan,commands:['check-data']},{repository}).runtime_data,true);
});

test('check commands retain the supplied process environment and prerequisite overrides',()=>{
 const repository={root:'/fixture',catalog:{prerequisites:{sample:{argv:['node','sample.mjs'],env:{INHERITED:'override',EXTRA:'{root}/input'}}},groups:[]}};
 const plan={prerequisites:['sample'],commands:[],unitTests:[],browserSpecs:[],unitTestPrerequisites:{},reasons:{}};
 let received;const result=executeCiPlan(plan,{repository,environment:{INHERITED:'original',OTHER:'preserved'},run:(_argv,options)=>{received=options.env;return {status:0};}});
 assert.equal(result.ok,true);assert.deepEqual(received,{INHERITED:'override',OTHER:'preserved',EXTRA:'/fixture/input'});
});

test('local native selection routes only selected checks to CI without local commands',()=>{
 const plan={prerequisites:['native-image'],commands:[],unitTests:['tests/unit/image.test.mjs'],browserSpecs:[],unitTestPrerequisites:{},reasons:{}};
 const repository={root:'/fixture',catalog:{prerequisites:{'native-image':{argv:['cmake']}},groups:[]}},requests=[];
 const result=executeCiPlan(plan,{repository,environment:{},run:()=>assert.fail('local native command'),remote:r=>{requests.push(r.selection);return {ok:true,results:[]};}});
 assert.equal(result.ok,true);assert.deepEqual(requests,[{unitTests:plan.unitTests,browserSpecs:[],commands:[],prerequisites:[]}]);
});

test('explicit native-only requests produce a non-browser CI job and execute the requested tool',()=>{
 const repository={root:'/fixture',catalog:{prerequisites:{'native-image':{argv:['node','prepare.mjs','image']}},groups:[]}};
 const plan={prerequisites:['native-image'],explicitPrerequisites:['native-image'],commands:[],unitTests:[],browserSpecs:[],reasons:{}};
 const outputs=executionOutputs(plan,{repository,phase:'non-browser'});assert.equal(outputs.checks,true);assert.equal(outputs.non_browser,true);assert.deepEqual(outputs.native_requirements,['image']);
 const calls=[];const result=executePlan(plan,{repository,phase:'non-browser',run:argv=>{calls.push(argv);return{status:0}}});
 assert.equal(result.ok,true);assert.deepEqual(calls,[['node','prepare.mjs','image']]);
 let routed;executeCiPlan(plan,{repository,phase:'non-browser',environment:{},run:()=>assert.fail('local preparation'),remote:r=>{routed=r.selection;return{ok:true,results:[]};}});assert.deepEqual(routed.prerequisites,['native-image']);
});

test('local comparison includes commits, index, working tree, untracked and both rename paths', t => {
  const root = isolatedTestWorkspace(t, 'pando-check-diff-');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'old.txt'), 'base'); writeFileSync(join(root, 'cancel.txt'), 'base'); writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  git('mv', 'old.txt', 'renamed.txt'); git('commit', '-qm', 'rename');
  writeFileSync(join(root, 'staged.txt'), 'staged'); git('add', 'staged.txt');
  writeFileSync(join(root, 'cancel.txt'), 'index version'); git('add', 'cancel.txt');
  writeFileSync(join(root, 'cancel.txt'), 'base');
  writeFileSync(join(root, 'renamed.txt'), 'working'); writeFileSync(join(root, 'untracked.txt'), 'new');
  writeFileSync(join(root, 'ignored.txt'), 'ignored');
  assert.deepEqual(collectChanges({ root, base, head:'HEAD', event:'local' }).files, ['cancel.txt', 'old.txt', 'renamed.txt', 'staged.txt', 'untracked.txt']);
  assert.deepEqual(collectChanges({ root, base, head:'HEAD', event: 'push' }).files, ['old.txt', 'renamed.txt']);
  assert.throws(() => collectChanges({ root, head:'HEAD', event:'local', base: 'missing-ref' }), /base|history/i);
});

test('prerequisites and identical commands execute once; failed prerequisites block consumers visibly', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: { generated: { argv: ['node', 'generate.mjs'] } },
    groups: [{ id: 'same', kind: 'command', argv: ['node', 'generate.mjs'] }] } };
  const plan = { prerequisites: ['generated'], commands: ['same'], unitTests: ['tests/unit/a.test.mjs'], browserSpecs: ['tests/browser/a.spec.mjs'], reasons: {} };
  const calls = [];
  const success = executePlan(plan, { repository, run: argv => { calls.push(argv); return { status: 0 }; } });
  assert.equal(success.ok, true); assert.equal(calls.filter(argv => argv.includes('generate.mjs')).length, 1);
  const failure = executePlan(plan, { repository, run: argv => ({ status: argv.includes('generate.mjs') ? 2 : 0 }) });
  assert.equal(failure.ok, false);
  assert.ok(failure.results.some(result => result.status === 'blocked' && result.id === 'browser'));
  assert.ok(failure.results.some(result => result.status === 'failed' && result.exitCode === 2));
});

test('missing tools and test process failures are failures, never skipped passes', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: {}, groups: [] } };
  const plan = { prerequisites: [], commands: [], unitTests: ['tests/unit/fails.test.mjs'], browserSpecs: [], reasons: {} };
  assert.equal(executePlan(plan, { repository, run: () => ({ status: 1 }) }).ok, false);
  assert.equal(executePlan(plan, { repository, run: () => { throw Error('ENOENT'); } }).ok, false);
});

test('shared report worktree suites run in dedicated processes after ordinary units', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: {}, groups: [] } };
  const files = ['tests/unit/data/place-publication.test.mjs','tests/unit/other.test.mjs'];
  const calls=[];
  const result=executePlan({prerequisites:[],commands:[],unitTests:files,browserSpecs:[]},
    {repository,phase:'non-browser',run:argv=>{calls.push(argv);return {status:0};}});
  assert.equal(result.ok,true);
  assert.deepEqual(calls.map(args=>args.filter(arg=>arg.startsWith('tests/unit/'))),[
    ['tests/unit/other.test.mjs'], ['tests/unit/data/place-publication.test.mjs'],
  ]);
});

test('a selected Hydro point-screen prerequisite installs its GIS build dependencies', () => {
  const repository={catalog:{prerequisites:{'native-hydro-point-screen':{argv:['node','prepare.mjs']}},groups:[]}};
  const plan={prerequisites:['native-hydro-point-screen'],commands:[],unitTests:['tests/unit/geometry/hydro-shared-boundary.test.mjs'],browserSpecs:[]};
  assert.equal(executionOutputs(plan,{repository,phase:'non-browser'}).gis_native,true);
});

test('a verifier runs again after a different profile replaces its staged input', () => {
  const groups = [
    { id: 'small-stage', argv: ['node', 'stage.mjs', 'small'] },
    { id: 'small-check', argv: ['node', 'check.mjs'], requires: ['small-stage'] },
    { id: 'world-stage', argv: ['node', 'stage.mjs', 'world'], requires: ['small-check'] },
    { id: 'world-check', argv: ['node', 'check.mjs'], requires: ['world-stage'] },
  ];
  let profile; const verified = [];
  const result = executePlan({ prerequisites: [], commands: groups.map(group => group.id), unitTests: [], browserSpecs: [] }, {
    repository: { root: '/fixture', catalog: { prerequisites: {}, groups } },
    run: argv => { if (argv[1] === 'stage.mjs') profile = argv[2]; else verified.push(profile); return { status: 0 }; },
  });
  assert.equal(result.ok, true); assert.deepEqual(verified, ['small', 'world']);
});

test('explicit manual coverage stays explicit while artifact auto dispatch stays affected-only', () => {
  const catalog = { groups: [{ id: 'units' }, { id: 'browser' }, { id: 'measurement', mode: 'manual' }],
    manualScopes: { focused: ['tests/browser/focused.spec.mjs'] }, remoteScopes: { p1: { ui: ['browser'] } } };
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'default' }), {groups:[],diff:true});
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'focused' }).specs, ['tests/browser/focused.spec.mjs']);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p1', CHECK_SCOPE: 'ui' }).groups, ['browser']);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p3', CHECK_SCOPE: 'auto' }).diff, true);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', BROWSER_SCOPE: 'focused' }).diff, true);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', CHECK_SCOPE: 'all' }).groups, ['units', 'browser']);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', CHECK_SCOPE: 'auto' }).diff, true);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', CHECK_SCOPE: 'all',
    CHECK_SELECTION: JSON.stringify({unitTests:[],browserSpecs:[],commands:[],prerequisites:[]}) }).exact,
  {unitTests:[],browserSpecs:[],commands:[],prerequisites:[]});
  assert.throws(() => selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'unknown' }), /Unsupported/);
});

function phasedFixture() {
  const repository = { root: '/fixture', catalog: {
    prerequisites: {
      core: { argv: ['node', 'core.mjs'] },
      generated: { argv: ['node', 'generate.mjs'], requires: ['core'] },
      'native-image': { argv: ['node', 'native.mjs'], requires: ['core'], env: { IMAGE: '{root}/image' } },
    },
    groups: [{ id: 'validation', argv: ['node', 'check.mjs'], requires: ['core'], gisNative: true }],
  } };
  const plan = { prerequisites: ['core', 'generated', 'native-image'], commands: ['validation'],
    unitTests: ['tests/unit/native.test.mjs'], unitTestPrerequisites: { 'tests/unit/native.test.mjs': ['native-image'] },
    browserSpecs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(id => 'tests/browser/' + id + '.spec.mjs'),
    browserPrerequisites: ['generated'], manualTests: ['tests/browser/manual.spec.mjs'], changedFiles: [] };
  return { repository, plan };
}

test('execution phases preserve the default sequence and run non-browser work only once', () => {
  const { repository, plan } = phasedFixture(), before = structuredClone(plan), all = [], nonBrowser = [];
  const complete = executePlan(plan, { repository, run: argv => { all.push(argv); return { status: 0 }; } });
  assert.deepEqual(all, [
    ['node', 'core.mjs'], ['node', 'generate.mjs'], ['node', 'native.mjs'], ['node', 'check.mjs'],
    ['node', '--test', '--test-concurrency=2', 'tests/unit/native.test.mjs'],
    ['node', 'node_modules/@playwright/test/cli.js', 'test', ...plan.browserSpecs, '--workers=1'],
  ]);
  assert.equal(complete.ok, true);
  const partial = executePlan(plan, { repository, phase: 'non-browser', run: argv => { nonBrowser.push(argv); return { status: 0 }; } });
  assert.equal(partial.ok, true);
  assert.deepEqual(nonBrowser, all.slice(0, -1));
  assert.deepEqual(partial.execution, { phase: 'non-browser', shard: null });
  assert.deepEqual(plan, before, 'Execution phases must preserve the complete canonical selection');
});

test('browser shards receive the complete original spec list and only browser prerequisite commands', () => {
  const { repository, plan } = phasedFixture(), before = structuredClone(plan);
  for (let current = 1; current <= 8; current++) {
    const calls = [], shard = current + '/8';
    const result = executePlan(plan, { repository, phase: 'browser', shard, run: argv => { calls.push(argv); return { status: 0 }; } });
    assert.deepEqual(calls, [
      ['node', 'core.mjs'], ['node', 'generate.mjs'],
      ['node', 'node_modules/@playwright/test/cli.js', 'test', ...plan.browserSpecs, '--workers=1', '--shard', shard],
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.execution, { phase: 'browser', shard });
    assert.deepEqual(plan, before);
  }
});

test('invalid execution phases and shards fail before any command is spawned', () => {
  const { repository, plan } = phasedFixture();
  const invalid = [
    { phase: 'unknown' }, { phase: '' }, { shard: '1/2' }, { phase: 'non-browser', shard: '1/2' },
    ...['', '0/2', '1/0', '3/2', '1/9', '1', '1/2x', '1.0/2', ' 1/2', '1/2 ', '1/9007199254740992']
      .map(shard => ({ phase: 'browser', shard })),
  ];
  for (const options of invalid) {
    const calls = [];
    assert.throws(() => executePlan(plan, { repository, ...options, run: argv => { calls.push(argv); return { status: 0 }; } }),
      /Invalid execution phase|Invalid browser shard|requires the browser phase/);
    assert.deepEqual(calls, []);
  }
  assert.throws(() => runner.main(['--phase', 'unknown'], {}), /Invalid execution phase/);
  assert.throws(() => runner.main(['--phase', 'browser', '--shard', '2/1'], {}), /Invalid browser shard/);
});

test('browser phase keeps failed browser prerequisites blocking and never runs native unit preparation', () => {
  const { repository, plan } = phasedFixture(), calls = [];
  const result = executePlan(plan, { repository, phase: 'browser', shard: '1/8', run: argv => {
    calls.push(argv); return { status: argv.includes('generate.mjs') ? 9 : 0 };
  } });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [['node', 'core.mjs'], ['node', 'generate.mjs']]);
  assert.ok(result.results.some(row => row.id === 'browser' && row.status === 'blocked'));
});

test('empty browser and non-browser phases execute no unrelated work', () => {
  const { repository, plan } = phasedFixture();
  for (const [phase, empty] of [
    ['browser', { ...plan, browserSpecs: [] }],
    ['non-browser', { ...plan, unitTests: [], commands: [] }],
  ]) {
    const calls = [], result = executePlan(empty, { repository, phase, run: argv => { calls.push(argv); return { status: 0 }; } });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, []);
    assert.deepEqual(result.results, []);
  }
});

test('execution CI outputs bound a nonempty browser matrix and keep native setup phase-specific', () => {
  const { repository, plan } = phasedFixture();
  for (const count of [0, 1, 2, 4, 5, 8, 9]) {
    const selected = { ...plan, browserSpecs: plan.browserSpecs.slice(0, count) };
    const outputs = runner.executionOutputs(selected, { repository });
    const total = Math.min(8, Math.ceil(count / 4));
    assert.equal(outputs.browser, count > 0);
    assert.equal(outputs.non_browser, true);
    assert.equal(outputs.browser_count, count);
    assert.deepEqual(outputs.browser_matrix, { include: Array.from({ length: total }, (_, i) => ({ current: i + 1, total })) });
    assert.deepEqual(outputs.native_requirements, ['image']);
  }
  const browser = runner.executionOutputs(plan, { repository, phase: 'browser', shard: '1/8' });
  assert.deepEqual(browser.native_requirements, []);
  assert.equal(browser.gis_native, false);
  const empty = runner.executionOutputs({ ...plan, unitTests: [], commands: [], browserSpecs: [] }, { repository });
  assert.equal(empty.checks, false);
  assert.equal(empty.non_browser, false);
  assert.equal(empty.browser, false);
  assert.deepEqual(empty.browser_matrix, { include: [] });
});


test('P3 full and affected unit entrypoints share stable prerequisite-bounded batches', () => {
  const files = ['tests/unit/plain.test.mjs', 'tests/unit/native.test.mjs',
    'tests/unit/again.test.mjs', 'tests/unit/isolate.test.mjs'];
  const requirements = new Map([['tests/unit/native.test.mjs', ['native-map-image']]]);
  const batches = planUnitTestBatches(files, {requirements,
    isolation: name => name.endsWith('/isolate.test.mjs'), limit: 2});
  assert.equal(UNIT_BATCH_LIMIT, 30);
  assert.deepEqual(batches.map(row => row.files), [
    ['tests/unit/plain.test.mjs','tests/unit/again.test.mjs'],
    ['tests/unit/native.test.mjs'], ['tests/unit/isolate.test.mjs']]);
  assert.deepEqual(batches.map(row => row.required), [[], ['native-map-image'], []]);
  assert.equal(batches.at(-1).isolated, true);
  assert.throws(() => planUnitTestBatches(files, {limit: 0}), /Invalid unit batch limit/);
});


test('P4 isolation policy binds active shared report owners, never an untracked dummy suite', () => {
  for (const file of ['tests/unit/data/place-publication.test.mjs']) {
    assert.equal(unitIsolationResource(file), 'shared-report-worktree');
    assert.equal(requiresUnitIsolation(file), true);
  }
  assert.equal(requiresUnitIsolation('tests/unit/reference-cache-cleanup.test.mjs'), false);
  assert.equal(unitIsolationResource('tests/unit/other.test.mjs'), null);
});


test('P5 CI unit test arguments are forwarded without dropping prerequisites', () => {
  const repository={root:'/fixture',catalog:{prerequisites:{core:{argv:['node','core.mjs']}},groups:[]}};
  const plan={prerequisites:[],commands:[],unitTests:['tests/unit/core-contract.test.mjs'],
    unitTestPrerequisites:{'tests/unit/core-contract.test.mjs':['core']},browserSpecs:[]};
  const calls=[],result=executePlan(plan,{repository,phase:'non-browser',
    unitTestArgs:['--test-name-pattern=contract'],run:(argv,options)=>{calls.push({argv,options});return{status:0};}});
  assert.equal(result.ok,true);
  assert.ok(calls.some(row=>row.argv.includes('core.mjs')));
  assert.ok(calls.some(row=>row.argv.includes('--test-name-pattern=contract')));
  assert.throws(()=>executePlan(plan,{repository,unitTestArgs:'invalid'}),/Invalid unit test arguments/);
});


// Contract-only checks: execution is injected, so these tests never launch a compiler or CI.
async function clippedVerificationFixture() {
  const {matchesPattern} = await import('../../../scripts/plan-application-checks.mjs');
  const catalog = JSON.parse(readFileSync(new URL('../../../scripts/contracts/application-checks.json', import.meta.url), 'utf8'));
  const unitTests = [
    'tests/unit/geometry/polygon-clipped-positive-ring.test.mjs',
    'tests/unit/geometry/polygon-geometry.test.mjs',
    'tests/unit/document/historical-world-territories.test.mjs',
    'tests/unit/geometry/gpu-mesh-country-strokes.test.mjs',
    'tests/unit/geometry/map-geometry-validation.test.mjs',
    'tests/unit/rendering/country-mesh-preparation.test.mjs',
  ];
  const owners = new Map(unitTests.map(file => [file, catalog.groups.find(group =>
    group.testPatterns?.some(pattern => matchesPattern(file, pattern)))]));
  for (const [file, owner] of owners) assert.ok(owner, 'Registered owner for ' + file);
  const unitRequirements = new Map(unitTests.map(file => [file, new Set([
    ...(owners.get(file).requires || []), ...catalog.unitPrerequisites.filter(binding =>
      binding.tests.some(pattern => matchesPattern(file, pattern)) && !binding.excludeTests?.includes(file)).flatMap(binding => binding.requires),
  ])]));
  const repository = {root:'/fixture', catalog, tests:unitTests, owners, unitRequirements};
  const selection = {unitTests, browserSpecs:[], commands:[
    'spherical-polygon-native', 'polygon-mesh-native', 'wasm-domain-geometry',
  ], prerequisites:[]};
  return {repository, selection, plan:runner.exactCheckPlan(repository, selection)};
}

test('clipped verification registers only two native targets and the exact matching-WASM fixture checks', async () => {
  const {repository, selection, plan} = await clippedVerificationFixture();
  assert.deepEqual(plan.commands, [...selection.commands].sort());
  assert.deepEqual(plan.unitTests, [...selection.unitTests].sort());
  assert.deepEqual(plan.prerequisites, ['core-assets','native-polygon-mesh-tests','native-spherical-polygon-tests']);
  assert.deepEqual(plan.unitTestPrerequisites['tests/unit/geometry/polygon-clipped-positive-ring.test.mjs'], ['core-assets']);
  assert.deepEqual(executionOutputs(plan,{repository,phase:'non-browser'}).native_requirements,
    ['polygon-mesh-tests','spherical-polygon-tests']);
  assert.equal(executionOutputs(plan,{repository}).browser, false);
  assert.equal(repository.catalog.prerequisites.core.env,undefined, 'General Core override semantics stay unchanged');
  assert.throws(() => runner.exactCheckPlan(repository,{...selection,commands:['native-gis']}), /Unknown selected command/);
  assert.throws(() => runner.exactCheckPlan(repository,{...selection,prerequisites:['native-all']}), /Unknown selected native tool/);
});

test('clipped verification local selection dispatches the exact checks without executing local native work', async () => {
  const {repository, selection, plan} = await clippedVerificationFixture();
  const requests=[];
  const result=executeCiPlan(plan,{repository,environment:{},phase:'non-browser',
    run:()=>assert.fail('No local compiler, WASM process, or CI command may execute in this test'),
    remote:request=>{requests.push(request.selection);return{ok:true,results:[]};}});
  assert.equal(result.ok,true);
  assert.deepEqual(requests,[{...selection,unitTests:[...selection.unitTests].sort(),commands:[...selection.commands].sort()}]);
});

test('clipped verification recipes build existing targets only, with no packaging or full matrix', async () => {
  const {nativeTestRecipe}=await import('../../../scripts/lib/native-test-prerequisites.mjs');
  const options={platform:'linux',architecture:'x64'};
  assert.deepEqual(nativeTestRecipe('spherical-polygon-tests',options),{commands:[
    ['cmake','--preset','pando-gis-tools'],
    ['cmake','--build','build-native/p1/pando-gis-tools','--config','Release','--target','pando-spherical-polygon-tests','--parallel','2'],
  ]});
  assert.deepEqual(nativeTestRecipe('polygon-mesh-tests',options),{commands:[
    ['cmake','-S','tools/build/native','-B','build-native/geometry-core','-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTING=ON'],
    ['cmake','--build','build-native/geometry-core','--config','Release','--target','polygon_mesh_tests','--parallel','2'],
  ]});
  assert.throws(()=>nativeTestRecipe('polygon-mesh-tests',{platform:'win32',architecture:'x64'}),/Linux x64/);
  const {repository}=await clippedVerificationFixture();
  for(const [id,directory,pattern] of [
    ['spherical-polygon-native','build-native/p1/pando-gis-tools','^spherical-polygon-normalization$'],
    ['polygon-mesh-native','build-native/geometry-core','^polygon_mesh_tests$'],
  ])assert.deepEqual(repository.catalog.groups.find(row=>row.id===id).argv,
    ['ctest','--test-dir',directory,'-C','Release','--output-on-failure','--no-tests=error','-R',pattern]);
});

test('clipped verification checks paired Core before fixture and WASM consumers, overrides stale module paths', async () => {
  const {repository, plan}=await clippedVerificationFixture(), calls=[];
  const result=executeCiPlan(plan,{repository,phase:'non-browser',environment:{GITHUB_ACTIONS:'true',PANDOEDITOR_WASM_MODULE:'/stale/core.js'},
    run:(argv,options)=>{calls.push({argv,env:options.env});return{status:0};}});
  assert.equal(result.ok,true);
  const core=calls.findIndex(row=>row.argv.includes('scripts/check-core-prerequisite.mjs'));
  const wasm=calls.findIndex(row=>row.argv.includes('tests/native/document/p5-polygon-mesh-wasm.test.mjs'));
  const fixtures=calls.findIndex(row=>row.argv.includes('tests/unit/geometry/polygon-clipped-positive-ring.test.mjs'));
  assert.ok(core>=0 && wasm>core && fixtures>core);
  assert.equal(calls[wasm].env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
  assert.equal(calls[core].env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
  for(const row of calls.filter(row=>row.argv.some(file=>plan.unitTests.includes(file))))
    assert.equal(row.env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
  assert.deepEqual(calls.filter(row=>row.argv[0]==='ctest').map(row=>row.argv.at(-1)).sort(),
    ['^polygon_mesh_tests$','^spherical-polygon-normalization$']);
  assert.equal(calls.filter(row=>row.argv.includes('scripts/check-core-prerequisite.mjs')).length,1);
});

test('clipped verification source-WASM mismatch blocks fixture and WASM consumers without a skipped pass', async () => {
  const {repository, plan}=await clippedVerificationFixture(), calls=[];
  const result=executeCiPlan(plan,{repository,phase:'non-browser',environment:{GITHUB_ACTIONS:'true'},
    run:argv=>{calls.push(argv);return{status:argv.includes('scripts/check-core-prerequisite.mjs')?1:0};}});
  assert.equal(result.ok,false);
  assert.ok(result.results.some(row=>row.id==='core-assets' && row.status==='failed'));
  assert.ok(result.results.some(row=>row.id==='wasm-domain-geometry' && row.status==='blocked'));
  for(const file of plan.unitTests)assert.ok(result.results.some(row=>
    row.id==='unit' && row.status==='blocked' && row.files?.includes(file)),file);
  assert.equal(calls.some(argv=>argv.includes('tests/unit/geometry/polygon-clipped-positive-ring.test.mjs')),false);
  assert.equal(calls.some(argv=>argv.includes('tests/native/document/p5-polygon-mesh-wasm.test.mjs')),false);
});

test('clipped verification installs Zlib only for selected native Core targets', () => {
  const action=readFileSync(new URL('../../../.github/actions/native-test-prerequisites/action.yml',import.meta.url),'utf8');
  assert.match(action,/if: contains\(fromJSON\(inputs.requirements\), 'polygon-mesh-tests'\)/);
  assert.match(action,/\|\| contains\(fromJSON\(inputs.requirements\), 'document-session-tests'\)/);
  assert.match(action,/run: sudo apt-get install -y zlib1g-dev/);
});


async function canonicalStorageVerificationFixture() {
  const {repository,selection}=await clippedVerificationFixture();
  const {matchesPattern}=await import('../../../scripts/plan-application-checks.mjs');
  for(const file of ['tests/unit/geometry/polygon-canonical-storage.test.mjs','tests/unit/document/core-geometry-resources-wasm.test.mjs']) {
    selection.unitTests.push(file);
    const owner=repository.catalog.groups.find(group=>group.testPatterns?.some(pattern=>matchesPattern(file,pattern)));
    assert.ok(owner);repository.owners.set(file,owner);
    repository.unitRequirements.set(file,new Set([...(owner.requires||[]),...repository.catalog.unitPrerequisites.filter(binding=>
      binding.tests.some(pattern=>matchesPattern(file,pattern)) && !binding.excludeTests?.includes(file)).flatMap(binding=>binding.requires)]));
  }
  selection.commands.push('document-session-native');
  return {repository,selection,plan:runner.exactCheckPlan(repository,selection)};
}

test('canonical storage verification adds only the existing document session native target and its two JS consumers',async()=>{
  const {repository,selection,plan}=await canonicalStorageVerificationFixture();
  assert.deepEqual(plan.commands,[...selection.commands].sort());
  assert.deepEqual(plan.unitTests,[...selection.unitTests].sort());
  assert.deepEqual(plan.prerequisites,['core-assets','native-document-session-tests','native-polygon-mesh-tests','native-spherical-polygon-tests']);
  assert.deepEqual(executionOutputs(plan,{repository,phase:'non-browser'}).native_requirements,
    ['document-session-tests','polygon-mesh-tests','spherical-polygon-tests']);
  assert.deepEqual(plan.unitTestPrerequisites['tests/unit/geometry/polygon-canonical-storage.test.mjs'],['core-assets']);
  assert.deepEqual(plan.unitTestPrerequisites['tests/unit/document/core-geometry-resources-wasm.test.mjs'],['core-assets']);
  const {nativeTestRecipe}=await import('../../../scripts/lib/native-test-prerequisites.mjs');
  assert.deepEqual(nativeTestRecipe('document-session-tests',{platform:'linux',architecture:'x64'}),{commands:[
    ['cmake','-S','tools/build/native','-B','build-native/geometry-core','-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTING=ON'],
    ['cmake','--build','build-native/geometry-core','--config','Release','--target','document_session_tests','--parallel','2'],
  ]});
  assert.deepEqual(repository.catalog.groups.find(row=>row.id==='document-session-native').argv,
    ['ctest','--test-dir','build-native/geometry-core','-C','Release','--output-on-failure','--no-tests=error','-R','^document_session_tests$']);
  const requests=[];assert.equal(executeCiPlan(plan,{repository,environment:{},phase:'non-browser',
    run:()=>assert.fail('No real native/CI command in this contract test'),remote:request=>{requests.push(request.selection);return{ok:true,results:[]};}}).ok,true);
  assert.deepEqual(requests,[{...selection,unitTests:[...selection.unitTests].sort(),commands:[...selection.commands].sort()}]);
});

test('canonical storage consumers require matching Core and fail closed on source-WASM mismatch',async()=>{
  const {repository,plan}=await canonicalStorageVerificationFixture();
  for(const mismatch of [false,true]) {
    const calls=[];const result=executeCiPlan(plan,{repository,environment:{GITHUB_ACTIONS:'true',PANDOEDITOR_WASM_MODULE:'/stale/core.js'},phase:'non-browser',
      run:(argv,options)=>{calls.push({argv,env:options.env});return {status:mismatch&&argv.includes('scripts/check-core-prerequisite.mjs')?1:0};}});
    assert.equal(result.ok,!mismatch);
    const checkers=calls.filter(row=>row.argv.includes('scripts/check-core-prerequisite.mjs'));
    assert.equal(checkers.length,1);
    assert.ok(checkers.every(row=>row.env.PANDOEDITOR_WASM_MODULE==='/fixture/assets/wasm/pandoeditor-core.js'));
    for(const file of ['tests/unit/geometry/polygon-canonical-storage.test.mjs','tests/unit/document/core-geometry-resources-wasm.test.mjs']) {
      const execution=calls.find(row=>row.argv.includes(file));
      if(mismatch){assert.equal(execution,undefined);assert.ok(result.results.some(row=>row.id==='unit'&&row.status==='blocked'&&row.files?.includes(file)));}
      else {assert.ok(execution);assert.equal(execution.env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
        assert.ok(calls.findIndex(row=>row.argv.includes('scripts/check-core-prerequisite.mjs'))<calls.indexOf(execution));}
    }
  }
});


test('exact unit prerequisite exclusion moves only the canonical resource check to paired assets',async t=>{
 const {loadRepository}=await import('../../../scripts/plan-application-checks.mjs');
 const root=isolatedTestWorkspace(t,'pando-check-exclusion-');
 mkdirSync(join(root,'tests/unit/document'),{recursive:true});
 const resource='tests/unit/document/core-geometry-resources-wasm.test.mjs',other='tests/unit/document/core-other-wasm.test.mjs';
 for(const file of [resource,other])writeFileSync(join(root,file),'export {};');
 const catalog={schema:'pando-application-checks-v1',groups:[{id:'units',kind:'unit',testPatterns:['tests/unit/**/*.test.mjs']}],
  prerequisites:{core:{argv:['node','-v']},'core-assets':{argv:['node','-v'],env:{PANDOEDITOR_WASM_MODULE:'{root}/assets/wasm/pandoeditor-core.js'}}},
  unitPrerequisites:[{tests:['tests/unit/**/core-*.test.mjs','tests/unit/**/*-wasm.test.mjs'],requires:['core'],excludeTests:[resource]},
   {tests:[resource],requires:['core-assets']}]};
 const repository=loadRepository(root,{catalog,libraryFiles:{}});
 assert.deepEqual([...repository.unitRequirements.get(resource)],['core-assets']);
 assert.deepEqual([...repository.unitRequirements.get(other)],['core']);
 for(const excluded of [null,'wrong',[3],['tests/unit/document/missing.test.mjs'],['tests/unit/**/core-*.test.mjs']]) {
  const invalid=structuredClone(catalog);invalid.unitPrerequisites[0].excludeTests=excluded;
  assert.throws(()=>loadRepository(root,{catalog:invalid,libraryFiles:{}}),/Invalid unit prerequisite exclusion/);
 }
});


test('prepared scene verification pins only its exact Core assets and blocks a source-WASM mismatch',async()=>{
  const {repository}=await canonicalStorageVerificationFixture();
  const {matchesPattern}=await import('../../../scripts/plan-application-checks.mjs');
  const file='tests/unit/rendering/prepared-country-scene.test.mjs';
  const owner=repository.catalog.groups.find(group=>group.testPatterns?.some(pattern=>matchesPattern(file,pattern)));
  assert.ok(owner);repository.tests.push(file);repository.owners.set(file,owner);
  repository.unitRequirements.set(file,new Set([...(owner.requires||[]),...repository.catalog.unitPrerequisites.filter(binding=>
    binding.tests.some(pattern=>matchesPattern(file,pattern))&&!binding.excludeTests?.includes(file)).flatMap(binding=>binding.requires)]));
  const plan=runner.exactCheckPlan(repository,{unitTests:[file],browserSpecs:[],commands:[],prerequisites:[]});
  assert.deepEqual(plan.unitTests,[file]);assert.deepEqual(plan.commands,[]);
  assert.deepEqual(plan.prerequisites,['core-assets']);
  assert.deepEqual(plan.unitTestPrerequisites[file],['core-assets']);
  assert.deepEqual(executionOutputs(plan,{repository,phase:'non-browser'}).native_requirements,[]);
  assert.equal(repository.catalog.prerequisites.core.env,undefined);
  for(const mismatch of [false,true]) {
    const calls=[];const result=executeCiPlan(plan,{repository,phase:'non-browser',
      environment:{GITHUB_ACTIONS:'true',PANDOEDITOR_WASM_MODULE:'/stale/core.js'},
      run:(argv,options)=>{calls.push({argv,env:options.env});return{status:mismatch&&argv.includes('scripts/check-core-prerequisite.mjs')?1:0};}});
    assert.equal(result.ok,!mismatch);
    const checker=calls.filter(row=>row.argv.includes('scripts/check-core-prerequisite.mjs'));
    assert.equal(checker.length,1);assert.equal(checker[0].env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
    const execution=calls.find(row=>row.argv.includes(file));
    if(mismatch) {
      assert.equal(execution,undefined);
      assert.ok(result.results.some(row=>row.id==='core-assets'&&row.status==='failed'));
      assert.ok(result.results.some(row=>row.id==='unit'&&row.status==='blocked'&&row.files?.includes(file)));
    } else {
      assert.ok(execution);assert.equal(execution.env.PANDOEDITOR_WASM_MODULE,'/fixture/assets/wasm/pandoeditor-core.js');
      assert.ok(calls.indexOf(checker[0])<calls.indexOf(execution));
    }
  }
});

// Exact CI requests may use the standard --option=value CLI spelling.
import {main as checkMain} from '../../../scripts/run-application-checks.mjs';
test('inline check option values reach their normal validation',()=>{
 assert.throws(()=>checkMain(['--phase=unknown'],{}),/Invalid execution phase/);
 assert.throws(()=>checkMain(['--group='],{}),/Missing check option value/);
});
