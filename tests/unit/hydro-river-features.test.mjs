import assert from 'node:assert/strict';
import test from 'node:test';
import {buildHydroRiverFeatures} from '../../tools/gis/hydro-river-features.mjs';

test('river feature assembly preserves split source IDs, stage fragments and terminal metadata',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const reach=(parts,borderPair,terminalClass='')=>({id:10,next:0,mainRiver:10,upstreamArea:100,flow:1,stage:3,
      borderPair,width:1,endWidth:2,renderSnap:null,terminalClass,originalEndpoint:[3,0],parts:[parts]}),chains=[[
      reach([[0,0],[1,0]],null),reach([[1,0],[2,0]],['AAA','BBB']),reach([[2,0],[3,0]],null,'sea')]];
    const result=await buildHydroRiverFeatures({chains,borders:[],neNames:{0:'Test River'},aliases:{},systemOverrides:{},
      independentDocument:{schemaVersion:1,replacements:[]},osmRows:[],fidStart:4,logicalFidStart:8},
    {connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.equal(result.nextFid,7);assert.equal(result.nextLogicalFid,9);assert.equal(result.features.length,3);
    assert.deepEqual(result.features.map(row=>[row.metadata.fid,row.metadata.logicalFid,row.metadata.sourceId,row.metadata.flags]),
      [[4,8,'10',0],[5,8,'10',1],[6,8,'10',0]]);
    assert.deepEqual(result.features.map(row=>row.geometry.coordinates),[[[0,0],[1,0]],[[1,0],[2,0]],[[2,0],[3,0]]]);
    assert.equal(result.features[0].metadata.name,'Test');assert.equal(result.features[1].metadata.source,'HydroRIVERS 1.0 · Natural Earth border AAA/BBB');
    assert.deepEqual(result.features[2].metadata.terminal,{class:'sea',sourceEndpoint:[3,0],renderEndpoint:[3,0]});
  });
