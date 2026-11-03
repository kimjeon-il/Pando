import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore } from '../../shared/frontend/js/modules/temporal.js';
import { assembleStrokeWithGroupReuse } from '../../shared/frontend/js/modules/country-stroke-group-reuse.js';

const row=(left,right,owners)=>({start:[left,10],end:[right,10],ownerIds:owners});
const quality=.499;
const native=(rows,angle)=>sharedCalculationCore.boundaryAssembleStrokePacket(rows,angle);
const full=rows=>native(rows.map(segment=>[segment.start,segment.end,segment.ownerIds]),quality);

test('P6 first-visit owner group reuse is byte-exact against original native C++ assembly',()=>{
  const a=['A','B'],b=['C'],c=['D'];
  const first=[row(0,1,a),row(1,2,a),row(5,6,b),row(6,7,b)];
  const initial=assembleStrokeWithGroupReuse(first,quality,native);
  assert.equal(initial.reusedGroups,0);
  assert.deepEqual(initial.packet,full(first));
  const second=[...first.slice(0,2),row(5,6.1,b),row(6.1,7,b),row(8,9,c)];
  const stages=[];
  const next=assembleStrokeWithGroupReuse(second,quality,native,initial.cache,
    (stage,ms,details)=>stages.push({stage,ms,...details}));
  assert.equal(next.reusedGroups,1);
  assert.equal(next.assembledGroups,2);
  assert.deepEqual(next.packet,full(second));
  assert.equal(stages.find(s=>s.stage==='group-reuse').reusedInputSegments,2);
  const back=assembleStrokeWithGroupReuse(first,quality,native,next.cache);
  assert.deepEqual(back.packet,full(first));
  assert.equal(back.packet.startsEnds.length,back.packet.segments.length*4);
  assert.equal(back.packet.chainPhase.length,back.packet.segments.length);
});

test('P6 owner group reuse invalidates raw double changes and quality, not just rounded GPU floats',()=>{
  const same=[row(0,1,['A','B']),row(3,4,['C'])];
  const first=assembleStrokeWithGroupReuse(same,quality,native);
  const changed=[row(0,1+1e-9,['A','B']),row(3,4,['C'])];
  const newPacket=assembleStrokeWithGroupReuse(changed,quality,native,first.cache);
  assert.equal(newPacket.reusedGroups,1);
  assert.equal(newPacket.assembledGroups,1);
  assert.deepEqual(newPacket.packet,full(changed));
  const differentQuality=assembleStrokeWithGroupReuse(same,2,native,first.cache);
  assert.equal(differentQuality.reusedGroups,0);
  assert.deepEqual(differentQuality.packet,
    native(same.map(segment=>[segment.start,segment.end,segment.ownerIds]),2));
});

test('P6 owner key collisions, malformed rows, and empty input defer to original compiled validation',()=>{
  const collision=[row(0,1,['A','B']),row(3,4,['A|B'])];
  const result=assembleStrokeWithGroupReuse(collision,quality,native);
  assert.equal(result.cache,null);
  assert.deepEqual(result.packet,full(collision));
  const empty=assembleStrokeWithGroupReuse([],quality,native);
  assert.equal(empty.cache,null);
  assert.deepEqual(empty.packet,full([]));
  const malformed=[row(0,1,[])];
  assert.throws(()=>assembleStrokeWithGroupReuse(malformed,quality,native),
    error=>error?.code==='PL-BOUNDARY-PACKET');
});
