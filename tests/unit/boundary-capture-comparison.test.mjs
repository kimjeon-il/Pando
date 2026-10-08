import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const configUrl = new URL('../../playwright.boundary-capture.config.mjs', import.meta.url);
const runnerUrl = new URL('../../scripts/run-boundary-capture-comparison.mjs', import.meta.url);
const flag = 'PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS';
const title = 'a child cut snaps to both parent boundaries, preserves coverage and undoes in one step';
const head = 'fccbbe86a54f66f8d43014fa036e58f8eab9501b';

function loadConfig(value) {
  assert.ok(existsSync(configUrl), 'the isolated capture config must exist');
  const env = { ...process.env };
  if (value === undefined) delete env[flag];
  else env[flag] = value;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import capture from ${JSON.stringify(configUrl.href)};
    import normal from ${JSON.stringify(new URL('../../playwright.config.js', import.meta.url).href)};
    console.log(JSON.stringify({ capture, normal }));
  `], { cwd: root, env, encoding: 'utf8' });
}

async function loadRunner() {
  assert.ok(existsSync(runnerUrl), 'the isolated four-process runner must exist');
  const runner = await import(runnerUrl.href);
  return { ...runner, runBoundaryCaptureComparison: options => runner.runBoundaryCaptureComparison({
    collectEvidence: () => ({ status: 0, signal: null }), ...options,
  }) };
}

function withOutput(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pandolab-boundary-capture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

for (const value of [undefined, '', 'TRUE', 'False', '1', '0', ' true', 'false ', 'unknown']) {
  test(`capture config rejects ${JSON.stringify(value)} instead of defaulting`, () => {
    const result = loadConfig(value);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS must be exactly true or false/);
  });
}

for (const value of ['true', 'false']) {
  test(`capture ${value} keeps normal defaults and every non-screencast evidence option`, () => {
    const result = loadConfig(value);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const { capture, normal } = JSON.parse(result.stdout);
    assert.deepEqual(capture.use.trace, { mode: 'on', screenshots: value === 'true', snapshots: true, sources: true, attachments: true });
    assert.deepEqual(capture.use, { ...normal.use, trace: capture.use.trace });
    assert.deepEqual(capture.webServer, { ...normal.webServer, reuseExistingServer: false });
    assert.deepEqual(capture, { ...normal, workers: 1, retries: 0, repeatEach: 1,
      use: capture.use, webServer: capture.webServer });
    assert.equal(normal.use.trace, 'retain-on-failure');
    assert.equal(normal.use.screenshot, 'only-on-failure');
    assert.equal(normal.webServer.reuseExistingServer, true);
    assert.equal(capture.timeout, 120_000);
    assert.deepEqual(capture.expect, { timeout: 8_000 });
  });
}

test('runner launches exactly four separate desktop processes in sequential ABBA order', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  const directory = withOutput(t);
  const calls = [];
  const env = { ...process.env, [flag]: 'invalid inherited value', PRIVATE_TOKEN: 'never summarize me' };
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: directory, env, readHead: () => head,
    execute(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null };
    } });
  assert.equal(result.exitCode, 0);
  const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
  assert.equal(summary.status, 'completed');
  assert.equal(summary.head, head);
  assert.deepEqual(summary.sequence, ['A1', 'B1', 'B2', 'A2']);
  assert.deepEqual(summary.runs.map(run => [run.id, run.order, run.condition, run.screenshots, run.exitCode]),
    [['A1', 1, 'A', true, 0], ['B1', 2, 'B', false, 0], ['B2', 3, 'B', false, 0], ['A2', 4, 'A', true, 0]]);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(call => call.options)).size, 4, 'each process has independent launch options');
  assert.equal(new Set(calls.map(call => call.options.env)).size, 4, 'each process has an independent environment');
  assert.equal(new Set(summary.runs.map(run => run.outputDirectory)).size, 4);
  const grep = '(?:^|\\s)' + title + '$';
  assert.match('boundary-cut-snapping.spec.mjs ' + title, new RegExp(grep));
  assert.doesNotMatch('boundary-cut-snapping.spec.mjs ' + title + ' extra', new RegExp(grep));
  assert.doesNotMatch('boundary-cut-snapping.spec.mjs a mobile native touch stroke keeps editable hit targets and cancels without residue', new RegExp(grep));
  for (const [index, call] of calls.entries()) {
    const run = summary.runs[index];
    assert.equal(call.command, process.execPath);
    assert.equal(call.args[0], fileURLToPath(import.meta.resolve('@playwright/test/cli')));
    assert.deepEqual(call.args.slice(1), ['test', 'tests/browser/boundary-cut-snapping.spec.mjs',
      '--config=playwright.boundary-capture.config.mjs', `--grep=${grep}`, '--workers=1', '--retries=0',
      '--repeat-each=1', `--output=${resolve(dirname(result.summaryPath), run.outputDirectory)}`]);
    assert.deepEqual(run.command, [call.command, ...call.args]);
    assert.equal(call.options.cwd, root);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env[flag], String(run.screenshots));
    assert.deepEqual(call.options.stdio, ['ignore', call.options.stdio[1], call.options.stdio[1]]);
    assert.equal(typeof call.options.stdio[1], 'number');
    assert.ok(existsSync(resolve(dirname(result.summaryPath), run.outputDirectory)));
    assert.ok(existsSync(resolve(dirname(result.summaryPath), run.log)));
  }
  assert.equal(env[flag], 'invalid inherited value', 'the caller environment must not be mutated');
  assert.ok(readFileSync(result.summaryPath).byteLength < 16_384, 'the manifest must remain small');
  assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /PRIVATE_TOKEN|never summarize me|invalid inherited value/);
});

for (const failedIndex of [0, 1, 2, 3]) {
  test(`runner retains every result and fails overall when arm ${failedIndex + 1} fails`, async t => {
    const { runBoundaryCaptureComparison } = await loadRunner();
    let calls = 0;
    const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead: () => head,
      execute: () => ({ status: calls++ === failedIndex ? 7 : 0, signal: null }) });
    const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    assert.equal(calls, 4);
    assert.equal(result.exitCode, 1);
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.runs.map(run => run.exitCode), [0, 1, 2, 3].map(index => index === failedIndex ? 7 : 0));
    assert.equal(summary.runs[failedIndex].status, 'failed');
  });
}

for (const failure of [
  { status: null, signal: 'SIGTERM' },
  { status: null, error: Object.assign(new Error('secret launch context'), { code: 'ENOENT' }) },
  { status: 0, error: Object.assign(new Error('secret context'), { code: 'EIO' }) },
  { status: undefined },
]) {
  test(`runner does not pass an infrastructure failure ${failure.signal || failure.error?.code || 'unknown'}`, async t => {
    const { runBoundaryCaptureComparison } = await loadRunner();
    let calls = 0;
    const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead: () => head,
      execute: () => calls++ === 1 ? failure : { status: 0, signal: null } });
    const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    assert.equal(calls, 4);
    assert.equal(result.exitCode, 1);
    assert.equal(summary.runs[1].status, 'infrastructure-failed');
    assert.equal(summary.runs.length, 4);
    assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /secret/);
  });
}

test('runner records thrown launch errors and still attempts the remaining arms', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  let calls = 0;
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead: () => head,
    execute() {
      if (calls++ === 0) throw Object.assign(new Error('private value'), { code: 'EACCES' });
      return { status: 0, signal: null };
    } });
  const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
  assert.equal(calls, 4);
  assert.equal(result.exitCode, 1);
  assert.equal(summary.runs[0].status, 'infrastructure-failed');
  assert.equal(summary.runs[0].errorCode, 'EACCES');
  assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /private value/);
});

test('runner publishes incremental results before launching each subsequent process', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  const outputRoot = withOutput(t);
  let calls = 0;
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot, readHead: () => head,
    execute() {
      const comparisonDirectory = join(outputRoot, readdirSync(outputRoot)[0]);
      const summary = JSON.parse(readFileSync(join(comparisonDirectory, 'summary.json'), 'utf8'));
      assert.equal(summary.status, 'running');
      assert.equal(summary.exitCode, null, 'an incomplete experiment must never be recorded as a pass');
      assert.equal(summary.runs.length, calls + 1);
      assert.equal(summary.runs.at(-1).status, 'running');
      assert.equal(summary.runs.slice(0, -1).every(run => run.status === 'passed'), true);
      calls++;
      return { status: 0, signal: null };
    } });
  assert.equal(calls, 4);
  assert.equal(result.exitCode, 0);
});

test('runner uses a new comparison directory even when the output parent is reused', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  const options = { cwd: root, outputRoot: withOutput(t), readHead: () => head,
    execute: () => ({ status: 0, signal: null }) };
  const first = runBoundaryCaptureComparison(options);
  const firstBytes = readFileSync(first.summaryPath);
  const second = runBoundaryCaptureComparison(options);
  assert.notEqual(dirname(first.summaryPath), dirname(second.summaryPath));
  assert.deepEqual(readFileSync(first.summaryPath), firstBytes);
});

test('runner refuses unverifiable heads and retains a failed preflight summary', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  for (const readHead of [() => 'not-a-sha', () => { throw new Error('private git context'); }]) {
    let calls = 0;
    const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead,
      execute: () => { calls++; return { status: 0 }; } });
    const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
    assert.equal(calls, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(summary.status, 'preflight-failed');
    assert.equal(summary.preflightError, 'HEAD_UNAVAILABLE');
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.head, null);
    assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /private git context/);
  }
});

test('runner captures stdout and stderr from four real independent non-browser processes', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  const fixture = `
    console.log(JSON.stringify({ pid: process.pid, screenshots: process.env.${flag} }));
    console.error('fixture stderr');
    process.exit(process.env.${flag} === 'false' ? 4 : 0);
  `;
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t),
    execute: (command, args, options) => spawnSync(command, ['--input-type=module', '-e', fixture], options) });
  const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
  assert.equal(summary.head, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim());
  assert.equal(result.exitCode, 1);
  assert.deepEqual(summary.runs.map(run => run.exitCode), [0, 4, 4, 0]);
  const pids = [];
  for (const run of summary.runs) {
    const lines = readFileSync(resolve(dirname(result.summaryPath), run.log), 'utf8').trim().split('\n');
    const output = JSON.parse(lines[0]);
    pids.push(output.pid);
    assert.equal(output.screenshots, String(run.screenshots));
    assert.deepEqual(lines.slice(1), ['fixture stderr']);
  }
  assert.equal(new Set(pids).size, 4, 'all four processes must have different identities');
});


test('runner aggregates a failed evidence post-process without hiding functional exits or stopping ABBA', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  let calls = 0, evidenceCalls = 0;
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead: () => head,
    execute: () => { calls++; return { status: 0, signal: null }; },
    collectEvidence({ output, evidence, screenshots, cwd }) {
      assert.equal(calls, evidenceCalls + 1, 'analysis must run only after each process has exited');
      assert.equal(cwd, root);
      assert.equal(dirname(output), dirname(evidence));
      assert.equal(screenshots, [true, false, false, true][evidenceCalls]);
      return { status: evidenceCalls++ === 1 ? 1 : 0, signal: null };
    } });
  const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
  assert.equal(calls, 4);
  assert.equal(evidenceCalls, 4);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(summary.runs.map(run => run.exitCode), [0, 0, 0, 0]);
  assert.deepEqual(summary.runs.map(run => run.evidence.status), ['complete', 'incomplete', 'complete', 'complete']);
});

test('runner records a thrown evidence reader error and continues all arms', async t => {
  const { runBoundaryCaptureComparison } = await loadRunner();
  let calls = 0;
  const result = runBoundaryCaptureComparison({ cwd: root, outputRoot: withOutput(t), readHead: () => head,
    execute: () => ({ status: 0, signal: null }),
    collectEvidence() {
      if (calls++ === 0) throw Object.assign(new Error('secret context'), { code: 'EIO' });
      return { status: 0, signal: null };
    } });
  const summary = JSON.parse(readFileSync(result.summaryPath, 'utf8'));
  assert.equal(calls, 4);
  assert.equal(result.exitCode, 1);
  assert.equal(summary.runs[0].evidence.status, 'error');
  assert.equal(summary.runs[0].evidence.errorCode, 'EIO');
  assert.doesNotMatch(readFileSync(result.summaryPath, 'utf8'), /secret context/);
});

const analyzerUrl = new URL('../../scripts/summarize-boundary-capture-evidence.py', import.meta.url);
function analyzeFixture(t, { screenshots = true, frames = screenshots ? 2 : 0, snapshots = 3,
  corrupt = false, missing = false, missingDiagnostics = false } = {}) {
  assert.ok(existsSync(analyzerUrl), 'the bounded post-exit evidence reader must exist');
  const directory = withOutput(t);
  const output = join(directory, 'artifacts');
  const evidence = join(directory, 'evidence');
  const fixture = spawnSync('python3', ['-c', `
import json, pathlib, zipfile
root=pathlib.Path(${JSON.stringify(output)}); root.mkdir()
if not ${missing ? 'True' : 'False'}:
    with zipfile.ZipFile(root/'trace.zip','w') as z:
        rows=[{'type':'context-options','origin':'library','browserName':'chromium','playwrightVersion':'1.62.1',
            'options':{'viewport':{'width':1280,'height':720},'isMobile':False,'hasTouch':False,'httpCredentials':{'password':'do not export'}}}]
        rows += [{'type':'frame-snapshot','snapshot':{'html':['do not export geometry']}}] * ${snapshots}
        rows += [{'type':'screencast-frame','sha1':'not copied'}] * ${frames}
        z.writestr('0-trace.trace', 'broken json' if ${corrupt ? 'True' : 'False'} else '\\n'.join(json.dumps(row) for row in rows))
        z.writestr('resources/src@unit.txt','source')
if not ${missingDiagnostics ? 'True' : 'False'}:
    (root/'boundary-project-undo-native-action.json').write_text(json.dumps({'label':'boundary-project-undo','host':{'outcome':'fulfilled','durationMs':11}}))
    (root/'boundary-project-undo-cpu-summary.json').write_text(json.dumps({'label':'boundary-project-undo','status':'captured'}))
`], { encoding: 'utf8' });
  assert.equal(fixture.status, 0, fixture.stderr);
  const result = spawnSync('python3', [fileURLToPath(analyzerUrl), output, evidence, String(screenshots)],
    { encoding: 'utf8' });
  assert.ifError(result.error);
  const metadata = JSON.parse(readFileSync(join(evidence, 'trace-metadata.json'), 'utf8'));
  return { result, metadata, evidence };
}

for (const screenshots of [true, false]) {
  test(`post-exit reader retains bounded hashes and observed trace counts for capture ${screenshots}`, t => {
    const { result, metadata, evidence } = analyzeFixture(t, { screenshots });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(metadata.status, 'complete');
    assert.equal(metadata.trace.status, 'available');
    assert.match(metadata.trace.sha256, /^[a-f0-9]{64}$/);
    assert.equal(metadata.trace.domSnapshotCount, 3);
    assert.equal(metadata.trace.screencastFrameCount, screenshots ? 2 : 0);
    assert.equal(metadata.trace.sourceResourceCount, 1);
    assert.equal(metadata.trace.matchesCaptureCondition, true);
    assert.equal(metadata.trace.contextOptions[0].browserName, 'chromium');
    assert.deepEqual(metadata.trace.contextOptions[0].options, { viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
    assert.equal(metadata.trace.effectiveTraceOptions.status, 'unavailable');
    assert.equal(metadata.requestedTraceOptions.screenshots, screenshots);
    assert.equal(metadata.diagnostics.native.status, 'available');
    assert.equal(metadata.diagnostics.cpu.status, 'available');
    assert.equal(existsSync(join(evidence, 'boundary-project-undo-native-action.json')), true);
    assert.equal(existsSync(join(evidence, 'boundary-project-undo-cpu-summary.json')), true);
    assert.deepEqual(readdirSync(evidence).sort(), ['boundary-project-undo-cpu-summary.json',
      'boundary-project-undo-native-action.json', 'trace-metadata.json']);
    const source = readFileSync(join(evidence, 'trace-metadata.json'), 'utf8');
    assert.doesNotMatch(source, /do not export|httpCredentials|password|geometry/);
    assert.ok(Buffer.byteLength(source) < 16_384);
  });
}

for (const options of [{ missing: true }, { corrupt: true }]) {
  test(`post-exit reader marks ${options.missing ? 'missing' : 'corrupt'} trace counts unknown`, t => {
    const { result, metadata } = analyzeFixture(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(metadata.status, 'incomplete');
    assert.equal(metadata.trace.status, options.missing ? 'missing' : 'error');
    assert.equal(metadata.trace.domSnapshotCount, null);
    assert.equal(metadata.trace.screencastFrameCount, null);
    assert.equal(metadata.trace.matchesCaptureCondition, null);
  });
}

for (const options of [{ screenshots: false, frames: 1 }, { screenshots: true, frames: 0 },
  { snapshots: 0 }, { missingDiagnostics: true }]) {
  test(`post-exit reader fails incomplete or mismatched evidence ${JSON.stringify(options)}`, t => {
    const { result, metadata } = analyzeFixture(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(metadata.status, 'incomplete');
    if (options.missingDiagnostics) {
      assert.equal(metadata.diagnostics.native.status, 'missing');
      assert.equal(metadata.diagnostics.cpu.status, 'missing');
    } else if (options.snapshots === undefined) assert.equal(metadata.trace.matchesCaptureCondition, false);
    else assert.equal(metadata.trace.domSnapshotCount, 0);
  });
}
