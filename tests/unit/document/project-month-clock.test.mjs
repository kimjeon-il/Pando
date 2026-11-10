import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectMonthClock} from '../../../src/document/project-month-clock.js';

test('startup loads the default project without enabling its saved automatic follow policy',async()=>{
 const events=[],clock=createProjectMonthClock({initialAutomatic:false,
  now:()=>new Date(2026,10,9),
  applyMonth:async(month,{mode,commit})=>{events.push([mode,month]);return commit();},
  onFollowChange:value=>events.push(['follow',value]),
 });
 try{
  assert.equal(await clock.initialize(),true);
  assert.equal(clock.month(),'2026-11');
  assert.equal(clock.isAutomatic(),false);
  assert.deepEqual(events,[['startup','2026-11']]);
  assert.equal(await clock.refresh(),false);
 }finally{clock.dispose();}
});

test('manual month selection in a user project uses one cursor and cannot arm automatic background navigation',async()=>{
 let kind='builtin',month='2014-01';
 const events=[],clock=createProjectMonthClock({now:()=>new Date(2026,10,9),initialAutomatic:true,
  canFollow:()=>kind==='builtin',
  onFollowChange:(value,{mode})=>{if(kind==='builtin'||mode==='follow')events.push(['policy',value]);},
  applyMonth:async(value,{mode,commit})=>{month=value;events.push([kind,mode,month]);return commit();},
 });
 try{
  await clock.initialize();
  kind='file';
  assert.equal(await clock.refresh(),false,'file date is never updated from device time');
  assert.equal(await clock.selectMonth('1801-01'),true);
  assert.equal(month,'1801-01');
  assert.equal(clock.isAutomatic(),false);
  assert.equal(await clock.refresh(),false);
  assert.deepEqual(events,[['builtin','startup','2026-11'],['file','manual','1801-01']]);
  kind='builtin';
  assert.equal(await clock.followNow(),true);
  assert.equal(clock.isAutomatic(),true);
  assert.equal(month,'2026-11');
  assert.deepEqual(events.at(-2),['policy',true]);
 }finally{clock.dispose();}
});

test('superseded rapid month requests never commit an earlier project cursor intent',async()=>{
 const commits=[],reads=[];
 const clock=createProjectMonthClock({initialAutomatic:false,
  applyMonth:async(month,{commit})=>{reads.push(month);return commit();},
  onCommitted:month=>commits.push(month),
 });
 try{
  const early=clock.selectMonth('2020-01'),latest=clock.selectMonth('2020-02');
  assert.equal(await early,false);
  assert.equal(await latest,true);
  assert.deepEqual(reads,['2020-02']);
  assert.deepEqual(commits,['2020-02']);
 }finally{clock.dispose();}
});

test('rapid project month intents start only the final cursor target and commit once', async () => {
  const started=[],commits=[];
  const clock=createProjectMonthClock({initialAutomatic:false,
    onCommitted:month=>commits.push(month),
    applyMonth:async(month,{isCurrent,commit})=>{
      started.push(month);
      if(isCurrent())commit();
      return isCurrent();
    }});
  try {
    const first=clock.selectMonth('2025-12');
    const middle=clock.selectMonth('2024-12');
    const latest=clock.selectMonth('2023-12');
    assert.deepEqual(started,[], 'same-turn obsolete targets must not start a Core read');
    assert.deepEqual(await Promise.all([first,middle,latest]),[false,false,true]);
    assert.deepEqual(started,['2023-12']);
    assert.deepEqual(commits,['2023-12']);
    assert.equal(clock.month(),'2023-12');
  } finally { clock.dispose(); }
});

test('out-of-order project cursor completions cannot publish an earlier date', async () => {
  const pending=new Map(),commits=[];
  const clock=createProjectMonthClock({initialAutomatic:false,coalesceRequests:false,
    onCommitted:month=>commits.push(month),
    applyMonth:(month,{isCurrent,commit})=>new Promise(resolve=>{
      pending.set(month,{isCurrent,commit,resolve});
    }),
  });
  try {
    const older=clock.selectMonth('1950-12');
    const latest=clock.selectMonth('1951-12');
    assert.equal(pending.get('1951-12').commit(),true);
    pending.get('1951-12').resolve(true);
    assert.equal(await latest,true);
    assert.equal(pending.get('1950-12').isCurrent(),false);
    assert.equal(pending.get('1950-12').commit(),false);
    pending.get('1950-12').resolve(true);
    assert.equal(await older,false);
    assert.equal(clock.month(),'1951-12');
    assert.deepEqual(commits,['1951-12']);
  } finally { clock.dispose(); }
});

