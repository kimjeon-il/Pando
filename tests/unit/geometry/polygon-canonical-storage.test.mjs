import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as stores from '../../../src/geometry/geometry-version-store.js';
import {snapshotTimelineStorage,restoreTimelineStorage} from '../../../src/document/timeline-storage.js';
import {createCoreDocumentReadModel} from '../../../src/document/core-document-read-model.js';
import {compileBuiltinWorldCatalog} from '../../../tools/build/builtin-world-compiler.mjs';
import {sharedCalculationCore} from '../../../src/document/temporal.js';
import {normalizeTerritorialGeometryVersion} from '../../../tools/gis/territorial-library.js';
const fixture=JSON.parse(readFileSync(new URL('../../fixtures/clipped-positive-current-rings.json',import.meta.url),'utf8'));
const rejected=new Set([3,6,9,24,26,40]);
const ordinary=[[[0,0],[0,2],[2,2],[2,0],[0,0]]];
const ref={id:'captured',version:1};
const canonical=(entries=[],options)=>stores.createCanonicalGeometryVersionStore(entries,options);
for(const {componentIndex,polygon} of fixture.fragments) {
 test(`canonical storage preserves captured fragment ${componentIndex} and an ordinary mixed component`,()=>{
  for(const value of [{type:'Polygon',coordinates:polygon},{type:'MultiPolygon',coordinates:[ordinary,polygon]}]) {
   const before=JSON.stringify(value),store=canonical();store.insert(ref,value);
   assert.deepEqual(store.get(ref),value);assert.equal(JSON.stringify(value),before);
   assert.ok(Object.isFrozen(store.get(ref).coordinates));
   const bytes=JSON.stringify(store.snapshot()),restored=canonical(JSON.parse(bytes));
   assert.equal(JSON.stringify(restored.snapshot()),bytes);
   const reused=canonical(restored.snapshot(),{reuse:restored});
   assert.equal(reused.get(ref),restored.get(ref));
   if(rejected.has(componentIndex))for(const sourceValue of [value,store.get(ref),restored.get(ref)]) {
    assert.throws(()=>stores.createGeometryVersionStore().insert(ref,sourceValue),{code:'INVALID_GEOMETRY'});
    assert.throws(()=>stores.createGeometryVersionStore([{...ref,geojson:sourceValue}]),{code:'INVALID_GEOMETRY'});
   }
   if(rejected.has(componentIndex))assert.throws(()=>normalizeTerritorialGeometryVersion({geometry:value},'general','captured','source:test'),{code:'INVALID_GEOMETRY'});
  }
 });
}
for(const [name,ring] of [
 ['zero area',[[0,0],[1,1],[2,2],[0,0]]],
 ['crossing',[[0,0],[3,2],[0,2],[2,0],[0,0]]],
 ['retraced edge',[[0,0],[2,0],[1,0],[1,1],[0,0]]],
 ['open ring',[[0,0],[0,1],[1,0]]],
 ['out of range',[[0,0],[181,0],[0,1],[0,0]]],
])test(`canonical storage rejects ${name} without publishing partial data`,()=>{
 const store=canonical([{id:'ordinary',version:1,geojson:{type:'Polygon',coordinates:ordinary}}]);
 const before=JSON.stringify(store.snapshot()),value={type:'Polygon',coordinates:[ring]},input=JSON.stringify(value);
 assert.throws(()=>store.insert(ref,value),{code:'INVALID_GEOMETRY'});
 assert.equal(JSON.stringify(store.snapshot()),before);assert.equal(JSON.stringify(value),input);
 assert.throws(()=>canonical([{...ref,geojson:value}]),{code:'INVALID_GEOMETRY'});
});
test('source and canonical storage retain ordinary geometry without rewriting winding or coordinates',()=>{
 const value={type:'Polygon',coordinates:ordinary};
 assert.deepEqual(canonical([{...ref,geojson:value}]).snapshot(),stores.createGeometryVersionStore([{...ref,geojson:value}]).snapshot());
});

