import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { loadRepository, planApplicationChecks } from '../../scripts/plan-application-checks.mjs';

const workflow = parseYaml(readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8'));
const workflows = ['application-architecture', 'ui-architecture', 'place-runtime']
  .map(name => ({ name, document: parseYaml(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')) }));
const catalog = JSON.parse(readFileSync(new URL('../../scripts/contracts/application-checks.json', import.meta.url), 'utf8'));
const MANUAL_SCOPES = workflow.on.workflow_dispatch.inputs.browser_scope.options;

test('current discovered tests each have one owner; diagnostic purposes and commands remain explicit', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  assert.equal(repository.owners.size, repository.tests.length);
  assert.ok(repository.tests.length > 600);
  for (const group of catalog.groups.filter(group => group.mode === 'manual')) assert.ok(group.reason);
  for (const group of catalog.groups) assert.notEqual(group.argv?.includes('--grep'), true);
});

test('application CI calls the shared selector and runner; automatic test lists are not copied into YAML', () => {
  const steps = workflow.jobs.checks.steps;
  assert.ok(steps.some(step => step.run === 'node scripts/run-application-checks.mjs --list --github-output'));
  assert.ok(steps.some(step => step.run?.startsWith('node scripts/run-application-checks.mjs --output')));
  assert.equal(steps.some(step => /node --test|playwright test|pnpm test:unit/.test(step.run || '')), false);
  assert.equal(workflow.on.push.paths, undefined); assert.equal(workflow.on.pull_request.paths, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(workflow.jobs.changes.steps.find(step => step.id === 'plan').env.HEAD_SHA.includes('pull_request.head.sha'));
  for (const name of MANUAL_SCOPES.filter(scope => scope.startsWith('boundary-'))) assert.ok(workflow.jobs[name]);
  for (const name of MANUAL_SCOPES.filter(scope => scope !== 'default' && !scope.startsWith('boundary-'))) assert.ok(catalog.manualScopes[name]);
});

test('P1/P3 retain native and artifact owners while Web checks share the same runner', () => {
  for (const name of ['remote-development-p1', 'remote-preview-p3']) {
    const document = parseYaml(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
    assert.equal(document.on.push.paths, undefined);
    assert.equal(document.jobs.plan.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
    const job = document.jobs[name.includes('p1') ? 'web-smoke' : 'web-contracts'];
    assert.ok(job.steps.some(step => step.run?.startsWith('node scripts/run-application-checks.mjs --output')));
    assert.equal(job.steps.some(step => /node --test|playwright test/.test(step.run || '')), false);
  }
});

test('CSS selects relevant UI checks without C++/GIS build or data generation commands', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const plan = planApplicationChecks({ repository, changedFiles: ['assets/css/features/map-rendering.css'] });
  assert.ok(plan.browserSpecs.includes('tests/browser/ui-components.spec.mjs'));
  assert.ok(plan.commands.includes('ui-spacing'));
  assert.deepEqual(plan.externalChecks, []);
  assert.equal(plan.commands.some(id => catalog.groups.find(group => group.id === id)?.gisNative), false);
  const worker = planApplicationChecks({ repository, changedFiles: ['assets/js/workers/canvas-render-worker.js'] });
  assert.ok(worker.browserSpecs.includes('tests/browser/physical-land-time.spec.mjs'));
  for (const id of ['country-selftest', 'country-validity-canonical', 'country-validity', 'territorial-library-contract'])
    assert.ok(catalog.groups.some(group => group.id === id && group.argv?.length));
});

test('prepared asset changes retain the real fixed-land unit and browser regressions', () => {
  const repository = loadRepository(new URL('../../', import.meta.url));
  const plan = planApplicationChecks({ repository, changedFiles: ['assets/data/prepared-polygons/generated/v2/manifest.json'] });
  assert.ok(plan.unitTests.includes('tests/unit/prepared-polygon-mesh.test.mjs'));
  assert.ok(plan.browserSpecs.includes('tests/browser/physical-land-time.spec.mjs'));
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
