import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import '../helpers/spherical-core.mjs';
import '../../shared/frontend/js/vendor/polygon-clipping.min.js';
import {distanceKm,geometryAreaKm2,lineDistanceKm} from '../../tools/gis/geometry-metrics.js';
import {validateCollection} from '../../tools/gis/geometry-validation.js';
import {createCountryImportMergePlanner} from '../../tools/gis/country-import-merge.js';
import {calculateLibraryBatch} from '../../tools/gis/territorial-batch-calculation.js';
import {createTerritoryComponentPlan} from '../../tools/gis/territory-component-plan.js';
import {normalizePolygonGeometry} from '../../shared/frontend/js/modules/map-edit-geometry.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const box=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[a,d],[c,d],[c,b],[a,b]]]});
const feature=(id,geometry)=>({type:'Feature',id,properties:{name:id},geometry});

test('R4-C canonical spatial adapters rely on one shared C++ calculation owner',()=>{
 const metrics=read('tools/gis/geometry-metrics.js');
 const validate=read('tools/gis/geometry-validation.js');
 const merge=read('tools/gis/country-import-merge.js');
 const batch=read('tools/gis/territorial-batch-calculation.js');
 for(const source of [metrics,validate,merge,batch])
   assert.doesNotMatch(source,/apps\/editor\/frontend|window\.|document\.|commandOwner|new Worker\s*\(/);
 for(const symbol of ['displayLineDistancesKm','displayGeometryAreasKm2'])
   assert.ok(metrics.includes('sharedCalculationCore.'+symbol),symbol);
 for(const symbol of ['validateGisGeometry','GisOverlapCandidates','gisValidationArea'])
   assert.ok(validate.includes('sharedCalculationCore.'+symbol),symbol);
 for(const symbol of ['planGisCountryMerge','planGisCountryGeometry','gisCountryMergeCanCommit'])
   assert.ok(merge.includes('sharedCalculationCore.'+symbol),symbol);
 assert.match(validate,/from '.\/polygon-clipping-calculation\.js'/);
 assert.match(batch,/from '.\/country-import-merge\.js'/);
 assert.match(batch,/from '.\/geometry-validation\.js'/);
});

test('R4-C metrics keep antimeridian distance and hole-aware polygon areas',()=>{
 assert.equal(distanceKm([0,0],[0,0]),0);
 assert.ok(distanceKm([179,0],[-179,0])<300);
 const route=[[179,0],[-179,0],[-179,1]];
 assert.ok(Math.abs(lineDistanceKm(route)-distanceKm(route[0],route[1])-distanceKm(route[1],route[2]))<1e-9);
 const outer=box(0,0,2,2),hole={...outer,coordinates:[outer.coordinates[0],box(0.5,0.5,1,1).coordinates[0].slice().reverse()]};
 assert.ok(geometryAreaKm2(outer)>geometryAreaKm2(hole));
});

test('R4-C GIS overlap audit keeps input geometry and reports both countries',()=>{
 const rows={type:'FeatureCollection',features:[feature('A',box(0,0,2,2)),feature('B',box(1,1,3,3))]};
 const before=structuredClone(rows);
 const result=validateCollection(rows);
 assert.deepEqual(result.firstOverlap,['A','B']);
 assert.ok(result.overlapAreaKm2>0);
 assert.deepEqual(rows,before);
 assert.equal(validateCollection(rows,['A'],{overlapAffectedIds:['A']}).firstOverlap?.length,2);
 assert.throws(()=>validateCollection(rows,['A'],{overlapAffectedIds:['B']}),/Overlap pair scope/);
});

test('R4-C detached country planner and batch calculator retain exact module ownership',()=>{
 assert.equal(typeof createCountryImportMergePlanner,'function');
 assert.equal(typeof calculateLibraryBatch,'function');
 assert.doesNotMatch(read('apps/editor/frontend/js/modules/import-service.js'),/createCountryImportMergePlanner/);
 assert.match(read('apps/editor/frontend/js/modules/map-edit-library-calculation.js'),
   /export \{calculateLibraryBatch\} from/);
});

test('R4-C detached territory component plan preserves untouched polygon coordinates',async()=>{
 const source=feature('A',box(0,0,1,1));
 const snapshot=structuredClone(source);
 const planner=createTerritoryComponentPlan({clipper:globalThis.polygonClipping,
   normalize:normalizePolygonGeometry});
 const result=await planner.prepare({features:[source]});
 assert.deepEqual(result.componentFeatures[0].geometry.coordinates,[source.geometry.coordinates]);
 assert.deepEqual(source,snapshot);
});

test('R4-C old editing geometry implementations have been removed',()=>{
 for(const path of ['apps/editor/frontend/js/modules/geometry-metrics.js',
   'apps/editor/frontend/js/modules/gis-geometry-validation.js',
   'apps/editor/frontend/js/modules/territory-component-plan.js'])
   assert.equal(existsSync(resolve(root,path)),false,path);
 for(const path of ['tools/gis/geometry-metrics.js','tools/gis/geometry-validation.js',
   'tools/gis/country-import-merge.js','tools/gis/territorial-batch-calculation.js',
   'tools/gis/territory-component-plan.js'])
   assert.equal(existsSync(resolve(root,path)),true,path);
 const report=JSON.parse(read('docs/development/r4-source-pruning.json'));
 assert.equal(report.baselineCandidates,153);
 assert.equal(report.removedSourceCount,50);
 assert.equal(report.remainingSourceCount,103);
});
