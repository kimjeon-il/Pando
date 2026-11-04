import { spawnSync,execFileSync } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import { appendFileSync, writeFileSync, mkdtempSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { requiresUnitIsolation } from './lib/unit-test-isolation.mjs';
import { collectChanges } from './lib/check-changes.mjs';
import { loadRepository, planApplicationChecks } from './plan-application-checks.mjs';

function executionOptions({ phase = 'all', shard = null } = {}) {
  if (!['all', 'non-browser', 'browser'].includes(phase)) throw Error('Invalid execution phase: ' + phase);
  if (shard !== null) {
    if (phase !== 'browser') throw Error('A shard requires the browser phase');
    const match = typeof shard === 'string' && /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
    const current = Number(match?.[1]), total = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current > total || total > 8)
      throw Error('Invalid browser shard: ' + shard);
  }
  return { phase, shard };
}

function phasePrerequisites(plan, phase) {
  if (phase === 'browser') {
    if (!plan.browserSpecs.length) return [];
    if (!Array.isArray(plan.browserPrerequisites)) throw Error('Missing browser prerequisites in the canonical plan');
    return plan.browserPrerequisites;
  }
  if (phase === 'non-browser' && !plan.unitTests.length && !plan.commands.length && !plan.explicitPrerequisites?.length) return [];
  return plan.prerequisites;
}

export function exactCheckPlan(repository,selection) {
  const allowed=new Set(['unitTests','browserSpecs','commands','prerequisites']);
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!allowed.has(k)))throw Error('Invalid exact check selection');
  for(const k of allowed)if(!Array.isArray(selection[k])||selection[k].some(x=>typeof x!=='string')||new Set(selection[k]).size!==selection[k].length)throw Error('Invalid exact check selection: '+k);
  for(const [kind,prefix] of [['unitTests','tests/unit/'],['browserSpecs','tests/browser/']])for(const file of selection[kind]){
    const owner=repository.owners.get(file);if(!file.startsWith(prefix)||!owner||owner.mode==='retired')throw Error('Unknown or retired selected check: '+file);
  }
  for(const id of selection.commands)if(!repository.catalog.groups.some(g=>g.id===id&&g.kind==='command'))throw Error('Unknown selected command: '+id);
  for(const id of selection.prerequisites)if(!id.startsWith('native-')||!repository.catalog.prerequisites[id])throw Error('Unknown selected native tool: '+id);
  return planApplicationChecks({repository,exactSelection:selection});
}

export function dispatchSelectedChecks({repository,selection,command=(args)=>execFileSync(args[0],args.slice(1),{cwd:repository.root,encoding:'utf8',maxBuffer:8*1024**2}).trim()}={}) {
  exactCheckPlan(repository,selection);
  if(command(['git','status','--porcelain','--untracked-files=no']))throw Error('CI checks require committed and pushed inputs; preserve changes and commit/push before retrying. Selected checks: '+JSON.stringify(selection));
  const files=[...selection.unitTests,...selection.browserSpecs];if(files.length)command(['git','ls-files','--error-unmatch','--',...files]);
  const head=command(['git','rev-parse','HEAD']),branch=command(['git','symbolic-ref','--short','HEAD']);
  const remote=command(['git','ls-remote','--heads','origin','refs/heads/'+branch]).split(/\s+/)[0];
  if(remote!==head)throw Error('Push the current commit before requesting CI checks: '+head);
  const requestId=randomUUID();
  command(['gh','workflow','run','application-architecture.yml','--ref',branch,'-f','check_selection='+JSON.stringify(selection),'-f','request_id='+requestId]);
  // A run is identified by this request, never by the latest unrelated branch run.
  let run;
  for(let attempt=0;attempt<30&&!run;attempt++){
    const runs=JSON.parse(command(['gh','run','list','--workflow','application-architecture.yml','--branch',branch,'--event','workflow_dispatch','--limit','50','--json','databaseId,headSha,displayTitle,url']));
    run=runs.find(r=>r.headSha===head&&r.displayTitle==='Application checks '+requestId);
    if(!run)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  }
  if(!run)throw Error('CI dispatch accepted but run discovery is pending; request '+requestId+'; do not dispatch again');
  command(['gh','run','watch',String(run.databaseId),'--exit-status','--interval','5']);
  return {ok:true,results:[{id:'selected-native-ci',status:'passed',url:run.url,head,requestId}],externalChecks:[]};
}

