import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutLabels } from '../../assets/js/modules/label-layout.js';
import { PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
import { createMapRenderCoordinator, MAP_RENDER_DIRTY } from '../../assets/js/modules/map-render-coordinator.js';
test('High layout has an absolute cap including selected and pinned candidates', () => {
  const records=Array.from({length:10000},(_,i)=>({ key: String(i), point: [i*5,10], width:1,height:1, priority:i, pinned:true, selected:i===9999 }));
  const metrics={}; const placed=layoutLabels(records,{ metrics });
  assert.equal(placed.length,PLACE_LIMITS.layoutCandidates); assert.equal(placed[0].key,'9999'); assert.equal(metrics.hardCulledCount,10000-PLACE_LIMITS.layoutCandidates);
});
test('builtin and user labels collide in the same label policy', () => {
  const records=[{key:'builtin:place:synthetic:1',point:[20,20],width:50,height:20,priority:90,collisionGroup:'place'},{key:'user1',point:[20,20],width:50,height:20,priority:40,collisionGroup:'place'}];
  assert.deepEqual(layoutLabels(records).map(item=>item.key),[records[0].key]);
});
test('quality and project invalidations do not execute label layout during interaction', () => {
  const frames=[], layouts=[];
  const coordinator=createMapRenderCoordinator({ requestFrame: fn=>frames.push(fn), prepareView: ()=>({}), renderers:{labelLayout:()=>layouts.push('layout')} });
  coordinator.beginInteraction(); coordinator.invalidate(MAP_RENDER_DIRTY.LABEL_LAYOUT,'quality'); frames.shift()(); assert.equal(layouts.length,0);
  coordinator.endInteraction(); frames.shift()(); assert.equal(layouts.length,1);
});
