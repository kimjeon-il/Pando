import test from 'node:test';
import assert from 'node:assert/strict';
import {NATURAL_SURFACE_PREVIEW_CATALOG,loadNaturalSurfaceCandidate} from '../../../src/data/terrain-natural-candidate.js';
const revision='c3d761ffc6d3cd54300e6fb491901551d8de3b54';
const levels=[{id:0,width:8,height:4,tileSize:8,columns:1,rows:1}];
const dem={crs:'EPSG:4326',extent:[-180,-90,180,90],registration:'cell-center',gutter:1,levels};
function catalog(){return {schema:'pando-natural-surface-v1',version:'0.1.0-preview.1',
  sourceRevision:revision,pathPrefix:'terrain/natural/v0.1.0-preview.1',
  crs:dem.crs,extent:[...dem.extent],registration:dem.registration,gutter:1,
  tileFormat:'lossless WebP RGBA',alpha:255,colorSpace:'sRGB',shadeIncluded:false,
  referenceDate:'2004-07',historicalReconstruction:false,status:'preview',mixWeight:0.65,
  levels,tiles:{'0/0-0.webp':{bytes:100,sha256:'a'.repeat(64),pixelWidth:10,pixelHeight:6}},
  sources:[{id:'bmng',url:'https://science.nasa.gov/earth/',observation:'2004-07',license:'NASA',sha256:'b'.repeat(64)}]};}
test('immutable external catalog opt-in validates source and same DEM grid',async()=>{
  const visited=[];
  const loaded=await loadNaturalSurfaceCandidate({dem,catalogUrl:NATURAL_SURFACE_PREVIEW_CATALOG,
    fetchFn:async(url)=>{visited.push(url.href);return new Response(JSON.stringify(catalog()),{status:200});}});
  assert.ok(Object.isFrozen(loaded));assert.equal(loaded.sourceRevision,revision);
  assert.deepEqual(visited,[NATURAL_SURFACE_PREVIEW_CATALOG]);
});
test('no preview URL means zero extra requests, preserving operational DEM',async()=>{
  let requests=0;
  const value=await loadNaturalSurfaceCandidate({dem,catalogUrl:null,fetchFn:()=>{requests++;throw Error('unexpected');}});
  assert.equal(value,null);assert.equal(requests,0);
});
test('unreviewed or floating URLs fail before download',async()=>{
  for(const url of ['https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/main/terrain/natural/candidates/x.json',
    'https://example.com/terrain/natural/candidates/x.json',
    NATURAL_SURFACE_PREVIEW_CATALOG+'?v=1']){
    let calls=0;
    await assert.rejects(loadNaturalSurfaceCandidate({dem,catalogUrl:url,fetchFn:()=>{calls++;return null;}}),/immutable/);
    assert.equal(calls,0);
  }
});
test('broken candidate cannot replace the already usable DEM',async()=>{
  await assert.rejects(loadNaturalSurfaceCandidate({dem,catalogUrl:NATURAL_SURFACE_PREVIEW_CATALOG,
    fetchFn:async()=>new Response(JSON.stringify({...catalog(),gutter:0}))}),/grid registration/);
  await assert.rejects(loadNaturalSurfaceCandidate({dem,catalogUrl:NATURAL_SURFACE_PREVIEW_CATALOG,
    fetchFn:async()=>new Response('',{status:503})}),/503/);
});
