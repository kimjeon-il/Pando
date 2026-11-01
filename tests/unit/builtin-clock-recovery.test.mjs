import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createApplicationLifecycle} from '../../shared/frontend/js/modules/application-lifecycle.js';
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
