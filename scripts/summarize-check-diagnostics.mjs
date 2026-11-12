// Merge selected CI phase evidence. This is diagnostic only: the existing
// "checks" job remains the sole pass/fail gate.
import {readdirSync,readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {summarizeCheckDiagnostics,diagnoseCheckFailure} from './lib/check-failure-diagnostics.mjs';

export function aggregateCheckEvidence(directory,{head=null,pipeline={},dataRevision=null}={}) {
  const reports=[],inputs=existsSync(directory)?readdirSync(directory)
    .filter(name=>/^application-checks-.*\.json$/.test(name)).sort():[];
  for(const name of inputs){
    try{
      const raw=JSON.parse(readFileSync(resolve(directory,name),'utf8'));
      if(raw.status!=='executed'||!Array.isArray(raw.results))throw Error('Invalid application check phase receipt');
      reports.push({file:name,phase:raw.execution?.phase||'unknown',
        diagnostics:raw.diagnostics||summarizeCheckDiagnostics(raw.results,{
          phase:raw.execution?.phase||'unknown',sourceCommit:raw.plan?.comparison?.head||head,dataRevision,
        })});
    }catch(error){
      reports.push({file:name,phase:'unknown',
        diagnostics:summarizeCheckDiagnostics([{id:'receipt:'+name,status:'failed',error:error.message}],{sourceCommit:head,dataRevision})});
    }
  }
  const missing=[];
  if(pipeline.selection!=='success')
    missing.push({id:'check-selection',status:'failed',error:'Check selection or its prerequisites did not succeed'});
  for(const phase of ['nonBrowser','browser']){
    if(pipeline[phase]==='failure'&&
      !reports.some(report=>phase==='browser'?report.phase==='browser':report.phase==='non-browser'))
      missing.push({id:'phase:'+phase,status:'failed',error:'Selected CI phase failed without a structured check receipt'});
  }
  if(missing.length)reports.push({file:null,phase:'infrastructure',
    diagnostics:summarizeCheckDiagnostics(missing,{sourceCommit:head,dataRevision})});
  const entries=reports.flatMap(report=>report.diagnostics.entries.map(entry=>({...entry,phase:report.phase,file:report.file})));
  const summary=summarizeCheckDiagnostics(entries.map(entry=>({
    ...entry,diagnosis:entry.diagnosis||diagnoseCheckFailure(entry),
  })),{sourceCommit:head,dataRevision});
  return {schema:'pando-ci-check-diagnostics-v1',sourceCommit:head,
    status:summary.status,counts:summary.counts,entries,phaseReceipts:reports.map(({file,phase})=>({file,phase}))};
}

function main(args=process.argv.slice(2),env=process.env){
  const arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const dir=arg('--input-dir'),out=arg('--output');
  if(!dir||!out)throw Error('Required: --input-dir DIR --output FILE');
  const data=aggregateCheckEvidence(resolve(dir),{
    head:env.HEAD_SHA||null,dataRevision:env.LIBRARY_REVISION||null,
    pipeline:{selection:env.SELECTION_RESULT,nonBrowser:env.NON_BROWSER_RESULT,browser:env.BROWSER_RESULT},
  });
  mkdirSync(dirname(resolve(out)),{recursive:true});
  writeFileSync(resolve(out),JSON.stringify(data,null,2)+'\n');
  if(env.GITHUB_STEP_SUMMARY){
    const lines=['### Application check failure diagnostics',
      'Source: '+(data.sourceCommit||'unavailable'), 'Classification is evidence-based; an assertion alone is unconfirmed.',
      '| Category | Count |','| --- | ---: |',
      ...Object.entries(data.counts).map(([kind,count])=>'| '+kind+' | '+count+' |'),
      '','Structured diagnostics: '+basename(out)];
    writeFileSync(env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
  }
  console.log(JSON.stringify({sourceCommit:data.sourceCommit,status:data.status,counts:data.counts,phaseReceipts:data.phaseReceipts}));
  return data;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)
  try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
