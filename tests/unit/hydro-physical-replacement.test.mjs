import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalWaterPresentation} from '../../shared/frontend/js/modules/physical-resources.js';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';
import '../../shared/frontend/js/vendor/polygon-clipping.min.js';
const box=(x,y,size)=>({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]});
test('physical water follows the effective copied object geometry, reuses its mask and honors visibility',()=>{
 const source=box(2,2,2),land={type:'MultiPolygon',coordinates:[[box(0,0,10).coordinates[0],source.coordinates[0]]]};
 const owner=createPhysicalWaterPresentation();
 const context={geometry:land,revision:'land',water:source,waterRevision:'source',waterObjectRef:{domain:'hydroBuiltin',id:'sea'}};
 assert.equal(owner(context,null,true),context);
 assert.equal(owner(context,null,false).water,null);
 const store=createGeometryVersionStore([{id:'copy',version:1,geojson:box(3,2,2)}]);
 const copy={id:'copy',geometry:store.get({id:'copy',version:1})};
 const next=owner(context,copy,true);assert.equal(next.water,null,'the normal edited-water renderer owns the only copied fill');
 assert.equal(next,owner(context,{...copy},true));
 assert.deepEqual(globalThis.polygonClipping.xor(next.geometry.coordinates,globalThis.polygonClipping.difference([box(0,0,10).coordinates],copy.geometry.coordinates)),[]);
 assert.notEqual(next.revision,context.revision);
});
