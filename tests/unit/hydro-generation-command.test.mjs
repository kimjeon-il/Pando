import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {executeHydroGeneration} from '../../tools/gis/build-hydro.mjs';
import {buildHydroGenerationManifest} from '../../tools/gis/hydro-generation-manifest.mjs';
import {generateHydroFromSources} from '../../tools/gis/hydro-generation-pipeline.mjs';
import {decodeHydroGeneratedPack} from '../../tools/gis/hydro-pack-decoder.mjs';

test('generation command writes verified new output and refuses replacement',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY||
    !process.env.PANDO_HYDRO_ENCODING_DIRECTORY||!process.env.PANDO_PHYSICAL_RASTER_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-command-'));t.after(()=>rm(root,{recursive:true}));
    const rivers=join(root,'sources'),earth=join(root,'data','hydro');await mkdir(rivers);await mkdir(earth,{recursive:true});
    for(const ext of ['shp','shx','dbf'])await copyFile(`tests/fixtures/hydro-selection-oracle.${ext}`,join(rivers,`HydroRIVERS_v10_eu.${ext}`));
    const rect=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]}),collection=features=>({type:'FeatureCollection',features});
    const countries=[{type:'Feature',id:'AAA',properties:{},geometry:rect(-2,-1,4,.5)},
      {type:'Feature',id:'BBB',properties:{},geometry:rect(3,.6,7,2)}],
      references=[{type:'Feature',properties:{name_en:'guide'},geometry:{type:'LineString',coordinates:[[-1,0],[4,0]]}}],
      lakes=[{type:'Feature',id:'lake',properties:{min_zoom:6,name_ko:'시험호'},geometry:rect(0,0,1,1)}];
    await writeFile(join(root,'data','countries-ne-5.1.1.geojson'),JSON.stringify(collection(countries)));
    await writeFile(join(earth,'rivers_base.geojson'),JSON.stringify(collection(references)));
    await writeFile(join(earth,'lakes_base.geojson'),JSON.stringify(collection(lakes)));
    await writeFile(join(earth,'hydronym-ko-overrides.json'),JSON.stringify({aliases:{},systems:{}}));
    const independent=join(root,'independent.json');await writeFile(independent,JSON.stringify({schemaVersion:1,replacements:[]}));
    const oracle=JSON.parse(await readFile('tests/fixtures/physical-raster-oracle.json','utf8')),
      raster=join(root,'mask.tif'),rgb=oracle.cases.find(row=>row.mode==='RGB');await writeFile(raster,Buffer.from(rgb.tiff,'base64'));
    const output=join(root,'output'),input={riverRoots:[rivers],naturalEarthRoot:earth,raster,output,independentPath:independent},
      options={codes:['eu'],pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
        connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},encoding:{directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY},
        physical:{directory:process.env.PANDO_PHYSICAL_RASTER_DIRECTORY}};
    const result=await executeHydroGeneration(input,options),manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
    assert.equal(manifest.stats.selectedReachCount,8);assert.equal(result.output,output);assert.ok(result.files.length>=4);
    await assert.rejects(executeHydroGeneration(input,options),/already exists/i);
  });

test('Hydro generation manifest combines only supplied source receipts and pack identities',()=>{
  const hash='a'.repeat(64),layout={index:{sha256:hash},metadata:{version:5},shards:[]},stats={featureCount:2},
    sourceRows=[{datasetCode:'eu',files:[],seedReachCount:2,selectedReachCount:3,continuityReachCount:1,
      terminalClassCounts:{sea:1},borderAlignedLengthKm:3.14,systemCount:1,nameMatches:1,osmMatches:0}],
    source={naturalEarthNameReference:[{file:'rivers_base.geojson',sha256:hash}],drainageFreeWaterMask:{file:'mask.tif',sha256:hash},
      naturalEarthLakes:{file:'lakes_base.geojson',sha256:hash,selected:1},osmWaterways:{file:null,matchedSystems:0,license:'ODbL'},
      hydronymOverrides:{file:'overrides.json',sha256:hash},independentHydronymReplacements:{file:'independent.json',sha256:hash,replacedSystems:0,geometryChanged:false}};
  const manifest=buildHydroGenerationManifest({layout,stats,sourceRows,source,namedSystems:1,unnamedSystems:0,osmMatches:0});
  assert.equal(manifest.schema,'pandolab-water-shards-v5');assert.equal(manifest.cache.name,'pandolab-water-v0.13.1-aaaaaaaaaaaa');
  assert.equal(manifest.stats.seedReachCount,2);assert.equal(manifest.stats.borderAlignedLengthKm,3.1);
  assert.deepEqual(manifest.stats.terminalClassCounts,{sea:1});assert.deepEqual(manifest.sources.hydroRivers,sourceRows);
});

