import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {generateHydroFromSources} from '../../tools/gis/hydro-generation-pipeline.mjs';
import {decodeHydroGeneratedPack} from '../../tools/gis/hydro-pack-decoder.mjs';

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
