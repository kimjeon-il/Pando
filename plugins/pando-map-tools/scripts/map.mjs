#!/usr/bin/env node
import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, basename } from 'node:path';
import { prepareRuntime,analysisDataConfig } from '../lib/runtime.mjs';
import { acquire } from '../lib/map-source.mjs';

const controller=new globalThis.AbortController();
const abort=()=>controller.abort(new Error('Cancelled by SIGINT'));
process.once('SIGINT',abort);let lock,jobPath;
const progress=data=>process.stderr.write(JSON.stringify(data)+'\n');
try {
  const values=process.argv.slice(2),command=values.shift(),options={};
  for(let i=0;i<values.length;i+=2) {
    if(!/^--[a-z-]+$/.test(values[i])||!values[i+1]||values[i+1].startsWith('--')||Object.hasOwn(options,values[i].slice(2)))throw new Error('Use unique --key value options.');
    options[values[i].slice(2)]=values[i+1];
  }
  const allowed={analyze:['workspace','input','source','job','model','languages','page','date','rect','projection','max-pixels','provenance'],revise:['workspace','job','changes'],export:['workspace','job','output']};
  if(!allowed[command]||Object.keys(options).some(key=>!allowed[command].includes(key))||!options.job)throw new Error('Usage: map.mjs analyze --input <map> or --source <source.json> --job <new job>; revise --job <job> --changes <json>; export --job <job> --output <new directory>.');
  if(command==='analyze'&&Boolean(options.input)===Boolean(options.source))throw new Error('Analyze requires exactly one of --input or --source.');
  if(options.source&&options.provenance)throw new Error('--source records its acquired provenance; do not override it with --provenance.');
  const runtime=await prepareRuntime({workspace:options.workspace,signal:controller.signal,progress});
  process.env.PANDO_MAP_WORKSPACE=runtime.workspace;process.env.PANDO_MAP_PYTHON=runtime.python;
  const {workspace,workspaceModule}=await import('../lib/workspace.mjs');
  const {analyze,renderPreview,reviseWithRaster,regionAnalysisOptions}=await import('../lib/engine.mjs');
  const {loadJob,saveJob,exportJob,digest}=await import('../lib/jobs.mjs');
  const external=path=>{const full=resolve(path),rel=relative(workspace,full);if(!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('Jobs/exports belong outside the analysis workspace.');return full;};
  controller.signal.throwIfAborted();jobPath=external(options.job);await mkdir(dirname(jobPath),{recursive:true});
  lock=await open(jobPath+'.lock','wx');await lock.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
  if(command==='analyze') {
    try {await readFile(jobPath);throw new Error('Job already exists; use revise or a new job path.');}catch(error){if(error.code!=='ENOENT')throw error;}
    let input=options.input,provenance=options.provenance?JSON.parse(await readFile(options.provenance,'utf8')):null;
    if(options.source) {
      progress({phase:'source',status:'acquiring'});
      const source=await acquire(JSON.parse(await readFile(resolve(options.source),'utf8')),jobPath+'.input',{signal:controller.signal});
      if(!['acquired-unlabelled','verified-existing'].includes(source.status))throw Object.assign(new Error('Map source is unavailable: '+source.status),{code:'PL-MAP-SOURCE'});
      input=source.path;provenance=JSON.parse(await readFile(source.provenancePath,'utf8'));
    }
    provenance??={kind:'provided-file',title:basename(input),rightsReviewed:false,license:null};
    let model=options.model||runtime.modelPath;
    if(!model){
      const {reportPath}=await workspaceModule('tools/report-paths.mjs'),{config}=await analysisDataConfig();
      model=reportPath(config.defaultModel.root+'/boundary.manifest.json',{access:'read'});
      if(digest(await readFile(model))!==config.defaultModel.manifestSha256)throw new Error('Default model manifest differs from pinned analysis pairing.');
    }
    const job=await analyze({input,jobPath,modelPath:resolve(model),languages:options.languages?.split(','),page:options.page?Number(options.page):null,
      date:options.date||null,rect:options.rect?JSON.parse(options.rect):null,projection:options.projection?JSON.parse(await readFile(options.projection,'utf8')):null,provenance,maxPixels:options['max-pixels']?Number(options['max-pixels']):4_000_000,signal:controller.signal,progress});
    await renderPreview(job,jobPath+'.preview.png',controller.signal);
    process.stdout.write(JSON.stringify({job:jobPath,status:job.status,preview:jobPath+'.preview.png',locationCandidates:job.locationCandidates.length,
      boundaries:job.graph.chains.length,faces:job.graph.faces.length,diagnostics:job.diagnostics,runtime:{cacheHit:runtime.cacheHit,codeRevision:runtime.catalog?.codeRevision}})+'\n');
  } else if(command==='revise') {
    if(!options.changes)throw new Error('--changes structured JSON file is required.');
    let job=await loadJob(jobPath);const changes=JSON.parse(await readFile(options.changes,'utf8'));
    for(const change of Array.isArray(changes)?changes:[changes]) {
      controller.signal.throwIfAborted();
      job=change.type==='region'?await analyze({...regionAnalysisOptions(job,change),jobPath,signal:controller.signal,progress}):await reviseWithRaster(job,change,controller.signal);
    }
    await renderPreview(job,jobPath+'.preview.png',controller.signal);await saveJob(jobPath,job);
    process.stdout.write(JSON.stringify({job:jobPath,revision:job.revision,status:job.status,reason:job.warp?.reason,review:job.review,preview:jobPath+'.preview.png'})+'\n');
  } else {
    if(!options.output)throw new Error('--output new private directory is required.');
    const result=await exportJob(await loadJob(jobPath),external(options.output),{preview:(job,path)=>renderPreview(job,path,controller.signal),signal:controller.signal});
    process.stdout.write(JSON.stringify(result)+'\n');
  }
} catch(error) {
  process.stderr.write(JSON.stringify({status:controller.signal.aborted?'cancelled':'failed',code:error.code||error.name,message:error.message,stack:error.stack,cause:error.cause?.stack,stderr:error.stderr})+'\n');process.exitCode=1;
} finally {process.removeListener('SIGINT',abort);if(lock){await lock.close();await unlink(jobPath+'.lock');}}
