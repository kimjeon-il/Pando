import { nextEventTurn, deferredResult } from '../helpers/async-test-ports.mjs';
import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "../helpers/virtual-clock.mjs";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "node:test";
import * as __merge_dep3 from "../../shared/frontend/js/modules/timeline-controls.js";
import * as __merge_dep4 from "../../shared/frontend/js/modules/builtin-month-clock.js";
import * as __merge_dep5 from "node:fs";
import * as __merge_dep6 from "node:vm";
import * as __merge_dep7 from "../../shared/frontend/js/modules/application-lifecycle.js";

// Original feature contract: timeline-controls.test.mjs
contractSuite("timeline-controls", () => {
const { createVirtualClock } = __merge_dep0;
const assert = __merge_dep1.default;
const test = __merge_dep2.default;
const { shiftTimelineMonth, timelineMonthLabel, installTimelineControls } = __merge_dep3;

test('timeline navigation handles months, years, BCE and extended years without year zero', () => {
  assert.equal(shiftTimelineMonth('1914-07', -1), '1914-06');
  assert.equal(shiftTimelineMonth('1914-12', 1), '1915-01');
  assert.equal(shiftTimelineMonth('1914-07', -12), '1913-07');
  assert.equal(shiftTimelineMonth('1914-07', 12), '1915-07');
  assert.equal(shiftTimelineMonth('0001-01', -1), '-0001-12');
  assert.equal(shiftTimelineMonth('-0001-12', 1), '0001-01');
  assert.equal(shiftTimelineMonth('0001-05', -12), '-0001-05');
  assert.equal(shiftTimelineMonth('-0001-05', 12), '0001-05');
  assert.equal(shiftTimelineMonth('9999-03', 12), '+10000-03');
  assert.equal(shiftTimelineMonth('+10000-03', -12), '9999-03');
  assert.equal(timelineMonthLabel('1914-07'), '1914년 7월');
  assert.equal(timelineMonthLabel('-0001-12'), '기원전 1년 12월');
  assert.throws(() => shiftTimelineMonth('1914-07-01', 1));
  assert.throws(() => shiftTimelineMonth('1914-07', 0.5));
});

function controls(setMonth) {
  const nodes = new Map();
  const clock = createVirtualClock(new Date(2026, 9, 26));
  const document = Object.assign(new globalThis.EventTarget(), { getElementById: id => nodes.get(id), activeElement: null });
  class Element extends globalThis.EventTarget {
    hidden = false;
    textContent = '';
    value = '';
    attrs = {};
    setAttribute(name, value) { this.attrs[name] = value; }
    focus() { document.activeElement = this; }
    select() {}
    contains(node) { return this === node || (this === nodes.get('timelineControls') && [...nodes.values()].includes(node)); }
  }
  for (const id of ['timelineControls', 'timelinePopover', 'timelineDateForm', 'timelineYearInput', 'timelineMonthInput',
    'timelineViewUnit', 'timelineDateBasis', 'timelineMonthFields', 'timelinePreviousDecade', 'timelineNextDecade', 'timelineGoBtn', 'timelineDateButton', 'timelineDateButtonText', 'timelineDateError',
    'timelinePreviousYear', 'timelinePreviousMonth', 'timelineNextMonth', 'timelineNextYear'])
    nodes.set(id, new Element());
  const window = new globalThis.EventTarget();
  let month = '1914-06';
  const dispose = installTimelineControls({ document, window,
    now: clock.now, getMonth: () => month, setMonth: requested => setMonth(requested, next => { month = next; }) });
  return { nodes, document, dispose, click: id => nodes.get(id).dispatchEvent(new globalThis.Event('click')),
    submit: () => nodes.get('timelineDateForm').dispatchEvent(new globalThis.Event('submit', { cancelable: true })),
    key: key => nodes.get('timelineControls').dispatchEvent(Object.assign(new globalThis.Event('keydown', { cancelable: true }), { key })) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('timeline controls wait for the required query and report failure without changing the visible month', async () => {
  let fail;
  const ui = controls(() => new Promise((resolve, reject) => { fail = reject; }));
  ui.click('timelineNextYear');
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1914년');
  fail(Object.assign(new Error('공통 C++ 엔진을 준비하지 못했습니다.'), { code: 'PL-CORE-WASM-UNAVAILABLE' }));
  await tick();
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1914년');
  assert.equal(ui.nodes.get('timelineDateError').hidden, false);
  assert.match(ui.nodes.get('timelineDateError').textContent, /C\+\+/);
  ui.dispose();
});

test('rapid annual steps retain each requested year and present only the latest completed request', async () => {
  const pending = [];
  const ui = controls((requested, commit) => new Promise(resolve => pending.push({ requested, finish() { commit(requested); resolve(true); } })));
  ui.click('timelineNextYear'); ui.click('timelineNextYear');
  assert.deepEqual(pending.map(row => row.requested), ['1915-12', '1916-12']);
  pending[0].finish(); await tick();
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1914년');
  pending[1].finish(); await tick();
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1916년');
  ui.dispose();
});

test('date popover commits separate year and month through the canonical query', async () => {
  const requests = [];
  const ui = controls(async (month, commit) => { requests.push(month); commit(month); });
  ui.click('timelineDateButton');
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.equal(ui.nodes.get('timelineYearInput').value, '1914');
  assert.equal(ui.nodes.get('timelineMonthInput').value, '6');
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineYearInput'));
  ui.nodes.get('timelineViewUnit').value = 'month';
  ui.nodes.get('timelineViewUnit').dispatchEvent(new globalThis.Event('change'));
  ui.nodes.get('timelineYearInput').value = '-1';
  ui.nodes.get('timelineMonthInput').value = '12';
  ui.submit(); await tick();
  assert.deepEqual(requests, ['-0001-12']);
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '기원전 1년 12월');
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineDateButton'));
  ui.dispose();
});

test('invalid input and failed queries preserve the popover draft and the committed month', async () => {
  const ui = controls(async () => { throw new Error('지도 불러오기 실패'); });
  ui.click('timelineDateButton');
  ui.nodes.get('timelineYearInput').value = '0';
  ui.submit(); await tick();
  assert.equal(ui.nodes.get('timelineDateError').hidden, false);
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1914년');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.nodes.get('timelineMonthInput').value = '3';
  ui.submit(); await tick();
  assert.equal(ui.nodes.get('timelineYearInput').value, '1920');
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.match(ui.nodes.get('timelineDateError').textContent, /불러오기 실패/);
  ui.dispose();
});

test('Escape and outside clicks discard only unsubmitted date input', async () => {
  const requests = [];
  const ui = controls(async month => { requests.push(month); });
  ui.click('timelineDateButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.key('Escape');
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineDateButton'));
  ui.click('timelineDateButton');
  assert.equal(ui.nodes.get('timelineYearInput').value, '1914');
  ui.document.dispatchEvent(new globalThis.Event('pointerdown'));
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.deepEqual(requests, []);
  ui.dispose();
});

test('date submission cannot duplicate an outstanding query', async () => {
  let finish;
  let calls = 0;
  const ui = controls((month, commit) => new Promise(resolve => { calls++; finish = () => { commit(month); resolve(); }; }));
  ui.click('timelineDateButton'); ui.submit(); ui.submit();
  assert.equal(calls, 1);
  assert.equal(ui.nodes.get('timelineGoBtn').disabled, true);
  finish(); await tick();
  assert.equal(ui.nodes.get('timelineGoBtn').disabled, false);
  ui.dispose();
});

test('a failed date query cannot reopen a dismissed input session or steal focus', async () => {
  let fail;
  const ui = controls(() => new Promise((resolve, reject) => { fail = reject; }));
  ui.click('timelineDateButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.submit(); ui.key('Escape');
  const outside = {};
  ui.document.activeElement = outside;
  fail(new Error('지도 불러오기 실패')); await tick();
  assert.equal(ui.nodes.get('timelinePopover').hidden, true);
  assert.equal(ui.document.activeElement, outside);
  assert.equal(ui.nodes.get('timelineDateError').hidden, true);
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1914년');
  ui.dispose();
});

test('a completed date query cannot close or overwrite a newly opened input session', async () => {
  let finish;
  const ui = controls((month, commit) => new Promise(resolve => { finish = () => { commit(month); resolve(); }; }));
  ui.click('timelineDateButton');
  ui.nodes.get('timelineYearInput').value = '1920';
  ui.submit(); ui.key('Escape'); ui.click('timelineDateButton');
  ui.nodes.get('timelineYearInput').value = '1930';
  finish(); await tick();
  assert.equal(ui.nodes.get('timelinePopover').hidden, false);
  assert.equal(ui.nodes.get('timelineYearInput').value, '1930');
  assert.equal(ui.document.activeElement, ui.nodes.get('timelineYearInput'));
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent, '1920년');
  ui.dispose();
});


test('annual toolbar uses year-end, one-year and decade steps without changing a restored cursor', async () => {
  const requests=[];const ui=controls(async(month,commit)=>{requests.push(month);commit(month);});
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent,'1914년');
  assert.equal(ui.nodes.get('timelineDateBasis').textContent,'6월말 기준');
  assert.deepEqual(requests,[]);
  for(const [id,expected] of [['timelineNextYear','1915-12'],['timelinePreviousDecade','1905-12'],['timelineNextDecade','1915-12'],['timelinePreviousYear','1914-12']]){
    ui.click(id);await tick();assert.equal(requests.at(-1),expected);
    assert.equal(ui.nodes.get('timelineDateBasis').textContent,'연말 기준');
  }
  ui.dispose();
});

test('annual form uses current month for this year and crosses BCE without year zero', async () => {
  const requests=[];const ui=controls(async(month,commit)=>{requests.push(month);commit(month);});
  ui.click('timelineDateButton');ui.nodes.get('timelineYearInput').value='2026';ui.submit();await tick();
  assert.equal(requests.at(-1),'2026-10');assert.equal(ui.nodes.get('timelineDateBasis').textContent,'현재 월 기준');
  ui.click('timelineDateButton');ui.nodes.get('timelineYearInput').value='-1';ui.submit();await tick();
  assert.equal(requests.at(-1),'-0001-12');
  ui.click('timelineNextYear');await tick();assert.equal(requests.at(-1),'0001-12');
  ui.click('timelinePreviousDecade');await tick();assert.equal(requests.at(-1),'-0010-12');
  ui.click('timelineDateButton');ui.nodes.get('timelineYearInput').value='10000';ui.submit();await tick();
  assert.equal(requests.at(-1),'+10000-12');ui.dispose();
});

test('monthly controls stay in the popover and cancelled unit input preserves annual view', async () => {
  const requests=[];const ui=controls(async(month,commit)=>{requests.push(month);commit(month);});
  ui.click('timelineDateButton');assert.equal(ui.nodes.get('timelineMonthFields').hidden,true);
  ui.nodes.get('timelineViewUnit').value='month';ui.nodes.get('timelineViewUnit').dispatchEvent(new globalThis.Event('change'));
  assert.equal(ui.nodes.get('timelineMonthFields').hidden,false);ui.key('Escape');
  assert.deepEqual(requests,[]);assert.equal(ui.nodes.get('timelineDateButtonText').textContent,'1914년');
  ui.click('timelineDateButton');assert.equal(ui.nodes.get('timelineViewUnit').value,'year');
  ui.nodes.get('timelineViewUnit').value='month';ui.nodes.get('timelineViewUnit').dispatchEvent(new globalThis.Event('change'));
  ui.click('timelineNextMonth');await tick();assert.equal(requests.at(-1),'1914-07');
  assert.equal(ui.nodes.get('timelinePopover').hidden,false);assert.equal(ui.nodes.get('timelineDateButtonText').textContent,'1914년 7월');
  ui.click('timelinePreviousMonth');await tick();assert.equal(requests.at(-1),'1914-06');
  ui.key('Escape');ui.click('timelineNextYear');await tick();assert.equal(requests.at(-1),'1915-06');
  ui.click('timelineDateButton');ui.nodes.get('timelineViewUnit').value='year';ui.nodes.get('timelineViewUnit').dispatchEvent(new globalThis.Event('change'));ui.submit();await tick();
  assert.equal(requests.at(-1),'1915-12');assert.equal(ui.nodes.get('timelineDateButtonText').textContent,'1915년');ui.dispose();
});

test('cancelled queries cannot commit a new display unit', async () => {
  const ui=controls(async()=>false);ui.click('timelineDateButton');
  ui.nodes.get('timelineViewUnit').value='month';ui.nodes.get('timelineViewUnit').dispatchEvent(new globalThis.Event('change'));ui.submit();await tick();
  assert.equal(ui.nodes.get('timelineDateButtonText').textContent,'1914년');
  assert.equal(ui.nodes.get('timelinePopover').hidden,false);ui.dispose();
});

test('Enter retains native activation on month arrows and view selectors', () => {
  const requests=[];const ui=controls(async(month,commit)=>{requests.push(month);commit(month);});
  try {
    ui.click('timelineDateButton');
    for(const id of ['timelineViewUnit','timelineMonthInput','timelineNextMonth','timelinePreviousMonth']){
      const event=new globalThis.Event('keydown',{cancelable:true});
      Object.defineProperties(event,{key:{value:'Enter'},target:{value:ui.nodes.get(id)}});
      ui.nodes.get('timelineDateForm').dispatchEvent(event);
      assert.equal(event.defaultPrevented,false,`${id} must retain native Enter activation`);
    }
    assert.deepEqual(requests,[]);
  } finally { ui.dispose(); }
});
});

// Original feature contract: builtin-month-clock.test.mjs
contractSuite("builtin-month-clock", () => {
const { createVirtualClock } = __merge_dep0;
const { describe : featureDescribe } = __merge_dep2;
const __suiteDependency0 = __merge_dep2;
const __suiteDependency1 = __merge_dep1;
const __suiteDependency2 = __merge_dep4;
const __suiteDependency3 = __merge_dep2;
const __suiteDependency4 = __merge_dep1;
const __suiteDependency5 = __merge_dep5;
const __suiteDependency6 = __merge_dep6;
const __suiteDependency7 = __merge_dep7;
const __suiteDependency8 = __merge_dep2;
const __suiteDependency9 = __merge_dep1;
const __suiteDependency10 = __merge_dep4;

// Original feature contract: builtin-month-clock.test.mjs
featureDescribe("builtin-month-clock", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const { createBuiltinMonthClock } = __suiteDependency2;
test('device month advances across years, manual mode stays put and builtin reset follows again',async()=>{
 const virtualClock=createVirtualClock(new Date(2026,9,31,23,59)),calls=[];
 const clock=createBuiltinMonthClock({now:virtualClock.now,applyMonth:async month=>{calls.push(month);return true;}});
 await clock.followNow();assert.equal(clock.month(),'2026-10');
 virtualClock.set(new Date(2026,10,1));await clock.refresh();assert.equal(clock.month(),'2026-11');
 virtualClock.set(new Date(2027,0,1));await clock.refresh();assert.equal(clock.month(),'2027-01');
 await clock.selectMonth('1953-07');virtualClock.set(new Date(2027,1,1));await clock.refresh();assert.equal(clock.month(),'1953-07');
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
 const virtualClock=createVirtualClock(new Date(2026,9,1));let release;
 const clock=createBuiltinMonthClock({now:virtualClock.now,applyMonth:()=>new Promise(resolve=>{release=resolve;})});
 const pending=clock.followNow(),resume=clock.suspend();release(true);
 assert.equal(await pending,false);virtualClock.set(new Date(2026,10,1));
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
const tick = nextEventTurn;
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
const deferred = deferredResult;
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
});
