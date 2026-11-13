import { spawnSync,execFileSync } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import { appendFileSync, writeFileSync, mkdtempSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { planUnitTestBatches } from './lib/unit-test-batches.mjs';
import { collectChanges } from './lib/check-changes.mjs';
import { loadRepository, planApplicationChecks } from './plan-application-checks.mjs';
import {assertRemoteOnlyNativeAllowed} from './lib/remote-only-native-policy.mjs';
import {diagnoseCheckFailure,summarizeCheckDiagnostics} from './lib/check-failure-diagnostics.mjs';

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
    const owner=repository.owners.get(file);if(!file.startsWith(prefix)||!owner)throw Error('Unknown or retired selected check: '+file);
  }
  for(const id of selection.commands)if(!repository.catalog.groups.some(g=>g.id===id&&g.kind==='command'))throw Error('Unknown selected command: '+id);
  for(const id of selection.prerequisites)if(!id.startsWith('native-')||!repository.catalog.prerequisites[id])throw Error('Unknown selected native tool: '+id);
  return planApplicationChecks({repository,exactSelection:selection});
}

export function dispatchSelectedChecks({repository,selection,artifact=null,command=(args)=>execFileSync(args[0],args.slice(1),{cwd:repository.root,encoding:'utf8',maxBuffer:8*1024**2}).trim()}={}) {
  if(artifact!==null&&artifact!=='core-wasm')throw Error('Unknown selected artifact');
  if(!artifact)exactCheckPlan(repository,selection);
  if(command(['git','status','--porcelain','--untracked-files=no']))throw Error('CI checks require committed and pushed inputs; preserve changes and commit/push before retrying. Selected checks: '+JSON.stringify(selection));
  const files=artifact?[]:[...selection.unitTests,...selection.browserSpecs];if(files.length)command(['git','ls-files','--error-unmatch','--',...files]);
  const head=command(['git','rev-parse','HEAD']),branch=command(['git','symbolic-ref','--short','HEAD']);
  const remote=command(['git','ls-remote','--heads','origin','refs/heads/'+branch]).split(/\s+/)[0];
  if(remote!==head)throw Error('Push the current commit before requesting CI checks: '+head);
  const requestId=randomUUID();
  const workflow=artifact?'shared-core.yml':'application-architecture.yml';
  const title=artifact?'Shared Core core-artifact '+requestId:'Application checks '+requestId;
  const inputs=artifact?['scope=core-artifact']:['check_selection='+JSON.stringify(selection)];
  command(['gh','workflow','run',workflow,'--ref',branch,...inputs.flatMap(input=>['-f',input]),'-f','request_id='+requestId]);
  // A run is identified by this request, never by the latest unrelated branch run.
  let run;
  for(let attempt=0;attempt<30&&!run;attempt++){
    const runs=JSON.parse(command(['gh','run','list','--workflow',workflow,'--branch',branch,'--event','workflow_dispatch','--limit','50','--json','databaseId,headSha,displayTitle,url']));
    run=runs.find(r=>r.headSha===head&&r.displayTitle===title);
    if(!run)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  }
  if(!run)throw Error('CI dispatch accepted but run discovery is pending; request '+requestId+'; do not dispatch again');
  command(['gh','run','watch',String(run.databaseId),'--exit-status','--interval','5']);
  return {ok:true,results:[{id:'selected-native-ci',status:'passed',url:run.url,head,requestId}],externalChecks:[]};
}

