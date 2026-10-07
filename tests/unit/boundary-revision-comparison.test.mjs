import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runnerUrl = new URL('../../scripts/run-boundary-revision-comparison.mjs', import.meta.url);
const configUrl = new URL('../../playwright.boundary-revision.config.mjs', import.meta.url);
const baseline = 'ebcfae4d27b29cbbea6416a7045a4806930204be';
const head = 'bd7ccd6762928d480c806c6188814372281d24de';
const title = 'a child cut snaps to both parent boundaries, preserves coverage and undoes in one step';
const sequence = ['PR1', 'main1', 'main2', 'PR2'];

async function runner() {
  assert.ok(existsSync(runnerUrl), 'the isolated revision runner must exist');
  return import(runnerUrl.href);
}
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'boundary-revisions-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function inputs() {
  return { pr: { revision: head, root }, main: { revision: baseline, root: '/isolated/main' }, fixtureFiles: [] };
}
function launchSuccess(command, args, options) {
  writeFileSync(options.env.PANDOLAB_BOUNDARY_TIMINGS_PATH, JSON.stringify({ schemaVersion: 1,
    testStatus: 'passed', stages: ['undo-click', 'child-observation', 'parent-observation', 'storage-observation', 'redo-click', 'redo-observation']
      .map((name, index) => ({ name, status: 'fulfilled', startMs: index * 2 + 1, endMs: index * 2 + 2, durationMs: 1 })), label: 'boundary-project-undo' }));
  return { status: 0, signal: null };
}

test('revision runner fixes PR/main/main/PR order and the exact desktop selection', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  const outputRoot = directory(t), calls = [];
  const env = { PRIVATE_TOKEN: 'never summarize', PANDOLAB_BOUNDARY_NATIVE_TRACE: '1' };
  const result = runBoundaryRevisionComparison({ cwd: root, outputRoot, env, preflight: inputs,
    execute(command, args, options) {
      const path = join(outputRoot, readdirSync(outputRoot)[0], 'summary.json');
      const incremental = JSON.parse(readFileSync(path));
      assert.equal(incremental.runs.length, calls.length + 1);
      assert.equal(incremental.runs.at(-1).status, 'running');
      assert.equal(incremental.exitCode, null);
      calls.push({ command, args, options });
      return launchSuccess(command, args, options);
    } });
  const summary = JSON.parse(readFileSync(result.summaryPath));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(summary.sequence, sequence);
  assert.deepEqual(summary.runs.map(run => run.id), sequence);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => call.options.env.PANDOLAB_BOUNDARY_PRODUCT_ROOT),
    [root, '/isolated/main', '/isolated/main', root]);
  assert.deepEqual(summary.conditions, { addedHelpers: 'off', trace: 'off', failureScreenshots: 'only-on-failure',
    workers: 1, retries: 0, repeatEach: 1 });
  for (const [index, call] of calls.entries()) {
    assert.equal(call.command, process.execPath);
    assert.deepEqual(call.args.slice(1), ['test', 'tests/browser/boundary-cut-snapping.spec.mjs',
      '--config=playwright.boundary-revision.config.mjs', `--grep=(?:^|\\s)${title}$`,
      '--workers=1', '--retries=0', '--repeat-each=1',
      `--output=${join(dirname(result.summaryPath), sequence[index], 'artifacts')}`]);
    assert.equal(call.options.cwd, root);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.PANDOLAB_BOUNDARY_REVISION_COMPARISON, '1');
    assert.equal(call.options.env.PANDOLAB_BOUNDARY_NATIVE_TRACE, '0');
    assert.deepEqual(summary.runs[index].command, [call.command, ...call.args]);
  }
  assert.equal(new Set(calls.map(call => call.options.env)).size, 4);
  assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /PRIVATE_TOKEN|never summarize/);
  assert.equal(env.PANDOLAB_BOUNDARY_NATIVE_TRACE, '1');
});

for (const failure of [{ status: 7 }, { status: null, signal: 'SIGTERM' },
  { status: null, error: Object.assign(new Error('private launch context'), { code: 'ENOENT' }) }]) {
  test(`all four terminal results survive ${failure.status ?? failure.signal ?? failure.error.code}`, async t => {
    const { runBoundaryRevisionComparison } = await runner();
    let calls = 0;
    const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
      execute(command, args, options) {
        launchSuccess(command, args, options);
        return calls++ === 1 ? failure : { status: 0 };
      } });
    const summary = JSON.parse(readFileSync(result.summaryPath));
    assert.equal(calls, 4);
    assert.equal(result.exitCode, 1);
    assert.equal(summary.runs.length, 4);
    assert.equal(summary.runs[1].status, failure.status === 7 ? 'failed' : 'infrastructure-failed');
    assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /private launch context/);
  });
}

