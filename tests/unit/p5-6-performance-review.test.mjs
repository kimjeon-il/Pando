import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewBorderPerformance } from '../../tools/p5-6-review-performance.mjs';
const pinned='3485ad37c60389c977f1a211236788c6bd17125d';
const row=(quality,ratio=.81)=>({
  quality,input:'fixture-'+quality,sourceHash:'f'.repeat(64),
  sourceSegments:10,displaySegments:12,match:true,
  legacy:{medianMs:100,minMs:95,maxMs:105,medianHeapDeltaMb:5,medianRssDeltaMb:2},
  compiled:{medianMs:100*ratio,minMs:75,maxMs:110,medianHeapDeltaMb:9,medianRssDeltaMb:1},
});
const sample=()=>({schema:'p5-shared-border-performance',baselineCommit:pinned,
  node:'v24.21.0',platform:'linux',results:['preview','canonical','stress'].map(q=>row(q))});
test('performance review retains source hashes, parity and memory caveats',()=>{
  const summary=reviewBorderPerformance(sample());
  assert.equal(summary.cases.length,3);
  assert.equal(summary.cases[0].cpuReductionPercent,19);
  assert.match(summary.cases[0].memoryDiagnostic,/transient heap/);
  assert.ok(summary.limitations.some(x=>x.includes('Real GPU')));
});
test('frozen JS source/geometry identity is mandatory',()=>{
  const report=sample();report.baselineCommit='0'.repeat(40);
  assert.throws(()=>reviewBorderPerformance(report),/frozen pre-C\+\+/);
  const empty=sample();empty.results[1].sourceHash='invalid';
  assert.throws(()=>reviewBorderPerformance(empty),/source data hash/);
});
test('correct output with slower CPU still fails final regression gate',()=>{
  const a=sample();a.results[0]=row('preview',1.151);
  assert.throws(()=>reviewBorderPerformance(a),/P5_6_CPU_REGRESSION/);
  const b=sample();b.results[2]=row('stress',1.251);
  assert.throws(()=>reviewBorderPerformance(b),/P5_6_CPU_REGRESSION/);
});
test('one row of unequal geometry rejects performance success',()=>{
  const a=sample();a.results[1].match=false;
  assert.throws(()=>reviewBorderPerformance(a),/P5_BORDER_PARITY_FAILED/);
});
