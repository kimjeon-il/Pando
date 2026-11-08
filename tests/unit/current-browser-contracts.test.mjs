import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { loadRepository, planApplicationChecks } from '../../scripts/plan-application-checks.mjs';

const workflow = parseYaml(readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8'));
// The canonical workflow now handles manual UI/place groups and PR selection.
const workflows = [{ name: 'application-architecture', document: workflow }];
const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url), 'utf8'));
const MANUAL_SCOPES = workflow.on.workflow_dispatch.inputs.browser_scope.options;

test('current native map preview check retains its source-bound image prerequisite', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const required = repository.unitRequirements.get('tests/unit/map-native-preview.test.mjs');
  assert.ok(required?.has('native-map-preview'));
  assert.ok(required?.has('native-map-image'));
});

test('current map PDF check retains independent native PDF and image prerequisites', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const required = repository.unitRequirements.get('tests/unit/map-native-pdf.test.mjs');
  assert.ok(required?.has('native-map-pdf'));
  assert.ok(required?.has('native-map-image'));
  const prerequisite = repository.catalog.prerequisites['native-map-pdf'];
  assert.ok(prerequisite,'Current PDF native recipe must remain registered');
});

test('Hydro calibration and shared-boundary checks select their native tools', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  for(const contract of ['hydro-calibration-metrics','hydro-calibration-native']) {
    const owner=repository.contractOwners.get(`tests/unit/${contract}.test.mjs`);
    assert.ok(owner, 'Missing original Hydro contract: '+contract);
    assert.ok(repository.unitRequirements.get(owner)?.has('native-hydro-calibration'),contract);
  }
  assert.ok(repository.unitRequirements.get('tests/unit/hydro-shared-boundary.test.mjs').has('native-hydro-point-screen'));
  assert.equal(repository.catalog.prerequisites['native-hydro-point-screen'].env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
    '{root}/build-native/hydro-point-screen/artifact');
});

test('current discovered tests each have one owner; diagnostic purposes and commands remain explicit', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  assert.equal(repository.owners.size, repository.tests.length);
  assert.ok(repository.contractOwners.size >= 616, 'original unit contracts must remain addressable');
  for (const group of catalog.groups.filter(group => group.mode === 'manual')) assert.ok(group.reason);
  for (const group of catalog.groups) assert.notEqual(group.argv?.includes('--grep'), true);
});

