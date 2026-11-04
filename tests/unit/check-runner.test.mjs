import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectChanges } from '../../scripts/lib/check-changes.mjs';
import { executePlan as executeCiPlan, executionOutputs, selectionRequest } from '../../scripts/run-application-checks.mjs';
import * as runner from '../../scripts/run-application-checks.mjs';

const executePlan=(plan,options)=>executeCiPlan(plan,{...options,environment:{GITHUB_ACTIONS:'true'}});

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
  const root = mkdtempSync(join(tmpdir(), 'pando-check-diff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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

test('shared report and cleanup fixtures run separately after other unit tests', () => {
  const repository = { root: '/fixture', catalog: { prerequisites: {}, groups: [] } };
  const files = ['tests/unit/place-publication.test.mjs','tests/unit/other.test.mjs',
    'tests/unit/place-sync-contract.test.mjs','tests/unit/reference-cache-cleanup.test.mjs'];
  const calls=[];
  const result=executePlan({prerequisites:[],commands:[],unitTests:files,browserSpecs:[]},
    {repository,phase:'non-browser',run:argv=>{calls.push(argv);return {status:0};}});
  assert.equal(result.ok,true);
  assert.deepEqual(calls.map(args=>args.filter(arg=>arg.startsWith('tests/unit/'))),[
    ['tests/unit/other.test.mjs'],['tests/unit/place-publication.test.mjs'],
    ['tests/unit/place-sync-contract.test.mjs'],['tests/unit/reference-cache-cleanup.test.mjs'],
  ]);
});

test('a selected Hydro point-screen prerequisite installs its GIS build dependencies', () => {
  const repository={catalog:{prerequisites:{'native-hydro-point-screen':{argv:['node','prepare.mjs']}},groups:[]}};
  const plan={prerequisites:['native-hydro-point-screen'],commands:[],unitTests:['tests/unit/hydro-shared-boundary.test.mjs'],browserSpecs:[]};
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
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'default' }).groups, ['units', 'browser']);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: 'focused' }).specs, ['tests/browser/focused.spec.mjs']);
  assert.deepEqual(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p1', CHECK_SCOPE: 'ui' }).groups, ['browser']);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'workflow_dispatch', CHECK_PROFILE: 'p3', CHECK_SCOPE: 'auto' }).diff, true);
  assert.equal(selectionRequest(catalog, { GITHUB_EVENT_NAME: 'push', BROWSER_SCOPE: 'focused' }).diff, true);
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
    const total = Math.min(8, count);
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
