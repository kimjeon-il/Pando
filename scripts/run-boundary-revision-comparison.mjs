import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDARY_REVISION_STAGES } from '../tests/browser/helpers/boundary-revision-timings.mjs';

const baselineRevision = 'ebcfae4d27b29cbbea6416a7045a4806930204be';
const prProduct = { assets: 'fcaf7e192cd08faece7ce7f80d0d1fead8282e14', index: '858e2efcda0ddab7e460cdb021b9fce4f2d3578a' };
const spec = 'tests/browser/boundary-cut-snapping.spec.mjs';
const title = 'a child cut snaps to both parent boundaries, preserves coverage and undoes in one step';
const sequence = ['PR1', 'main1', 'main2', 'PR2'];
const cliPath = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const { parse } = createRequire(import.meta.resolve('eslint'))('espree');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000 }).trim();

function fixtureDependencies(root) {
  const files = new Set();
  const parseFile = path => parse(readFileSync(join(root, path), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const local = (owner, source) => {
    const path = relative(root, resolve(root, dirname(owner), source));
    if (path.startsWith('..') || isAbsolute(path)) throw new Error(`Fixture dependency escapes product root: ${owner}`);
    return path;
  };
  const visit = path => {
    if (files.has(path)) return;
    files.add(path);
    if (path.endsWith('.json')) return;
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
        const source = node.source.value;
        if (source.startsWith('.')) visit(local(path, source));
        else if (!source.startsWith('node:')) throw new Error(`Unverified fixture package import: ${path}: ${source}`);
      }
      if (node.type === 'ImportExpression') throw new Error(`Unverified dynamic fixture import: ${path}`);
      if (node.type === 'CallExpression' && node.callee.name === 'readFileSync') {
        const url = node.arguments[0];
        if (url?.type !== 'NewExpression' || url.callee.name !== 'URL' || typeof url.arguments[0]?.value !== 'string'
          || url.arguments[1]?.object?.type !== 'MetaProperty' || url.arguments[1]?.property?.name !== 'url') {
          throw new Error(`Unverified fixture file read: ${path}`);
        }
        visit(local(path, url.arguments[0].value));
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(parseFile(path));
  };
  // Derive the real Node fixture imports from the canonical scenario, excluding
  // browser-only diagnostic helpers. Traverse every transitive module and the
  // literal corpus read. Unknown import/read forms fail closed.
  for (const node of parseFile(spec).body) if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
    const path = local(spec, node.source.value);
    if (/^(assets\/|tests\/(helpers|fixtures)\/)/.test(path)) visit(path);
  }
  if (!files.has('tests/helpers/timeline-project.mjs') || !files.has('assets/js/modules/territorial-units.js')) {
    throw new Error('Canonical boundary fixture imports are missing');
  }
  return [...files].sort();
}

export function verifyBoundaryProductBytes(root, tree) {
  const mismatches = tree.split('\n').filter(row => {
    const [, type, oid, path] = row.match(/^\d+ (\w+) ([a-f0-9]{40})\t(.+)$/) || [];
    if (type !== 'blob' || !path || !existsSync(join(root, path))) return true;
    const bytes = readFileSync(join(root, path));
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== oid;
  }).map(row => row.split('\t')[1]);
  if (mismatches.length) throw new Error(`Incomplete or modified product bytes: ${mismatches.join(', ')}`);
}

export function checkBoundaryFixtureEquivalence(cwd, baselineRoot) {
  const fixtureFiles = fixtureDependencies(cwd);
  // Main has no new helpers, but its existing functional spec imports the same
  // canonical factories. A closure difference or byte difference is fatal.
  const mainFiles = fixtureDependencies(baselineRoot);
  const common = ['package.json', 'pnpm-lock.yaml', 'tests/browser/server.mjs', ...new Set([...fixtureFiles, ...mainFiles])];
  const differences = common.filter(path => !existsSync(join(cwd, path)) || !existsSync(join(baselineRoot, path))
    || !readFileSync(join(cwd, path)).equals(readFileSync(join(baselineRoot, path))));
  if (fixtureFiles.join('\n') !== mainFiles.join('\n')) differences.push(...fixtureFiles.filter(path => !mainFiles.includes(path)),
    ...mainFiles.filter(path => !fixtureFiles.includes(path)));
  if (differences.length) throw new Error(`Fixture dependencies differ: ${[...new Set(differences)].sort().join(', ')}`);
  return { fixtureFiles, common };
}

export function checkBoundaryRevisionInputs({ cwd, baselineRoot, expectedHead }) {
  if (!baselineRoot || !isAbsolute(baselineRoot)) throw new Error('Baseline root must be an explicit absolute path');
  if (!/^[a-f0-9]{40}$/.test(expectedHead || '')) throw new Error('Expected PR revision must be a full SHA');
  cwd = realpathSync(cwd);
  baselineRoot = realpathSync(baselineRoot);
  if (baselineRoot === cwd) throw new Error('Baseline must be a separate checkout');
  for (const root of [cwd, baselineRoot]) if (realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== root) {
    throw new Error('Each product root must be its own checkout root');
  }
  if (git(cwd, 'rev-parse', 'HEAD') !== expectedHead) throw new Error('PR HEAD differs from the requested full SHA');
  if (git(baselineRoot, 'rev-parse', 'HEAD') !== baselineRevision) throw new Error('Baseline HEAD differs from the fixed main SHA');
  const { fixtureFiles, common } = checkBoundaryFixtureEquivalence(cwd, baselineRoot);
  const product = root => {
    const dirty = git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'index.html', 'assets', ...common);
    if (dirty) throw new Error(`Product or fixture checkout is dirty: ${dirty}`);
    const tree = git(root, 'ls-tree', '-r', 'HEAD', '--', 'index.html', 'assets');
    verifyBoundaryProductBytes(root, tree);
    return { root, revision: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}'),
      assetsTree: git(root, 'rev-parse', 'HEAD:assets'), indexBlob: git(root, 'rev-parse', 'HEAD:index.html'),
      productHash: createHash('sha256').update(tree).digest('hex') };
  };
  const pr = product(cwd), main = product(baselineRoot);
  if (pr.assetsTree !== prProduct.assets || pr.indexBlob !== prProduct.index) throw new Error('PR product differs from the declared bd7ccd67 product baseline');
  return { pr, main, fixtureFiles };
}

