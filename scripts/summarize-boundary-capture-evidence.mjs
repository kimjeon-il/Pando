/** Bounded post-exit browser trace evidence; never records credentials or full context options. */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync,
  statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipMembers, zipMemberChunks } from '../tools/lib/geonames-zip.mjs';

export const LIMITS = Object.freeze({zip:512*1024*1024,trace:256*1024*1024,
  line:8*1024*1024,contexts:4});
const digest=async file=>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
};
function findNames(root,name) {
  const found=[];
  if(!existsSync(root))return found;
  const stack=[root];
  while(stack.length){
    const current=stack.pop();
    for(const item of readdirSync(current,{withFileTypes:true})){
      const path=join(current,item.name);
      if(item.isSymbolicLink())continue;
      if(item.isDirectory())stack.push(path);
      else if(item.isFile()&&item.name===name)found.push(path);
    }
  }
  return found.sort();
}
export function contextOptions(row) {
  const options=row.options||{},safe={};
  for(const key of ['noDefaultViewport','ignoreHTTPSErrors','javaScriptEnabled','bypassCSP',
    'offline','isMobile','hasTouch'])if(typeof options[key]==='boolean')safe[key]=options[key];
  const viewport=options.viewport;
  if(viewport&&typeof viewport==='object'&&['width','height'].every(k=>
      Number.isInteger(viewport[k])&&viewport[k]>0&&viewport[k]<100000))
    safe.viewport={width:viewport.width,height:viewport.height};
  if(['light','dark','no-preference'].includes(options.colorScheme))safe.colorScheme=options.colorScheme;
  if(['allow','block'].includes(options.serviceWorkers))safe.serviceWorkers=options.serviceWorkers;
  return {origin:['library','testRunner'].includes(row.origin)?row.origin:null,
    browserName:['chromium','firefox','webkit',''].includes(row.browserName)?row.browserName:null,
    playwrightVersion:typeof row.playwrightVersion==='string'&&/^\d+\.\d+\.\d+$/.test(row.playwrightVersion)?row.playwrightVersion:null,
    options:safe};
}
async function* linesBounded(zip,member){
  let fragments=[],lineSize=0;
  for await(const chunk of zipMemberChunks(zip,member)){
    let start=0,pos;
    while((pos=chunk.indexOf(10,start))!==-1){
      const fragment=chunk.subarray(start,pos);
      lineSize+=fragment.length+1;
      if(lineSize>LIMITS.line)throw Error('Trace line bound exceeded');
      yield Buffer.concat([...fragments,fragment]).toString('utf8');
      fragments=[];lineSize=0;start=pos+1;
    }
    if(start<chunk.length){
      const rest=chunk.subarray(start);
      lineSize+=rest.length;
      if(lineSize>LIMITS.line)throw Error('Trace line bound exceeded');
      fragments.push(rest);
    }
  }
  if(lineSize)yield Buffer.concat(fragments).toString('utf8');
}
export async function traceMetadata(output,screenshots){
  const result={status:'missing',path:null,bytes:null,sha256:null,
    domSnapshotCount:null,screencastFrameCount:null,sourceResourceCount:null,
    matchesCaptureCondition:null,contextOptions:[],contextOptionsOmitted:0,
    effectiveTraceOptions:{status:'unavailable',reason:
      'Trace capture options are absent from Playwright context-options headers; use observed event counts.'}};
  const traces=findNames(output,'trace.zip');
  if(!traces.length)return result;
  try{
    if(traces.length!==1)throw Error('Expected one desktop trace');
    const file=traces[0],stats=statSync(file);
    result.path=relative(output,file).replaceAll('\\','/');
    result.bytes=stats.size;
    if(stats.size>LIMITS.zip)throw Error('ZIP size bound exceeded');
    result.sha256=await digest(file);
    let snapshots=0,frames=0,sources=0,contexts=0,traceBytes=0,traceMembers=0;
    const entries=await zipMembers(file);
    for(const entry of entries){
      if(entry.name.startsWith('resources/src@'))sources++;
      if(!entry.name.endsWith('.trace'))continue;
      traceMembers++;
      traceBytes+=entry.uncompressed;
      if(traceBytes>LIMITS.trace)throw Error('Trace size bound exceeded');
      for await(const line of linesBounded(file,entry)){
        const row=JSON.parse(line);
        if(row.type==='frame-snapshot')snapshots++;
        if(row.type==='screencast-frame')frames++;
        if(row.type==='context-options'){
          contexts++;
          if(result.contextOptions.length<LIMITS.contexts)
            result.contextOptions.push(contextOptions(row));
        }
      }
    }
    if(!traceMembers)throw Error('No trace event streams');
    Object.assign(result,{status:'available',domSnapshotCount:snapshots,
      screencastFrameCount:frames,sourceResourceCount:sources,
      matchesCaptureCondition:screenshots?frames>0:frames===0,
      contextOptionsOmitted:Math.max(0,contexts-LIMITS.contexts)});
  }catch(error){
    result.status='error';result.error=error.name;
  }
  return result;
}
export async function diagnosticFile(output,evidence,name,limit){
  const result={status:'missing',path:null,bytes:null,sha256:null};
  const files=findNames(output,name);
  if(!files.length)return result;
  try{
    if(files.length!==1)throw Error('Ambiguous diagnostic file');
    const path=files[0],size=statSync(path).size;
    result.bytes=size;
    if(size>limit)throw Error('Diagnostic size bound exceeded');
    const bytes=readFileSync(path),parsed=JSON.parse(bytes.toString('utf8'));
    if(!parsed||Array.isArray(parsed)||parsed.label!=='boundary-project-undo')
      throw Error('Unexpected diagnostic contract');
    writeFileSync(join(evidence,name),bytes);
    Object.assign(result,{status:'available',path:name,sha256:createHash('sha256').update(bytes).digest('hex')});
  }catch(error){result.status='error';result.error=error.name;}
  return result;
}
export async function summarizeBoundaryEvidence(output,evidence,screenshots){
  mkdirSync(evidence,{recursive:true});
  const trace=await traceMetadata(output,screenshots);
  const diagnostics={
    native:await diagnosticFile(output,evidence,'boundary-project-undo-native-action.json',256*1024),
    cpu:await diagnosticFile(output,evidence,'boundary-project-undo-cpu-summary.json',32*1024)};
  const complete=trace.status==='available'&&trace.domSnapshotCount>0&&
    trace.sourceResourceCount>0&&trace.matchesCaptureCondition&&
    Object.values(diagnostics).every(d=>d.status==='available');
  const metadata={schemaVersion:1,status:complete?'complete':'incomplete',
    requestedTraceOptions:{mode:'on',screenshots,snapshots:true,sources:true,attachments:true},
    trace,diagnostics};
  writeFileSync(join(evidence,'trace-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
  return complete?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5||!['true','false'].includes(process.argv[4])){
    console.error('Expected output directory, evidence directory, and exact true/false capture flag');
    process.exitCode=2;
  }else summarizeBoundaryEvidence(resolve(process.argv[2]),resolve(process.argv[3]),
    process.argv[4]==='true').then(code=>{process.exitCode=code;}).catch(e=>{
      console.error('Evidence extractor failed: '+e.name);process.exitCode=2;
    });
}
