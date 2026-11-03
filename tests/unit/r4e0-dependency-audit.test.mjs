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
 assert.ok(gis.blocking.some(x=>x.from==='tests/unit/helpers/gis-worker-harness.mjs'));
 const gpkg=audit.records.find(x=>x.path.endsWith('/gis-gpkg-worker.js'));
 assert.ok(gpkg.blocking.some(x=>x.from==='tests/helpers/production-geopackage.mjs'));
 for(const path of manifest.invariants)assert.ok(typeof path==='string'&&path.length>0);
});

test('R4-E0 diagnoses retired tests separately from genuinely shipped runtime imports',()=>{
 const runtime=new Set(['viewer-runtime','shared-runtime']);
 const executable=new Set(['static-import','dynamic-import','worker-url','worker-import']);
 const shipping=audit.records.flatMap(x=>x.blocking.filter(y=>runtime.has(y.owner)&&executable.has(y.kind)));
 assert.deepEqual(shipping,[],
   'R4-E0 requires the shipped Viewer/Windows frontend to remain independent of archived editor modules');
 assert.ok(audit.summary.referencedFiles>0);
 assert.ok(audit.summary.retiredReferences>0);
});

test('R4-E0 dependency graph produces unique complete deletion units',()=>{
 const candidates=new Set(audit.records.filter(x=>x.present).map(x=>x.path));
 for(const row of audit.records){
   for(const path of row.internalOutgoing)assert.ok(candidates.has(path),path);
   for(const path of row.atomicDeletionGroup)assert.ok(candidates.has(path),path);
 }
 const composition=audit.records.find(x=>x.path==='apps/editor/frontend/js/modules/app-composition.js');
 assert.ok(composition.internalOutgoing.includes(
   'apps/editor/frontend/js/modules/app-runtime-dependencies.js'),
   'versioned URL dynamic import must be resolved to its static module filename');
 for(const cycle of audit.cycles){
   assert.ok(cycle.length>1);
   for(const path of cycle)assert.deepEqual(audit.records.find(x=>x.path===path).atomicDeletionGroup,cycle);
 }
});
