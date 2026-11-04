import test from 'node:test';
import assert from 'node:assert/strict';
import {compareChains,detailMetrics,sampleChain,measureSamples} from '../../tools/gis/measure-border-detail.mjs';
test('uniform arc-length distances do not depend on native vertex density',()=>{
 const sparse=[[0,0],[1000,0]],dense=Array.from({length:101},(_,n)=>[n*10,10]);
 const result=compareChains(sparse,dense,{spacingMeters:25});
 assert.equal(result.leftToRight.samples,41);assert.equal(result.rightToLeft.samples,41);
 assert.equal(result.pooled.median,10);assert.equal(result.sampledMaximumMeters,10);assert.equal(result.lengthRatio,1);
 assert.equal(detailMetrics(dense).vertices,101);assert.equal(detailMetrics(dense).lengthKm,1);
});
test('metric length, common-window turns and fixed endpoints remain separate measurements',()=>{
 const line=[[0,0],[1000,0],[1000,1000]];const m=detailMetrics(line);
 assert.equal(m.lengthKm,2);assert.equal(m.verticesPerKm,1.5);assert.equal(m.turnDegrees.median,90);
 assert.deepEqual(sampleChain(line,1000),line);assert.deepEqual(line,[[0,0],[1000,0],[1000,1000]]);
 const q=compareChains(line,[[10,0],[1010,0],[1010,1000]]);assert.deepEqual(q.endpointOffsetsMeters,[10,10]);
});
test('explicit finite metric chains and positive sample spacing are required',()=>{
 assert.throws(()=>detailMetrics([[0,0],[NaN,1]]));assert.throws(()=>sampleChain([[0,0],[1,1]],0));assert.throws(()=>detailMetrics([[0,0],[0,0]]));
});

test('the file workflow requires metre CRS metadata and keeps input chains immutable',()=>{
 const input={schema:'pando-border-detail-samples-v1',samples:[{id:'synthetic',metricCrs:'+proj=aeqd +lat_0=0 +lon_0=0 +units=m',public:[[0,0],[1000,0]],work:[[0,0],[1000,0]],reference:[[0,10],[1000,10]]}]};
 const before=structuredClone(input),result=measureSamples(input);
 assert.equal(result.schema,'pando-border-detail-metrics-v1');assert.equal(result.samples[0].comparison50m.pooled.median,10);assert.deepEqual(input,before);
 input.samples[0].metricCrs='EPSG:4326';assert.throws(()=>measureSamples(input),/metre projection/);
});

test('closed outlines have no chord ratio and short lines have no 1km turn statistic',()=>{const closed=detailMetrics([[0,0],[1000,0],[1000,1000],[0,0]]);assert.equal(closed.lengthToChordRatio,null);assert.equal(closed.lengthToChordApplicability,'not-applicable-closed-chain');assert.equal(detailMetrics([[0,0],[10,0]]).turnDegrees,null);});
