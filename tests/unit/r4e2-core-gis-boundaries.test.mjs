import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const paths=[
 'tests/helpers/current-command-fixture.mjs',
 'tests/helpers/web-full-document-fixture.mjs',
 'tests/helpers/gis-core-fixture.mjs',
 'tests/unit/territorial-service.test.mjs',
 'tests/unit/distribution-service.test.mjs',
 'tests/unit/core-territorial-service-wasm.test.mjs',
 'tests/unit/core-service-writer-clock-wasm.test.mjs',
 'tests/unit/service-core-command-owner.test.mjs',
 'tests/unit/core-direct-object-writers-wasm.test.mjs',
 'tests/unit/core-delete-selection-wasm.test.mjs',
 'tests/unit/generic-provenance.test.mjs',
 'tests/unit/land-relations-presentation.test.mjs',
 'tests/unit/import-service.test.mjs',
 'tests/unit/gis-geometry-worker.test.mjs',
 'tests/unit/platform-boundaries.test.mjs',
 'tests/unit/general-regional-contract.test.mjs',
 'tests/unit/territorial-command-storage.test.mjs',
 'tests/unit/territorial-metadata-command.test.mjs',
];
test('R4-E2 target Core/GIS tests and helpers do not import archived editor sources',()=>{
 for(const path of paths){
   const src=read(path);
   assert.doesNotMatch(src,/^(?:import\s|[\s\S]*?\bfrom\s*['"])[^\n]*?apps\/editor\/frontend\/js\//m,path);
 }
});
test('R4-E2 supported Core command adapters are test-only, not product code',()=>{
 const files=[
  'tests/helpers/core-command-services/territorial-service.mjs',
  'tests/helpers/core-command-services/distribution-service.mjs',
  'tests/helpers/core-gis-compat/gis-import-transaction.mjs',
  'tests/helpers/core-gis-compat/land-relations.mjs',
  'tests/helpers/core-gis-compat/import-service.mjs',
 ];
 for(const path of files){
  const src=read(path);
  assert.doesNotMatch(src,/from\s*['"][^'"]*apps\/editor\/frontend|import\s*\([^)]*apps\/editor\/frontend/,path);
 }
 const production=read('scripts/lib/frontend-layout.mjs');
 assert.doesNotMatch(production,/sourcePath:\s*['"]tests\/helpers/);
});
test('R4-E2 C++ Core semantic tests still assert provenance, persistence and state changes',()=>{
 const cases=[
  ['tests/unit/core-territorial-service-wasm.test.mjs',['createNodeCoreProject','documentModel']],
  ['tests/unit/core-service-writer-clock-wasm.test.mjs',['createNodeCoreProject','stateRevision','canUndo']],
  ['tests/unit/core-direct-object-writers-wasm.test.mjs',['hydro.metadata','label.edit','storageSnapshot','undo()']],
  ['tests/unit/core-delete-selection-wasm.test.mjs',['createNodeSelection','service.remove','domain.clear','domain.snapshot']],
  ['tests/unit/generic-provenance.test.mjs',['normalizeSourceProvenance','importGeoJson','undo()','redo()']]
 ];
 for(const [path,terms] of cases){
  const src=read(path);
  for(const term of terms)assert.ok(src.includes(term),path+': '+term);
 }
});
test('R4-E2 103 archived sources remain until dependency closure and R4-E4/E5 deletion',()=>{
 const inventory=JSON.parse(read('docs/development/r4-source-pruning.json'));
 assert.equal(inventory.remainingSourceCount,103);
 assert.equal(inventory.removedSourceCount,50);
});
