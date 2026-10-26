import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTimelineRecords } from '../../shared/frontend/js/modules/timeline-records.js';
import { sharedCalculationCore } from '../../shared/frontend/js/modules/temporal.js';

const ref = (domain, id = 'same-id') => ({ domain, id });
function fixture() {
  const country=ref('territorial'),lake=ref('hydro');
  const records={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
  for(const objectRef of [country,lake]) {
    const key=objectRef.domain;
    records.lifetimes.push({id:`${key}:life`,objectRef,validFrom:null,validTo:null});
    records.geometryBindings.push({id:`${key}:old`,objectRef,validFrom:null,validTo:'1922-12-29',geometryRef:{id:`${key}:modern`,version:1}},
      {id:`${key}:restored`,objectRef,validFrom:'1922-12-30',validTo:'1925-05-12',geometryRef:{id:`${key}:restored`,version:1}},
      {id:`${key}:new`,objectRef,validFrom:'1925-05-13',validTo:null,geometryRef:{id:`${key}:modern`,version:1}});
  }
  records.parentRelations.push({id:'country:parent',objectRef:country,validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'});
  return {records,context:{entities:[{objectRef:country,entityKind:'general'},{objectRef:lake,entityKind:'lake'}],geometryExists:()=>true}};
}

test('country and lake with equal IDs share inclusive selection without administrative lake parents',()=>{
  const {records,context}=fixture();
  const normalized=normalizeTimelineRecords(records,context);
  assert.deepEqual(normalized,records);
  for(const [date,suffix] of [['1922-12-29','modern'],['1922-12-30','restored'],['1925-05-12','restored'],['1925-05-13','modern']]) {
    const world=sharedCalculationCore.timelineResolveWorld(normalized,context,date);
    assert.equal(world.entities.length,2);
    for(const entity of world.entities) assert.equal(entity.geometryRef.id,`${entity.objectRef.domain}:${suffix}`);
  }
});

test('common validator rejects overlapping water versions and water administrative relations',()=>{
  const {records,context}=fixture();
  const overlap=structuredClone(records);
  overlap.geometryBindings.find(row=>row.id==='hydro:new').validFrom='1925-05-12';
  assert.throws(()=>normalizeTimelineRecords(overlap,context),{code:'TIMELINE_OVERLAP'});
  records.parentRelations.push({id:'invalid-water-parent',objectRef:ref('hydro'),validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'});
  assert.throws(()=>normalizeTimelineRecords(records,context),{code:'TIMELINE_KIND'});
});
