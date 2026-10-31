import test from 'node:test';
import assert from 'node:assert/strict';
import '../../shared/frontend/js/vendor/polygon-clipping.min.js';
import {applyCompiledSourceDelta,patchCountryWindow} from '../../tools/gis/china-frontier-delta.mjs';
const pc=globalThis.polygonClipping;
const box=(x,y,X,Y)=>({type:'Polygon',coordinates:[[[x,y],[X,y],[X,Y],[x,Y],[x,y]]]});
const mp=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const equal=(a,b)=>assert.deepEqual(pc.xor(mp(a),mp(b)),[]);
test('source delta retains earlier compiled exclusions outside frontier',()=>{
 equal(applyCompiledSourceDelta(box(0,0,4,4),box(0,0,5,4),box(1,0,4,4),null,pc),box(1,0,5,4));
});
test('restores only paired old owner release within new counterpart source',()=>{
 const release=pc.difference(mp(box(0,0,3,4)),mp(box(0,0,1,4)));
 equal(applyCompiledSourceDelta(box(1,0,5,4),box(1,0,5,4),box(3,0,5,4),{type:'MultiPolygon',coordinates:release},pc),box(1,0,5,4));
});
test('does not add released land outside counterpart or remove unrelated exclusion',()=>{
 equal(applyCompiledSourceDelta(box(2,0,5,4),box(2,0,5,4),box(4,0,5,4),box(0,0,3,4),pc),{type:'MultiPolygon',coordinates:[box(2,0,3,4).coordinates,box(4,0,5,4).coordinates]});
});
test('splits only selected window and updates paired refs preserving outside geometries',()=>{
 const geo=box(0,0,4,4),ref={id:'old',version:1},row={id:'r',validFrom:'1900-01-01',validTo:null,geometryRef:ref};
 const c={geometries:[{...ref,geojson:geo}],timelineRecords:{geometryBindings:[row]},sourceBindings:[{...row,sourceVersionId:'source'}]};
 const result=patchCountryWindow(c,{from:'1922-12-30',to:'1925-05-12',transform:()=>box(0,0,3,4),sourceVersionId:'selected'});
 assert.deepEqual(result.timelineRecords.geometryBindings.map(x=>[x.validFrom,x.validTo]),[['1900-01-01','1922-12-29'],['1922-12-30','1925-05-12'],['1925-05-13',null]]);
 assert.deepEqual(result.timelineRecords.geometryBindings[0].geometryRef,ref);assert.deepEqual(result.timelineRecords.geometryBindings[2].geometryRef,ref);
 assert.equal(result.sourceBindings[1].sourceVersionId,'selected');assert.equal(result.sourceBindings[0].sourceVersionId,'source');
 assert.deepEqual(c.geometries,[{...ref,geojson:geo}]);
});
test('open-ended selected window splits at effective date and preserves earlier geometry',()=>{
 const geo=box(0,0,4,4),ref={id:'old',version:1},row={id:'r',validFrom:'1995-09-25',validTo:null,geometryRef:ref};
 const c={geometries:[{...ref,geojson:geo}],timelineRecords:{geometryBindings:[row]},sourceBindings:[{...row,sourceVersionId:'old-source'}]};
 const result=patchCountryWindow(c,{from:'2006-01-12',to:null,transform:()=>box(0,0,3,4),sourceVersionId:'treaty-source'});
 assert.deepEqual(result.timelineRecords.geometryBindings.map(x=>[x.validFrom,x.validTo]),[['1995-09-25','2006-01-11'],['2006-01-12',null]]);
 assert.deepEqual(result.timelineRecords.geometryBindings[0].geometryRef,ref);
 assert.notDeepEqual(result.timelineRecords.geometryBindings[1].geometryRef,ref);
 assert.equal(result.sourceBindings[0].sourceVersionId,'old-source');
 assert.equal(result.sourceBindings[1].sourceVersionId,'treaty-source');
 assert.deepEqual(c.sourceBindings,[{...row,sourceVersionId:'old-source'}]);
});
