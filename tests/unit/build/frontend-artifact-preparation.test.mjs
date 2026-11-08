import assert from 'node:assert/strict';
import test from 'node:test';
import {artifactPreparationPrefixes} from '../../../scripts/lib/p2-artifact-graph.mjs';

test('artifact preparation follows selected owners and their dependencies without unrelated inputs',()=>{
 const graph=[
  {id:'source',dependencies:['wasm'],inputs:['assets/data/source/','reports/review/'],outputs:['assets/data/generated/source/']},
  {id:'viewer',dependencies:['source'],inputs:[{prefix:'assets/data/current/',pattern:'.json$'},'tools/build/owner.mjs'],outputs:['assets/data/viewer/index.json']},
  {id:'unrelated',dependencies:[],inputs:['assets/data/huge-original/'],outputs:[]},
 ];
 assert.deepEqual(artifactPreparationPrefixes(graph,['viewer']),['assets/data/current','assets/data/generated/source','assets/data/source','assets/data/viewer/index.json']);
 assert.throws(()=>artifactPreparationPrefixes(graph,['missing']),/unknown/i);
});
