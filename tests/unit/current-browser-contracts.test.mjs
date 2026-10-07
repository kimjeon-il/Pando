import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/application-architecture.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const automaticWorkflows = ['application-architecture', 'ui-architecture', 'place-runtime', 'reference-image-integration']
  .map(file => ({ file, source: readFileSync(new URL(`../../.github/workflows/${file}.yml`, import.meta.url), 'utf8').replaceAll('\r\n', '\n') }));
const startMarker = "node --input-type=module <<'NODE'\n";
const start = workflow.indexOf(startMarker);
assert.ok(start >= 0, 'the workflow must expose its actual browser selector');
const end = workflow.indexOf('\n          NODE', start + startMarker.length);
assert.ok(end > start, 'the inline selector must have a complete heredoc');
const selector = workflow.slice(start + startMarker.length, end).replace(/^ {10}/gm, '');
const scopeStart = workflow.indexOf('        id: scope\n');
assert.ok(scopeStart >= 0, 'the workflow must expose its actual scope detector');
const scopeStep = workflow.slice(scopeStart, workflow.indexOf('      - name:', scopeStart));
const scopeScript = scopeStep.slice(scopeStep.indexOf('        run: |\n') + '        run: |\n'.length)
  .replace(/^ {10}/gm, '');
const jobs = Object.fromEntries([...workflow.matchAll(/^ {2}([a-z][a-z-]+):\n([\s\S]*?)(?=^ {2}[a-z][a-z-]+:\n|(?![\s\S]))/gm)]
  .filter(match => workflow.indexOf(match[0]) > workflow.indexOf('\njobs:\n'))
  .map(([, id, body]) => [id, body]));
const browserDirectory = new URL('../browser/', import.meta.url);
const prefix = 'tests/browser/';
const specPath = name => `${prefix}${name}.spec.mjs`;
const coreSmoke = ['boundary-cut-snapping', 'country-label-flags', 'generic-feature-independent-geometry',
  'hydro-metadata-edit', 'storage-protection', 'ui-components', 'gis-interchange'].map(specPath).sort();
const focusedSpecs = ['country-map-substrate', 'interaction-unification'].map(specPath);
const editorDiagnosticSpecs = ['gis-interchange', 'boundary-cut-snapping', 'hydro-metadata-edit',
  'library-header-layout'].map(specPath);
const scopeNames = ['territorial_store', 'unit_suite', 'python_contracts', 'data_contracts', 'terrain_rendering',
  'boundary_continuity', 'preview_handoff', 'scene_staging', 'visual_policy'];
const timelineConsumers = readdirSync(browserDirectory).filter(name => name.endsWith('.spec.mjs')
  && readFileSync(new URL(name, browserDirectory), 'utf8').includes("from '../helpers/timeline-project.mjs'"))
  .map(name => `${prefix}${name}`).sort();
assert.ok(timelineConsumers.length > 0, 'the current timeline fixture must have real browser consumers');

let selectorRun = 0;

function concurrencyContract(source) {
  const body = source.match(/^concurrency:\n((?: {2,}.+\n)+)/m)?.[1];
  assert.ok(body, 'the actual workflow must define top-level concurrency');
  assert.deepEqual([...body.matchAll(/^ {2}([a-z-]+):/gm)].map(match => match[1]), ['group', 'cancel-in-progress']);
  const scalar = key => {
    const value = body.match(new RegExp(`^ {2}${key}: >-\\n((?: {4}.+\\n)+)`, 'm'))?.[1];
    assert.ok(value, `${key} must be a folded expression`);
    return value.trim().split('\n').map(line => line.trim()).join(' ');
  };
  const group = scalar('group').match(/^\$\{\{ github\.workflow \}\}-\$\{\{ (.+) && '([^']+)' \|\| format\('([^']+)', github\.run_id, github\.run_attempt\) \}\}$/);
  assert.ok(group, 'group must isolate workflows and use fixed automatic or unique run/attempt suffixes');
  const cancel = scalar('cancel-in-progress').match(/^\$\{\{ (.+) \}\}$/);
  assert.ok(cancel, 'cancellation must be an expression');
  assert.equal(group[1], cancel[1], 'the shared group and cancellation must have identical guards');
  assert.equal(group[2], 'pr-76-country-editor-hover-relations');
  assert.equal(group[3], 'run-{0}-attempt-{1}');
  const evaluate = (expression, github) => expression.split(' && ').every(term => {
    // Evaluate only this contract's equality/conjunction subset, never arbitrary code.
    const comparison = term.match(/^github\.([a-z_.]+) == (?:'([^']*)'|(\d+))$/);
    assert.ok(comparison, `unsupported concurrency guard: ${term}`);
    const actual = comparison[1].split('.').reduce((value, key) => value?.[key], github) ?? '';
    return comparison[3] === undefined
      ? String(actual).toLowerCase() === comparison[2].toLowerCase()
      : Number(actual) === Number(comparison[3]);
  });
  return github => ({
    group: `${github.workflow}-${evaluate(group[1], github) ? group[2]
      : group[3].replace('{0}', String(github.run_id)).replace('{1}', String(github.run_attempt))}`,
    cancel: evaluate(cancel[1], github),
  });
}