// Unit suites that start a real Playwright browser need an executable in the
// non-browser CI phase too. Installing Chromium for every unit suite is wasteful.
export function selectedUnitTestsNeedBrowser(plan,{repository}={}) {
  if(typeof repository?.read!=='function')return false;
  return (plan.unitTests||[]).some(file=>{
    const source=repository.read(file);
    return /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:@playwright\/test|playwright)(?:\/[^'"]+)?['"]/.test(source);
  });
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
  const total = Math.min(8, Math.ceil(count / 4));
  const metadataOnly = new Set(repository?.catalog.metadataOnlyTests || []);
  const runtimeData = phase !== 'non-browser' && count > 0 || phase !== 'browser' && (
    plan.commands.length > 0 || Boolean(plan.explicitPrerequisites?.length) || plan.unitTests.some(file => !metadataOnly.has(file)));
  return {
    checks: nonBrowser || count > 0, non_browser: nonBrowser, browser: count > 0, browser_count: count,
    runtime_data: runtimeData,
    unit_browser: phase !== 'browser' && selectedUnitTestsNeedBrowser(plan,{repository}),
    browser_matrix: { include: Array.from({ length: total }, (_, i) => ({ current: i + 1, total })) },
    gis_native: phase !== 'browser' && (required.has('native-hydro-point-screen') ||

      plan.commands.some(id => repository.catalog.groups.find(group => group.id === id)?.gisNative)),
    native_requirements: [...required].filter(id => id.startsWith('native-')).map(id => id.slice(7)).sort(),
  };
}

export function executePlan(plan, { repository, phase = 'all', shard = null, unitTestArgs = [], environment:executionEnvironment=process.env,remote=dispatchSelectedChecks, run = (argv, options) => {
  // Preserve ordinary CI stdout/stderr while retaining bounded evidence to
  // distinguish a broken artifact/setup from an unverified assertion.
  const result = spawnSync(argv[0] === 'node' ? process.execPath : argv[0],
    argv.slice(1), { ...options, stdio: ['ignore','pipe','pipe'],
      encoding:'utf8', maxBuffer:32*1024*1024, shell:false });
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  return result;
} } = {}) {
  const execution = executionOptions({ phase, shard });
  if (!Array.isArray(unitTestArgs) || unitTestArgs.some(arg => typeof arg !== 'string'))
    throw Error('Invalid unit test arguments');
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
      const definitionForCheck=definition(id);
      if(id.startsWith('native-')||definitionForCheck?.gisNative)
        assertRemoteOnlyNativeAllowed({root:repository.root,environment:executionEnvironment,operation:'application native prerequisite '+id});
      const response = run(argv, { cwd: repository.root, env: { ...executionEnvironment, ...env } });
      result = { id, argv, status: response.status === 0 && !response.error ? 'passed' : 'failed',
        exitCode: response.status, error: response.error?.message,
        ...(id==='unit'||id==='browser'?{files:argv.filter(arg=>/^tests\/(?:unit|browser)\//.test(arg))}:{}) };
      if(result.status==='failed')result.diagnosis=diagnoseCheckFailure({
        ...result,stdout:response.stdout,stderr:response.stderr,
      });
    } catch (error) {
      result = { id, argv, status:'failed', error:error.message,
        diagnosis:diagnoseCheckFailure({status:'failed',error:error.code?error.code+': '+error.message:error.message}) };
    }
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
      const ready = [], requirements = new Map();
      for (const file of plan.unitTests) {
        const required = plan.unitTestPrerequisites?.[file] || [];
        const failed = required.filter(id => !prerequisite(id));
        if (failed.length) {
          results.push({ id: 'unit', files: [file], status: 'blocked', reason: 'prerequisite failed', prerequisites: failed });
          continue;
        }
        ready.push(file);
        requirements.set(file, required);
      }
      for (const {required, files} of planUnitTestBatches(ready, {requirements}))
        command('unit', ['node', '--test', '--test-concurrency=2', ...files, ...unitTestArgs], required, environment(required));
    }
  }
  if (phase !== 'non-browser' && plan.browserSpecs.length) {
    if ((plan.browserPrerequisites || plan.prerequisites).some(id => states.get(id) === false)) results.push({ id: 'browser', status: 'blocked', reason: 'prerequisite failed' });
    else command('browser', ['node', 'node_modules/@playwright/test/cli.js', 'test', ...plan.browserSpecs, '--workers=1', ...(shard ? ['--shard', shard] : [])]);
  }
  const evidence=scratch&&existsSync(join(scratch,'web-evidence.json'))?readFileSync(join(scratch,'web-evidence.json'),'utf8'):null;
  for(const result of results)if(result.status==='blocked'){
    const cause=(result.prerequisites||[]).map(id=>results.find(row=>row.id===id&&row.status==='failed'))
      .find(Boolean);
    result.diagnosis=cause?.diagnosis && cause.diagnosis.kind!=='undetermined'
      ? {...cause.diagnosis,confidence:'inherited',rule:'blocked-by-'+cause.diagnosis.rule}
      : diagnoseCheckFailure(result);
  }
  let dataRevision=null;
  if(repository.root&&existsSync(resolve(repository.root,'config/library-data.json'))){
    try{dataRevision=JSON.parse(readFileSync(resolve(repository.root,'config/library-data.json'),'utf8')).revision||null;}
    catch{ /* An invalid library pin is diagnosed by its owning prerequisite. */ }
  }
  const diagnostics=summarizeCheckDiagnostics(results,{
    phase,sourceCommit:plan.comparison?.head||null,dataRevision,
  });
  return { execution, ok: results.every(result => result.status === 'passed'),
    results,diagnostics,stagingEvidence:evidence,externalChecks: (plan.externalChecks || []).map(check => ({ ...check, status: 'not-executed-by-application-runner' })) };
  }finally{if(scratch)rmSync(scratch,{recursive:true});}
}

export function selectionRequest(catalog, env, groups = []) {
  if (env.CHECK_SELECTION) return { exact: JSON.parse(env.CHECK_SELECTION), groups: [], diff: false };
  // Explicit groups are validated and come from environment, not shell syntax.
  const selected = [...groups, ...String(env.CHECK_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean)];
  if (selected.length) {
    const known = new Set(catalog.groups.map(group => group.id));
    for (const group of selected) if (!known.has(group)) throw Error('Unknown check group: ' + group);
    return { groups: [...new Set(selected)], diff: false };
  }
  const automatic = () => catalog.groups.filter(group => group.mode !== 'manual' && group.mode !== 'retired').map(group => group.id);
  if (env.CHECK_SCOPE === 'all') return { groups: automatic(), diff: false };
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.BROWSER_SCOPE && env.BROWSER_SCOPE !== 'default') {
    const specs = catalog.manualScopes?.[env.BROWSER_SCOPE];
    if (!specs) throw Error('Unsupported browser scope: ' + env.BROWSER_SCOPE);
    return { specs, groups: [], diff: false };
  }
  if (env.CHECK_SCOPE && env.CHECK_SCOPE !== 'auto') {
    const groups = catalog.remoteScopes?.[env.CHECK_PROFILE]?.[env.CHECK_SCOPE];
    if (!groups) throw Error('Unsupported remote check scope: ' + env.CHECK_SCOPE);
    return { groups, diff: false };
  }
  // Default manual dispatch and PRs are affected-only. Full catalog requires
  // check_scope=all, preventing redundant global test runs on small changes.
  return { groups: [], diff: true };
}