for(const {componentIndex,polygon} of fixture.fragments.filter(row=>rejected.has(row.componentIndex)))
test(`source storage still rejects fragment ${componentIndex} without a canonical path`,()=>{
 const value={type:'Polygon',coordinates:polygon},before=JSON.stringify(value);
 assert.throws(()=>stores.createGeometryVersionStore([{...ref,geojson:value}]),{code:'INVALID_GEOMETRY'});
 assert.throws(()=>stores.createGeometryVersionStore().insert(ref,value),{code:'INVALID_GEOMETRY'});
 assert.throws(()=>normalizeTerritorialGeometryVersion({geometry:value},'general','captured','source:test'),{code:'INVALID_GEOMETRY'});
 assert.equal(JSON.stringify(value),before);
});
test('canonical timeline storage and read-model restoration preserve every stored fragment',()=>{
 const geometry={type:'MultiPolygon',coordinates:[ordinary,...fixture.fragments.map(row=>row.polygon)]};
 const source=canonical([{...ref,geojson:geometry}]);
 const records={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 const snapshot=snapshotTimelineStorage(records,source,[]);
 const restored=restoreTimelineStorage(JSON.parse(JSON.stringify(snapshot)),[]);
 assert.deepEqual(restored.geometries.snapshot(),source.snapshot());
 const project={geometries:source.snapshot(),timelineRecords:records,territorialEntities:[],labels:[],hydroEdits:[],genericFeatures:[],distributionLayers:[],distributionEntries:[]};
 const model=createCoreDocumentReadModel(project);
 assert.deepEqual(model.geometry(ref),geometry);
 model.acceptLoadedProject(JSON.parse(JSON.stringify(project)));
 assert.deepEqual(model.geometry(ref),geometry);
 assert.deepEqual(model.snapshot().geometries,source.snapshot());
});
test('builtin compiler stores real clipped output from valid five-point source operands',()=>{
 const pair=JSON.parse(readFileSync(new URL('../../fixtures/clipped-positive-ring.json',import.meta.url),'utf8'));
 const shapes=[{type:'MultiPolygon',coordinates:[pair.left,ordinary]},{type:'Polygon',coordinates:pair.right}];
 // These are the original valid source operands, not rejected output fragments
 // inserted as if they were approved source data.
 for(const shape of shapes)sharedCalculationCore.normalizePolygonGeometry(shape,false);
 const entities=shapes.map((geometry,i)=>({schemaVersion:2,entityId:'current:'+['AAA','BBB'][i],entityKind:'general',lineageId:'test',
  names:{ko:['AAA','BBB'][i]},lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{entityKind:'general',coverageMode:'explicit'},metadata:{},
  sourceInfo:{featureId:['AAA','BBB'][i],featureProperties:{name:['AAA','BBB'][i]}},geometryVersions:[{versionId:'v1',validFrom:null,validTo:null,geometry}]}));
 const view={schemaVersion:1,id:'world:canonical-storage',sourceInfo:{collectionMetadata:{type:'FeatureCollection'}},selections:entities.map(row=>({entityId:row.entityId,geometryVersionId:'v1'}))};
 const input={entities,view,policy:{schemaVersion:1,unknownPeerOverlap:'exclude-from-all',replacements:[]},
  displayPolicy:{schema:'pandolab-builtin-display-policy',schemaVersion:1,subunits:[],territoryMerges:[],sourceAttributions:{}}};
 // Current/current source snapshots intentionally bypass historical peer clipping.
 // Keep that behavior as a control, then make only BBB historical through the
 // actual selection contract. The source ID prefix and coordinates do not change.
 const currentBefore=JSON.stringify(input),current=compileBuiltinWorldCatalog(input);
 assert.deepEqual(current.coverageReport.adjustments,[]);
 assert.deepEqual(current.countries.find(row=>row.entityId==='AAA').geometries[0].geojson,shapes[0]);
 assert.equal(JSON.stringify(input),currentBefore);
 input.view={...view,selections:view.selections.slice(0,1)};
 const before=JSON.stringify(input);
 const compiled=compileBuiltinWorldCatalog(input),country=compiled.countries.find(row=>row.entityId==='AAA');
 assert.ok(country);
 const geometry=country.geometries[0].geojson;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 const vertices=ring=>ring.slice(0,-1).map(point=>JSON.stringify(point)).sort();
 assert.ok(polygons.some(polygon=>JSON.stringify(vertices(polygon[0]))===JSON.stringify(vertices(pair.exactTarget[0]))),
  'the same positive native fragment must reach real archive.insert, not a fake clipper result');
 assert.ok(polygons.some(polygon=>JSON.stringify(vertices(polygon[0]))===JSON.stringify(vertices(ordinary[0]))));
 assert.ok(compiled.coverageReport.adjustments.some(row=>row.entityId==='AAA'&&row.kind==='unknown-peer-overlap'&&row.relatedIds.includes('current:BBB')),
  'the real compiler must perform the historical subtraction before archive insertion');
 assert.throws(()=>stores.createGeometryVersionStore(country.geometries),{code:'INVALID_GEOMETRY'},
  'the generated archive must require canonical admission, rather than pass source admission accidentally');
 assert.deepEqual(canonical(JSON.parse(JSON.stringify(country.geometries))).snapshot(),country.geometries);
 assert.equal(compiled.coverageReport.adjustments.some(row=>row.kind==='certified-clipping-precision-artifact'),false);
 assert.equal(JSON.stringify(input),before);
});


test('storage reuse cannot substitute a caller-owned mutable geometry for the admitted immutable value',()=>{
 const value={type:'Polygon',coordinates:structuredClone(ordinary)};
 for(const create of [stores.createGeometryVersionStore,stores.createCanonicalGeometryVersionStore]) {
  const mutable=structuredClone(value),store=create([{...ref,geojson:value}],{reuse:{get:()=>mutable}});
  assert.notEqual(store.get(ref),mutable);assert.ok(Object.isFrozen(store.get(ref).coordinates[0][0]));
  mutable.coordinates[0][0][0]=99;assert.deepEqual(store.get(ref),value);
 }
});
