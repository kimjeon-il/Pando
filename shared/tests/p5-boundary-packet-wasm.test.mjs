import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

test('C++ shared-border packet exports typed GPU arrays and stable owner groups',()=>{
  const input=[
    [[0,0],[0,.25],['A','B']],
    [[0,.25],[0,.5],['A','B']],
    [[2,0],[2,.25],['C']],
  ];
  const previous=structuredClone(input);
  const packet=core.boundaryAssembleStrokePacket(input,2);
  assert.deepEqual(packet.ownerIds,['A','B','C']);
  assert.deepEqual(packet.ownerRanges,{'A|B':{first:0,count:2},C:{first:2,count:1}});
  assert.equal(packet.segments.length,3);
  assert.ok(packet.startsEnds instanceof Float32Array);
  assert.ok(packet.chainPhase instanceof Float32Array);
  assert.equal(packet.startsEnds.length,12);
  assert.deepEqual([...packet.chainPhase],[0,.25,0]);
  assert.deepEqual(input,previous);
  assert.equal(core.boundaryVerifyStrokeChains(input.slice(0,2)),2);
});

test('antimeridian display lines keep phase, but artificial seams and poles vanish',()=>{
  const crossing=core.boundaryAssembleStrokePacket([
    [[179.8,30],[-179.8,30],['E','W']],
  ],2);
  assert.equal(crossing.segments.length,2);
  assert.equal(crossing.segments[0].end[0],180);
  assert.equal(crossing.segments[1].start[0],-180);
  assert.ok(crossing.chainPhase[1]>0);
  const artificial=core.boundaryAssembleStrokePacket([
    [[180,10],[180,20],['A','B']],
    [[0,90],[1,89],['A','B']],
  ],2);
  assert.equal(artificial.segments.length,0);
  assert.equal(artificial.ownerIds.length,0);
});

test('shared border source verification and render packet reject malformed rows',()=>{
  for(const rows of [null,{},[[[0,0],[1,1]]],[[[0,0],[1,1],[]]],
    [[[NaN,0],[1,0],['A']]],[[[0,0],[1,0],[1]]]]) {
    assert.throws(()=>core.boundaryAssembleStrokePacket(rows,2),
      error=>error?.code==='PL-BOUNDARY-PACKET');
  }
  assert.throws(()=>core.boundaryVerifyStrokeChains([
    [[0,0],[1,0],['A']]
  ]),error=>error?.code==='PL-BOUNDARY-PACKET');
});
