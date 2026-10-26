import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import {hydroEditResourceDependencies} from '../../shared/frontend/js/modules/gpu-map-renderer.js';
import {resourceUpdate} from '../../shared/frontend/js/modules/resource-update-policy.js';
test('water resource preparation follows geometry version and width inputs, not date or copied DTOs',()=>{
 const store=createGeometryVersionStore([{id:'river',version:1,geojson:{type:'LineString',coordinates:[[0,0],[1,1]]}},{id:'river',version:2,geojson:{type:'LineString',coordinates:[[0,0],[2,1]]}}]);
 const water=version=>({id:'r',geometry:store.get({id:'river',version}),properties:{category:'river',stroke_widths:[[1,2]]}});
 const dependencies=feature=>hydroEditResourceDependencies([feature],4,()=> '#2277cc');
 const first=dependencies(water(1));
 assert.equal(resourceUpdate(first,dependencies({...water(1),properties:{...water(1).properties,name:'renamed'}})).prepare,false);
 assert.equal(resourceUpdate(first,dependencies(water(2))).prepare,true);
 assert.equal(resourceUpdate(first,dependencies({...water(1),properties:{category:'river',stroke_widths:[[2,3]]}})).prepare,true);
});
