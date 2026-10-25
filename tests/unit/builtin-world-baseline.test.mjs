import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {builtinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from "../../shared/frontend/js/modules/geometry-version-store.js";
import {resolveWorld} from "../../shared/frontend/js/modules/timeline-resolver.js";
import {temporalContains,temporalMonthEnd} from "../../shared/frontend/js/modules/temporal.js";
import {createRingHitTester} from "../../shared/frontend/js/modules/ring-hit-test.js";
const oracle=JSON.parse(fs.readFileSync(new URL('../fixtures/builtin-modern-interval-baseline.json',import.meta.url)));
test('the pre-change modern publication keeps identities, geometry, hierarchy and Crimea attribution',()=>{
 const rings=createRingHitTester(r=>r);
 for(const reference of oracle.months.filter(row=>row.month==='2026-10')){
  const month=reference.month,project=builtinProject(month);
  const view=resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month);
  const entities=view.entities.map(row=>{
   const info=row.identity.properties.metadata.historicalTimeline;
   const binding=info.geometryBindings.find(value=>temporalContains(value,temporalMonthEnd(month)));
   return {entityId:row.id,sourceEntityId:info.entityId,sourceVersionId:binding.sourceVersionId,parentId:row.parentId,rootId:row.rootId,geometryRef:row.geometryRef};
  }).sort((a,b)=>a.entityId.localeCompare(b.entityId,'en'));
  assert.deepEqual(entities,reference.entities,month);
  for(const expected of reference.points){
   const roots=[...new Set(view.entities.filter(row=>{
    const g=row.geometry;return (g.type==='Polygon'?[g.coordinates]:g.coordinates).some(p=>rings.contains(expected.point,p[0])&&!p.slice(1).some(h=>rings.contains(expected.point,h)));
   }).map(row=>row.rootId))].sort();
   assert.deepEqual(roots,expected.rootIds,`${month} ${expected.point}`);
  }
 }
});
