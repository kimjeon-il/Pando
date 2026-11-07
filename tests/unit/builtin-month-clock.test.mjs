import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:test";
import * as __suiteDependency1 from "node:assert/strict";
import * as __suiteDependency2 from "../../shared/frontend/js/modules/builtin-month-clock.js";
import * as __suiteDependency3 from "node:test";
import * as __suiteDependency4 from "node:assert/strict";
import * as __suiteDependency5 from "node:fs";
import * as __suiteDependency6 from "node:vm";
import * as __suiteDependency7 from "../../shared/frontend/js/modules/application-lifecycle.js";
import * as __suiteDependency8 from "node:test";
import * as __suiteDependency9 from "node:assert/strict";
import * as __suiteDependency10 from "../../shared/frontend/js/modules/builtin-month-clock.js";

// Original feature contract: builtin-month-clock.test.mjs
featureDescribe("builtin-month-clock", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const { createBuiltinMonthClock } = __suiteDependency2;
test('device month advances across years, manual mode stays put and builtin reset follows again',async()=>{
 let now=new Date(2026,9,31,23,59),calls=[];
 const clock=createBuiltinMonthClock({now:()=>now,applyMonth:async month=>{calls.push(month);return true;}});
 await clock.followNow();assert.equal(clock.month(),'2026-10');
 now=new Date(2026,10,1);await clock.refresh();assert.equal(clock.month(),'2026-11');
 now=new Date(2027,0,1);await clock.refresh();assert.equal(clock.month(),'2027-01');
 await clock.selectMonth('1953-07');now=new Date(2027,1,1);await clock.refresh();assert.equal(clock.month(),'1953-07');
 await clock.followNow();assert.equal(clock.month(),'2027-02');assert.equal(calls.length,5);
});
test('only the last successful request is committed; failure retains the previous month',async()=>{
 const waiting=new Map();
 const clock=createBuiltinMonthClock({now:()=>new Date(2026,9,1),applyMonth:(month,{isCurrent})=>new Promise((resolve,reject)=>waiting.set(month,{resolve:()=>resolve(isCurrent()),reject}))});
 const initial=clock.followNow();waiting.get('2026-10').resolve();await initial;
 const old=clock.selectMonth('1953-06'),latest=clock.selectMonth('1953-07');
 waiting.get('1953-07').resolve();await latest;waiting.get('1953-06').resolve();await old;
 assert.equal(clock.month(),'1953-07');
 const failed=clock.selectMonth('1900-01');waiting.get('1900-01').reject(new Error('offline'));
 await assert.rejects(failed,/offline/);assert.equal(clock.month(),'1953-07');
});

test('opening a file suspends pending automatic changes and failure can restore the prior mode',async()=>{
 let now=new Date(2026,9,1),release;
 const clock=createBuiltinMonthClock({now:()=>now,applyMonth:()=>new Promise(resolve=>{release=resolve;})});
 const pending=clock.followNow(),resume=clock.suspend();release(true);
 assert.equal(await pending,false);now=new Date(2026,10,1);
 assert.equal(await clock.refresh(),false);assert.equal(clock.month(),null);
 assert.equal(resume(),true);assert.equal(clock.isAutomatic(),true);
 const next=clock.refresh();release(true);await next;assert.equal(clock.month(),'2026-11');
 const staleResume=clock.suspend(),manual=clock.selectMonth('1953-07');release(true);await manual;
 assert.equal(staleResume(),false);assert.equal(clock.isAutomatic(),false);
});

test('a presented frame commits its month once before background opening work finishes',async()=>{
 let release,commit,commits=[];
 const clock=createBuiltinMonthClock({onCommitted:month=>commits.push(month),applyMonth:(_month,request)=>{
  commit=request.commit;return new Promise(resolve=>{release=resolve;});
 }});
 const pending=clock.selectMonth('1953-06');
 assert.equal(clock.month(),null);
 assert.equal(commit(),true);assert.equal(clock.month(),'1953-06');
 assert.equal(commit(),false);release(true);await pending;
 assert.deepEqual(commits,['1953-06']);
 const stale=clock.selectMonth('1953-07'),oldCommit=commit,oldRelease=release;
 const latest=clock.selectMonth('1953-08');
 assert.equal(oldCommit(),false);oldRelease(false);await stale;
 assert.equal(clock.month(),'1953-06');
 commit();release(true);await latest;assert.equal(clock.month(),'1953-08');
});


test('P3-1 a same-task burst dispatches only its final month and commits once',async()=>{
 const reads=[],commits=[];
 const clock=createBuiltinMonthClock({coalesceRequests:true,
  onCommitted:month=>commits.push(month),applyMonth:async(month,{isCurrent,commit})=>{
   reads.push(month);if(isCurrent())commit();return true;
  }});
 const first=clock.selectMonth('2025-12'),second=clock.selectMonth('2024-12'),last=clock.selectMonth('2023-12');
 assert.deepEqual(reads,[],'same-task earlier intents must not start I/O or Core work');
 assert.equal(await first,false);assert.equal(await second,false);assert.equal(await last,true);
 assert.deepEqual(reads,['2023-12']);assert.deepEqual(commits,['2023-12']);
 assert.equal(clock.month(),'2023-12');clock.dispose();
});

test('P3-1 latest request wins even if an older Core-bound operation is suspended',async()=>{
 const started=[],commits=[],pending=new Map();
 const clock=createBuiltinMonthClock({coalesceRequests:true,
  onCommitted:month=>commits.push(month),applyMonth:(month,{isCurrent,commit})=>{
   started.push(month);
   return new Promise((resolve,reject)=>pending.set(month,{finish:()=>{if(isCurrent())commit();resolve(isCurrent());},reject}));
  }});
 const old=clock.selectMonth('2025-12');await Promise.resolve();
 assert.deepEqual(started,['2025-12']);
 const middle=clock.selectMonth('2024-12'),latest=clock.selectMonth('2023-12');
 await Promise.resolve();
 // In the RED phase the older implementation starts the middle request;
 // settle it explicitly so the regression fails promptly rather than hanging.
 pending.get('2024-12')?.finish();
 assert.equal(await middle,false);
 assert.deepEqual(started,['2025-12','2023-12']);
 pending.get('2023-12').finish();assert.equal(await latest,true);
 pending.get('2025-12').finish();assert.equal(await old,false);
 assert.deepEqual(commits,['2023-12']);assert.equal(clock.month(),'2023-12');
 const fail=clock.selectMonth('2022-12');await Promise.resolve();
 pending.get('2022-12').reject(new Error('offline'));
 await assert.rejects(fail,/offline/);assert.equal(clock.month(),'2023-12');
 clock.dispose();
});

test('P3-1 a suspended or disposed viewer cannot start an unflushed source request',async()=>{
 const requests=[];
 const clock=createBuiltinMonthClock({coalesceRequests:true,now:()=>new Date(2026,9,31),
  applyMonth:async month=>{requests.push(month);return true;}});
 const inFlight=clock.followNow(),resume=clock.suspend();
 assert.equal(await inFlight,false);assert.deepEqual(requests,[]);
 assert.equal(resume(),true);const fresh=clock.followNow();
 assert.equal(await fresh,true);assert.deepEqual(requests,['2026-10']);
 const late=clock.selectMonth('2025-12');clock.dispose();
 assert.equal(await late,false);assert.deepEqual(requests,['2026-10']);
});

test('P3-1 automatic same-month refresh shares the pending request without extra source loads',async()=>{
 let release;const reads=[];
 const clock=createBuiltinMonthClock({coalesceRequests:true,now:()=>new Date(2026,9,31),
  applyMonth:month=>{reads.push(month);return new Promise(resolve=>{release=resolve;});}});
 const a=clock.refresh(),b=clock.refresh();
 await Promise.resolve();assert.deepEqual(reads,['2026-10']);
 release(true);assert.deepEqual([await a,await b],[true,true]);
 assert.equal(clock.month(),'2026-10');clock.dispose();
});
});
// Original feature contract: builtin-clock-recovery.test.mjs
featureDescribe("builtin-clock-recovery", () => {
  const test = __suiteDependency3.default;
  const assert = __suiteDependency4.default;
  const { readFileSync } = __suiteDependency5;
  const vm = __suiteDependency6.default;
  const { createApplicationLifecycle } = __suiteDependency7;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Calendar correctness is covered by temporal tests. This fixture isolates the
// clock's real async ownership from the unavailable compiled engine in Node.
const context=vm.createContext({Date,parseTemporal:()=>({precision:'month'})});
vm.runInContext(readFileSync(new URL('../../shared/frontend/js/modules/builtin-month-clock.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'').replaceAll('export ',''),context);
const createClock=context.createBuiltinMonthClock;
const now=()=>new Date(2026,9,31);

test('concurrent refresh consumers await the existing dated request instead of a false result',async()=>{
  let finish,calls=0;const clock=createClock({now,applyMonth:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
  const first=clock.followNow(),second=clock.refresh(),third=clock.refresh();finish(true);
  assert.deepEqual(await Promise.all([first,second,third]),[true,true,true]);assert.equal(calls,1);clock.dispose();
});
test('clock and lifecycle wake listeners share one recovery and announce readiness after its completion',async()=>{
  const window=new EventTarget(),document=new EventTarget();window.document=document;window.navigator={onLine:true};window.CustomEvent=CustomEvent;
  window.setTimeout=()=>1;window.clearTimeout=()=>{};document.visibilityState='visible';
  let clock,calls=0,finish,ready=0;window.addEventListener('pandolab:ready',()=>ready++);
  const lifecycle=createApplicationLifecycle({window,document,compose:[()=>{clock=createClock({window,document,now,
    applyMonth:()=>{if(++calls===1)return Promise.reject(Object.assign(new Error('offline'),{retryable:true}));return new Promise(resolve=>finish=resolve);}});}],
    startup:()=>clock.refresh(),shouldRetryStartup:error=>error.retryable,getDisposables:()=>[clock]});
  assert.equal(await lifecycle.start(),false);window.dispatchEvent(new Event('focus'));await tick();assert.equal(calls,2);assert.equal(ready,0);
  finish(true);await tick();assert.equal(ready,1);assert.equal(calls,2);lifecycle.dispose();
});
test('manual selection and file suspension supersede pending recovery without publishing stale dates',async()=>{
  let finish;const clock=createClock({now,applyMonth:()=>new Promise(resolve=>finish=resolve)});
  const first=clock.followNow(),follower=clock.refresh(),oldFinish=finish;
  const manual=clock.selectMonth('1953-07');finish(true);await manual;oldFinish(true);
  assert.equal(await first,false);assert.equal(await follower,false);assert.equal(await clock.refresh(),false);assert.equal(clock.month(),'1953-07');
  const pending=clock.followNow(),resume=clock.suspend();finish(true);assert.equal(await pending,false);assert.equal(await clock.refresh(),false);assert.equal(resume(),true);clock.dispose();
});
});
// Original feature contract: map-transition-clock-contract.test.mjs
featureDescribe("map-transition-clock-contract", () => {
  const test = __suiteDependency8.default;
  const assert = __suiteDependency9.default;
  const { createBuiltinMonthClock } = __suiteDependency10;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
function fixture() {
  const requests = [], commits = [];
  const clock = createBuiltinMonthClock({now: () => new Date(2026, 9, 31, 12),
    applyMonth: (month, controls) => {const done = deferred(); requests.push({month, ...controls, ...done}); return done.promise;},
    onCommitted: month => commits.push(month)});
  return {clock, requests, commits};
}
test('P0 commits visible time only when the presentation callback accepts it', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const pending = clock.selectMonth('1950-12'); assert.equal(clock.month(), null);
  assert.equal(requests[0].commit(), true); assert.equal(clock.month(), '1950-12');
  assert.equal(requests[0].commit(), false); requests[0].resolve(true); await pending;
  assert.deepEqual(commits, ['1950-12']);
});
test('P0 reverse completion cannot commit the older target', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const old = clock.selectMonth('1950-12'), current = clock.selectMonth('1951-12');
  assert.equal(requests[0].isCurrent(), false); assert.equal(requests[0].commit(), false);
  requests[1].commit(); requests[1].resolve(true); assert.equal(await current, true);
  requests[0].resolve(true); assert.equal(await old, false);
  assert.equal(clock.month(), '1951-12'); assert.deepEqual(commits, ['1951-12']);
});
test('P0 a failed target keeps the last committed time and remains an error', async t => {
  const {clock, requests} = fixture(); t.after(() => clock.dispose());
  const first = clock.selectMonth('1950-12'); requests[0].commit(); requests[0].resolve(true); await first;
  const failed = clock.selectMonth('1951-12'), assertion = assert.rejects(failed, /source failed/);
  requests[1].reject(new Error('source failed')); await assertion;
  assert.equal(clock.month(), '1950-12');
});
test('P0 stale failures do not reject or overwrite a newer successful target', async t => {
  const {clock, requests} = fixture(); t.after(() => clock.dispose());
  const old = clock.selectMonth('1950-12'), current = clock.selectMonth('1951-12');
  requests[1].commit(); requests[1].resolve(true); await current;
  requests[0].reject(new Error('stale source failed')); assert.equal(await old, false);
  assert.equal(clock.month(), '1951-12');
});
test('P0 A to B to A cannot publish the abandoned middle state', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const a = clock.selectMonth('1950-12'); requests[0].commit(); requests[0].resolve(true); await a;
  const b = clock.selectMonth('1951-12'), back = clock.selectMonth('1950-12');
  requests[2].commit(); requests[2].resolve(true); await back;
  assert.equal(requests[1].commit(), false); requests[1].resolve(true); await b;
  assert.deepEqual(commits, ['1950-12', '1950-12']);
});
test('P0 suspending builtin mode invalidates late presentation after a file opens', async t => {
  const {clock, requests, commits} = fixture(); t.after(() => clock.dispose());
  const pending = clock.selectMonth('1950-12'); clock.suspend();
  assert.equal(requests[0].commit(), false); requests[0].resolve(true);
  assert.equal(await pending, false); assert.deepEqual(commits, []);
});
});
