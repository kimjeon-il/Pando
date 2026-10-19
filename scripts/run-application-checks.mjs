import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { collectChanges } from './lib/check-changes.mjs';
import { loadRepository, planApplicationChecks } from './plan-application-checks.mjs';

export function executePlan(plan, { repository, run = (argv, options) => spawnSync(
  argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1), { ...options, stdio: 'inherit', shell: false }) } = {}) {
  const results = [], completed = new Map(), states = new Map(), visiting = new Set();
  const catalog = repository.catalog;
  let scratch;
  const expanded = argv => argv.map(arg => arg.includes('{scratch}') ? arg.replaceAll('{scratch}', scratch ||= mkdtempSync(join(tmpdir(), 'pando-checks-'))) : arg);
  const definition = id => catalog.prerequisites[id] || catalog.groups.find(group => group.id === id);
  function command(id, argv, context = []) {
    argv = expanded(argv);
    const key = JSON.stringify({ argv, context });
    if (completed.has(key)) return completed.get(key);
    let result;
    try {
      const response = run(argv, { cwd: repository.root, env: process.env });
      result = { id, argv, status: response.status === 0 && !response.error ? 'passed' : 'failed',
        exitCode: response.status, error: response.error?.message };
    } catch (error) { result = { id, argv, status: 'failed', error: error.message }; }
    completed.set(key, result); results.push(result); return result;
  }
  function prerequisite(id) {
    if (states.has(id)) return states.get(id);
    const entry = definition(id);
    if (!entry) throw Error('Missing prerequisite definition: ' + id);
    if (visiting.has(id)) throw Error('Cyclic check prerequisites: ' + id);
    visiting.add(id);
    const ready = (entry.requires || []).map(prerequisite).every(Boolean);
    visiting.delete(id);
    if (!ready) { results.push({ id, status: 'blocked', reason: 'prerequisite failed' }); states.set(id, false); return false; }
    const commands = [entry.argv];
    let ok = true;
    for (const argv of commands) {
      const extra = entry.appendChanged ? plan.changedFiles.filter(file => /\.[cm]?js$/.test(file)
        && repository.exists(file) && !/\/(?:vendor|worker-runtime|fixtures)\//.test(file)) : [];
      if (entry.appendChanged && !extra.length) continue;
      if (command(id, [...argv, ...extra], entry.requires || []).status !== 'passed') { ok = false; break; }
    }
    states.set(id, ok); return ok;
  }
  for (const id of plan.prerequisites) prerequisite(id);
  for (const id of plan.commands) prerequisite(id);
  // Unit failures stay visible even if a separate browser/asset prerequisite failed.
  if (plan.unitTests.length) {
    if (states.get('core') === false) results.push({ id: 'unit', status: 'blocked', reason: 'core prerequisite failed' });
    else for (let at = 0; at < plan.unitTests.length; at += 30)
      command('unit', ['node', '--test', '--test-concurrency=2', ...plan.unitTests.slice(at, at + 30)]);
  }
  if (plan.browserSpecs.length) {
    if (plan.prerequisites.some(id => states.get(id) === false)) results.push({ id: 'browser', status: 'blocked', reason: 'prerequisite failed' });
    else command('browser', ['node', 'node_modules/@playwright/test/cli.js', 'test', ...plan.browserSpecs, '--workers=1']);
  }
  return { ok: results.every(result => result.status === 'passed'), results, externalChecks: (plan.externalChecks || []).map(check => ({ ...check, status: 'not-executed-by-application-runner' })) };
}

export function selectionRequest(catalog, env, groups = []) {
  if (groups.length) return { groups, diff: true };
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') return { groups: [], diff: true };
  const automatic = () => catalog.groups.filter(group => group.mode !== 'manual').map(group => group.id);
  if (env.BROWSER_SCOPE === 'default') return { groups: automatic(), diff: false };
  if (env.BROWSER_SCOPE) {
    const specs = catalog.manualScopes?.[env.BROWSER_SCOPE];
    if (!specs) throw Error('Unsupported browser scope: ' + env.BROWSER_SCOPE);
    return { specs, groups: [], diff: false };
  }
  if (env.CHECK_SCOPE === 'all') return { groups: automatic(), diff: false };
  if (env.CHECK_SCOPE && env.CHECK_SCOPE !== 'auto') {
    const selected = catalog.remoteScopes?.[env.CHECK_PROFILE]?.[env.CHECK_SCOPE];
    if (!selected) throw Error('Unsupported remote check scope: ' + env.CHECK_SCOPE);
    return { groups: selected, diff: false };
  }
  return { groups: [], diff: true };
}

export function main(args = process.argv.slice(2), env = process.env) {
  const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const known = new Set(['--list', '--base', '--group', '--github-output', '--output']);
  for (let at = 0; at < args.length; at++) {
    if (!known.has(args[at])) throw Error('Unknown check option: ' + args[at]);
    if (['--base', '--group', '--output'].includes(args[at]) && (!args[++at] || args[at].startsWith('--'))) throw Error('Missing check option value');
  }
  const repository = loadRepository();
  const request = selectionRequest(repository.catalog, env, value('--group')?.split(',') || []);
  const comparison = request.diff === false ? collectChanges({ base: env.HEAD_SHA || 'HEAD', head: env.HEAD_SHA || 'HEAD', event: 'push' }) : collectChanges({ base: value('--base') || env.BASE_SHA || 'origin/main',
    head: env.HEAD_SHA || 'HEAD', event: env.GITHUB_EVENT_NAME || 'local' });
  const plan = { ...planApplicationChecks({ changedFiles: comparison.files, repository, groups: request.groups }), comparison };
  if (request.specs) {
    const specs = request.specs;
    for (const spec of specs) if (!repository.owners.has(spec)) throw Error('Missing focused browser spec: ' + spec);
    plan.unitTests = []; plan.commands = []; plan.browserSpecs = [...specs]; plan.prerequisites = ['core', 'generated'];
    plan.reasons = Object.fromEntries(specs.map(spec => [spec, ['manual scope: ' + env.BROWSER_SCOPE]]));
  }
  console.log(JSON.stringify(plan, null, 2));
  if (args.includes('--github-output')) {
    if (!env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT is required');
    appendFileSync(env.GITHUB_OUTPUT, `browser=${Boolean(plan.browserSpecs.length)}\nchecks=${Boolean(plan.unitTests.length || plan.browserSpecs.length || plan.commands.length)}\ngis_native=${plan.commands.some(id => repository.catalog.groups.find(group => group.id === id)?.gisNative)}\n`);
  }
  const result = args.includes('--list') ? { status: 'planned', plan } : { status: 'executed', plan, ...executePlan(plan, { repository }) };
  if (value('--output')) writeFileSync(value('--output'), JSON.stringify(result, null, 2) + '\n');
  if (result.status === 'executed') { console.log(JSON.stringify({ applicationChecksPassed: result.ok, results: result.results, externalChecks: result.externalChecks }, null, 2)); if (!result.ok) process.exitCode = 1; }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
