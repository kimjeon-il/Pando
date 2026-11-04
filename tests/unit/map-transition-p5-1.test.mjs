import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instrumentP5Source,p5Stages} from '../helpers/map-transition-p5-1.mjs';

for(const [file,path] of [
 ['viewer-composition.js','apps/viewer/js/modules/viewer-composition.js'],
 ['builtin-session.js','shared/frontend/js/modules/builtin-session.js'],
 ['project-domain.js','shared/frontend/js/modules/project-domain.js'],
]){
 test('P5-1 injects exactly one set of read-only probes: '+file,()=>{
   const source=readFileSync(new URL('../../'+path,import.meta.url),'utf8');
   const injected=instrumentP5Source(source,file);
   const normalized=source.replaceAll('\r\n','\n');
   assert.ok(injected.length>normalized.length);
   assert.equal(instrumentP5Source(normalized.replaceAll('\n','\r\n'),file),injected);
   assert.equal(source.includes('__PANDO_P0__'),false);
 });
}
test('P5-1 stage sample preserves absence and rejects invalid duration',()=>{
 const events=[{kind:'p5:cache:hit',at:1},{kind:'p5:candidate-prepare:start',at:2},
  {kind:'p5:candidate-prepare:end',at:9},{kind:'p5:candidate-adopt:start',at:11},
  {kind:'p5:candidate-adopt:end',at:19}];
 assert.deepEqual(p5Stages(events),{cache:['hit'],phases:{'candidate-prepare':7,'candidate-adopt':8}});
 assert.throws(()=>p5Stages([{kind:'p5:candidate-adopt:start',at:1}]),/lacks end/);
});
