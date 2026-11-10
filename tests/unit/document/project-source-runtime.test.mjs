import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProjectSourceRuntime} from '../../../src/document/project-source-runtime.js';

const project=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
const sha='a'.repeat(64);
const meta={mapProject:project,mapProjectManifest:{sha256:'b'.repeat(64)},
 projectCatalogs:{territorial:{catalog:project.resources.territorial.catalog,sha256:sha,bytes:200}},
 dataRevision:'data-'+'c'.repeat(32)};
test('common project source runtime preserves verified country bytes and deferred geometry loading',async()=>{
 const events=[],world={documentId:'test-doc',format:'pandolab-project-state'};
 let generation=3,loaderCreated=0,loads=0,baselineId=0;
 const domain={
  getGeneration:()=>generation,
  state:()=>({storageBaselineId:baselineId}),
  admitStorageBaseline:async(bytes,options)=>{
   events.push(['admit',bytes.sourceMonth,options.expectedGeneration]);
   baselineId=9;return {storageBaselineId:baselineId};
  },
  prepareTemporalBuiltin:async(facts,setup,options)=>{
   events.push(['candidate',facts.sourceMonth,setup.initialMonth,options.expectedGeneration]);
   return {kind:'temporal-candidate',candidateId:13};
  },
  discardTemporalBuiltin:async candidate=>events.push(['discard',candidate.candidateId]),
 };
 const runtime=createProjectSourceRuntime({buildMeta:meta,
  getDependencies:()=>({domains:{projectDomain:domain},platformConfigurationA:{BASE_DATASET:'test-dataset'}}),
  createSourceLoader:()=>{loaderCreated++;return{
   loadProject:async month=>{loads++;events.push(['source',month]);return {project:{...world}};},
   loadGeometryResources:async ids=>{events.push(['geometry',ids]);return ['lazy-geometry'];},
  };},
 });
 const prepared=await runtime.prepareProjectSource('2026-11');
 assert.equal(prepared.kind,'stored-asset');assert.equal(prepared.sourceMonth,'2026-11');
 assert.match(prepared.fingerprint,/^[0-9a-f]{64}$/);
 assert.equal(prepared.compressedBytes,prepared.decodedBytes);
 const bytes=prepared.sourceBytes;bytes[0]^=1;
 assert.equal(JSON.parse(new TextDecoder().decode(prepared.sourceBytes)).documentId,'test-doc');
 assert.deepEqual(await runtime.loadGeometryResources(['part-a']),['lazy-geometry']);
 assert.equal(loaderCreated,1);
 assert.equal((await runtime.admitPreparedProjectSource(prepared)).baselineId,9);
 assert.equal((await runtime.prepareProjectBaseline('2026-11')).baselineId,9);
 assert.equal(loads,1,'same admitted month reuses C++ baseline');
 assert.equal((await runtime.prepareProjectCandidate('2026-11')).kind,'temporal-candidate');
 assert.equal(loaderCreated,1,'reuses verified source loader');
 generation++;
 await assert.rejects(runtime.admitPreparedProjectSource(prepared),{code:'PL-CORE-STALE'});
 runtime.dispose();
 await assert.rejects(runtime.loadGeometryResources([]),{code:'PL-CORE-STALE'});
 assert.deepEqual(events.filter(entry=>entry[0]==='candidate'),[['candidate','2026-11','2026-11',3]]);
});
