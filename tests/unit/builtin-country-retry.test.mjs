import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildBuiltinWorldPublication} from '../../tools/build-builtin-world.mjs';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
import {createBuiltinWorldLoader} from '../../shared/frontend/js/modules/builtin-world-loader.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('a failed query settles its outstanding failed reads before an immediate clean retry',async t=>{
 const files=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
 const index=JSON.parse(files.get('index.json'));index.entities=index.entities.filter(row=>['AUS','CHN'].includes(row.entityId));
 assert.equal(index.entities.length,2);
 const bytes=Buffer.from(JSON.stringify(index));files.set('index.json',bytes);
 const slow=index.entities[1].file,entered=deferred(),release=deferred();t.after(()=>release.resolve());
 const calls=[];let successful=false,slowAttempts=0,settled=false;
 const loader=createBuiltinWorldLoader({manifestUrl:'https://retry.test/data/index.json',
  manifestSpec:{sha256:createHash('sha256').update(bytes).digest('hex'),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length},
  dataRevision:'retry',cacheStorage:null,fetchFn:async url=>{
   const file=new URL(url).pathname.slice('/data/'.length);calls.push(file);
   if(file==='index.json')return new Response(bytes);
   const fail=!successful;
   if(fail&&file===slow&&++slowAttempts===3){entered.resolve();await release.promise;}
   return fail?new Response(null,{status:503}):new Response(files.get(file));
  }});
 const first=loader.loadProject('2026-10').then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));
 // The fast file has failed; the slower file's last failed attempt is still held.
 // Returning now would let an immediate retry join that doomed pending request.
 assert.equal(settled,false,'failed query must drain its outstanding workers');
 release.resolve();assert.match((await first).message,/503/);
 successful=true;
 assert.equal((await loader.loadProject('2026-10')).project.territorialEntities.length,2);
 for(const entry of index.entities)assert.equal(calls.filter(file=>file===entry.file).length,4);
});
