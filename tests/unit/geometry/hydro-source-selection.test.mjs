import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:assert/strict";
import * as __hydro_dep1 from "node:crypto";
import * as __hydro_dep3 from "node:test";
import * as __hydro_dep5 from "node:fs/promises";
import * as __hydro_dep6 from "node:path";
import * as __hydro_dep7 from "../../../tools/gis/hydro-source-selection.mjs";
import * as __hydro_dep8 from "../../../tools/gis/hydro-connectivity-native.mjs";
import * as __hydro_dep9 from "../../../tools/gis/hydro-source-reader.mjs";

contractSuite("hydro-source-selection", () => {
const assert = __hydro_dep0.default;
const { createHash } = __hydro_dep1;
const { readFile } = __hydro_dep5;
const { resolve } = __hydro_dep6;
const test = __hydro_dep3.default;
const { selectHydroSourceTopology } = __hydro_dep7;
const { buildHydroSelectedReaches, withHydroSourceSelection } = __hydro_dep8;
const { openHydroRiverShapeReader } = __hydro_dep9;

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
    try{await withHydroSourceSelection({files,specification:{datasetCode:'eu'},batchSize:3},async selection=>{
      const result=await selectHydroSourceTopology({selection,reader,references},{pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
        runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT}});
      assert.deepEqual(result.ids,[10,20,40,11,13,30,31,32]);
      assert.deepEqual(result.stats,{seedReachCount:2,continuityRootCount:1,namedContinuityRootCount:1,
        mediumMainstemRootCount:1,mediumMainstemReachCount:3,downstreamClosureReachCount:1});
      const reaches=await buildHydroSelectedReaches({selection,reader,selected:new Set(result.ids)},
        {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
      assert.deepEqual(reaches.map(row=>row.stage),[3,1,3,3,3,3,3,3]);
      const expected=[[1.945060181722841,2.1936998213239964],[2.1936998213239964,2.1936998213239964],
        [2.1936998213239964,2.1936998213239964],[.69,1.945060181722841],[.69,.69],[.69,.69],[.69,.69],[.69,.69]];
      for(let i=0;i<reaches.length;i++){assert.ok(Math.abs(reaches[i].width-expected[i][0])<1e-12);
        assert.ok(Math.abs(reaches[i].endWidth-expected[i][1])<1e-12);}
    },{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});}
    finally{await reader.close();}
  });
});
