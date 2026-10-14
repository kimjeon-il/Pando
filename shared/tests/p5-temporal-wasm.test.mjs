import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
// This pinned month-precision Web source is a comparison fixture only, not a runtime fallback.
import * as reference from '../../tests/fixtures/portability/web-9300609-oracle/assets/js/modules/temporal.js';

const runtimePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/wasm/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(runtimePath));
const core=await createCore({wasmBinary:await readFile(runtimePath.replace(/\.js$/,'.wasm'))});
const endpoints=[
  '1945','1945-08-15','1914-07','1916-02','1900-02','2000-02','2100-02',
  '-0001','-0001-02','-0400-02','-0100-02','0001-01','+1914-07','+12000-02','-999999-01','+999999-12',
  ' \u00a01914-07\u00a0 '
];
const bad=['','0000','-0000','+0000-07','1945-2-1','12000','1900-02-29',
  '1914-07-00','1914-13-01','1914-07-31T00:00:00Z','+1000000-01'];

test('P5-3 exported C++ calendar ABI keeps source precision and BCE/CE boundaries',()=>{
  for(const name of ['temporalParse','temporalMonthEnd','temporalCompare',
    'temporalNormalizeInterval','temporalContains','temporalIntervalsOverlap','temporalShiftMonth',
    'temporalCompareKeys','temporalFollowingDay'])
    assert.equal(typeof core[name],'function',name);
  assert.equal(core.coreAbiVersion,1);
  for(const input of endpoints) {
    const before=reference.parseTemporal(input,{nullable:false});
    const after=core.temporalParse(input);
    assert.deepEqual(after,{
      source:before.source,canonical:before.canonical,precision:before.precision,
      year:before.year,month:before.month,day:before.day,
      startKey:before.startKey,endKey:before.endKey
    },input);
  }
  for(const input of bad) {
    assert.throws(()=>core.temporalParse(input),error=>error?.code==='PL-TEMPORAL-001',input);
  }
});

test('P5-3 C++ month-end, boundary comparison and inclusive interval parity',()=>{
  for(const month of ['1914-07','1916-02','1900-02','2000-02','-0001-02','+12000-02']) {
    const parsed=reference.parseTemporal(month);
    const end=parsed.canonical+'-'+String(parsed.endKey[2]).padStart(2,'0');
    assert.equal(core.temporalMonthEnd(month).canonical,end,month);
  }
  assert.throws(()=>core.temporalMonthEnd('1914'),error=>error?.code==='PL-TEMPORAL-001');
  const keyPairs=[['-0001-12','0001-01'],['1914-07','1914-07-31'],['1945','1945-08-15'],['+12000-02','+12000-03']];
  for(const [a,b] of keyPairs) for(const leftBoundary of ['start','end']) for(const rightBoundary of ['start','end'])
    assert.equal(core.temporalCompare(a,b,leftBoundary==='end',rightBoundary==='end'),
      reference.compareTemporal(a,b,{leftBoundary,rightBoundary}),`${a}/${b}`);
  const intervals=[
    [null,null],[null,'-0001-12'],['0001-01',null],['1914-07','1914-07'],
    [null,'1914-07-15'],['1914-07-15',null],['1914-07-31','1914-07-31'],
    ['1914-08','1914-08'],['1914','1914'],['-0001-01','0001-12'],
  ];
  const points=['-0002','-0001-12','0001-01','1914-06-30','1914-07','1914-07-01','1914-07-15',
    '1914-07-31','1914-08-01','+12000-01'];
  for(const [from,to] of intervals) {
    const before=reference.normalizeTemporalInterval(from,to);
    assert.deepEqual(core.temporalNormalizeInterval(from,to),{validFrom:before.validFrom,validTo:before.validTo});
    for(const point of points)
      assert.equal(core.temporalContains(from,to,point),reference.temporalContains(before,point),
        `contains ${from},${to},${point}`);
    for(const [otherFrom,otherTo] of intervals) {
      const second=reference.normalizeTemporalInterval(otherFrom,otherTo);
      assert.equal(core.temporalIntervalsOverlap(from,to,otherFrom,otherTo),
        reference.temporalIntervalsOverlap(before,second),`overlap ${from},${to}/${otherFrom},${otherTo}`);
    }
  }
  assert.throws(()=>core.temporalNormalizeInterval('1914-08','1914-07'),
    error=>error?.code==='PL-TEMPORAL-INTERVAL');
});

test('P5-3 shared month navigation crosses year zero and extended years correctly',()=>{
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

test('P5-3 C++ timeline event keys include leap days and maximum-year sentinel',()=>{
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