export function executionOutputs(plan, { repository, ...options } = {}) {
  const { phase } = executionOptions(options), required = new Set();
  const include = id => {
    if (required.has(id)) return;
    required.add(id);
    const entry = repository.catalog.prerequisites[id] || repository.catalog.groups.find(group => group.id === id);
    (entry?.requires || []).forEach(include);
  };
  phasePrerequisites(plan, phase).forEach(include);
  const nonBrowser = Boolean(plan.unitTests.length || plan.commands.length || plan.explicitPrerequisites?.length), count = plan.browserSpecs.length;
  const total = Math.min(8, count);
  return {
    checks: nonBrowser || count > 0, non_browser: nonBrowser, browser: count > 0, browser_count: count,
    browser_matrix: { include: Array.from({ length: total }, (_, i) => ({ current: i + 1, total })) },
    gis_native: phase !== 'browser' && (required.has('native-hydro-point-screen') ||
      plan.commands.some(id => repository.catalog.groups.find(group => group.id === id)?.gisNative)),
    native_requirements: [...required].filter(id => id.startsWith('native-')).map(id => id.slice(7)).sort(),
  };
}

export function executePlan(plan, { repository, phase = 'all', shard = null, environment:executionEnvironment=process.env,remote=dispatchSelectedChecks, run = (argv, options) => spawnSync(
  argv[0] === 'node' ? process.execPath : argv[0], argv.slice(1), { ...options, stdio: 'inherit', shell: false }) } = {}) {
  const execution = executionOptions({ phase, shard });
  const prerequisites = phasePrerequisites(plan, phase);
  const pending=[...prerequisites,...(phase==='browser'?[]:[...plan.commands,...Object.values(plan.unitTestPrerequisites||{}).flat()])],seen=new Set();
  while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const entry=repository.catalog.prerequisites[id]||repository.catalog.groups.find(g=>g.id===id);pending.push(...(entry?.requires||[]));}
  if(executionEnvironment.GITHUB_ACTIONS!=='true'&&[...seen].some(id=>id.startsWith('native-'))){
    const selection={unitTests:phase==='browser'?[]:plan.unitTests,browserSpecs:phase==='non-browser'?[]:plan.browserSpecs,commands:phase==='browser'?[]:plan.commands,prerequisites:phase==='browser'?[]:plan.explicitPrerequisites||[]};
    return {...remote({repository,selection}),execution};
  }
  const results = [], completed = new Map(), states = new Map(), visiting = new Set();
  const catalog = repository.catalog;
  let scratch;
  const expanded = argv => argv.map(arg => arg.includes('{scratch}') ? arg.replaceAll('{scratch}', scratch ||= mkdtempSync(join(tmpdir(), 'pando-checks-'))) : arg);
  const definition = id => catalog.prerequisites[id] || catalog.groups.find(group => group.id === id);
  function environment(ids, seen = new Set()) {
    const result = {};
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = definition(id);
      Object.assign(result, environment(entry.requires || [], seen));
      for (const [name, value] of Object.entries(entry.env || {}))
        result[name] = value.replaceAll('{root}', repository.root);
    }
    return result;
  }
  function command(id, argv, context = [], env = {}) {
    argv = expanded(argv);
    const key = JSON.stringify({ argv, context, env });
    if (completed.has(key)) return completed.get(key);
    let result;
    try {
      const response = run(argv, { cwd: repository.root, env: { ...process.env, ...env } });
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
      if (command(id, [...argv, ...extra], entry.requires || [], environment([id])).status !== 'passed') { ok = false; break; }
    }
    states.set(id, ok); return ok;
  }
  try{
  for (const id of prerequisites) prerequisite(id);
  if (phase !== 'browser') for (const id of plan.commands) prerequisite(id);
  // Unit failures stay visible even if a separate browser/asset prerequisite failed.
  if (phase !== 'browser' && plan.unitTests.length) {
    if (states.get('core') === false) results.push({ id: 'unit', status: 'blocked', reason: 'core prerequisite failed' });
    else {
      const batches = new Map(), isolated = [];
      for (const file of plan.unitTests) {
        const required = plan.unitTestPrerequisites?.[file] || [];
        const failed = required.filter(id => !prerequisite(id));
        if (failed.length) {
          results.push({ id: 'unit', files: [file], status: 'blocked', reason: 'prerequisite failed', prerequisites: failed });
          continue;
        }
        if (requiresUnitIsolation(file)) { isolated.push({required, file}); continue; }
        const key = JSON.stringify(required);
        if (!batches.has(key)) batches.set(key, { required, files: [] });
        batches.get(key).files.push(file);
      }
      for (const { required, files } of batches.values()) for (let at = 0; at < files.length; at += 30)
        command('unit', ['node', '--test', '--test-concurrency=2', ...files.slice(at, at + 30)], required, environment(required));
      for (const {required, file} of isolated)
        command('unit', ['node', '--test', '--test-concurrency=2', file], required, environment(required));
    }
  }
  if (phase !== 'non-browser' && plan.browserSpecs.length) {
    if ((plan.browserPrerequisites || plan.prerequisites).some(id => states.get(id) === false)) results.push({ id: 'browser', status: 'blocked', reason: 'prerequisite failed' });
    else command('browser', ['node', 'node_modules/@playwright/test/cli.js', 'test', ...plan.browserSpecs, '--workers=1', ...(shard ? ['--shard', shard] : [])]);
  }
  const evidence=scratch&&existsSync(join(scratch,'web-evidence.json'))?readFileSync(join(scratch,'web-evidence.json'),'utf8'):null;
  return { execution, ok: results.every(result => result.status === 'passed'), results, stagingEvidence:evidence,externalChecks: (plan.externalChecks || []).map(check => ({ ...check, status: 'not-executed-by-application-runner' })) };
  }finally{if(scratch)rmSync(scratch,{recursive:true});}
}