test('application CI calls the shared selector and runner; automatic test lists are not copied into YAML', () => {
  assert.ok(workflow.jobs.changes.steps.some(step => step.run === 'node scripts/run-application-checks.mjs --list --github-output'));
  for (const phase of ['non-browser', 'browser']) {
    const steps = workflow.jobs[phase].steps;
    assert.ok(steps.some(step => step.run?.startsWith('node scripts/run-application-checks.mjs --list --github-output') && step.run.includes('--phase ' + phase)));
    assert.ok(steps.some(step => step.run?.startsWith('node scripts/run-application-checks.mjs --phase ' + phase) && step.run.includes('--output')));
    assert.equal(steps.some(step => /node --test|playwright test|pnpm test:unit/.test(step.run || '')), false);
  }
  assert.ok(workflow.jobs.checks.steps.some(step => step.id === 'aggregate'));
  assert.equal(workflow.jobs.checks.steps.some(step => step.run?.includes('run-application-checks.mjs')), false);
  assert.equal(workflow.on.push.paths, undefined); assert.equal(workflow.on.pull_request.paths, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(workflow.on.workflow_dispatch.inputs.check_groups,
    'manual groups replace the removed UI/place workflow wrappers');
  assert.equal(workflow.jobs.changes.steps.find(step => step.id === 'plan').env.CHECK_GROUPS,
    "${{ inputs.check_groups || '' }}");
  assert.ok(workflow.jobs.changes.steps.find(step => step.id === 'plan').env.HEAD_SHA.includes('pull_request.head.sha'));
  for (const name of MANUAL_SCOPES.filter(scope => scope.startsWith('boundary-'))) assert.ok(workflow.jobs[name]);
  for (const name of MANUAL_SCOPES.filter(scope => scope !== 'default' && !scope.startsWith('boundary-'))) assert.ok(catalog.manualScopes[name]);
});

test('feature-owned Viewer preview and shared Core replace stage-owned validation',()=>{
  assert.ok(workflow.on.workflow_call?.inputs?.head_sha);
  assert.ok(workflow.on.workflow_call?.inputs?.check_profile);
  assert.ok(workflow.on.workflow_call?.inputs?.base_sha);
  const preview=parseYaml(readFileSync(new URL('../../.github/workflows/viewer-preview.yml',import.meta.url),'utf8'));
  assert.equal(preview.jobs['application-contracts'].uses,'./.github/workflows/application-architecture.yml');
  assert.equal(preview.jobs['application-contracts'].with.check_profile,'viewer-preview');
  assert.ok(preview.jobs['application-contracts'].with.head_sha.includes('inputs.source_sha'));
  assert.ok(preview.jobs.snapshot.steps.some(step=>step.run?.includes('stage-viewer-preview.mjs')));
  const core=parseYaml(readFileSync(new URL('../../.github/workflows/shared-core.yml',import.meta.url),'utf8'));
  assert.ok(core.on.push.branches.includes('work/remote-only'));
  assert.ok(core.jobs['native-branch-impact']);
  assert.ok(core.jobs['native-branch-core']);
  assert.ok(core.jobs['native-branch-gis']);
  for(const retired of ['remote-development-p1.yml','remote-preview-p3.yml','remote-only-gate.yml'])
    assert.equal(existsSync(new URL('../../.github/workflows/'+retired,import.meta.url)),false,retired);
});
test('CSS selects relevant UI checks without C++/GIS build or data generation commands', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const plan = planApplicationChecks({ repository, changedFiles: ['shared/frontend/css/features/map-rendering.css'] });
  assert.ok(plan.browserSpecs.includes('tests/browser/web-viewer.spec.mjs'));
  assert.ok(plan.commands.includes('ui-spacing'));
  assert.deepEqual(plan.externalChecks, []);
  assert.equal(plan.commands.some(id => catalog.groups.find(group => group.id === id)?.gisNative), false);
  const worker = planApplicationChecks({ repository, changedFiles: ['shared/frontend/js/workers/canvas-render-worker.js'] });
  assert.ok(worker.browserSpecs.includes('tests/browser/viewer-startup-and-terrain.spec.mjs'));
  for (const id of ['country-selftest', 'country-validity-canonical', 'country-validity', 'territorial-library-contract'])
    assert.ok(catalog.groups.some(group => group.id === id && group.argv?.length));
});

test('native Core external checks retain every compiled input and exclude shared frontend resources', () => {
  const repository = { catalog, files: [], tests: [], owners: new Map(), dependencies: () => [] };
  const nativeCheck = catalog.externalChecks.find(check => check.id === 'native-core');
  const manifest = JSON.parse(readFileSync(new URL('../../shared/frontend/static/wasm/pandoeditor-core.manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.inputs.length > 0);
  for (const path of [...manifest.inputs.map(input => input.path), 'CMakeLists.txt', 'CMakePresets.json']) {
    const plan = planApplicationChecks({ repository, changedFiles: [path] });
    assert.deepEqual(plan.externalChecks, [nativeCheck], path);
  }
  for (const path of ['shared/frontend/css/features/map-rendering.css', 'shared/frontend/js/workers/canvas-render-worker.js']) {
    const plan = planApplicationChecks({ repository, changedFiles: [path] });
    assert.deepEqual(plan.externalChecks, [], path);
  }
});

test('prepared asset changes retain the real fixed-land unit and browser regressions', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const plan = planApplicationChecks({ repository, changedFiles: ['assets/data/prepared-polygons/generated/v2/manifest.json'] });
  assert.ok(plan.unitTests.includes('tests/unit/prepared-polygon-mesh.test.mjs'));
  assert.ok(plan.browserSpecs.includes('tests/browser/viewer-startup-and-terrain.spec.mjs'));
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

test('R4-E3 manual application scopes offer Viewer checks without removed edit-only capture jobs',()=>{
 assert.deepEqual(MANUAL_SCOPES,['default','map-rendering']);
 assert.equal(workflow.jobs['boundary-capture-comparison'],undefined);
 assert.equal(workflow.jobs['boundary-native-capture'],undefined);
 assert.equal(workflow.jobs['boundary-revision-comparison'],undefined);
 for(const path of catalog.manualScopes['map-rendering'])assert.ok(path.startsWith('tests/browser/viewer-'));
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

