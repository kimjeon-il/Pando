import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {executeHydroGeneration} from '../../tools/gis/build-hydro.mjs';

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
