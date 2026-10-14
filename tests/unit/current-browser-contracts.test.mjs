import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { APPLICATION_SCOPES, FOCUSED_BROWSER_SPECS, MANUAL_SCOPES, applicationScopes,
  completeBrowserSpecs, loadRepository, planApplicationChecks, runApplicationPlanner } from '../../scripts/plan-application-checks.mjs';

const workflow = parseYaml(readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8'));
const workflows = ['application-architecture', 'ui-architecture', 'place-runtime', 'reference-image-integration']
  .map(name => ({ name, document: parseYaml(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')) }));
const specPath = name => `tests/browser/${name}.spec.mjs`;
const smoke = ['boundary-cut-snapping', 'country-label-flags', 'generic-feature-independent-geometry',
  'hydro-metadata-edit', 'storage-protection', 'ui-components', 'gis-interchange'].map(specPath).sort();

function fixtureRepository({ specs = [specPath('changed'), specPath('consumer'), specPath('unrelated')],
  imports = {}, missing = [], configuration = workflow, cases = {} } = {}) {
  return { exists: file => !missing.includes(file), browserSpecs: specs, sourceFiles: Object.keys(imports),
    dependencies: file => imports[file] || [], workflow: configuration, listTests: spec => cases[spec] || [] };
}
const plan = (changedFiles, options = {}) => planApplicationChecks({ changedFiles,
  repository: fixtureRepository(), ...options });
const allScopes = enabled => Object.fromEntries(APPLICATION_SCOPES.map(name => [name, enabled]));

test('changed specs and transitive helper consumers follow the current graph with cycles', () => {
  const repository = fixtureRepository({ imports: {
    [specPath('consumer')]: ['tests/browser/helpers/renamed.mjs'],
    'tests/browser/helpers/renamed.mjs': ['tests/helpers/leaf.mjs'],
    'tests/helpers/leaf.mjs': ['tests/browser/helpers/renamed.mjs'],
  } });
  assert.deepEqual(plan([specPath('changed'), 'tests/helpers/leaf.mjs'], { repository }).browserSpecs,
    [specPath('changed'), specPath('consumer')]);
});

test('conditionally imported diagnostic helpers retain their actual browser consumer', () => {
  const repository = loadRepository(new URL('../../', import.meta.url), { listTests: () => [] });
  assert.ok(repository.dependencies('assets/js/workers/data-loader-worker.js')
    .includes('assets/js/modules/startup-readiness.js'), 'revision query templates preserve their real module pathname');
  for (const helper of ['long-animation-frame-diagnostics', 'native-action-diagnostics', 'native-action-timeline']) {
    assert.ok(plan([`tests/browser/helpers/${helper}.mjs`], { repository: { ...repository, sourceFiles: [] } })
      .browserSpecs.includes(specPath('boundary-cut-snapping')), helper);
  }
  assert.deepEqual(plan(['tests/helpers/not-an-import.mjs']).browserSpecs, []);
});

test('renderer source changes retain bounded scopes and new dependencies inherit their owner', () => {
  const result = plan(['assets/js/modules/gpu-map-renderer.js']);
  assert.deepEqual(result.browserSpecs, []);
  assert.equal(result.scopes.scene_staging, true);
  assert.equal(result.scopes.boundary_continuity, true);
  const repository = fixtureRepository({ imports: {
    'assets/js/modules/render-scene.js': ['assets/js/modules/renamed-render-resource.js'],
  } });
  assert.equal(applicationScopes(['assets/js/modules/renamed-render-resource.js'], 'default', 'push', repository).scene_staging, true);
});

test('infrastructure and fixtures select only the bounded smoke policy', () => {
  for (const file of ['tests/browser/server.mjs', 'playwright.config.js', 'package.json', 'pnpm-lock.yaml',
    'eslint.config.js', 'scripts/plan-application-checks.mjs', 'tests/fixtures/renamed-fixture.json']) {
    assert.deepEqual(plan([file]).browserSpecs, smoke, file);
  }
});

test('complete coverage follows current workflow commands instead of copied spec names', () => {
  const whole = specPath('renamed-whole'), partial = specPath('renamed-partial');
  const configuration = { jobs: {
    full: { if: "needs.changes.outputs.scene-staging == 'true'", steps: [{ run: `pnpm exec playwright test ${whole}` }] },
    partial: { if: "needs.changes.outputs.visual-policy == 'true'", steps: [{ run: `pnpm exec playwright test ${partial} --grep='some behavior'` }] },
    diagnostic: { if: "github.event_name == 'workflow_dispatch'", steps: [{ run: `pnpm exec playwright test ${partial}` }] },
  } };
  assert.deepEqual(plan([whole, partial], { repository: fixtureRepository({ specs: [whole, partial], configuration }) }).browserSpecs, [partial]);
});

test('matrix-filtered coverage requires discovery to prove all current cases are covered', () => {
  const spec = specPath('renamed-renderer');
  const configuration = { jobs: { renderer: {
    if: "needs.changes.outputs.preview-handoff == 'true'", strategy: { matrix: { backend: ['canvas', 'webgl2'] } },
    steps: [{ run: `pnpm exec playwright test ${spec} --grep='\${{ matrix.backend }} '` }],
  } } };
  assert.deepEqual([...completeBrowserSpecs(configuration, () => ['canvas changed title', 'webgl2 another title'])], [spec]);
  assert.deepEqual([...completeBrowserSpecs(configuration, () => ['canvas case', 'unfiltered new behavior'])], []);
  assert.deepEqual([...completeBrowserSpecs(configuration, () => [])], []);
});

test('current complete jobs avoid duplication while partial jobs keep complete changed specs', () => {
  const complete = ['edit-preview-handoff', 'territorial-boundary-continuity', 'gpu-scene-staging', 'visual-frame-sync'].map(specPath);
  const partial = ['selection-interaction-style', 'interaction-unification'].map(specPath).sort();
  const repository = fixtureRepository({ specs: [...complete, ...partial], configuration: workflow,
    cases: { [specPath('edit-preview-handoff')]: ['canvas case', 'webgl2 case'] } });
  assert.deepEqual(plan([...complete, ...partial], { repository }).browserSpecs, partial);
});

test('default manual dispatch keeps changed specs, bounded smoke and all application scopes', () => {
  for (const browserScope of [undefined, '', 'default']) {
    const result = plan([specPath('changed')], { eventName: 'workflow_dispatch', browserScope });
    assert.deepEqual(result.browserSpecs, [...smoke, specPath('changed')].sort());
    assert.deepEqual(result.scopes, allScopes(true));
  }
});

test('focused dispatches isolate their intended scopes and never inspect the diff', () => {
  for (const browserScope of MANUAL_SCOPES.filter(scope => scope !== 'default')) {
    let output;
    const result = runApplicationPlanner({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: browserScope },
      gitDiff: () => assert.fail('focused dispatch must not inspect git'), repository: fixtureRepository(),
      writeOutput: value => { output = value; } });
    assert.deepEqual(result.browserSpecs, FOCUSED_BROWSER_SPECS[browserScope] || []);
    assert.deepEqual(result.scopes, { ...allScopes(false), preview_handoff: browserScope === 'map-rendering' });
    assert.ok(output.includes(`current_browser_specs=${JSON.stringify(result.browserSpecs)}`));
  }
});

test('automatic events ignore dispatch inputs and share one diff lookup between planners', () => {
  for (const eventName of ['pull_request', 'push']) for (const browserScope of [...MANUAL_SCOPES, 'unknown']) {
    const calls = [], outputs = [];
    const result = runApplicationPlanner({ env: { GITHUB_EVENT_NAME: eventName, BROWSER_SCOPE: browserScope,
      BASE_SHA: 'fixture-base', HEAD_SHA: 'fixture-head' }, repository: fixtureRepository(),
    gitDiff: (...args) => { calls.push(args); return [specPath('changed')]; }, writeOutput: value => outputs.push(value) });
    assert.deepEqual(calls, [['fixture-base', 'fixture-head']]);
    assert.deepEqual(result.browserSpecs, [specPath('changed')]);
    assert.equal(outputs.length, 1);
  }
});

test('empty initial-push base uses the integration branch as its diff baseline', () => {
  let from;
  runApplicationPlanner({ env: { GITHUB_EVENT_NAME: 'push', BASE_SHA: '0000000000', HEAD_SHA: 'current-head' },
    repository: fixtureRepository(), gitDiff: base => { from = base; return []; }, writeOutput: () => {} });
  assert.equal(from, 'origin/main');
});

test('invalid manual scopes fail before git or output and missing required specs fail visibly', () => {
  for (const browserScope of ['unknown', 'map-rendering; touch sentinel', '$(touch sentinel)']) {
    assert.throws(() => runApplicationPlanner({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', BROWSER_SCOPE: browserScope },
      repository: fixtureRepository(), gitDiff: () => assert.fail('unexpected diff'),
      writeOutput: () => assert.fail('unexpected output') }), /Unsupported browser_scope/);
  }
  for (const [browserScope, specs] of Object.entries(FOCUSED_BROWSER_SPECS)) for (const missingSpec of specs) {
    assert.throws(() => plan([], { eventName: 'workflow_dispatch', browserScope,
      repository: fixtureRepository({ missing: [missingSpec] }) }), { message: `Missing focused browser spec: ${missingSpec}` });
  }
  assert.throws(() => plan(['package.json'], { repository: fixtureRepository({ missing: [smoke[0]] }) }), /Missing smoke browser spec/);
});

test('parsed YAML choices, read permission and outputs agree with the executable planner', () => {
  const input = workflow.on.workflow_dispatch.inputs.browser_scope;
  assert.deepEqual(input.options, MANUAL_SCOPES);
  assert.equal(input.required, false);
  assert.equal(input.type, 'choice');
  assert.equal(input.default, 'default');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const planner = workflow.jobs.changes.steps.filter(step => step.id === 'plan');
  assert.equal(planner.length, 1);
  assert.equal(planner[0].run, 'node scripts/plan-application-checks.mjs --github-output');
  for (const name of ['BASE_SHA', 'HEAD_SHA', 'BROWSER_SCOPE']) assert.ok(planner[0].env[name]);
  assert.deepEqual(Object.values(workflow.jobs.changes.outputs).sort(), [...APPLICATION_SCOPES
    .map(scope => `\${{ steps.plan.outputs.${scope} }}`), '${{ steps.plan.outputs.current_browser_specs }}'].sort());
  const current = workflow.jobs['current-browser-contracts'];
  assert.equal(current.strategy['max-parallel'], 2);
  assert.equal(current.strategy['fail-fast'], false);
  assert.ok(current.steps.some(step => /playwright\s+test/.test(step.run || '') && step.run.includes('matrix.spec') && !step.run.includes('--grep')));
});

// Parse only the guard-expression subset, without executing YAML as JavaScript.
function expressionValue(expression, context) {
  const tokens = expression.match(/'[^']*'|\d+|==|!=|&&|\|\||[(),]|[a-zA-Z_][\w.-]*/g) || [];
  let index = 0;
  const consume = token => tokens[index] === token && Boolean(index++ + 1);
  function primary() {
    if (consume('(')) { const value = or(); assert.ok(consume(')')); return value; }
    const token = tokens[index++];
    assert.ok(token, 'expression must be complete');
    if (token.startsWith("'")) return token.slice(1, -1);
    if (/^\d+$/.test(token)) return Number(token);
    if (token === 'true' || token === 'false') return token === 'true';
    if (consume('(')) {
      assert.equal(token, 'format');
      const args = [or()];
      while (consume(',')) args.push(or());
      assert.ok(consume(')'));
      return args[0].replace(/\{(\d+)\}/g, (_, number) => String(args[Number(number) + 1]));
    }
    return token.split('.').reduce((value, key) => value?.[key], context) ?? '';
  }
  function equality() {
    let value = primary();
    while (['==', '!='].includes(tokens[index])) {
      const operation = tokens[index++], right = primary();
      const equal = typeof value === 'string' && typeof right === 'string'
        ? value.toLowerCase() === right.toLowerCase() : value === right;
      value = operation === '==' ? equal : !equal;
    }
    return value;
  }
  function and() { let value = equality(); while (consume('&&')) { const right = equality(); value = value && right; } return value; }
  function or() { let value = and(); while (consume('||')) { const right = and(); value = value || right; } return value; }
  const result = or();
  assert.equal(index, tokens.length, 'guard expression must be fully understood');
  return result;
}
const templateValue = (template, context) => template.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g,
  (_, expression) => String(expressionValue(expression, context)));

test('one shared core preflight gates dependent jobs and preserves isolated capture dispatches', () => {
  const steps = workflow.jobs.changes.steps;
  const prerequisites = steps.filter(step => step.run === 'node scripts/check-core-prerequisite.mjs');
  assert.equal(prerequisites.length, 1);
  assert.ok(steps.indexOf(prerequisites[0]) > steps.findIndex(step => step.id === 'plan'));
  for (const browserScope of MANUAL_SCOPES) {
    assert.equal(expressionValue(prerequisites[0].if,
      { github: { event_name: 'workflow_dispatch' }, inputs: { browser_scope: browserScope } }), !browserScope.startsWith('boundary-'));
  }
  assert.equal(expressionValue(prerequisites[0].if, { github: { event_name: 'pull_request' }, inputs: {} }), true);
  for (const job of Object.values(workflow.jobs).filter(job => job !== workflow.jobs.changes)) {
    assert.ok([job.needs].flat().includes('changes'), 'dependent job must wait for the common prerequisite');
  }
});

test('focused dispatches isolate diagnostics and skip the broad command job', () => {
  for (const browserScope of MANUAL_SCOPES.filter(scope => scope !== 'default')) {
    const context = { github: { event_name: 'workflow_dispatch' }, inputs: { browser_scope: browserScope } };
    assert.equal(expressionValue(workflow.jobs['command-contract'].if, context), false);
    for (const diagnostic of MANUAL_SCOPES.filter(scope => scope.startsWith('boundary-'))) {
      assert.equal(expressionValue(workflow.jobs[diagnostic].if, context), browserScope === diagnostic);
    }
  }
  assert.equal(expressionValue(workflow.jobs['command-contract'].if,
    { github: { event_name: 'pull_request' }, inputs: {} }), true);
});

test('manual capture jobs preserve bounded execution and immutable evidence without exact titles or historical SHA assertions', () => {
  for (const id of MANUAL_SCOPES.filter(scope => scope.startsWith('boundary-'))) {
    const job = workflow.jobs[id];
    assert.equal(job.needs, 'changes');
    assert.equal(job.strategy, undefined);
    assert.equal(job['continue-on-error'], undefined);
    const runs = job.steps.filter(step => step.run);
    assert.equal(runs.filter(step => /playwright\s+test|node scripts\/run-boundary-/.test(step.run)).length, 1, id);
    assert.ok(!runs.some(step => /pnpm check:|pnpm test:/.test(step.run)), id);
    for (const artifact of job.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))) {
      assert.equal(artifact.if, 'always()');
      assert.ok(artifact.with.path);
    }
  }
  const capture = workflow.jobs['boundary-native-capture'].steps.find(step => /playwright\s+test/.test(step.run || ''));
  assert.equal(capture.env.PANDOLAB_BOUNDARY_NATIVE_TRACE, '1');
  assert.equal(capture.env.PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS, 'false');
  for (const option of ['--workers=1', '--retries=0', '--repeat-each=1']) assert.ok(capture.run.includes(option));
  const checkouts = workflow.jobs['boundary-revision-comparison'].steps.filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 2);
  assert.equal(new Set(checkouts.map(step => step.with.path)).size, 2);
  assert.equal(checkouts.filter(step => /^[0-9a-f]{40}$/.test(step.with.ref || '')).length, 1);
});

