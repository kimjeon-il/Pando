import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {prepareHydroRegion} from '../../tools/gis/hydro-region-pipeline.mjs';
import {withHydroSourceSelection} from '../../tools/gis/hydro-connectivity-native.mjs';
import {openHydroRiverShapeReader} from '../../tools/gis/hydro-source-reader.mjs';

test('regional Hydro pipeline preserves source selection, chains and reference names',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const files={};for(const ext of ['shp','shx','dbf']){const path=resolve(`tests/fixtures/hydro-selection-oracle.${ext}`);
      files[ext]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
    const reader=await openHydroRiverShapeReader(files),rect=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]});
    const countries=[{id:'AAA',geometry:rect(-2,-1,4,.5)},{id:'BBB',geometry:rect(3,.6,7,2)}],references=[{
      type:'Feature',properties:{name_en:'guide'},geometry:{type:'LineString',coordinates:[[-1,0],[4,0]]}}],
      options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
        connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}};
    try{await withHydroSourceSelection({files,specification:{datasetCode:'eu'}},async selection=>{
      const result=await prepareHydroRegion({selection,reader,references,countries,lakes:[],sampleWater:async points=>points.map(()=>false),region:'eu'},options);
      assert.deepEqual(result.bounds,[-1,0,7,1]);assert.deepEqual(result.chains.map(chain=>chain.map(row=>row.id)),[[32,31,30],[13,11,10,20,40]]);
      assert.deepEqual(result.neNames,{1:'guide'});assert.equal(result.stats.selectedReachCount,8);
      assert.equal(result.stats.continuityReachCount,6);assert.equal(result.stats.downstreamClosureReachCount,1);
      assert.deepEqual(result.stats.terminalClassCounts,{sea:2});assert.equal(result.junctionReport.remaining.length,0);
    },options.connectivity);}finally{await reader.close();}
  });
