import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {ATTRIBUTE_HISTORY_IDS,planAttributes} from '../../tools/gis/apply-2000-2026-name-flag-history.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('only dated name and flag attributes change; existing geometry and parent relations remain immutable',()=>{
 const sources=readTerritorialSources(),byId=new Map(sources.map(row=>[row.entityId,row]));
 const applied=ATTRIBUTE_HISTORY_IDS.some(id=>!!byId.get(id)?.sourceInfo?.attributeHistoryEvidence);
 if(applied){
  for(const id of ATTRIBUTE_HISTORY_IDS){
   const row=byId.get(id);
   assert.ok(row?.sourceInfo?.attributeHistoryEvidence,'Missing applied source: '+id);
  }
  return;
 }
 const plan=planAttributes(sources);
 assert.equal(plan.namedCount,10);
 assert.equal(plan.flagCount,5);
 assert.equal(plan.updates.length,ATTRIBUTE_HISTORY_IDS.length);
 for(const after of plan.updates){
  const before=byId.get(after.entityId);
  assert.equal(hash(after.geometryVersions),hash(before.geometryVersions),'Geometry changed: '+after.entityId);
  assert.deepEqual(after.lifetime,before.lifetime,'Lifetime changed: '+after.entityId);
  assert.equal(after.parentEntityId,before.parentEntityId,'Parent changed: '+after.entityId);
  if(after.nameVersions){
   for(const row of after.nameVersions)assert.ok(row.names?.ko?.common,'Missing dated common name');
  }
  if(after.metadata.flagHistory){
   const editions=after.metadata.flagHistory;
   assert.equal(editions.length,2);
   assert.equal(editions[0].policy,'embedded');
   assert.match(editions[0].flagDataUrl,/^data:image\/svg\+xml;base64,/);
   for(const row of editions.filter(row=>row.policy==='embedded'))
    assert.match(Buffer.from(row.flagDataUrl.split(',')[1],'base64').toString('utf8'),/^<svg /);
  }
 }
 const bahrain=plan.updates.find(e=>e.entityId==='state:BHR');
 assert.deepEqual(bahrain.nameVersions.map(v=>v.names.ko.common),['바레인','바레인','바레인']);
 assert.equal(bahrain.nameVersions.at(-1).names.ko.formal,'바레인 왕국');
 const north=plan.updates.find(e=>e.entityId==='state:MKD');
 assert.equal(north.nameVersions.at(-2).names.ko.common,'마케도니아');
 assert.equal(north.nameVersions.at(-1).names.ko.common,'북마케도니아');
 const n=plan.updates.find(e=>e.entityId==='state:NRU');
 assert.equal(n.nameVersions.at(-1).validFrom,'2026-05-12');
});
