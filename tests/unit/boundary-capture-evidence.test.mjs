import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipFixture } from '../helpers/geonames-fixtures.mjs';
import { summarizeBoundaryEvidence,traceMetadata,contextOptions,LIMITS } from '../../scripts/summarize-boundary-capture-evidence.mjs';

const root=t=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-evidence-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const output=join(dir,'output'),evidence=join(dir,'evidence');
 mkdirSync(output);return{dir,output,evidence};
};
function record(root,{frames=1,contexts=1,snapshots=1,corrupt=false}={}){
 const data=[
  ...Array.from({length:snapshots},()=>({type:'frame-snapshot'})),
  ...Array.from({length:frames},()=>({type:'screencast-frame'})),
  ...Array.from({length:contexts},()=>({type:'context-options',origin:'testRunner',
    browserName:'chromium',playwrightVersion:'1.62.1',options:{
      viewport:{width:1920,height:1080},isMobile:false,SECRET_ACCESS:'DO_NOT_EXPORT',
      colorScheme:'dark'}}))];
 writeFileSync(join(root.output,'trace.zip'),zipFixture('resources/src@frame.trace',
   data.map(x=>JSON.stringify(x)).join('\n')+'\n',{deflate:true,corruptCrc:corrupt}));
 for(const name of ['boundary-project-undo-native-action.json','boundary-project-undo-cpu-summary.json'])
   writeFileSync(join(root.output,name),JSON.stringify({label:'boundary-project-undo',safe:true}));
}
test('trace header sanitization allows only canonical UI flags and no private options',()=>{
 const result=contextOptions({origin:'testRunner',browserName:'chromium',playwrightVersion:'1.62.1',
   options:{viewport:{width:1920,height:1080},isMobile:false,SECRET_ACCESS:'secret',
     colorScheme:'dark',serviceWorkers:'block'}});
 assert.deepEqual(result,{origin:'testRunner',browserName:'chromium',playwrightVersion:'1.62.1',
   options:{isMobile:false,viewport:{width:1920,height:1080},colorScheme:'dark',serviceWorkers:'block'}});
 assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('source excerpts, one original trace, snapshots, frames and diagnostics constitute complete evidence',async t=>{
 const r=root(t);record(r);
 assert.equal(await summarizeBoundaryEvidence(r.output,r.evidence,true),0);
 const meta=JSON.parse(readFileSync(join(r.evidence,'trace-metadata.json'),'utf8'));
 assert.equal(meta.status,'complete');assert.equal(meta.trace.domSnapshotCount,1);
 assert.equal(meta.trace.screencastFrameCount,1);assert.equal(meta.trace.sourceResourceCount,1);
 assert.equal(meta.trace.matchesCaptureCondition,true);
 assert.equal(meta.diagnostics.native.status,'available');
 assert.equal(meta.diagnostics.cpu.status,'available');
 assert.ok(existsSync(join(r.evidence,'boundary-project-undo-native-action.json')));
 assert.doesNotMatch(JSON.stringify(meta),/SECRET_ACCESS|DO_NOT_EXPORT/);
});
test('screenshots false requires zero frames; screenshots true requires one or more frames',async t=>{
 const a=root(t);record(a,{frames:0});
 assert.equal(await summarizeBoundaryEvidence(a.output,a.evidence,false),0);
 assert.equal(await summarizeBoundaryEvidence(a.output,a.evidence,true),1);
 assert.equal(JSON.parse(readFileSync(join(a.evidence,'trace-metadata.json'))).status,'incomplete');
});
test('corrupt trace and oversized diagnostic are errors, never silently successful',async t=>{
 const a=root(t);record(a,{corrupt:true});
 assert.equal(await summarizeBoundaryEvidence(a.output,a.evidence,true),1);
 const meta=JSON.parse(readFileSync(join(a.evidence,'trace-metadata.json')));
 assert.equal(meta.trace.status,'error');
 const b=root(t);record(b);
 writeFileSync(join(b.output,'boundary-project-undo-cpu-summary.json'),'x'.repeat(33*1024));
 assert.equal(await summarizeBoundaryEvidence(b.output,b.evidence,true),1);
 assert.equal(JSON.parse(readFileSync(join(b.evidence,'trace-metadata.json'))).diagnostics.cpu.status,'error');
});
test('missing trace or diagnostics never produce a complete result',async t=>{
 const a=root(t);
 assert.equal((await traceMetadata(a.output,false)).status,'missing');
 assert.equal(await summarizeBoundaryEvidence(a.output,a.evidence,false),1);
 assert.equal(JSON.parse(readFileSync(join(a.evidence,'trace-metadata.json'))).status,'incomplete');
 assert.equal(LIMITS.contexts,4);
});