function processError(error) {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'PROCESS_ERROR';
}

function validTimingStages(report) {
  if (!Array.isArray(report.stages) || report.stages.length !== BOUNDARY_REVISION_STAGES.length) return false;
  let stopped = false, previousEnd = 0;
  for (const [index, stage] of report.stages.entries()) {
    if (!stage || stage.name !== BOUNDARY_REVISION_STAGES[index]) return false;
    const { status, startMs, endMs, durationMs } = stage;
    if (status === 'not-reached') {
      if (startMs !== null || endMs !== null || durationMs !== null) return false;
      stopped = true;
      continue;
    }
    if (stopped || !Number.isFinite(startMs) || startMs < previousEnd) return false;
    if (status === 'pending-at-failure') {
      if (!['failed', 'timedOut', 'interrupted'].includes(report.testStatus) || endMs !== null || durationMs !== null) return false;
      stopped = true;
      continue;
    }
    if (!['fulfilled', 'rejected'].includes(status) || !Number.isFinite(endMs) || !Number.isFinite(durationMs)
      || endMs < startMs || durationMs < 0
      || Math.abs(durationMs - (endMs - startMs)) > Number.EPSILON * Math.max(1, durationMs)) return false;
    if (status === 'rejected' && report.testStatus === 'passed') return false;
    previousEnd = endMs;
    stopped = status === 'rejected';
  }
  return report.testStatus !== 'passed' || report.stages.every(stage => stage.status === 'fulfilled');
}

