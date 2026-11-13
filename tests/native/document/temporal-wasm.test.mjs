import { loadNodeCore } from '../../../tools/build/load-node-core.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const cases=JSON.parse(await readFile(new URL('../../fixtures/calendar-contract.json',import.meta.url),'utf8'));

const core = await loadNodeCore();
test('calendar parsing preserves source precision and BCE/CE boundaries',()=>{
 for(const name of ['temporalParse','temporalMonthEnd','temporalCompare','temporalNormalizeInterval','temporalContains','temporalIntervalsOverlap','temporalShiftMonth','temporalCompareKeys','temporalFollowingDay'])assert.equal(typeof core[name],'function',name);
 assert.equal(core.coreAbiVersion,1);
 for(const {input,expected}of cases.parse)assert.deepEqual(core.temporalParse(input),expected,input);
 for(const input of cases.bad)assert.throws(()=>core.temporalParse(input),error=>error?.code==='PL-TEMPORAL-001',input);
});
test('calendar month ends and inclusive intervals match fixed contract cases',()=>{
 for(const {input,expected}of cases.monthEnds)assert.equal(core.temporalMonthEnd(input).canonical,expected,input);
 assert.throws(()=>core.temporalMonthEnd('1914'),error=>error?.code==='PL-TEMPORAL-001');
 for(const row of cases.compare)assert.equal(core.temporalCompare(row.a,row.b,row.leftEnd,row.rightEnd),row.expected);
 for(const row of cases.intervals)assert.deepEqual(core.temporalNormalizeInterval(row.from,row.to),row.expected);
 for(const row of cases.contains)assert.equal(core.temporalContains(row.from,row.to,row.point),row.expected);
 for(const row of cases.overlap)assert.equal(core.temporalIntervalsOverlap(row.from,row.to,row.otherFrom,row.otherTo),row.expected);
 assert.throws(()=>core.temporalNormalizeInterval('1914-08','1914-07'),error=>error?.code==='PL-TEMPORAL-INTERVAL');
});
test('shared month navigation crosses year zero and extended years correctly',()=>{
  for(const [input,offset,expected] of [
    ['1914-07',-1,'1914-06'],['1914-12',1,'1915-01'],
    ['0001-01',-1,'-0001-12'],['-0001-12',1,'0001-01'],
    ['0001-05',-12,'-0001-05'],['-0001-05',12,'0001-05'],
    ['9999-03',12,'+10000-03'],['+10000-03',-12,'9999-03'],
    ['-0001-01',-1,'-0002-12'],['+999999-11',1,'+999999-12']
  ])assert.equal(core.temporalShiftMonth(input,offset),expected);
  assert.throws(()=>core.temporalShiftMonth('1914',1),error=>error?.code==='PL-TEMPORAL-001');
  assert.throws(()=>core.temporalShiftMonth('+999999-12',1),error=>error?.code==='PL-TEMPORAL-001');
});

test('C++ timeline event keys include leap days and maximum-year sentinel',()=>{
  for(const [key, expected] of [
    [[1916,2,28],[1916,2,29]],[[1916,2,29],[1916,3,1]],
    [[1900,2,28],[1900,3,1]],[[2000,2,28],[2000,2,29]],
    [[-1,12,31],[1,1,1]],[[-2,12,31],[-1,1,1]],
    [[999999,12,31],[1000000,1,1]]
  ])assert.deepEqual(core.temporalFollowingDay(key),expected);
  for(const [a,b,result] of [
    [[1914,7,31],[1914,8,1],-1],[[-1,12,31],[1,1,1],-1],
    [[1000000,1,1],[999999,12,31],1],[[2000,2,29],[2000,2,29],0]
  ])assert.equal(core.temporalCompareKeys(a,b),result);
  assert.throws(()=>core.temporalFollowingDay([1900,2,29]),error=>error?.code==='PL-TEMPORAL-001');
  assert.throws(()=>core.temporalFollowingDay([0,1,1]),error=>error?.code==='PL-TEMPORAL-001');
});
