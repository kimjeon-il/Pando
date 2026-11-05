import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {buildR4E0Map} from '../../scripts/r4e0-dependency-audit.mjs';

const source=JSON.parse(readFileSync(new URL('../../docs/development/r4e0-source-dispositions.json',import.meta.url),'utf8'));
const receipt=JSON.parse(readFileSync(new URL('../../docs/development/r4-source-pruning.json',import.meta.url),'utf8'));
const audit=buildR4E0Map();
test('R4-E5 preserves one historical classification for every archived source',()=>{
 assert.equal(source.baselineCandidateCount,103);
 assert.equal(source.decisions.length,103);
 assert.equal(new Set(source.decisions.map(x=>x.path)).size,103);
 assert.equal(audit.summary.tracked,103);
 assert.deepEqual(audit.errors,[]);
 assert.equal(receipt.remainingSourceCount,0);
 assert.equal(receipt.removedSourceCount,receipt.baselineCandidates);
 assert.equal(receipt.removedSources.length,receipt.baselineCandidates);
});
test('R4-E5 has no surviving editor runtime or source-level import cycle',()=>{
 assert.equal(audit.summary.present,0);
 assert.equal(audit.summary.internalEdges,0);
 assert.equal(audit.summary.stronglyConnectedGroups,0);
 assert.deepEqual(audit.cycles,[]);
 for(const row of audit.records){
  assert.equal(row.present,false,row.path);
  assert.ok(row.disposition && row.blockingGate,row.path);
  for(const ref of row.blocking)assert.ok(!['viewer-runtime','shared-runtime','windows-runtime','gis-or-build-tool'].includes(ref.owner),ref.from);
 }
});
test('R4-E5 retains current Viewer inspection, canonical GIS, Core and GeoPackage evidence',()=>{
 for(const path of source.invariants)assert.equal(existsSync(new URL('../../'+path,import.meta.url)),true,path);
 assert.equal(existsSync(new URL('../../apps/editor/src-tauri/src/lib.rs',import.meta.url)),false,
  'retired Windows reviewer must not be revived as an active invariant');
 const harness=readFileSync(new URL('./helpers/gis-worker-harness.mjs',import.meta.url),'utf8');
 assert.ok(harness.includes('tools/gis/gis-geometry-worker.js'));
 const producer=readFileSync(new URL('../helpers/production-geopackage.mjs',import.meta.url),'utf8');
 assert.ok(producer.includes('fixtures/geopackage/compat'));
});
