import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStoredAssetLoader} from '../../shared/frontend/js/modules/stored-asset-loader.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bytes=Buffer.from('{"map":true}');
const spec={url:'https://test.local/map',encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const parse=buffer=>JSON.parse(new TextDecoder().decode(buffer));
const fixture=options=>createStoredAssetLoader({dataRevision:'test',cacheStorage:null,resolveUrl:spec=>spec.url,...options});
const load=(loader,signal)=>loader.loadAsset(spec,'geometry','map','지도',parse,signal);

test('stored asset transport exhaustion preserves its recoverable network classification',async()=>{
  let calls=0;const loader=fixture({fetchFn:async()=>{calls++;throw new TypeError('Failed to fetch');}});
  await assert.rejects(load(loader),error=>error.retryable===true&&error.code==='PL-NETWORK-001');assert.equal(calls,3);
});

test('stalled body is cancelled and retried rather than retaining the only pending transport',async t=>{
  let serial=0,calls=0,cancellations=0;const timers=new Map(),bodies=[];const controller=new AbortController();
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++serial;timers.set(id,{delay,run:()=>{timers.delete(id);callback();}});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  t.after(()=>{controller.abort();for(const body of bodies)body.error(new DOMException('test cleanup','AbortError'));});
  const loader=fixture({fetchFn:async()=>{calls++;if(calls>1)return new Response(bytes);return new Response(new ReadableStream({start(c){bodies.push(c);},cancel(){cancellations++;}}));}});
  const pending=load(loader,controller.signal);pending.catch(()=>{});await tick();
  assert.equal(timers.size,1,'the stalled body must have an active deadline');
  [...timers.values()][0].run();await tick();assert.equal(cancellations,1);
  const backoff=[...timers.values()][0];assert.equal(backoff.delay,500);backoff.run();
  assert.deepEqual((await pending).value,{map:true});assert.equal(calls,2);assert.equal(timers.size,0);
});

test('already aborted loads do not use even a valid cache or delete it',async()=>{
  let matches=0,deletions=0,fetches=0;const controller=new AbortController();controller.abort();
  const cacheStorage={open:async()=>({match:async()=>{matches++;return new Response(bytes);},delete:async()=>deletions++})};
  const loader=fixture({cacheStorage,fetchFn:async()=>{fetches++;return new Response(bytes);}});
  await assert.rejects(load(loader,controller.signal),{name:'AbortError'});assert.equal(matches,0);assert.equal(deletions,0);assert.equal(fetches,0);
});

test('verified stored bytes still serve later loads without another network request',async()=>{
  let calls=0;const values=new Map();const cacheStorage={open:async()=>({match:async url=>values.get(url)?.clone(),
    put:async(url,response)=>values.set(url,response.clone()),delete:async url=>values.delete(url)})};
  const loader=fixture({cacheStorage,fetchFn:async()=>{calls++;return new Response(bytes);}});
  assert.equal((await load(loader)).cacheHit,false);assert.equal((await load(loader)).cacheHit,true);assert.equal(calls,1);
});