function concurrencyContext(overrides = {}) {
  return { workflow: 'Application Architecture', event_name: 'pull_request', repository: 'kimjeon-il/Pando',
    run_id: 1001, run_attempt: 1,
    event: { pull_request: { number: 76,
      head: { ref: 'codex/country-editor-hover-relations', repo: { full_name: 'kimjeon-il/Pando' } } } },
    ...overrides };
}

for (const { file, source } of automaticWorkflows) {
  test(`${file} concurrency cancels only the exact trusted automatic PR across all guard combinations`, () => {
    const concurrency = concurrencyContract(source);
    for (let mask = 0; mask < 64; mask++) {
      const github = concurrencyContext();
      if (mask & 1) github.event_name = 'workflow_dispatch';
      if (mask & 2) github.repository = 'someone-else/Pando';
      if (mask & 4) github.event.pull_request.number = 77;
      if (mask & 8) github.event.pull_request.head.repo.full_name = 'someone-else/Pando';
      if (mask & 16) github.event.pull_request.head.ref = 'another-branch';
      if (mask & 32) github.run_attempt = 2;
      const result = concurrency(github);
      assert.equal(result.cancel, mask === 0, `guard mask ${mask}`);
      assert.equal(result.group, `${github.workflow}-${mask === 0 ? 'pr-76-country-editor-hover-relations' : `run-1001-attempt-${github.run_attempt}`}`, `guard mask ${mask}`);
      const nextRun = concurrency({ ...github, run_id: 1002 });
      const nextAttempt = concurrency({ ...github, run_attempt: github.run_attempt + 1 });
      assert.equal(result.group === nextRun.group, mask === 0, 'only the matching automatic PR shares runs');
      assert.notEqual(result.group, nextAttempt.group, 'every rerun must remain independent');
    }
  });

  test(`${file} concurrency isolates old and current PR reruns and missing attempts`, () => {
    const concurrency = concurrencyContract(source);
    const automatic = concurrency(concurrencyContext({ run_id: 1002 })).group;
    const rerunGroups = new Set();
    for (const runId of [1001, 1002]) {
      for (const attempt of [2, 3]) {
        const result = concurrency(concurrencyContext({ run_id: runId, run_attempt: attempt }));
        assert.deepEqual(result, { group: `Application Architecture-run-${runId}-attempt-${attempt}`, cancel: false });
        assert.notEqual(result.group, automatic, 'old and current reruns must not replace or cancel an automatic run');
        rerunGroups.add(result.group);
      }
    }
    assert.equal(rerunGroups.size, 4, 'reruns must not replace or cancel each other');
    const missingAttempt = concurrencyContext();
    delete missingAttempt.run_attempt;
    assert.equal(concurrency(missingAttempt).cancel, false, 'absent attempt metadata must not enable cancellation');
    assert.notEqual(concurrency(missingAttempt).group, automatic, 'absent attempt metadata must not enter the shared group');
  });

  test(`${file} concurrency preserves manual scopes and non-PR events without PR context`, () => {
    const concurrency = concurrencyContract(source);
    const automatic = concurrency(concurrencyContext()).group;
    for (const eventName of ['workflow_dispatch', 'push', 'schedule', 'workflow_call', 'pull_request_target']) {
      for (const browserScope of [undefined, 'default', 'map-rendering', 'editor-diagnostics', 'boundary-capture-comparison', '$(touch sentinel)']) {
        const github = concurrencyContext({ event_name: eventName, event: {}, inputs: { browser_scope: browserScope } });
        assert.deepEqual(concurrency(github), { group: 'Application Architecture-run-1001-attempt-1', cancel: false });
        assert.notEqual(concurrency(github).group, automatic);
        assert.notEqual(concurrency(github).group, concurrency({ ...github, run_id: 1002 }).group);
        assert.notEqual(concurrency(github).group, concurrency({ ...github, run_attempt: 2 }).group);
      }
    }
    for (const event of [{}, { pull_request: {} }, { pull_request: { number: 76, head: { repo: null } } }]) {
      assert.equal(concurrency(concurrencyContext({ event })).cancel, false, 'incomplete PR metadata must not match');
    }
    const hostileBranch = concurrencyContext();
    hostileBranch.event.pull_request.head.ref = 'codex/country-editor-hover-relations; $(touch sentinel)';
    assert.deepEqual(concurrency(hostileBranch), { group: 'Application Architecture-run-1001-attempt-1', cancel: false });
  });
}

