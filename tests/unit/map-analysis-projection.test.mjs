import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateReferenceImage as calculate} from '../../plugins/pando-map-tools/lib/analysis/core.mjs';
import {selectReferenceImageGeoreference} from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';
import * as georef from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';

const fixture=JSON.parse(await readFile(new URL('../fixtures/reference-projections.json',import.meta.url),'utf8'));
for(const row of fixture.cases)test('C++ forward/inverse agrees with independent '+row.projection.kind+' vectors',()=>{
  const forward=calculate('projectionForward',{projection:row.projection,points:row.points});
  for(let i=0;i<row.points.length;i++){
    assert.ok(Math.hypot(...forward.coordinates[i].map((v,j)=>v-row.coordinates[i][j]))<=1);
  }
  const inverse=calculate('projectionInverse',{projection:row.projection,points:row.coordinates});
  for(let i=0;i<row.points.length;i++)assert.ok(inverse.coordinates[i].every((v,j)=>Math.abs(v-row.points[i][j])<=1e-5));
});
test('projection rejects unsupported and invalid domains instead of clamping',()=>{
  assert.throws(()=>calculate('projectionForward',{projection:{kind:'invented'},points:[[0,0]]}));
  assert.throws(()=>calculate('projectionForward',{projection:{kind:'laea',ellipsoid:'GRS80'},points:[[0,0]]}));
  assert.equal(calculate('projectionForward',{projection:{kind:'merc'},points:[[0,90]]}).coordinates[0],null);
  assert.equal(calculate('projectionForward',{projection:{kind:'aeqd',ellipsoid:'sphere'},points:[[180,0]]}).coordinates[0],null);
});
test('projected affine fit, full-source pixel validation and prepared mesh share projection',()=>{
  const projection={kind:'lcc',ellipsoid:'GRS80',lon0:-95,lat0:49,lat1:49,lat2:77};
  const images=Array.from({length:16},(_,i)=>[.1+(i%4)*.8/3,.1+Math.floor(i/4)*.8/3]);
  const plane=images.map(([u,v])=>[-2500000+5000000*u,4000000-4500000*v]);
  const coordinates=calculate('projectionInverse',{projection,points:plane}).coordinates;
  const points=images.map((image,i)=>({id:'point-'+i,image,coordinate:coordinates[i]}));
  const {warp,quality}=selectReferenceImageGeoreference(points,{width:1584,height:1224},{projection});
  assert.equal(warp.mode,'affine');assert.equal(warp.projection.kind,'lcc');
  assert.equal(quality.recommended,true);assert.ok(quality.crossValidationP95Pixels<.001);
  const mesh=calculate('mesh',{warp,columns:4,rows:4});
  assert.ok(mesh.vertices.every(v=>!v.coordinate||v.coordinate.every(Number.isFinite)));
});
test('valid controls cannot recommend an image whose outer pixels exceed projection domain',()=>{
  const projection={kind:'aeqd',ellipsoid:'sphere',radius:6371008.8};
  const images=Array.from({length:9},(_,i)=>[.25+(i%3)*.25,.25+Math.floor(i/3)*.25]);
  const plane=images.map(([u,v])=>[(u-.5)*8*projection.radius,(v-.5)*8*projection.radius]);
  const coordinates=calculate('projectionInverse',{projection,points:plane}).coordinates;
  const points=images.map((image,i)=>({id:'g'+i,image,coordinate:coordinates[i]}));
  const {quality}=selectReferenceImageGeoreference(points,{width:800,height:800},{mode:'affine',projection});
  assert.equal(quality.recommended,false);assert.equal(quality.invalidDomain,true);
});
test('robust consensus never counts repeated settlement or OCR identities as new controls',()=>{
  const images=[[.1,.1],[.9,.1],[.1,.9],[.9,.9],[.1,.1],[.9,.1]];
  const points=images.map((image,i)=>({id:'g'+i,detectionId:'d'+i,placeId:'p'+(i%4),image,coordinate:[10+image[0],40+image[1]],confidence:1}));
  assert.equal(calculate('autoGeoref',{points,mode:'affine',minimumInliers:6,maxTrials:64}).ok,false);
  const sameLabel=points.map((p,i)=>({...p,placeId:'p'+i,detectionId:'one-label'}));
  assert.equal(calculate('autoGeoref',{points:sameLabel,mode:'affine',minimumInliers:6,maxTrials:64}).ok,false);
});
test('unknown projection selection reserves distinct fit, selection and confirmation controls',()=>{
  const projection={kind:'lcc',ellipsoid:'GRS80',lon0:-95,lat0:49,lat1:49,lat2:77};
  const images=Array.from({length:18},(_,i)=>[.1+(i%6)*.16,.1+Math.floor(i/6)*.4]);
  const plane=images.map(([u,v])=>[-2500000+5000000*u,4000000-4500000*v]);
  const coordinates=calculate('projectionInverse',{projection,points:plane}).coordinates;
  const points=images.map((image,i)=>({id:'g'+i,image,coordinate:coordinates[i]}));
  const source={width:1584,height:1224},options={candidates:[{kind:'geographic'},projection]};
  assert.equal(georef.selectReferenceImageProjection(points.slice(0,17),source,options).ok,false);
  const selected=georef.selectReferenceImageProjection(points,source,options);
  assert.equal(selected.ok,true);assert.equal(selected.projection.kind,'lcc');
  const groups=Object.values(selected.validation.pointIds);assert.equal(new Set(groups.flat()).size,18);
  assert.ok(groups.every(v=>v.length===6));assert.ok(selected.validation.confirmationP95Pixels<.001);
});
