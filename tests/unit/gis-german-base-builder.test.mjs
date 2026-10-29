import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildGerman1914} from '../../tools/gis/build-german-1914-base.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const ring=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pando-german-builder-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'input'));
  const features=Array.from({length:26},(_,i)=>({type:'Feature',properties:{STAAT_NAME:'Synthetic '+i},geometry:{type:'Polygon',coordinates:[ring(10+i*.2,50,10.1+i*.2,50.1)]}}));
  const hgis={type:'FeatureCollection',features};
  const country={type:'FeatureCollection',features:[{type:'Feature',id:'DEU',properties:{},geometry:{type:'MultiPolygon',coordinates:[
    [ring(7.88,54.18,7.90,54.2)],[ring(7.915,54.185,7.93,54.2)],[ring(8.5,54.5,8.6,54.6)]
  ]}}]};
  const source=JSON.stringify(country);writeFileSync(join(root,'input/hgis.json'),JSON.stringify(hgis));writeFileSync(join(root,'input/country.json'),source);
  const lon={intercept:-0.0268725,slope:0.0011841},lat={intercept:-0.1088705,slope:0.0024464};
  const patch={selectionBbox:[7.85,54.16,7.95,54.21],cleanupBbox:[7.8,54.12,8,54.25],expectedComponents:2,insidePoints:{Heligoland:[7.893,54.19],Dune:[7.918,54.188]}};
  const recipe={id:'synthetic-german',referenceDate:'1914-07-31',roundingDigits:7,output:'output/base.json',diagnosticsOutput:'output/base.diagnostics.json',
    sources:{hgisStates:{path:'input/hgis.json',crs:'EPSG:4326',expectedFeatureCount:26,expectedBounds:[10,50,15.1,50.1],boundsToleranceDegrees:.0001},
      canonicalCountries:{path:'input/country.json',crs:'EPSG:4326',sha256:createHash('sha256').update(source).digest('hex').toUpperCase()}},
    linearCorrection:{source:'synthetic',upstreamCommit:'synthetic',longitude:lon,latitude:lat},heligolandPatch:patch,
    validation:{areaMethod:'wgs84-geodesic',areaKm2:{minimum:1,maximum:10000},maximumHeligolandPatchDifferenceKm2:.001,insidePoints:{in:[10.03,50.06]},outsidePoints:{out:[9,49]}},
    operations:[{id:'hgis-state-union',operation:'union',source:'hgisStates'},
      {id:'hgis-axis-corrected',operation:'axis-linear-correction',input:'hgis-state-union',longitude:lon,latitude:lat},
      {id:'modern-deu',operation:'union',source:'canonicalCountries',selector:{field:'__feature_id__',values:['DEU']}},
      {id:'heligoland-components',operation:'select-components-in-bbox',input:'modern-deu',bbox:patch.selectionBbox,expectedComponents:2,insidePoints:patch.insidePoints},
      {id:'heligoland-window',operation:'bbox',bbox:patch.cleanupBbox},
      {id:'without-heligoland-window',operation:'difference',inputs:['hgis-axis-corrected','heligoland-window']},
      {id:'german-1914-candidate',operation:'union',inputs:['without-heligoland-window','heligoland-components']}]};
  return {root,recipe,binary};
}
test('German builder produces a protected working derivative and reproducible check',t=>{
  assert(binary,'PANDO_TERRITORIAL_RECIPE_BINARY required');const f=fixture(t);
  const receipt=buildGerman1914(f);assert.equal(receipt.output.componentCount,28);assert.equal(receipt.heligolandPatch.componentCount,2);
  assert.equal(receipt.output.heligolandPatchDifferenceKm2,0);assert(receipt.output.areaKm2>2000&&receipt.output.areaKm2<10000);
  const output=JSON.parse(readFileSync(join(f.root,f.recipe.output),'utf8'));
  assert.equal(output.features[0].properties.status,'working-base-not-final');assert.equal(output.features[0].geometry.type,'MultiPolygon');
  if(process.env.PANDO_GERMAN_ORACLE_PYTHON){
    const script=[
      'import importlib.util,json,pathlib,sys',
      'spec=importlib.util.spec_from_file_location("original",sys.argv[1])',
      'original=importlib.util.module_from_spec(spec); spec.loader.exec_module(original)',
      'original.ROOT=pathlib.Path(sys.argv[2]); recipe=json.load(sys.stdin)',
      'geometry,diagnostics=original.build(recipe)',
      'print(json.dumps({"geometry":original.output_collection(geometry,recipe)["features"][0]["geometry"],"diagnostics":diagnostics}))',
    ].join('\n');
    const python=spawnSync(process.env.PANDO_GERMAN_ORACLE_PYTHON,['-c',script,fileURLToPath(new URL('../../tools/build_german_empire_1914_base.py',import.meta.url)),f.root],{input:JSON.stringify(f.recipe),encoding:'utf8'});
    assert.equal(python.status,0,python.stderr);const oracle=JSON.parse(python.stdout);
    for(const field of ['areaKm2','componentCount','coordinateCount','heligolandPatchDifferenceKm2'])assert(Math.abs(receipt.output[field]-oracle.diagnostics.output[field])<.000002,field);
    assert.deepEqual(receipt.output.bounds,oracle.diagnostics.output.bounds);
    const request=join(f.root,'geometry-comparison.json');writeFileSync(request,JSON.stringify({approved:oracle.geometry,published:output.features[0].geometry}));
    const compared=spawnSync(binary,['--compare-historical-geometry',request],{encoding:'utf8'});
    assert.equal(compared.status,0,compared.stderr);assert.equal(JSON.parse(compared.stdout).passed,true,'original and native rounded geometry must be topologically identical');
  }
  assert.deepEqual(buildGerman1914({...f,check:true}),receipt);
  assert.throws(()=>buildGerman1914(f),/exists/i,'existing derivative must be preserved');
});
test('German builder rejects altered sources and historical anchor changes before publishing output',t=>{
  const f=fixture(t);const bad=structuredClone(f.recipe);bad.sources.canonicalCountries.sha256='0'.repeat(64);
  assert.throws(()=>buildGerman1914({...f,recipe:bad}),/sha/i);
  const anchor=structuredClone(f.recipe);anchor.validation.insidePoints.in=[0,0];
  assert.throws(()=>buildGerman1914({...f,recipe:anchor}),/anchor/i);
});
