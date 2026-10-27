import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinMonthClock} from "../../shared/frontend/js/modules/builtin-month-clock.js";
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