test('missing timing output remains an evidence failure without changing functional exit', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  let calls = 0;
  const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
    execute() { calls++; return { status: 0 }; } });
  const summary = JSON.parse(readFileSync(result.summaryPath));
  assert.equal(calls, 4);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(summary.runs.map(run => run.exitCode), [0, 0, 0, 0]);
  assert.deepEqual(summary.runs.map(run => run.timings.status), ['missing', 'missing', 'missing', 'missing']);
});

test('incomplete or mismatched scalar timings cannot turn a functional pass into a comparison pass', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  for (const report of [{ schemaVersion: 1, label: 'boundary-project-undo', stages: [], testStatus: 'passed' },
    { schemaVersion: 1, label: 'boundary-project-undo', testStatus: 'failed', stages: [] }]) {
    const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
      execute(command, args, options) {
        writeFileSync(options.env.PANDOLAB_BOUNDARY_TIMINGS_PATH, JSON.stringify(report));
        return { status: 0 };
      } });
    const summary = JSON.parse(readFileSync(result.summaryPath));
    assert.equal(result.exitCode, 1);
    assert.deepEqual(summary.runs.map(run => run.timings.status), ['invalid', 'invalid', 'invalid', 'invalid']);
  }
});

for (const [name, overrides, testStatus] of [
  ['fulfilled with null scalars', { startMs: null, endMs: null, durationMs: null }, 'passed'],
  ['negative start', { startMs: -1, endMs: 0, durationMs: 1 }, 'passed'],
  ['reversed endpoints', { startMs: 2, endMs: 1, durationMs: 1 }, 'passed'],
  ['inconsistent duration', { durationMs: 5 }, 'passed'],
  ['non-numeric endpoint', { endMs: '2' }, 'passed'],
  ['not reached with measured scalars', { status: 'not-reached' }, 'failed'],
  ['unresolved pending', { status: 'pending', endMs: null, durationMs: null }, 'failed'],
  ['pending failure without a start', { status: 'pending-at-failure', startMs: null, endMs: null, durationMs: null }, 'failed'],
  ['pending failure with an end', { status: 'pending-at-failure' }, 'failed'],
  ['rejected in a passed report', { status: 'rejected' }, 'passed'],
  ['completed stage after failure', { status: 'rejected' }, 'failed'],
]) {
  test(`final timing evidence rejects ${name} and retains all four functional exits`, async t => {
    const { runBoundaryRevisionComparison } = await runner();
    const exit = testStatus === 'passed' ? 0 : 7;
    const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
      execute(command, args, options) {
        launchSuccess(command, args, options);
        const path = options.env.PANDOLAB_BOUNDARY_TIMINGS_PATH, report = JSON.parse(readFileSync(path));
        report.testStatus = testStatus;
        Object.assign(report.stages[0], overrides);
        writeFileSync(path, JSON.stringify(report));
        return { status: exit };
      } });
    const summary = JSON.parse(readFileSync(result.summaryPath));
    assert.equal(result.exitCode, 1);
    assert.deepEqual(summary.runs.map(run => run.exitCode), [exit, exit, exit, exit]);
    assert.deepEqual(summary.runs.map(run => run.timings.status), ['invalid', 'invalid', 'invalid', 'invalid']);
  });
}

for (const status of ['not-reached', 'pending-at-failure', 'rejected']) {
  test(`final timing evidence preserves meaningful ${status} failure stages`, async t => {
    const { runBoundaryRevisionComparison } = await runner();
    const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
      execute(command, args, options) {
        launchSuccess(command, args, options);
        const path = options.env.PANDOLAB_BOUNDARY_TIMINGS_PATH, report = JSON.parse(readFileSync(path));
        report.testStatus = 'failed';
        report.stages = report.stages.map(stage => ({ ...stage, status: 'not-reached', startMs: null, endMs: null, durationMs: null }));
        if (status !== 'not-reached') Object.assign(report.stages[0], { status, startMs: 1,
          endMs: status === 'rejected' ? 2 : null, durationMs: status === 'rejected' ? 1 : null });
        writeFileSync(path, JSON.stringify(report));
        return { status: 7 };
      } });
    const summary = JSON.parse(readFileSync(result.summaryPath));
    assert.equal(result.exitCode, 1);
    assert.deepEqual(summary.runs.map(run => run.timings.status), ['available', 'available', 'available', 'available']);
    assert.equal(summary.runs[0].timings.report.stages[0].status, status);
  });
}