export function main(args = process.argv.slice(2), env = process.env) {
  args=args.flatMap(arg=>{const at=arg.indexOf('=');return arg.startsWith('--')&&at>2?[arg.slice(0,at),arg.slice(at+1)]:[arg];});
  const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const known = new Set(['--core-artifact', '--list', '--base', '--group', '--github-output', '--output', '--phase', '--shard']);
  for (let at = 0; at < args.length; at++) {
    if (!known.has(args[at])) throw Error('Unknown check option: ' + args[at]);
    if (['--base', '--group', '--output', '--phase', '--shard'].includes(args[at]) && (!args[++at] || args[at].startsWith('--'))) throw Error('Missing check option value');
  }
  const execution = executionOptions({ phase: value('--phase'), shard: value('--shard') });
  const repository = loadRepository();
  if(args.includes('--core-artifact')){
    if(args.length!==1)throw Error('Core artifact preparation must be selected alone');
    const result=dispatchSelectedChecks({repository,artifact:'core-wasm'});
    console.log(JSON.stringify(result,null,2));return result;
  }
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
      execution, results: result.results, diagnostics:result.diagnostics,
      externalChecks: result.externalChecks }, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error(error.stack);
    console.error(JSON.stringify({checkDiagnosis:diagnoseCheckFailure({
      status:'failed',error:(error.code||'')+' '+error.message,
    })}));
    process.exitCode = 1;
  }
}
