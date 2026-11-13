import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as terrain from '../../../src/data/terrain-manifest.js';

const body=Buffer.from('verified natural surface fixture');
const digest=createHash('sha256').update(body).digest('hex');
const revision='a'.repeat(40);
const dem={gutter:1,crs:'EPSG:4326',extent:[-180,-90,180,90],registration:'cell-center',
  levels:[{id:0,width:1350,height:675,tileSize:1024,columns:2,rows:1}]};
const spec={level:0,column:0,row:0,pixelWidth:1024,pixelHeight:675};
function surface(){return {schema:'pando-natural-surface-v1',version:'0.1.0-preview.1',
  sourceRevision:revision,pathPrefix:'terrain/natural/v0.1.0-preview.1',
  crs:dem.crs,extent:dem.extent,registration:dem.registration,gutter:1,
  tileFormat:'lossless WebP RGBA',alpha:255,colorSpace:'sRGB',shadeIncluded:false,
  referenceDate:'2004-07',historicalReconstruction:false,status:'preview',mixWeight:0.65,
  sources:[{id:'bmng-base',url:'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/',
    sha256:'b'.repeat(64),observation:'2004-07',license:'NASA imagery usage guidelines'}],
  levels:dem.levels,tiles:{'0/0-0.webp':{bytes:body.length,sha256:digest,pixelWidth:1026,pixelHeight:677}}};}
function api(){
  assert.equal(typeof terrain.validateNaturalSurfaceManifest,'function','natural catalog validation is implemented');
  assert.equal(typeof terrain.terrainNaturalTileRequest,'function','natural tiles use the canonical terrain loader');
  return terrain;
}

test('natural catalog is optional, immutable, source-dated and aligned to the DEM grid',()=>{
  const {validateNaturalSurfaceManifest}=api();
  const input=surface(),valid=validateNaturalSurfaceManifest(input,dem);
  assert.equal(valid.sourceRevision,revision);
  assert.equal(valid.shadeIncluded,false);
  assert.equal(valid.historicalReconstruction,false);
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid.tiles));
  assert.ok(Object.isFrozen(valid.tiles['0/0-0.webp']));
  input.tiles['0/0-0.webp'].sha256='f'.repeat(64);
  assert.equal(valid.tiles['0/0-0.webp'].sha256,digest,'caller mutation cannot alter admitted identity');
});

test('natural requests use existing immutable raw-library paths and byte/hash verification',async()=>{
  const {validateNaturalSurfaceManifest,terrainNaturalTileRequest,fetchTerrainTile}=api();
  const manifest={...dem,naturalSurface:validateNaturalSurfaceManifest(surface(),dem)};
  const request=terrainNaturalTileRequest(spec,manifest);
  assert.equal(request.url.href,`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/terrain/natural/v0.1.0-preview.1/0/0-0.webp`);
  assert.equal(request.sha256,digest);assert.equal(request.bytes,body.length);
  const calls=[];
  const blob=await fetchTerrainTile(request,{fetchFn:async(url,options)=>{calls.push([url.href,options]);return new Response(body);}});
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),body);
  assert.equal(calls.length,1);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:async()=>new Response(Buffer.alloc(body.length))}),/해시/);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:async()=>new Response('short')}),/크기/);
});

test('monochrome, ocean, disabled terrain and uncovered tiles make no natural requests',()=>{
  const {terrainNaturalTileRequest}=api(),manifest={...dem,naturalSurface:surface()};
  for(const options of [{physicalStyle:'political'},{terrainVisible:false},{pass:'ocean'}])
    assert.equal(terrainNaturalTileRequest(spec,manifest,options),null);
  assert.equal(terrainNaturalTileRequest(spec,dem),null);
  assert.equal(terrainNaturalTileRequest({...spec,column:1,pixelWidth:326},manifest),null);
});

test('light and dark share one natural source request and key',()=>{
  const {terrainNaturalTileRequest}=api(),manifest={...dem,naturalSurface:surface()};
  const light=terrainNaturalTileRequest(spec,manifest,{theme:'light'});
  const dark=terrainNaturalTileRequest(spec,manifest,{theme:'dark'});
  assert.equal(light.url.href,dark.url.href);
  assert.equal(light.sha256,dark.sha256);
});

test('catalog rejects baked hillshade, grid drift, invalid alpha, hashes and mutable source refs',()=>{
  const {validateNaturalSurfaceManifest}=api();
  for(const patch of [{shadeIncluded:true},{sourceRevision:'main'},{alpha:0},{colorSpace:'linear'},
    {historicalReconstruction:true},{mixWeight:NaN},{pathPrefix:'../main'},{gutter:0}])
    assert.throws(()=>validateNaturalSurfaceManifest({...surface(),...patch},dem));
  const badGrid=surface();badGrid.levels=[{...dem.levels[0],width:2700,columns:3}];
  assert.throws(()=>validateNaturalSurfaceManifest(badGrid,dem));
  const wrongSize=surface();wrongSize.tiles['0/0-0.webp'].pixelWidth=1024;
  assert.throws(()=>validateNaturalSurfaceManifest(wrongSize,dem));
  const badHash=surface();badHash.tiles['0/0-0.webp'].sha256='broken';
  assert.throws(()=>validateNaturalSurfaceManifest(badHash,dem));
  const unsafe=surface();unsafe.tiles['0/../../other.webp']=unsafe.tiles['0/0-0.webp'];
  assert.throws(()=>validateNaturalSurfaceManifest(unsafe,dem));
});

test('bad coordinates are rejected without a network call',()=>{
  const {terrainNaturalTileRequest}=api(),manifest={...dem,naturalSurface:surface()};
  for(const patch of [{column:-1},{level:0.5},{row:NaN}])
    assert.throws(()=>terrainNaturalTileRequest({...spec,...patch},manifest));
});

test('optional surface feather uses actual GPU residency without changing the archived catalog',()=>{
  const {naturalSurfaceFadeEdges}=api();
  const world={...dem,levels:[{id:0,width:3072,height:675,tileSize:1024,columns:3,rows:1}]};
  const catalog={...surface(),levels:world.levels,tiles:{...surface().tiles,
    '0/1-0.webp':{bytes:body.length,sha256:digest,pixelWidth:1026,pixelHeight:677}}};
  const loaded={...world,naturalSurface:catalog};
  assert.deepEqual([...naturalSurfaceFadeEdges(spec,loaded)],[1,0,0,0],'declared neighbouring tile');
  assert.deepEqual([...naturalSurfaceFadeEdges(spec,loaded,()=>false)],[1,1,0,0],'not-yet-uploaded tile');
  assert.deepEqual([...naturalSurfaceFadeEdges(spec,loaded,key=>key==='0/1-0.webp')],[1,0,0,0]);
  assert.throws(()=>naturalSurfaceFadeEdges(spec,loaded,true),/residency/);
});

test('HTTP errors and aborts stay optional and never become zero-filled natural tiles',async()=>{
  const {fetchTerrainTile,terrainNaturalTileRequest}=api();
  const manifest={...dem,naturalSurface:surface()},request=terrainNaturalTileRequest(spec,manifest);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:async()=>new Response('unavailable',{status:503})}),/HTTP 503/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(fetchTerrainTile(request,{signal:controller.signal,
    fetchFn:async(_url,{signal})=>{if(signal.aborted)throw new DOMException('cancelled','AbortError');}}),/cancelled/);
});