test('product byte verification fails closed on absent or modified files even when Git skip-worktree hides them', async t => {
  const { verifyBoundaryProductBytes } = await runner();
  const path = directory(t), files = { 'index.html': '<html>main</html>', 'assets/app.js': 'export const main = true;' };
  mkdirSync(join(path, 'assets'));
  const tree = Object.entries(files).map(([file, text]) => {
    writeFileSync(join(path, file), text);
    const bytes = Buffer.from(text), oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    return `100644 blob ${oid}\t${file}`;
  }).join('\n');
  assert.doesNotThrow(() => verifyBoundaryProductBytes(path, tree));
  rmSync(join(path, 'assets/app.js'));
  assert.throws(() => verifyBoundaryProductBytes(path, tree), /Incomplete or modified product bytes: assets\/app.js/);
  writeFileSync(join(path, 'assets/app.js'), files['assets/app.js']);
  writeFileSync(join(path, 'index.html'), 'PR markup mixed with main JS');
  assert.throws(() => verifyBoundaryProductBytes(path, tree), /Incomplete or modified product bytes: index\.html/);
});

test('failed preflight launches nothing and retains concrete affected paths', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  let calls = 0;
  const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t),
    preflight() { throw new Error('Fixture dependencies differ: assets/js/modules/project-state.js'); },
    execute() { calls++; return { status: 0 }; } });
  const summary = JSON.parse(readFileSync(result.summaryPath));
  assert.equal(calls, 0);
  assert.equal(result.exitCode, 1);
  assert.equal(summary.status, 'preflight-failed');
  assert.match(summary.preflightError, /assets\/js\/modules\/project-state.js/);
});

test('reusing an output parent never overwrites a prior experiment', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  const options = { cwd: root, outputRoot: directory(t), preflight: inputs, execute: launchSuccess };
  const first = runBoundaryRevisionComparison(options), bytes = readFileSync(first.summaryPath);
  const second = runBoundaryRevisionComparison(options);
  assert.notEqual(first.summaryPath, second.summaryPath);
  assert.deepEqual(readFileSync(first.summaryPath), bytes);
});

test('runner retains all four ordinary failures and thrown infrastructure errors without retries', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  for (const throws of [false, true]) {
    let calls = 0;
    const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
      execute() { calls++; if (throws) throw Object.assign(new Error('private error'), { code: 'EACCES' }); return { status: 7 }; } });
    const summary = JSON.parse(readFileSync(result.summaryPath));
    assert.equal(calls, 4);
    assert.equal(result.exitCode, 1);
    assert.equal(summary.runs.every(run => run.status === (throws ? 'infrastructure-failed' : 'failed')), true);
    assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /private error/);
  }
});

test('four actual non-browser child processes keep independent identities, logs and immutable root selection', async t => {
  const { runBoundaryRevisionComparison } = await runner();
  const fixture = `
    import { writeFileSync } from 'node:fs';
    console.log(JSON.stringify({ pid: process.pid, root: process.env.PANDOLAB_BOUNDARY_PRODUCT_ROOT }));
    console.error('fixture stderr');
    writeFileSync(process.env.PANDOLAB_BOUNDARY_TIMINGS_PATH, JSON.stringify({ schemaVersion: 1,
      label: 'boundary-project-undo', testStatus: 'passed', stages:
      ['undo-click', 'child-observation', 'parent-observation', 'storage-observation', 'redo-click', 'redo-observation']
        .map((name, index) => ({ name, status: 'fulfilled', startMs: index * 2 + 1, endMs: index * 2 + 2, durationMs: 1 })) }));
  `;
  const result = runBoundaryRevisionComparison({ cwd: root, outputRoot: directory(t), preflight: inputs,
    execute: (command, args, options) => spawnSync(command, ['--input-type=module', '-e', fixture], options) });
  assert.equal(result.exitCode, 0);
  const summary = JSON.parse(readFileSync(result.summaryPath)), pids = [];
  for (const run of summary.runs) {
    const lines = readFileSync(join(dirname(result.summaryPath), run.log), 'utf8').trim().split('\n');
    const output = JSON.parse(lines[0]);
    pids.push(output.pid);
    assert.equal(output.root, run.productRoot);
    assert.deepEqual(lines.slice(1), ['fixture stderr']);
  }
  assert.equal(new Set(pids).size, 4);
});

function matchingFixtureRoot(t) {
  const path = directory(t);
  for (const file of ['tests/helpers/timeline-project.mjs', 'tests/fixtures/timeline-storage-cases.mjs',
    'tests/fixtures/timeline-storage.json', 'assets/js/modules', 'tests/browser/boundary-cut-snapping.spec.mjs',
    'tests/browser/server.mjs', 'package.json', 'pnpm-lock.yaml']) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    cpSync(join(root, file), join(path, file), { recursive: true });
  }
  return path;
}