export function selectionRequest(catalog, env, groups = []) {
  if(env.CHECK_SELECTION)return {exact:JSON.parse(env.CHECK_SELECTION),groups:[],diff:false};
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
  const known = new Set(['--list', '--base', '--group', '--github-output', '--output', '--phase', '--shard']);
  for (let at = 0; at < args.length; at++) {
    if (!known.has(args[at])) throw Error('Unknown check option: ' + args[at]);
    if (['--base', '--group', '--output', '--phase', '--shard'].includes(args[at]) && (!args[++at] || args[at].startsWith('--'))) throw Error('Missing check option value');
  }
  const execution = executionOptions({ phase: value('--phase'), shard: value('--shard') });
  const repository = loadRepository();
  const request = selectionRequest(repository.catalog, env, value('--group')?.split(',') || []);
  const comparison = request.diff === false ? collectChanges({ base: env.HEAD_SHA || 'HEAD', head: env.HEAD_SHA || 'HEAD', event: 'push' }) : collectChanges({ base: value('--base') || env.BASE_SHA || 'origin/main',
    head: env.HEAD_SHA || 'HEAD', event: env.GITHUB_EVENT_NAME || 'local' });
  const plan = { ...(request.exact?exactCheckPlan(repository,request.exact):planApplicationChecks({ changedFiles: comparison.files, repository, groups: request.groups })), comparison };
  if (request.specs) {
    const specs = request.specs;
    for (const spec of specs) if (!repository.owners.has(spec)) throw Error('Missing focused browser spec: ' + spec);
    plan.unitTests = []; plan.commands = []; plan.browserSpecs = [...specs]; plan.prerequisites = ['core', 'generated']; plan.browserPrerequisites = [...plan.prerequisites];
    plan.reasons = Object.fromEntries(specs.map(spec => [spec, ['manual scope: ' + env.BROWSER_SCOPE]]));
  }
  console.log(JSON.stringify(plan, null, 2));
  if (args.includes('--github-output')) {
    if (!env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT is required');
    const outputs = executionOutputs(plan, { repository, ...execution });
    appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join(''));
  }
  const result = args.includes('--list') ? { status: 'planned', plan, execution } : { status: 'executed', plan, ...executePlan(plan, { repository, ...execution }) };
  if (value('--output')) writeFileSync(value('--output'), JSON.stringify(result, null, 2) + '\n');
  if (result.status === 'executed') {
    console.log(JSON.stringify({ [execution.phase === 'all' ? 'applicationChecksPassed' : 'applicationPhasePassed']: result.ok,
      execution, results: result.results, externalChecks: result.externalChecks }, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
