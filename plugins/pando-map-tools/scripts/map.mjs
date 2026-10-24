#!/usr/bin/env node
import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

const values=process.argv.slice(2), command=values.shift(), options={};
for(let i=0;i<values.length;i+=2) {
  if(!/^--[a-z-]+$/.test(values[i]) || !values[i+1] || values[i+1].startsWith('--') || Object.hasOwn(options,values[i].slice(2))) throw new Error('Use unique --key value options.');
  options[values[i].slice(2)]=values[i+1];
}
if(options.workspace) process.env.PANDO_MAP_WORKSPACE=resolve(options.workspace);
const {workspace,workspaceModule}=await import('../lib/workspace.mjs');
const {analyze,renderPreview,reviseWithRaster,regionAnalysisOptions}=await import('../lib/engine.mjs');
const {loadJob,saveJob,exportJob}=await import('../lib/jobs.mjs');
const allowed={analyze:['workspace','input','job','model','languages','page','date','rect','max-pixels','provenance'],revise:['workspace','job','changes'],export:['workspace','job','output']};
if(!allowed[command] || Object.keys(options).some(v=>!allowed[command].includes(v)) || !options.job) throw new Error('Usage: map.mjs analyze --input <map> --job <external/job.json> [--model <manifest>] [--languages eng,ell] [--page 1]; revise --job <job> --changes <json>; export --job <job> --output <new directory>. All commands accept --workspace <existing work/ui>.');
const external=path=>{const full=resolve(path),rel=relative(workspace,full);if(!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Jobs/exports belong in external material storage, outside the application checkout.');return full;};
const jobPath=external(options.job);await mkdir(dirname(jobPath),{recursive:true});
const controller=new globalThis.AbortController(),abort=()=>controller.abort(new Error('Cancelled by SIGINT'));
process.once('SIGINT',abort);
let lock;
try {
  lock=await open(jobPath+'.lock','wx');await lock.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
  if(command==='analyze') {
    if(!options.input) throw new Error('--input is required.');
    try {await readFile(jobPath);throw new Error('Job already exists; use revise or a new job path.');}catch(error){if(error.code!=='ENOENT') throw error;}
    let model=options.model;
    if(!model) {const {reportPath}=await workspaceModule('tools/report-paths.mjs');model=reportPath('reports/map-analysis/models/macro-v6/boundary.manifest.json',{access:'read'});}
    const job=await analyze({input:options.input,jobPath,modelPath:resolve(model),languages:options.languages?.split(','),page:options.page?Number(options.page):null,
      date:options.date || null,rect:options.rect?JSON.parse(options.rect):null,provenance:options.provenance?JSON.parse(await readFile(options.provenance,'utf8')):null,maxPixels:options['max-pixels']?Number(options['max-pixels']):4_000_000,signal:controller.signal,
      progress:data=>process.stderr.write(JSON.stringify(data)+'\n')});
    await renderPreview(job,jobPath+'.preview.png',controller.signal);
    process.stdout.write(JSON.stringify({job:jobPath,status:job.status,preview:jobPath+'.preview.png',locationCandidates:job.locationCandidates.length,
      boundaries:job.graph.chains.length,faces:job.graph.faces.length,diagnostics:job.diagnostics})+'\n');
  } else if(command==='revise') {
    if(!options.changes) throw new Error('--changes structured JSON file is required.');
    let job=await loadJob(jobPath);
    const changes=JSON.parse(await readFile(options.changes,'utf8'));
    for(const change of Array.isArray(changes)?changes:[changes]) {
      controller.signal.throwIfAborted();
      job=change.type==='region'?await analyze({...regionAnalysisOptions(job,change),jobPath,signal:controller.signal,progress:data=>process.stderr.write(JSON.stringify(data)+'\n')})
        : await reviseWithRaster(job,change,controller.signal);
    }
    await renderPreview(job,jobPath+'.preview.png',controller.signal);await saveJob(jobPath,job);
    process.stdout.write(JSON.stringify({job:jobPath,revision:job.revision,status:job.status,reason:job.warp?.reason,review:job.review,preview:jobPath+'.preview.png'})+'\n');
  } else {
    if(!options.output) throw new Error('--output new external directory is required.');
    const result=await exportJob(await loadJob(jobPath),external(options.output),{preview:(job,path)=>renderPreview(job,path,controller.signal),signal:controller.signal});
    process.stdout.write(JSON.stringify(result)+'\n');
  }
} catch(error) {
  process.stderr.write(JSON.stringify({status:controller.signal.aborted?'cancelled':'failed',code:error.code || error.name,message:error.message,stack:error.stack,cause:error.cause?.stack,errors:error.errors?.map(item=>({message:item.message,stack:item.stack}))})+'\n');process.exitCode=1;
} finally {process.removeListener('SIGINT',abort);if(lock){await lock.close();await unlink(jobPath+'.lock');}}
