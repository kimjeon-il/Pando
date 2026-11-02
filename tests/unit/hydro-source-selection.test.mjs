import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {selectHydroSourceTopology} from '../../tools/gis/hydro-source-selection.mjs';
import {withHydroSourceSelection} from '../../tools/gis/hydro-connectivity-native.mjs';
import {openHydroRiverShapeReader} from '../../tools/gis/hydro-source-reader.mjs';

test('source topology follows named guidance, medium basins and downstream closure',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const row=(id,next,mainRiver,area,points)=>({id,next,mainRiver,order:1,flow:1,upstreamArea:area,parts:[points]});
    const rows=[row(10,20,1,500,[[1,0],[2,0]]),row(20,40,1,1000,[[2,0],[3,0]]),row(40,0,1,2000,[[3,0],[4,0]]),
      row(11,10,1,300,[[0,0],[1,0]]),row(12,10,1,800,[[1,1],[1,0]]),row(13,11,1,100,[[-1,0],[0,0]]),
      row(30,0,2,3000,[[6,1],[7,1]]),row(31,30,2,500,[[5,1],[6,1]]),row(32,31,2,100,[[4,1],[5,1]])];
    rows[0].order=4;rows[0].flow=100;rows[1].order=5;rows[1].flow=200;
    rows.forEach((row,index)=>{row.recordIndex=index;});
    const byId=new Map(rows.map(row=>[row.id,row]));
    const selection={roots:{seeds:[10,20],continuityRoots:[],namedCandidates:[10],mediumRoots:[30]},
      records:async ids=>ids.map(id=>byId.get(id)??null),candidates:async ids=>ids.map(id=>({id,current:byId.get(id)??null,
        candidates:rows.filter(row=>row.next===id).sort((a,b)=>a.upstreamArea-b.upstreamArea)}))};
    const reader={read:async requests=>requests.map(({id})=>({id,parts:byId.get(id).parts}))};
    const references=[{type:'Feature',properties:{name_en:'guide'},geometry:{type:'LineString',coordinates:[[-1,0],[4,0]]}}];
    const result=await selectHydroSourceTopology({selection,reader,references},
      {pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT}});
    // Frozen from the original read_selected_rivers with the same nine source shapes.
    assert.deepEqual(result.ids,[10,20,40,11,13,30,31,32]);
    assert.deepEqual(result.stats,{seedReachCount:2,continuityRootCount:1,namedContinuityRootCount:1,
      mediumMainstemRootCount:1,mediumMainstemReachCount:3,downstreamClosureReachCount:1});
  });
test('verified indexed source selection matches the original Python topology oracle',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const files={};for(const ext of ['shp','shx','dbf']){const path=resolve(`tests/fixtures/hydro-selection-oracle.${ext}`);
      files[ext]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
    const reader=await openHydroRiverShapeReader(files),references=[{type:'Feature',properties:{name_en:'guide'},
      geometry:{type:'LineString',coordinates:[[-1,0],[4,0]]}}];
    try{const result=await withHydroSourceSelection({files,specification:{datasetCode:'eu'},batchSize:3},
      selection=>selectHydroSourceTopology({selection,reader,references},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
        runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT}}),{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.deepEqual(result.ids,[10,20,40,11,13,30,31,32]);
    assert.deepEqual(result.stats,{seedReachCount:2,continuityRootCount:1,namedContinuityRootCount:1,
      mediumMainstemRootCount:1,mediumMainstemReachCount:3,downstreamClosureReachCount:1});}
    finally{await reader.close();}
  });
