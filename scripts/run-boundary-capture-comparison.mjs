import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spec = 'tests/browser/boundary-cut-snapping.spec.mjs';
const title = 'a child cut snaps to both parent boundaries, preserves coverage and undoes in one step';
const sequence = ['A1', 'B1', 'B2', 'A2'];
const config = 'playwright.boundary-capture.config.mjs';
const cliPath = fileURLToPath(import.meta.resolve('@playwright/test/cli'));

function errorCode(error) {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'PROCESS_ERROR';
}

export function runBoundaryCaptureComparison({
  cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  outputRoot = join(cwd, 'test-results/boundary-capture-comparison'),
  env = process.env,
  execute = spawnSync,
  collectEvidence = ({ output, evidence, screenshots, cwd, logFile }) => spawnSync('python3',
    [join(cwd, 'scripts/summarize-boundary-capture-evidence.py'), output, evidence, String(screenshots)],
    { cwd, shell: false, timeout: 60_000, stdio: ['ignore', logFile, logFile] }),
  readHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
} = {}) {
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, 'comparison-'));
  const summaryPath = join(directory, 'summary.json');
  const summary = {
    schemaVersion: 1,
    status: 'running',
    head: null,
    spec,
    title,
    trace: { mode: 'on', snapshots: true, sources: true, attachments: true },
    sequence,
    runs: [],
    exitCode: null,
  };
  const save = () => writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  save();
  try {
    const head = readHead();
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Unverifiable HEAD');
    summary.head = head;
  } catch {
    summary.status = 'preflight-failed';
    summary.preflightError = 'HEAD_UNAVAILABLE';
    summary.exitCode = 1;
    save();
    return { exitCode: 1, summaryPath };
  }

  for (const [index, id] of sequence.entries()) {
    const screenshots = id.startsWith('A');
    const outputDirectory = join(id, 'artifacts');
    const log = join(id, 'playwright.log');
    const output = join(directory, outputDirectory);
    mkdirSync(output, { recursive: true });
    // Playwright matches the file/describe/title string, so anchor the exact
    // desktop title at its end. Zero matches remains a failing CLI result.
    const args = [cliPath, 'test', spec, `--config=${config}`, `--grep=(?:^|\\s)${title}$`,
      '--workers=1', '--retries=0', '--repeat-each=1', `--output=${output}`];
    const run = { id, order: index + 1, condition: screenshots ? 'A' : 'B', screenshots,
      command: [process.execPath, ...args], outputDirectory, log, status: 'running',
      exitCode: null, signal: null, errorCode: null,
      evidence: { status: 'pending', metadata: join(id, 'evidence/trace-metadata.json'),
        exitCode: null, signal: null, errorCode: null } };
    summary.runs.push(run);
    save();
    const logFile = openSync(join(directory, log), 'w');
    try {
      const result = execute(process.execPath, args, { cwd,
        env: { ...env, PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS: String(screenshots) },
        shell: false, stdio: ['ignore', logFile, logFile] });
      run.exitCode = Number.isInteger(result.status) && result.status >= 0 ? result.status : null;
      run.signal = result.signal || null;
      run.errorCode = result.error ? errorCode(result.error) : null;
      if (run.exitCode === null || run.signal || run.errorCode) run.status = 'infrastructure-failed';
      else run.status = run.exitCode === 0 ? 'passed' : 'failed';
    } catch (error) {
      run.status = 'infrastructure-failed';
      run.errorCode = errorCode(error);
    }
    // Extraction happens after the test process settles, outside every native
    // action and test deadline. Keep small evidence downloadable if trace ZIPs grow.
    try {
      const result = collectEvidence({ output, evidence: join(directory, id, 'evidence'), screenshots, cwd, logFile });
      run.evidence.exitCode = Number.isInteger(result.status) && result.status >= 0 ? result.status : null;
      run.evidence.signal = result.signal || null;
      run.evidence.errorCode = result.error ? errorCode(result.error) : null;
      run.evidence.status = run.evidence.exitCode === null || run.evidence.signal || run.evidence.errorCode
        ? 'error' : run.evidence.exitCode === 0 ? 'complete' : 'incomplete';
    } catch (error) {
      run.evidence.status = 'error';
      run.evidence.errorCode = errorCode(error);
    } finally {
      closeSync(logFile);
    }
    save();
  }
  summary.status = 'completed';
  summary.exitCode = summary.runs.every(run => run.status === 'passed' && run.evidence.status === 'complete') ? 0 : 1;
  save();
  return { exitCode: summary.exitCode, summaryPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runBoundaryCaptureComparison();
  console.log(`Boundary capture comparison summary: ${result.summaryPath}`);
  process.exitCode = result.exitCode;
}
