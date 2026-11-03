import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countryImportIdentityKey,resolveCountryIdentities,materializeResolvedCountries} from '../../tools/gis/country-import-identity.js';
import {createGisImportPlan,assertCurrentGisImportPlan} from '../../tools/gis/gis-import-plan.js';
import {normalizeImportPlan} from '../../tools/gis/import-plan.js';
import {createGisGeometryValidator} from '../../tools/gis/gis-geometry-validator.js';
import {createTerritorialEntityLoader,createRepositoryTerritorialLoader} from '../../tools/gis/territorial-entity-loader.js';
import * as previousIdentity from '../../apps/editor/frontend/js/modules/country-import-identity.js';
import * as previousPlan from '../../apps/editor/frontend/js/modules/gis-import-plan.js';
import * as previousImport from '../../apps/editor/frontend/js/modules/import-plan.js';
import * as previousLoader from '../../apps/editor/frontend/js/modules/territorial-entity-loader.js';
import * as previousService from '../../apps/editor/frontend/js/modules/import-service.js';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const old={worker:'apps/editor/frontend/js/workers/gis-gpkg-worker.js',
 adapter:'apps/editor/frontend/js/gis-adapters.js'};
const fixtures={worker:'tests/fixtures/geopackage/compat/worker/gis-gpkg-worker.source.txt',
 adapter:'tests/fixtures/geopackage/compat/worker/gis-adapters.source.txt'};

test('R4-E1 canonical GIS identity and import plans preserve the historical adapter API',()=>{
 assert.equal(previousIdentity.resolveCountryIdentities,resolveCountryIdentities);
 assert.equal(previousIdentity.materializeResolvedCountries,materializeResolvedCountries);
 assert.equal(previousPlan.createGisImportPlan,createGisImportPlan);
 assert.equal(previousPlan.assertCurrentGisImportPlan,assertCurrentGisImportPlan);
 assert.equal(previousImport.normalizeImportPlan,normalizeImportPlan);
 assert.equal(previousService.createGisGeometryValidator,createGisGeometryValidator);
 assert.equal(previousLoader.createTerritorialEntityLoader,createTerritorialEntityLoader);
 assert.equal(previousLoader.createRepositoryTerritorialLoader,createRepositoryTerritorialLoader);
 const source={type:'Feature',id:'DEU',properties:{name:'Germany'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},
   importIdentity:{sourceNamespace:'natural-earth',sourceIdField:'ADM0_A3',sourceId:'DEU'}};
 const row=resolveCountryIdentities([source],[{...source,properties:{name:'독일'}}])[0];
 assert.equal(countryImportIdentityKey(row.sourceIdentity),'natural-earth:adm0_a3:DEU');
 assert.equal(materializeResolvedCountries([row])[0].id,'DEU');
 assert.equal(normalizeImportPlan({targetType:'general',sourceFormat:'GPKG'}).openMode,'merge');
 const plan=createGisImportPlan({id:'test',kind:'territorial',projectGeneration:5,affectedIds:['DEU','DEU']});
 assert.deepEqual(plan.affectedIds,['DEU']);
 assert.equal(assertCurrentGisImportPlan(plan,5),plan);
 assert.throws(()=>assertCurrentGisImportPlan(plan,6),{code:'PL-GIS-STALE-PLAN-001'});
});

test('R4-E1 canonical GIS sources do not depend on the archived editor or native mutation adapters',()=>{
 for(const path of ['tools/gis/country-import-identity.js','tools/gis/gis-import-plan.js',
  'tools/gis/import-plan.js','tools/gis/gis-geometry-validator.js',
  'tools/gis/territorial-entity-loader.js','tools/gis/gis-geometry-worker.js']){
  const src=read(path);
  assert.doesNotMatch(src,/apps\/editor\/frontend|apps\/editor\/src-tauri|library_commit|library_conflict|document\.|window\./,path);
 }
 const worker=read('tools/gis/gis-geometry-worker.js');
 assert.match(worker,/gis\.validate/);
 assert.match(worker,/geometry-validation\.js/);
 assert.doesNotMatch(worker,/importScripts\(['"]\.\.\/modules/);
});

test('R4-E1 freezes unshipped GeoPackage writer and GIS adapters as byte-identical compatibility fixtures',()=>{
 assert.equal(read(old.worker),read(fixtures.worker));
 assert.equal(read(old.adapter),read(fixtures.adapter));
 const consumer=read('tests/helpers/production-geopackage.mjs');
 assert.doesNotMatch(consumer,/apps\/editor\/frontend/);
 assert.match(consumer,/fixtures\/geopackage\/compat/);
 const adapterTest=read('tests/unit/gis-adapters.test.mjs');
 assert.doesNotMatch(adapterTest,/apps\/editor\/frontend/);
});

test('R4-E1 preserves 103 candidates until editor-only Core/test dependencies are retired in E2-E5',()=>{
 const report=JSON.parse(read('docs/development/r4e0-source-dispositions.json'));
 const e1=report.decisions.filter(row=>row.category==='gis-interop');
 assert.equal(e1.length,13);
 assert.ok(e1.some(x=>x.path.endsWith('gis-geometry-worker.js')));
 assert.ok(e1.some(x=>x.path.endsWith('gis-gpkg-worker.js')));
 assert.ok(e1.some(x=>x.path.endsWith('gis-import-transaction.js')));
});