test('selected Hydro source flows into verifiable private packs and a source manifest',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY||!process.env.PANDO_HYDRO_ENCODING_DIRECTORY},async()=>{
    const files={};for(const ext of ['shp','shx','dbf']){const path=resolve(`tests/fixtures/hydro-selection-oracle.${ext}`);
      files[ext]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
    const sourceFiles=Object.values(files).map(file=>({file:file.path.split(/[\\/]/).at(-1),sha256:file.sha256})),hash='a'.repeat(64),
      rect=(a,b,c,d)=>({type:'Polygon',coordinates:[[[a,b],[c,b],[c,d],[a,d],[a,b]]]}),
      countries=[{id:'AAA',geometry:rect(-2,-1,4,.5)},{id:'BBB',geometry:rect(3,.6,7,2)}],
      references=[{type:'Feature',properties:{name_en:'guide'},geometry:{type:'LineString',coordinates:[[-1,0],[4,0]]}}],
      lakes=[{id:'lake',properties:{min_zoom:6,name_ko:'시험호'},geometry:rect(0,0,1,1)}],
      source={naturalEarthNameReference:[{file:'rivers_base.geojson',sha256:hash}],drainageFreeWaterMask:{file:'mask.tif',sha256:hash},
        naturalEarthLakes:{file:'lakes_base.geojson',sha256:hash,selected:1},osmWaterways:{file:null,matchedSystems:0,license:'ODbL'},
        hydronymOverrides:{file:'overrides.json',sha256:hash},independentHydronymReplacements:{file:'independent.json',sha256:hash,replacedSystems:0,geometryChanged:false}};
    const options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},encoding:{directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY}};
    const result=await generateHydroFromSources({sources:[{files,specification:{datasetCode:'eu'},sourceFiles}],countries,references,lakes,
      sampleWater:async points=>points.map(()=>false),aliases:{},systemOverrides:{},independentDocument:{schemaVersion:1,replacements:[]},osmRows:[],source},options);
    assert.equal(result.manifest.stats.selectedReachCount,8);assert.equal(result.manifest.stats.riverSystemCount,2);
    const oracle=JSON.parse(await readFile('tests/fixtures/hydro-generation-oracle.json','utf8'));
    for(const [name,expected] of Object.entries(oracle.files)){const bytes=result.pack.files.get(name),comparable=Buffer.from(bytes);
      // zlib records the producer OS in byte 9; compare every other byte with the Windows oracle.
      if(name.endsWith('.gz'))comparable[9]=10;
      else if(name.startsWith('shards/')){const shard=Number(name.match(/s(\d+)\.bin$/)[1]);
        for(const pack of result.pack.layout.packs)if(pack.shard===shard)comparable[pack.offset+9]=10;}
      assert.equal(bytes.length,expected.bytes);assert.equal(createHash('sha256').update(comparable).digest('hex'),expected.sha256);}
    assert.deepEqual(result.manifest.stats,oracle.stats);
    const decoded=decodeHydroGeneratedPack({...result.pack,stages:result.manifest.stages,expectedStats:result.pack.stats});
    assert.equal(decoded.length,result.manifest.stats.featureCount);assert.equal(decoded.at(-1).metadata.name,'시험호');
    assert.deepEqual(result.manifest.sources.hydroRivers[0].files,sourceFiles);
  });