export function runBoundaryRevisionComparison({
  cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  outputRoot = join(cwd, 'test-results/boundary-revision-comparison'), env = process.env,
  preflight = () => checkBoundaryRevisionInputs({ cwd, baselineRoot: env.PANDOLAB_BOUNDARY_BASELINE_ROOT,
    expectedHead: env.PANDOLAB_BOUNDARY_PR_REVISION }), execute = spawnSync,
} = {}) {
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, 'comparison-')), summaryPath = join(directory, 'summary.json');
  const summary = { schemaVersion: 1, status: 'running', spec, title, sequence,
    conditions: { addedHelpers: 'off', trace: 'off', failureScreenshots: 'only-on-failure', workers: 1, retries: 0, repeatEach: 1 },
    inputs: null, runs: [], exitCode: null };
  const save = () => writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  save();
  try { summary.inputs = preflight(); }
  catch (error) {
    summary.status = 'preflight-failed'; summary.preflightError = String(error.message).slice(0, 4000); summary.exitCode = 1;
    save(); return { exitCode: 1, summaryPath };
  }
  for (const [index, id] of sequence.entries()) {
    const product = summary.inputs[id.startsWith('PR') ? 'pr' : 'main'];
    const outputDirectory = join(id, 'artifacts'), log = join(id, 'playwright.log'), timingPath = join(id, 'timings.json');
    mkdirSync(join(directory, outputDirectory), { recursive: true });
    const args = [cliPath, 'test', spec, '--config=playwright.boundary-revision.config.mjs', `--grep=(?:^|\\s)${title}$`,
      '--workers=1', '--retries=0', '--repeat-each=1', `--output=${join(directory, outputDirectory)}`];
    const run = { id, order: index + 1, revision: product.revision, productRoot: product.root,
      command: [process.execPath, ...args], outputDirectory, log, status: 'running', exitCode: null,
      signal: null, errorCode: null, timings: { path: timingPath, status: 'pending' } };
    summary.runs.push(run); save();
    const logFile = openSync(join(directory, log), 'w');
    try {
      const result = execute(process.execPath, args, { cwd, env: { ...env, PANDOLAB_BOUNDARY_REVISION_COMPARISON: '1',
        PANDOLAB_BOUNDARY_NATIVE_TRACE: '0', PANDOLAB_BOUNDARY_PRODUCT_ROOT: product.root,
        PANDOLAB_BOUNDARY_TIMINGS_PATH: join(directory, timingPath) }, shell: false, timeout: 480_000, stdio: ['ignore', logFile, logFile] });
      run.exitCode = Number.isInteger(result.status) && result.status >= 0 ? result.status : null;
      run.signal = result.signal || null;
      run.errorCode = result.error ? processError(result.error) : null;
      run.status = run.exitCode === null || run.signal || run.errorCode ? 'infrastructure-failed' : run.exitCode === 0 ? 'passed' : 'failed';
    } catch (error) { run.status = 'infrastructure-failed'; run.errorCode = processError(error); }
    finally { closeSync(logFile); }
    try {
      const path = join(directory, timingPath);
      if (statSync(path).size > 16_384) throw new Error('Timing output exceeds its scalar bound');
      const report = JSON.parse(readFileSync(path, 'utf8'));
      if (report.schemaVersion !== 1 || report.label !== 'boundary-project-undo'
        || !['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(report.testStatus)
        || !validTimingStages(report)
        || (run.exitCode === 0 && (report.testStatus !== 'passed' || report.stages.some(stage => stage.status !== 'fulfilled')))) {
        throw new Error('Invalid timing output');
      }
      run.timings.status = 'available';
      run.timings.report = report;
    } catch (error) { run.timings.status = error.code === 'ENOENT' ? 'missing' : 'invalid'; }
    save();
  }
  summary.status = 'completed';
  summary.exitCode = summary.runs.every(run => run.status === 'passed' && run.timings.status === 'available') ? 0 : 1;
  save();
  return { exitCode: summary.exitCode, summaryPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runBoundaryRevisionComparison();
  console.log(`Boundary revision comparison summary: ${result.summaryPath}`);
  process.exitCode = result.exitCode;
}
