import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildR4E0Map} from '../../scripts/r4e0-dependency-audit.mjs';

const manifest=JSON.parse(readFileSync(new URL('../../docs/development/r4e0-source-dispositions.json',import.meta.url),'utf8'));
const audit=buildR4E0Map();

test('R4-E0 assigns each of the 103 historic editor files exactly one disposition',()=>{
 assert.equal(manifest.baselineCandidateCount,103);
 assert.equal(manifest.decisions.length,103);
 assert.equal(new Set(manifest.decisions.map(x=>x.path)).size,103);
 assert.equal(audit.summary.tracked,103);
 assert.equal(audit.summary.present+audit.summary.removed,103);
 assert.deepEqual(audit.errors,[]);
 for(const row of audit.records){
   assert.ok(row.phase.startsWith('R4-E'),row.path);
   assert.ok(row.disposition&&row.target&&row.blockingGate,row.path);
   assert.ok(row.atomicDeletionGroup.includes(row.path),row.path);
 }
});

test('R4-E0 keeps canonical GIS, C++/WASM, and actual Worker/GeoPackage parity guards',()=>{
 for(const name of [
  'apps/editor/frontend/js/workers/gis-geometry-worker.js',
  'apps/editor/frontend/js/workers/gis-gpkg-worker.js',
  'apps/editor/frontend/js/gis-adapters.js',
  'apps/editor/frontend/js/modules/import-service.js']){
   const row=audit.records.find(x=>x.path===name);
   assert.ok(row,name);
   assert.equal(row.category,'gis-interop');
   assert.equal(row.phase,'R4-E1');
 }
 const gis=audit.records.find(x=>x.path.endsWith('/gis-geometry-worker.js'));
 // R4-E1 migrates these two consumers to canonical GIS and frozen test fixtures;
 // the E0 inventory continues to audit every archived source without requiring
 // a stale consumer to remain attached to the old editor file.
 assert.ok(!gis.blocking.some(x=>x.from==='tests/unit/helpers/gis-worker-harness.mjs'));
 const harness=readFileSync(new URL('./helpers/gis-worker-harness.mjs',import.meta.url),'utf8');
 assert.match(harness,/tools\/gis\/gis-geometry-worker\.js/);
 const gpkg=audit.records.find(x=>x.path.endsWith('/gis-gpkg-worker.js'));
 assert.ok(!gpkg.blocking.some(x=>x.from==='tests/helpers/production-geopackage.mjs'));
 const producer=readFileSync(new URL('../helpers/production-geopackage.mjs',import.meta.url),'utf8');
 assert.match(producer,/fixtures\/geopackage\/compat/);
 for(const path of manifest.invariants)assert.ok(typeof path==='string'&&path.length>0);
});

test('R4-E0 diagnoses retired tests separately from genuinely shipped runtime imports',()=>{
 const runtime=new Set(['viewer-runtime','shared-runtime']);
 const executable=new Set(['static-import','dynamic-import','worker-url','worker-import']);
 const shipping=audit.records.flatMap(x=>x.blocking.filter(y=>runtime.has(y.owner)&&executable.has(y.kind)));
 assert.deepEqual(shipping,[],
   'R4-E0 requires the shipped Viewer/Windows frontend to remain independent of archived editor modules');
 assert.equal(audit.records.filter(r=>r.present&&r.blocking.length).length,0);
 assert.equal(audit.summary.retiredReferences,0);
});

test('R4-E5 closes the archived source dependency graph',()=>{
 assert.equal(audit.summary.present,0);
 assert.equal(audit.summary.removed,103);
 assert.equal(audit.records.filter(r=>r.present&&r.blocking.length).length,0);
 assert.deepEqual(audit.errors,[]);
});
