import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeViewerWorldData} from '../world-data-plan.mjs';

const world=()=>({schema:'pandolab-world-bundle',schemaVersion:1,
  source:{countryCount:258,sha256:'a'.repeat(64)},
  defaultClassification:{countries:{AAA:'source'},units:{},removedIds:Array.from({length:257},(_,i)=>`removed-${i}`)}});

test('Windows review summarizes the selected Viewer data instead of the source library',()=>{
  const paths=['assets/data/world/current.json','assets/data/builtin-world/generated/v1/index.json',
    'assets/data/prepared-polygons/generated/v2/manifest.json','assets/data/hydro/v0.13.4/manifest.json'];
  const summary=summarizeViewerWorldData({world:world(),paths,bytes:42,dataRevision:'data-fixture'});
  assert.equal(summary.fileCount,4);assert.equal(summary.worldFileCount,3);
  assert.equal(summary.physicalFileCount,1);assert.equal(summary.bytes,42);
  assert.equal(summary.countryCount,258);assert.equal(summary.modelEntityCount,1);
});

test('Windows review rejects malformed Viewer world summaries',()=>{
  const input={world:world(),paths:['assets/data/world/current.json']};
  assert.throws(()=>summarizeViewerWorldData({...input,paths:['../source-library.json']}),/Invalid Viewer world data/);
  assert.throws(()=>summarizeViewerWorldData({...input,paths:[input.paths[0],input.paths[0]]}),/Invalid Viewer world data/);
  input.world.defaultClassification.removedIds=[];
  assert.throws(()=>summarizeViewerWorldData(input),/classification/);
});
