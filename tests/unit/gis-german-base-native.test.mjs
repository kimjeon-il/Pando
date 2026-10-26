import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const bin=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const square=(x0,y0,x1,y1)=>[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]];
const polygon=(a,b,c,d)=>({type:'Polygon',coordinates:square(a,b,c,d)});
const collection=polygons=>({type:'FeatureCollection',features:polygons.map((geometry,i)=>({
 type:'Feature',id:i===0?'DEU':'other-'+i,properties:{},geometry,
}))});
function execute(t,sources,ops){
 assert.ok(bin&&existsSync(bin),'Native GEOS recipe binary must be set and built');
 const dir=mkdtempSync(join(tmpdir(),'gis-c1-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'sources'));
 const config={sources:{},operations:ops};
 for(const [id,document] of Object.entries(sources)){
   config.sources[id]={path:'sources/'+id+'.json',crs:'EPSG:4326'};
   writeFileSync(join(dir,'sources',id+'.json'),JSON.stringify(document));
 }
 const spec=join(dir,'sample.recipe.json');
 writeFileSync(spec,JSON.stringify(config));
 const result=spawnSync(bin,[dir,spec],{encoding:'utf8',cwd:dir,maxBuffer:1024*1024});
 return {result,geometry:result.status===0?JSON.parse(result.stdout):null};
}
const linear={longitude:{intercept:-0.0268725,slope:0.0011841},
 latitude:{intercept:-0.1088705,slope:0.0024464}};
test('native affine axis correction matches original HGIS longitude and distinct latitude coefficients',t=>{
 const {result,geometry}=execute(t,{hgis:collection([polygon(10,50,10.1,50.1)])},[
  {id:'hgis-original',operation:'union',source:'hgis'},
  {id:'hgis-corrected',operation:'axis-linear-correction',input:'hgis-original',...linear},
 ]);
 assert.equal(result.status,0,result.stderr);
 assert.equal(geometry.type,'MultiPolygon');
 assert.ok(geometry.coordinates.flat(2).some(([x,y])=>
   Math.abs(x-9.9849685)<1e-10&&Math.abs(y-50.0134495)<1e-10));
});
test('native Heligoland selector preserves exactly two whole islands and their mandatory anchors',t=>{
 const islands={type:'MultiPolygon',coordinates:[
  square(7.88,54.18,7.90,54.2),
  square(7.915,54.185,7.93,54.2),
  square(8.5,54.5,8.6,54.6),
 ]};
 const inputs={canonical:collection([islands])};
 const ops=[
  {id:'modern-DEU',operation:'union',source:'canonical'},
  {id:'selected',operation:'select-components-in-bbox',input:'modern-DEU',
   bbox:[7.85,54.16,7.95,54.21],expectedComponents:2,
   insidePoints:{Heligoland:[7.893,54.19],Dune:[7.918,54.188]}},
 ];
 const {result,geometry}=execute(t,inputs,ops);
 assert.equal(result.status,0,result.stderr);
 assert.equal(geometry.coordinates.length,2);
 const wrong=structuredClone(ops);wrong[1].expectedComponents=3;
 const rejected=execute(t,inputs,wrong);
 assert.notEqual(rejected.result.status,0);
 assert.match(rejected.result.stderr,/component count differs/);
});
test('historical rectangular cleanup removes only the source window before island reinsertion',t=>{
 const inputs={hgis:collection([polygon(7.7,54.0,8.2,54.4)]),
  canonical:collection([{type:'MultiPolygon',coordinates:[
   square(7.88,54.18,7.90,54.2),square(7.915,54.185,7.93,54.2),
   square(8.5,54.5,8.6,54.6),
  ]}])};
 const ops=[
  {id:'base',operation:'union',source:'hgis'},
  {id:'modern',operation:'union',source:'canonical'},
  {id:'patch',operation:'select-components-in-bbox',input:'modern',
    bbox:[7.85,54.16,7.95,54.21],expectedComponents:2},
  {id:'window',operation:'bbox',bbox:[7.8,54.12,8.0,54.25]},
  {id:'mainland',operation:'difference',inputs:['base','window']},
  {id:'reconstruction',operation:'union',inputs:['mainland','patch']},
 ];
 const {result,geometry}=execute(t,inputs,ops);
 assert.equal(result.status,0,result.stderr);
 assert.equal(geometry.type,'MultiPolygon');
 assert.ok(geometry.coordinates.length>=2);
 const bad=structuredClone(ops);bad[3].bbox=[8,54.12,7.8,54.25];
 assert.match(execute(t,inputs,bad).result.stderr,/Invalid historical bbox/);
});
test('German 1914 production recipe uses the common engine but retains an explicit unverified gate',()=>{
 const recipe=JSON.parse(readFileSync(new URL('../../tools/historical-library/german-empire-1914-base.recipe.json',import.meta.url)));
 assert.equal(recipe.nativeStatus,'pending-actual-hgis-source-hash-and-geometry-oracle');
 assert.deepEqual(recipe.operations.map(op=>op.operation),[
   'union','axis-linear-correction','union','select-components-in-bbox','bbox','difference','union']);
 assert.deepEqual(recipe.operations[1].latitude,recipe.linearCorrection.latitude);
 assert.equal(recipe.operations[3].expectedComponents,2);
 assert.equal(recipe.referenceDate,'1914-07-31');
});

test('historical recipe enforces GEOS inclusion/exclusion anchors and PROJ metric area',t=>{
 const input={provinces:collection([polygon(10,50,11,51)])};
 const valid=[
   {id:'source',operation:'union',source:'provinces'}
 ];
 const rootDir=mkdtempSync(join(tmpdir(),'gis-policy-'));
 t.after(()=>rmSync(rootDir,{recursive:true,force:true}));
 mkdirSync(join(rootDir,'sources'));
 writeFileSync(join(rootDir,'sources/provinces.json'),JSON.stringify(input.provinces));
 const spec={sources:{provinces:{path:'sources/provinces.json',crs:'EPSG:4326'}},
   operations:valid,
   validation:{areaKm2:{minimum:5000,maximum:25000},
     insidePoints:{inside:[10.5,50.5]},outsidePoints:{outside:[12,50.5]},
     maximumCoordinates:100}};
 const invoke=value=>{
   const path=join(rootDir,'spec.json');
   writeFileSync(path,JSON.stringify(value));
   return spawnSync(bin,[rootDir,path],{encoding:'utf8',cwd:rootDir});
 };
 assert.equal(invoke(spec).status,0,'Valid historical anchor and area policy should pass');
 for(const [mutation,error] of [
   [x=>x.validation.areaKm2.maximum=1,/projected area/],
   [x=>x.validation.insidePoints.inside=[12,50.5],/anchor mismatch: inside/],
   [x=>x.validation.outsidePoints.outside=[10.5,50.5],/anchor mismatch: outside/],
   [x=>x.validation.maximumCoordinates=4,/coordinate budget/]
 ]){
   const copy=structuredClone(spec);mutation(copy);
   const bad=invoke(copy);
   assert.notEqual(bad.status,0,error.source);
   assert.match(bad.stderr,error);
 }
});

test('native historical HGIS axis-correct-tree modifies XY but retains any extra ordinates',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hgis-axis-tree-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const original={
  coordinates:[[[10,50,123],[10.1,50.1,456]]],
  longitude:linear.longitude,latitude:linear.latitude,
 };
 const path=join(dir,'coords.json'),bytes=JSON.stringify(original);
 writeFileSync(path,bytes);
 const result=spawnSync(bin,['--axis-correct-tree',path],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const converted=JSON.parse(result.stdout);
 assert.equal(converted[0][0][2],123);
 assert.equal(converted[0][1][2],456);
 assert.ok(Math.abs(converted[0][0][0]-9.9849685)<1e-10);
 assert.ok(Math.abs(converted[0][0][1]-50.0134495)<1e-10);
 assert.equal(readFileSync(path,'utf8'),bytes,'input evidence must not be modified');
});
test('native historical coordinate-tree conversion fails closed on invalid coordinates',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hgis-axis-invalid-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'coords.json');
 writeFileSync(path,JSON.stringify({coordinates:[181,50],
   longitude:linear.longitude,latitude:linear.latitude}));
 const p=spawnSync(bin,['--axis-correct-tree',path],{encoding:'utf8'});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/geographic coordinate invalid/);
});