test('fixture gate validates the complete current canonical Node module closure', async t => {
  const { checkBoundaryFixtureEquivalence } = await runner();
  const baselineRoot = matchingFixtureRoot(t);
  const { fixtureFiles } = checkBoundaryFixtureEquivalence(root, baselineRoot);
  assert.ok(fixtureFiles.includes('assets/js/modules/project-state.js'));
  assert.ok(fixtureFiles.includes('assets/js/modules/color-adapter.js'));
  assert.ok(fixtureFiles.includes('tests/fixtures/timeline-storage.json'));
  assert.equal(fixtureFiles.length, 22);
  const changed = 'assets/js/modules/color-adapter.js';
  writeFileSync(join(baselineRoot, changed), `${readFileSync(join(baselineRoot, changed), 'utf8')}\n// changed fixture dependency\n`);
  assert.throws(() => checkBoundaryFixtureEquivalence(root, baselineRoot),
    /Fixture dependencies differ: assets\/js\/modules\/color-adapter.js/);
});

test('fixture gate follows side-effect imports, re-exports and corpus bytes and rejects unknown dynamic imports', async t => {
  const { checkBoundaryFixtureEquivalence } = await runner();
  const baselineRoot = matchingFixtureRoot(t);
  const file = join(baselineRoot, 'assets/js/modules/territorial-units.js');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, `${original}\nimport('./unverified.js');\n`);
  assert.throws(() => checkBoundaryFixtureEquivalence(root, baselineRoot), /Unverified dynamic fixture import/);
  writeFileSync(file, original);
  writeFileSync(join(baselineRoot, 'tests/fixtures/timeline-storage.json'), '{}');
  assert.throws(() => checkBoundaryFixtureEquivalence(root, baselineRoot), /tests\/fixtures\/timeline-storage.json/);
});

test('preflight rejects mixed or unverifiable revision inputs before launch', async t => {
  const { checkBoundaryRevisionInputs } = await runner();
  assert.throws(() => checkBoundaryRevisionInputs({ cwd: root, baselineRoot: root, expectedHead: head }), /separate/);
  assert.throws(() => checkBoundaryRevisionInputs({ cwd: root, baselineRoot: 'relative', expectedHead: head }), /absolute/);
  assert.throws(() => checkBoundaryRevisionInputs({ cwd: root, baselineRoot: directory(t), expectedHead: 'main' }), /full SHA/);
  const baselineRoot = join(directory(t), 'main');
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, baselineRoot]);
  assert.throws(() => checkBoundaryRevisionInputs({ cwd: root, baselineRoot, expectedHead: '0'.repeat(40) }), /PR HEAD/);
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.throws(() => checkBoundaryRevisionInputs({ cwd: root, baselineRoot, expectedHead: currentHead }), /fixed main SHA/);
});

function loadConfig(overrides = {}) {
  assert.ok(existsSync(configUrl), 'the isolated revision config must exist');
  const env = { ...process.env, PANDOLAB_BOUNDARY_REVISION_COMPARISON: '1',
    PANDOLAB_BOUNDARY_PRODUCT_ROOT: '/isolated/main', PANDOLAB_BOUNDARY_TIMINGS_PATH: '/isolated/PR1/timings.json', ...overrides };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import comparison from ${JSON.stringify(configUrl.href)};
    import normal from ${JSON.stringify(new URL('../../playwright.config.js', import.meta.url).href)};
    console.log(JSON.stringify({ comparison, normal }));
  `], { cwd: root, env, encoding: 'utf8' });
}
for (const mode of [undefined, '', 'true', '0', ' 1', '1 ']) {
  test(`isolated config rejects ambiguous mode ${JSON.stringify(mode)}`, () => {
    const result = loadConfig({ PANDOLAB_BOUNDARY_REVISION_COMPARISON: mode });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be exactly 1/);
  });
}
test('isolated config changes only helpers metadata, tracing and immutable product server ownership', () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
  const { comparison, normal } = JSON.parse(result.stdout);
  assert.deepEqual(comparison.use, { ...normal.use, trace: 'off' });
  assert.deepEqual(comparison.webServer, { ...normal.webServer,
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'tests/browser/server.mjs'))}`,
    cwd: '/isolated/main', reuseExistingServer: false });
  assert.equal(comparison.metadata.boundaryRevisionComparison, true);
  assert.equal(comparison.retries, 0);
  assert.equal(comparison.repeatEach, 1);
  assert.equal(comparison.workers, 1);
  assert.equal(normal.webServer.reuseExistingServer, true);
  assert.equal(normal.use.trace, 'retain-on-failure');
  assert.equal(comparison.timeout, normal.timeout);
  assert.deepEqual(comparison.expect, normal.expect);
});
for (const key of ['PANDOLAB_BOUNDARY_PRODUCT_ROOT', 'PANDOLAB_BOUNDARY_TIMINGS_PATH']) {
  test(`isolated config requires an explicit absolute ${key}`, () => {
    for (const value of [undefined, '', 'relative']) assert.notEqual(loadConfig({ [key]: value }).status, 0);
  });
}
