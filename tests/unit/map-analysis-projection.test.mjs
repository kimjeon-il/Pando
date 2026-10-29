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

test('composed inverse returns source UVs through the same C++ projection and warp',()=>{
  const projection={kind:'lcc',ellipsoid:'GRS80',lon0:-95,lat0:49,lat1:49,lat2:77};
  const images=[[.1,.1],[.9,.1],[.1,.9],[.9,.9],[.5,.5],[.5,.1]];
  const coordinates=calculate('projectionInverse',{projection,points:images.map(([u,v])=>[-2500000+5000000*u,4000000-4500000*v])}).coordinates;
  const warp=calculate('warp',{projection,mode:'affine',points:images.map((image,i)=>({id:'inverse'+i,image,coordinate:coordinates[i]}))});
  const inverse=calculate('warpInverse',{warp,points:[...coordinates,[0,100]]});
  for(let i=0;i<images.length;i++)assert.ok(Math.hypot(...inverse.coordinates[i].map((v,j)=>v-images[i][j]))<1e-8);
  assert.equal(inverse.coordinates.at(-1),null);
  assert.throws(()=>calculate('warpInverse',{warp:{ok:false},points:[[0,0]]}),/warp|solved/i);
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

test('automatic projection discovery needs18 controls and never treats its provisional geographic seed as known',()=>{
  const source={width:1800,height:1200};
  const points=Array.from({length:18},(_,i)=>{const image=[.1+(i%6)*.16,.1+Math.floor(i/6)*.4];return {id:'auto'+i,image,coordinate:[-120+60*image[0],65-40*image[1]]};});
  assert.equal(georef.selectReferenceImageProjection(points.slice(0,6),source).reason,'projection-selection-requires18-distinct-controls');
  const result=georef.selectReferenceImageProjection(points,source);
  assert.ok(result.attemptedProjectionCount>3&&result.attemptedProjectionCount<=64);
  if(result.ok)assert.equal(new Set(Object.values(result.validation.pointIds).flat()).size,18);
  else assert.match(result.reason,/ambiguous|confirmation|stable/);
});

function projectedFixture() {
  const projection={kind:'lcc',ellipsoid:'GRS80',lon0:-95,lat0:49,lat1:49,lat2:77};
  const images=Array.from({length:18},(_,i)=>[.1+(i%6)*.16,.1+Math.floor(i/6)*.4]);
  const plane=images.map(([u,v])=>[-2500000+5000000*u,4000000-4500000*v]);
  const coordinates=calculate('projectionInverse',{projection,points:plane}).coordinates;
  return {projection,source:{width:1584,height:1224},points:images.map((image,i)=>({id:'reserved-'+i,image,coordinate:coordinates[i]}))};
}

test('typed projection exports nonempty boundary lines and closed faces as longitude latitude',()=>{
  const {projection,source,points}=projectedFixture();
  const warp=calculate('warp',{points,mode:'affine',projection});
  const pixels=[[317,245],[950,245],[950,734],[317,734],[317,245]];
  const graph={...source,chains:[{id:0,points:pixels.slice(0,2)}],faces:[{id:0,ring:pixels,holes:[]}]};
  const output=calculate('projectBoundaryGraph',{graph,warp});
  const expected=calculate('project',{warp,point:[pixels[0][0]/(source.width-1),pixels[0][1]/(source.height-1)]});
  assert.equal(output.lines[0].geometry.type,'LineString');
  assert.ok(output.lines[0].geometry.coordinates[0].every((v,i)=>Math.abs(v-expected[i])<1e-8));
  assert.equal(output.polygons[0].geometry.type,'Polygon');
  assert.ok(output.polygons[0].geometry.coordinates.flat().every(([lon,lat])=>Math.abs(lon)<=180&&Math.abs(lat)<=90));
});

test('quality does not count repeated image positions, settlements or detections as independent controls',()=>{
  const triangle=[[.1,.1],[.9,.1],[.1,.9]].map((image,i)=>({id:'triangle-'+i,image,coordinate:[30+10*image[0],20-10*image[1]]}));
  const repeated=[...triangle,...triangle.map(p=>({...p,id:p.id+'-copy'}))];
  assert.equal(georef.georeferenceQuality(repeated,'affine',{width:1000,height:1000}).recommended,false);
  const {projection,source,points}=projectedFixture();
  for(const field of ['detectionId','placeId']) {
    const observed=points.map((p,i)=>({...p,[field]:'observation-'+(i===1?0:i)}));
    const warp=calculate('warp',{points:observed,mode:'affine',projection});
    assert.equal(georef.georeferenceQuality(warp.controlPoints,'affine',source,projection).recommended,false);
  }
});

test('projection splitting rejects duplicate observations instead of leaking them across reserved groups',()=>{
  const {projection,source,points}=projectedFixture(),options={candidates:[{kind:'geographic'},projection]};
  const repeated=[...points,...points.slice(0,3).map(p=>({...p,id:p.id+'-copy'}))];
  assert.equal(georef.selectReferenceImageProjection(repeated,source,options).ok,false);
  for(const field of ['detectionId','placeId']) {
    assert.equal(georef.selectReferenceImageProjection(points.map((p,i)=>({...p,[field]:'same-'+(i===1?0:i)})),source,options).ok,false);
  }
});

test('engine unknown-projection entry reserves controls before attempting any geographic consensus',async()=>{
  const {locateReferenceImage}=await import('../../plugins/pando-map-tools/lib/engine.mjs');
  const {source,points}=projectedFixture();
  const result=locateReferenceImage(points,source);
  assert.ok(result.accepted,'A geographic consensus gate must not reject valid typed LCC controls');
  assert.equal(result.accepted.warp.projection.kind,'lcc');
  assert.equal(new Set(Object.values(result.accepted.quality.projectionValidation.pointIds).flat()).size,18);
});
