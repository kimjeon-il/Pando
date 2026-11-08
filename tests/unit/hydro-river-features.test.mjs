import "../../assets/js-vendor/polygon-clipping.min.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildHydroRiverFeatures} from '../../tools/gis/hydro-river-features.mjs';
import {buildHydroLakeFeatures} from '../../tools/gis/hydro-lake-features.mjs';
import {copyFile, mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {prepareHydroRiverSources} from '../../tools/gis/hydro-calibration-input.mjs';
import {createPhysicalWaterPresentation} from "../../src/data/physical-resources.js";
import {createGeometryVersionStore} from "../../src/geometry/geometry-version-store.js";
import {createHash} from 'node:crypto';
import {prepareHydroRegion} from '../../tools/gis/hydro-region-pipeline.mjs';
import {withHydroSourceSelection} from '../../tools/gis/hydro-connectivity-native.mjs';
import {openHydroRiverShapeReader} from '../../tools/gis/hydro-source-reader.mjs';
import {encodeHydroRepairPlan} from '../../tools/gis/hydro-encoding-native.mjs';
import {buildHydroPack} from '../../tools/gis/hydro-pack-layout.mjs';
import {decodeHydroGeneratedPack} from '../../tools/gis/hydro-pack-decoder.mjs';

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

test('Natural Earth lake features preserve names, stages and source identity',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},lakes=[
      {id:'lake-a',properties:{name_ko:'테스트 호수',min_zoom:6,source_id:'A'},geometry:polygon},
      {id:'lake-b',properties:{name_en:'Blue Lake',min_zoom:7},geometry:polygon},
      {id:'skip',properties:{},geometry:{type:'Point',coordinates:[0,0]}}];
    const result=await buildHydroLakeFeatures({lakes,aliases:{},fidStart:4,logicalFidStart:8},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.equal(result.nextFid,6);assert.equal(result.nextLogicalFid,10);assert.equal(result.features.length,2);
    assert.deepEqual(result.features.map(row=>[row.metadata.fid,row.metadata.logicalFid,row.metadata.name,row.metadata.stage,row.metadata.sourceId]),
      [[4,8,'테스트호수',0,'A'],[5,9,'Blue',2,'lake-b']]);
  });

test('river source discovery fingerprints requested original members and rejects duplicates',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-input-'));t.after(()=>rm(root,{recursive:true}));
  const source=join(root,'source');await mkdir(source);
  for(const ext of ['shp','shx','dbf'])await copyFile(`tests/fixtures/hydro-selection-oracle.${ext}`,join(source,`HydroRIVERS_v10_eu.${ext}`));
  await writeFile(join(source,'HydroRIVERS_v10_eu.prj'),'test projection');
  const result=await prepareHydroRiverSources({riverRoots:[root],codes:['eu']});
  assert.equal(result.length,1);assert.equal(result[0].specification.datasetCode,'eu');
  assert.deepEqual(result[0].sourceFiles.map(row=>row.file),['HydroRIVERS_v10_eu.shp','HydroRIVERS_v10_eu.shx',
    'HydroRIVERS_v10_eu.dbf','HydroRIVERS_v10_eu.prj']);
  assert.ok(result[0].sourceFiles.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));
  const duplicate=join(root,'duplicate');await mkdir(duplicate);
  await copyFile(join(source,'HydroRIVERS_v10_eu.shp'),join(duplicate,'HydroRIVERS_v10_eu.shp'));
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu']}),/exactly one/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu'],signal:controller.signal}),{name:'AbortError'});
});

const box=(x,y,size)=>({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]});
test('physical water follows the effective copied object geometry, reuses its mask and honors visibility',()=>{
 const source=box(2,2,2),land={type:'MultiPolygon',coordinates:[[box(0,0,10).coordinates[0],source.coordinates[0]]]};
 const owner=createPhysicalWaterPresentation();
 const context={geometry:land,revision:'land',water:source,waterRevision:'source',waterObjectRef:{domain:'hydroBuiltin',id:'sea'}};
 assert.equal(owner(context,null,true),context);
 assert.equal(owner(context,null,false).water,null);
 const store=createGeometryVersionStore([{id:'copy',version:1,geojson:box(3,2,2)}]);
 const copy={id:'copy',geometry:store.get({id:'copy',version:1})};
 const next=owner(context,copy,true);assert.equal(next.water,null,'the normal edited-water renderer owns the only copied fill');
 assert.equal(next,owner(context,{...copy},true));
 assert.deepEqual(globalThis.polygonClipping.xor(next.geometry.coordinates,globalThis.polygonClipping.difference([box(0,0,10).coordinates],copy.geometry.coordinates)),[]);
 assert.notEqual(next.revision,context.revision);
});

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
      const rivers=await buildHydroRiverFeatures({chains:result.chains,borders:result.borders,neNames:result.neNames,aliases:{},systemOverrides:{},
        independentDocument:{schemaVersion:1,replacements:[]},osmRows:[]},options);
      assert.equal(rivers.systemCount,2);assert.equal(rivers.namedSystems,1);assert.ok(rivers.features.some(row=>row.metadata.name==='guide'));
      const lake=await buildHydroLakeFeatures({lakes:[{id:'lake',properties:{min_zoom:6,name_ko:'시험호'},geometry:rect(0,0,1,1)}],aliases:{},
        fidStart:rivers.nextFid,logicalFidStart:rivers.nextLogicalFid},options.connectivity);
      if(process.env.PANDO_HYDRO_ENCODING_DIRECTORY){const features=[...rivers.features,...lake.features],ids=features.map(row=>row.metadata.fid),
        encoder={directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY},encoded=await encodeHydroRepairPlan({features,changedFeatureIds:ids,boundsPendingFor:ids},encoder),
        pack=await buildHydroPack({features,encoded,changedFeatureIds:ids},encoder),stages=[6,6.7,7,7.5].map((minZoom,id)=>({id,minZoom}));
        const decoded=decodeHydroGeneratedPack({...pack,stages,expectedStats:pack.stats});assert.equal(decoded.length,features.length);
        assert.deepEqual(decoded.map(row=>row.metadata.fid),ids);assert.equal(decoded.at(-1).metadata.name,'시험호');}
    },options.connectivity);}finally{await reader.close();}
  });