test('automatic validation workflow groups cannot cancel one another or manual runs', () => {
  const automaticGroups = new Set();
  const manualGroups = new Set();
  for (const { source } of automaticWorkflows) {
    const name = source.match(/^name: (.+)$/m)?.[1];
    assert.ok(name);
    const concurrency = concurrencyContract(source);
    automaticGroups.add(concurrency(concurrencyContext({ workflow: name })).group.toLowerCase());
    manualGroups.add(concurrency(concurrencyContext({ workflow: name, event_name: 'workflow_dispatch' })).group.toLowerCase());
  }
  assert.equal(automaticGroups.size, automaticWorkflows.length);
  assert.equal(manualGroups.size, automaticWorkflows.length);
  assert.equal(new Set([...automaticGroups, ...manualGroups]).size, automaticWorkflows.length * 2);
});

async function runSelector(t, changed, eventName = 'pull_request', browserScope,
  { expectedGitCalls = 1, expectedError, missingSpec } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pandolab-current-browser-contracts-'));
  const output = join(directory, 'github-output.txt');
  const environment = { BASE_SHA: 'fixture-base', HEAD_SHA: 'fixture-head', GITHUB_OUTPUT: output,
    GITHUB_EVENT_NAME: eventName, BROWSER_SCOPE: browserScope };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const gitDiff = t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['diff', '--name-only', 'fixture-base', 'fixture-head']);
    assert.equal(options.encoding, 'utf8');
    return changed.join('\n');
  });
  const originalExistsSync = fs.existsSync;
  const specExists = missingSpec
    ? t.mock.method(fs, 'existsSync', path => path === missingSpec ? false : originalExistsSync(path))
    : null;
  syncBuiltinESMExports();
  try {
    const execution = import(`data:text/javascript,${encodeURIComponent(selector)}#${encodeURIComponent(t.name)}-${selectorRun++}`);
    if (expectedError) {
      await assert.rejects(execution, expectedError);
      assert.equal(existsSync(output), false, 'a rejected selection must not emit a matrix');
      assert.equal(gitDiff.mock.callCount(), expectedGitCalls, 'invalid focused selection must not inspect a diff');
      return;
    }
    await execution;
    const lines = readFileSync(output, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('specs='));
    const selected = JSON.parse(lines[0].slice('specs='.length));
    assert.equal(gitDiff.mock.callCount(), expectedGitCalls, `unexpected diff lookup for ${JSON.stringify(selected)}`);
    return selected;
  } finally {
    gitDiff.mock.restore();
    specExists?.mock.restore();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('pandolab-current-browser-contracts-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

function runScope(eventName, browserScope, changed = []) {
  const directory = mkdtempSync(join(tmpdir(), 'pandolab-current-browser-scopes-'));
  const output = join(directory, 'github-output.txt');
  const gitLog = join(directory, 'git-calls.txt');
  const sentinel = join(directory, 'sentinel');
  const environment = { ...process.env, BASE_SHA: 'fixture-base', HEAD_SHA: 'fixture-head',
    GITHUB_EVENT_NAME: eventName, GITHUB_OUTPUT: output, GIT_CALL_LOG: gitLog, DIFF_FIXTURE: changed.join('\n') };
  if (browserScope === undefined) delete environment.BROWSER_SCOPE;
  else environment.BROWSER_SCOPE = browserScope;
  try {
    const result = childProcess.spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', `
git() {
  printf '%s\\n' "$*" >> "$GIT_CALL_LOG"
  [[ "$*" == 'diff --name-only fixture-base fixture-head' ]] || return 1
  printf '%s\\n' "$DIFF_FIXTURE"
}
${scopeScript}`], { cwd: directory, env: environment, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(existsSync(sentinel), false, 'scope values must never execute shell commands');
    const lines = existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n') : [];
    assert.equal(new Set(lines.map(line => line.split('=')[0])).size, lines.length, 'outputs must not be repeated');
    return { status: result.status, stderr: result.stderr,
      scopes: Object.fromEntries(lines.map(line => line.split('='))),
      gitCalls: existsSync(gitLog) ? readFileSync(gitLog, 'utf8').trim().split('\n') : [] };
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('pandolab-current-browser-scopes-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('current browser CI selects a changed storage spec', async t => {
  assert.deepEqual(await runSelector(t, [specPath('storage-protection')]), [specPath('storage-protection')]);
});

test('current browser CI selects actual timeline helper consumers', async t => {
  assert.deepEqual(await runSelector(t, ['tests/helpers/timeline-project.mjs']), timelineConsumers);
});

test('current browser CI retains the boundary consumer of conditionally loaded diagnostic helpers', async t => {
  for (const name of ['long-animation-frame-diagnostics', 'native-action-diagnostics', 'native-action-timeline']) {
    const selected = await runSelector(t, [`tests/browser/helpers/${name}.mjs`]);
    assert.ok(selected.includes(specPath('boundary-cut-snapping')), `${name} must retain its boundary consumer`);
  }
});

test('current browser CI leaves renderer source changes in existing renderer groups', async t => {
  assert.deepEqual(await runSelector(t, ['assets/js/modules/gpu-map-renderer.js']), []);
});

test('current browser CI selects bounded smoke after browser server changes', async t => {
  assert.deepEqual(await runSelector(t, ['tests/browser/server.mjs']), coreSmoke);
});

test('current browser CI runs complete changed specs when existing jobs only grep part of them', async t => {
  const specs = ['selection-interaction-style', 'interaction-unification'].map(specPath).sort();
  assert.deepEqual(await runSelector(t, specs), specs);
});

test('current browser CI avoids duplicating complete M1 M2 M3 M6 jobs', async t => {
  const specs = ['edit-preview-handoff', 'territorial-boundary-continuity', 'gpu-scene-staging', 'visual-frame-sync'].map(specPath);
  assert.deepEqual(await runSelector(t, specs), []);
});

test('current browser CI manual dispatch runs bounded smoke even with an empty diff', async t => {
  assert.deepEqual(await runSelector(t, [], 'workflow_dispatch'), coreSmoke);
});

for (const file of ['package.json', 'pnpm-lock.yaml', 'eslint.config.js']) {
  test(`current browser CI selects bounded smoke after ${file} changes`, async t => {
    assert.deepEqual(await runSelector(t, [file]), coreSmoke);
  });
}

test('focused map dispatch selects only the fixed map specs without inspecting git', async t => {
  assert.deepEqual(await runSelector(t, [], 'workflow_dispatch', 'map-rendering', { expectedGitCalls: 0 }), focusedSpecs);
});

test('focused map dispatch ignores unrelated specs helpers and infrastructure changes', async t => {
  const changed = ['tests/browser/territorial-library.spec.mjs', 'tests/helpers/timeline-project.mjs',
    'tests/browser/helpers/map-diagnostics.mjs', 'package.json', '.github/workflows/application-architecture.yml'];
  assert.deepEqual(await runSelector(t, changed, 'workflow_dispatch', 'map-rendering', { expectedGitCalls: 0 }), focusedSpecs);
});

test('editor diagnostics select only the four fixed complete specs without inspecting git', async t => {
  assert.deepEqual(await runSelector(t, [], 'workflow_dispatch', 'editor-diagnostics', { expectedGitCalls: 0 }), editorDiagnosticSpecs);
});

test('editor diagnostics ignore unrelated specs helpers and infrastructure changes', async t => {
  const changed = ['tests/browser/territorial-library.spec.mjs', 'tests/helpers/timeline-project.mjs',
    'tests/browser/helpers/map-diagnostics.mjs', 'package.json', '.github/workflows/application-architecture.yml'];
  assert.deepEqual(await runSelector(t, changed, 'workflow_dispatch', 'editor-diagnostics', { expectedGitCalls: 0 }), editorDiagnosticSpecs);
});

test('editor diagnostics leave all nine optional application scopes disabled without inspecting git', () => {
  const result = runScope('workflow_dispatch', 'editor-diagnostics');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, 'false'])));
  assert.deepEqual(result.gitCalls, []);
});

for (const browserScope of [undefined, '', 'default']) {
  const label = browserScope === undefined ? 'missing' : JSON.stringify(browserScope);
  test(`manual ${label} scope retains changed specs and all existing smoke specs`, async t => {
    const changed = [specPath('country-map-substrate')];
    assert.deepEqual(await runSelector(t, changed, 'workflow_dispatch', browserScope), [...changed, ...coreSmoke].sort());
  });
  test(`manual ${label} scope enables all nine application scopes`, () => {
    const result = runScope('workflow_dispatch', browserScope);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, 'true'])));
    assert.deepEqual(result.gitCalls, []);
  });
}

for (const eventName of ['pull_request', 'push']) {
  for (const browserScope of ['map-rendering', 'editor-diagnostics', 'boundary-capture-comparison', 'unknown']) {
    test(`${eventName} selector ignores supplied ${browserScope} manual scope`, async t => {
      const changed = ['tests/helpers/timeline-project.mjs', 'package.json'];
      const expected = [...new Set([...timelineConsumers, ...coreSmoke])].sort();
      assert.deepEqual(await runSelector(t, changed, eventName), expected);
      assert.deepEqual(await runSelector(t, changed, eventName, browserScope), expected);
    });
    test(`${eventName} application scopes ignore supplied ${browserScope} manual scope`, () => {
      const changed = [specPath('interaction-unification'), 'tests/helpers/timeline-project.mjs'];
      const baseline = runScope(eventName, undefined, changed);
      const supplied = runScope(eventName, browserScope, changed);
      const expected = Object.fromEntries(scopeNames.map(name => [name,
        ['unit_suite', 'visual_policy'].includes(name) ? 'true' : 'false']));
      for (const result of [baseline, supplied]) {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.scopes, expected);
        assert.deepEqual(result.gitCalls, ['diff --name-only fixture-base fixture-head']);
      }
    });
  }
}

for (const browserScope of ['unknown', 'map-rendering; touch sentinel', 'editor-diagnostics; touch sentinel', '$(touch sentinel)']) {
  test(`manual selector rejects ${JSON.stringify(browserScope)} before output or git`, async t => {
    await runSelector(t, [], 'workflow_dispatch', browserScope,
      { expectedGitCalls: 0, expectedError: /Unsupported browser_scope/ });
  });
  test(`manual application scopes reject ${JSON.stringify(browserScope)} without execution`, () => {
    const result = runScope('workflow_dispatch', browserScope);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported browser_scope/);
    assert.deepEqual(result.scopes, {});
    assert.deepEqual(result.gitCalls, []);
  });
}

for (const missingSpec of focusedSpecs) {
  test(`focused dispatch rejects missing ${missingSpec} before output or git`, async t => {
    await runSelector(t, [], 'workflow_dispatch', 'map-rendering', {
      expectedGitCalls: 0, expectedError: { message: `Missing focused browser spec: ${missingSpec}` }, missingSpec,
    });
  });
}

for (const missingSpec of editorDiagnosticSpecs) {
  test(`editor diagnostics reject missing ${missingSpec} before output or git`, async t => {
    await runSelector(t, [], 'workflow_dispatch', 'editor-diagnostics', {
      expectedGitCalls: 0, expectedError: { message: `Missing focused browser spec: ${missingSpec}` }, missingSpec,
    });
  });
}

test('focused application scopes enable only the existing preview handoff renderer job', () => {
  const result = runScope('workflow_dispatch', 'map-rendering');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, name === 'preview_handoff' ? 'true' : 'false'])));
  assert.deepEqual(result.gitCalls, []);
});

test('workflow exposes only the allowlisted optional dispatch choice and keeps read-only permissions', () => {
  const dispatch = workflow.slice(workflow.indexOf('  workflow_dispatch:\n'), workflow.indexOf('  pull_request:\n'));
  assert.match(dispatch, /^ {4}inputs:\n {6}browser_scope:\n/m);
  assert.match(dispatch, /^ {8}required: false$/m);
  assert.match(dispatch, /^ {8}type: choice$/m);
  assert.match(dispatch, /^ {8}default: default$/m);
  assert.deepEqual([...dispatch.matchAll(/^ {10}- (.+)$/gm)].map(match => match[1]), ['default', 'map-rendering', 'editor-diagnostics', 'boundary-capture-comparison', 'boundary-native-capture', 'boundary-revision-comparison']);
  assert.deepEqual([...dispatch.matchAll(/^ {6}(\w+):$/gm)].map(match => match[1]), ['browser_scope']);
  assert.match(workflow, /^permissions:\n {2}contents: read\n\njobs:/m);
  assert.equal(workflow.match(/^ {10}BROWSER_SCOPE: \$\{\{ inputs.browser_scope \|\| 'default' \}\}$/gm)?.length, 2);
  assert.match(scopeStep, /^ {10}BROWSER_SCOPE: \$\{\{ inputs.browser_scope \|\| 'default' \}\}$/m);
  assert.doesNotMatch(scopeScript, /\$\{\{/);
  assert.doesNotMatch(selector, /\$\{\{|process\.exit\(/);
});

test('focused dispatch skips only the broad unconditional architecture job through an explicit event and input gate', () => {
  assert.match(jobs['command-contract'], /^ {4}if: github.event_name != 'workflow_dispatch' \|\| \(inputs.browser_scope != 'map-rendering' && inputs.browser_scope != 'editor-diagnostics' && inputs.browser_scope != 'boundary-capture-comparison' && inputs.browser_scope != 'boundary-native-capture' && inputs.browser_scope != 'boundary-revision-comparison'\)$/m);
  assert.match(jobs['command-contract'], /^ {8}run: pnpm check:architecture$/m);
});

test('all focused job names are distinct while normal names and matrix suffixes stay exact', () => {
  const expectedNames = {
    changes: 'Detect application scopes',
    'boundary-capture-comparison': 'Boundary screencast comparison (A1, B1, B2, A2)',
    'boundary-native-capture': 'Boundary native rendering attribution (one B run)',
    'boundary-revision-comparison': 'Boundary revision comparison (PR1, main1, main2, PR2)',
    'current-browser-contracts': 'Current browser contract (${{ matrix.spec }})',
    'visual-policy': 'Common map visual policy and frame consumers (M4-M6)',
    'scene-staging': 'GPU stroke domain staging (M3)',
    'preview-handoff': 'Direct edit preview and end-to-end continuity (M2/M7, ${{ matrix.renderer }})',
    'terrain-rendering-contract': 'Terrain coverage and GPU upload regression',
    'boundary-continuity': 'Territorial boundary topology continuity',
    'command-contract': 'command-contract',
    'territorial-store-contract': 'Territorial storage contract',
    'python-contracts': 'Current Python contracts and terrain DEM',
    'data-contracts': 'Validation entrypoints and current generated assets',
    'full-unit-suite': 'Full unit suite',
  };
  const namePrefix = "${{ github.event_name == 'workflow_dispatch' && inputs.browser_scope == 'map-rendering' && 'Focused map rendering / ' || '' }}";
  const editorPrefix = "${{ github.event_name == 'workflow_dispatch' && inputs.browser_scope == 'editor-diagnostics' && 'Focused editor diagnostics / ' || '' }}";
  assert.deepEqual(Object.keys(jobs), Object.keys(expectedNames));
  for (const [id, expected] of Object.entries(expectedNames)) {
    assert.equal(jobs[id].match(/^ {4}name: (.+)$/m)?.[1],
      ['boundary-capture-comparison', 'boundary-native-capture', 'boundary-revision-comparison'].includes(id) ? expected : `${namePrefix}${editorPrefix}${expected}`, id);
  }
  assert.match(jobs['current-browser-contracts'], /^ {6}max-parallel: 2$/m);
  assert.match(jobs['current-browser-contracts'], /^ {6}fail-fast: false$/m);
  assert.match(jobs['current-browser-contracts'], /pnpm exec playwright test "\$\{\{ matrix.spec \}\}" --workers=1 --output=test-results\/current-browser-contracts /);
  assert.doesNotMatch(jobs['current-browser-contracts'], /--grep/);
  assert.match(jobs['preview-handoff'], /^ {8}renderer: \[webgl2, canvas\]$/m);
  assert.match(jobs['preview-handoff'], /pnpm exec playwright test tests\/browser\/edit-preview-handoff\.spec\.mjs --grep='\$\{\{ matrix.renderer \}\} '/);
});

test('manual capture comparison selects no unrelated browser matrix and ignores git', async t => {
  assert.deepEqual(await runSelector(t, ['package.json', specPath('territorial-library')],
    'workflow_dispatch', 'boundary-capture-comparison', { expectedGitCalls: 0 }), []);
});

test('manual capture comparison disables every existing optional application job', () => {
  const result = runScope('workflow_dispatch', 'boundary-capture-comparison');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, 'false'])));
  assert.deepEqual(result.gitCalls, []);
});

test('capture comparison job is explicitly manual and invokes only the bounded four-process runner', () => {
  const comparison = jobs['boundary-capture-comparison'];
  assert.ok(comparison, 'the new manual comparison job must exist');
  assert.match(comparison, /^ {4}needs: changes$/m);
  assert.match(comparison, /^ {4}if: github.event_name == 'workflow_dispatch' && inputs.browser_scope == 'boundary-capture-comparison'$/m);
  assert.match(comparison, /^ {4}runs-on: ubuntu-latest$/m);
  assert.doesNotMatch(comparison, /strategy:|matrix:|continue-on-error:|pnpm check:|--grep|playwright test|pnpm test:/);
  assert.equal(comparison.match(/node scripts\/run-boundary-capture-comparison\.mjs/g)?.length, 1);
  assert.equal(comparison.match(/actions\/upload-artifact@v4/g)?.length, 5);
  assert.equal(comparison.match(/^ {8}if: always\(\)$/gm)?.length, 5);
  for (const id of ['A1', 'B1', 'B2', 'A2']) {
    assert.match(comparison, new RegExp(`name: boundary-capture-${id}-\\$\\{\\{ github.run_id \\}\\}-attempt-\\$\\{\\{ github.run_attempt \\}\\}`));
    assert.ok(comparison.includes(`path: test-results/boundary-capture-comparison/comparison-*/${id}`));
  }
  assert.ok(comparison.includes('          path: |\n            test-results/boundary-capture-comparison/comparison-*/summary.json\n            test-results/boundary-capture-comparison/comparison-*/**/evidence/**'));
  assert.equal(comparison.match(/^ {10}if-no-files-found: error$/gm)?.length, 5);
});


test('manual native capture selects no unrelated browser matrix or application scope', async t => {
  assert.deepEqual(await runSelector(t, ['package.json', specPath('territorial-library')],
    'workflow_dispatch', 'boundary-native-capture', { expectedGitCalls: 0 }), []);
  const result = runScope('workflow_dispatch', 'boundary-native-capture');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, 'false'])));
  assert.deepEqual(result.gitCalls, []);
});

test('native capture job invokes one exact desktop B case and separates native raw and manifest artifacts', () => {
  const native = jobs['boundary-native-capture'];
  assert.ok(native, 'the isolated manual native capture job must exist');
  assert.match(native, /^ {4}needs: changes$/m);
  assert.match(native, /^ {4}if: github.event_name == 'workflow_dispatch' && inputs.browser_scope == 'boundary-native-capture'$/m);
  assert.match(native, /PANDOLAB_BOUNDARY_NATIVE_TRACE: '1'/);
  assert.match(native, /PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS: 'false'/);
  assert.equal(native.match(/pnpm exec playwright test /g)?.length, 1);
  assert.match(native, /tests\/browser\/boundary-cut-snapping\.spec\.mjs/);
  assert.match(native, /--config=playwright\.boundary-capture\.config\.mjs/);
  assert.match(native, /--workers=1 --retries=0 --repeat-each=1/);
  assert.ok(native.includes("--grep='(?:^|\\s)a child cut snaps to both parent boundaries, preserves coverage and undoes in one step$'"));
  assert.doesNotMatch(native, /run-boundary-capture-comparison|strategy:|matrix:|continue-on-error:|pnpm check:|pnpm test:/);
  assert.equal(native.match(/actions\/upload-artifact@v4/g)?.length, 3);
  assert.equal(native.match(/^ {8}if: always\(\)$/gm)?.length, 3);
  assert.match(native, /path: test-results\/boundary-native-capture\/\*\*\/boundary-project-undo-native-timeline\.json/);
  assert.match(native, /path: \|\n {12}test-results\/boundary-native-capture\/\*\*\/boundary-project-undo-native-timeline-manifest\.json/);
  assert.match(native, /!test-results\/boundary-native-capture\/\*\*\/boundary-project-undo-native-timeline\.json/);
  assert.match(native, /!test-results\/boundary-native-capture\/\*\*\/boundary-project-undo-native-timeline-manifest\.json/);
  assert.match(native, /compression-level: 0/);
});


test('manual revision comparison selects no other browser or application job', async t => {
  assert.deepEqual(await runSelector(t, ['package.json', specPath('territorial-library')],
    'workflow_dispatch', 'boundary-revision-comparison', { expectedGitCalls: 0 }), []);
  const result = runScope('workflow_dispatch', 'boundary-revision-comparison');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.scopes, Object.fromEntries(scopeNames.map(name => [name, 'false'])));
  assert.deepEqual(result.gitCalls, []);
});

test('manual revision job checks out immutable main separately and uses one bounded runner and browser installation', () => {
  const comparison = jobs['boundary-revision-comparison'];
  assert.ok(comparison, 'the isolated revision job must exist');
  assert.match(comparison, /^ {4}if: github.event_name == 'workflow_dispatch' && inputs.browser_scope == 'boundary-revision-comparison'$/m);
  assert.match(comparison, /^ {4}needs: changes$/m);
  assert.equal(comparison.match(/actions\/checkout@v4/g)?.length, 2);
  assert.match(comparison, /ref: ebcfae4d27b29cbbea6416a7045a4806930204be/);
  assert.match(comparison, /path: boundary-main\n {10}fetch-depth: 1/);
  assert.match(comparison, /path: boundary-pr/);
  assert.equal(comparison.match(/pnpm install --frozen-lockfile/g)?.length, 1);
  assert.equal(comparison.match(/playwright install --with-deps chromium/g)?.length, 1);
  assert.equal(comparison.match(/node scripts\/run-boundary-revision-comparison.mjs/g)?.length, 1);
  assert.match(comparison, /PANDOLAB_BOUNDARY_BASELINE_ROOT: \$\{\{ github.workspace \}\}\/boundary-main/);
  assert.match(comparison, /PANDOLAB_BOUNDARY_PR_REVISION: \$\{\{ github.sha \}\}/);
  assert.doesNotMatch(comparison, /strategy:|matrix:|continue-on-error:|--grep|playwright test|git (?:push|switch|reset)|delete-artifact/);
  assert.equal(comparison.match(/actions\/upload-artifact@v4/g)?.length, 5);
  for (const id of ['PR1', 'main1', 'main2', 'PR2']) assert.ok(comparison.includes(`comparison-*/${id}`));
});