test('calendar rollover uses one common cursor while manual file navigation disables follow-now', async () => {
  let now=new Date(2026,9,31,23,59),inFile=false;
  const accepted=[],clock=createProjectMonthClock({
    now:()=>now,canFollow:()=>!inFile,
    applyMonth:async(month,{mode,commit})=>{accepted.push([mode,month]);return commit();},
  });
  try {
    assert.equal(await clock.followNow(),true);
    assert.equal(clock.month(),'2026-10');
    now=new Date(2026,10,1);
    assert.equal(await clock.refresh(),true);
    assert.equal(clock.month(),'2026-11');
    inFile=true;
    assert.equal(await clock.refresh(),false);
    assert.equal(await clock.selectMonth('1953-07'),true);
    now=new Date(2027,0,1);
    assert.equal(await clock.refresh(),false);
    assert.equal(clock.month(),'1953-07');
    inFile=false;
    assert.equal(await clock.followNow(),true);
    assert.equal(clock.month(),'2027-01');
    assert.deepEqual(accepted.map(([,month])=>month),['2026-10','2026-11','1953-07','2027-01']);
  } finally {clock.dispose();}
});

test('concurrent follow-now refresh consumers await the same committed source request', async () => {
  let resolve,loads=0;
  const clock=createProjectMonthClock({
    now:()=>new Date(2026,9,31),
    applyMonth:()=>{loads++;return new Promise(done=>{resolve=done;});},
  });
  try {
    const first=clock.followNow();
    await Promise.resolve();
    const second=clock.refresh(),third=clock.refresh();
    assert.equal(loads,1);
    resolve(true);
    assert.deepEqual(await Promise.all([first,second,third]),[true,true,true]);
    assert.equal(clock.month(),'2026-10');
  } finally {clock.dispose();}
});

test('file project replacement cancels pending date publication and all late callbacks', async () => {
  let inFile=false,current;
  const clock=createProjectMonthClock({
    now:()=>new Date(2026,9,31),canFollow:()=>!inFile,
    coalesceRequests:false,
    applyMonth:(month,{commit,isCurrent})=>new Promise(resolve=>{
      current={month,commit,isCurrent,resolve};
    }),
  });
  try {
    const previous=clock.followNow(),obsolete=current;
    inFile=true;clock.cancelPending();
    assert.equal(obsolete.isCurrent(),false);
    assert.equal(obsolete.commit(),false);
    obsolete.resolve(true);
    assert.equal(await previous,false);
    assert.equal(await clock.refresh(),false);
    const user=clock.selectMonth('1953-07');
    const manual=current;
    assert.equal(manual.month,'1953-07');
    assert.equal(manual.commit(),true);
    manual.resolve(true);
    assert.equal(await user,true);
    assert.equal(clock.month(),'1953-07');
    assert.equal(clock.isAutomatic(),false);
  } finally {clock.dispose();}
});

test('focus and visibility changes refresh only the active default project', async () => {
  const window=new EventTarget(),document=new EventTarget();
  window.setTimeout=()=>1;window.clearTimeout=()=>{};
  document.visibilityState='visible';
  let now=new Date(2026,9,31),inFile=false;
  const visited=[];
  const clock=createProjectMonthClock({
    window,document,now:()=>now,canFollow:()=>!inFile,
    applyMonth:async(month,{commit})=>{visited.push(month);return commit();},
  });
  try {
    await clock.followNow();
    now=new Date(2026,10,1);
    window.dispatchEvent(new Event('focus'));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(clock.month(),'2026-11');
    assert.deepEqual(visited,['2026-10','2026-11']);
    inFile=true;now=new Date(2026,11,1);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(visited,['2026-10','2026-11']);
  } finally {clock.dispose();}
});