test('concurrency follows the current PR/ref while manual diagnostics and reruns remain independent', () => {
  const groups = new Set();
  for (const { name, document } of workflows) {
    const context = { github: { workflow: document.name, event_name: 'pull_request', run_attempt: 1,
      run_id: 1001, ref: 'refs/pull/104/merge', event: { pull_request: { number: 104 } } } };
    const group = overrides => templateValue(document.concurrency.group, { github: { ...context.github, ...overrides } });
    const cancel = overrides => expressionValue(document.concurrency['cancel-in-progress'].replace(/^\$\{\{|\}\}$/g, ''),
      { github: { ...context.github, ...overrides } });
    assert.equal(group({}), group({ run_id: 1002 }), name);
    assert.notEqual(group({}), group({ event: { pull_request: { number: 105 } } }), name);
    assert.equal(cancel({}), true);
    assert.equal(group({ event_name: 'push', event: {}, ref: 'refs/heads/main' }),
      group({ event_name: 'push', event: {}, ref: 'refs/heads/main', run_id: 1002 }));
    assert.notEqual(group({ event_name: 'push', event: {}, ref: 'refs/heads/main' }),
      group({ event_name: 'push', event: {}, ref: 'refs/heads/work/objects' }));
    for (const overrides of [{ event_name: 'workflow_dispatch' }, { run_attempt: 2 }]) {
      assert.equal(cancel(overrides), false);
      assert.notEqual(group(overrides), group({ ...overrides, run_id: 1002 }));
      assert.notEqual(group(overrides), group({ ...overrides, run_attempt: 3 }));
    }
    groups.add(group({}));
  }
  assert.equal(groups.size, workflows.length);
});
