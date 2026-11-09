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
