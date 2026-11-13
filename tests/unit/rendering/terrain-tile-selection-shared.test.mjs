import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createGpuTerrainPreparation } from '../../../src/rendering/gpu-terrain-preparation.js';
import { fetchTerrainTile } from '../../../src/data/terrain-manifest.js';
import * as resourcePolicy from '../../../src/runtime/resource-dependency-policy.js';
const source = readFileSync(new URL('../../../src/rendering/workers/terrain-tile-selection-core.js', import.meta.url), 'utf8');
const scope = {};
vm.runInNewContext(source, { self: scope });
const tiles = scope.PandoLabTerrainTileSelection;

test('shared admission uses the same visible footprint limit, including explicit overflow', () => {
  const levels=[0,1,2,3].map(id=>({id,width:256*2**id}));
  const manifest={levels,gutter:1};
  const visible=level=>Array.from({length:[2,4,7,16][level.id]},(_,i)=>({key:`${level.id}/${i}`,pixelWidth:1024,pixelHeight:1024}));
  const fit=tiles.admitVisibleTiles(manifest,1600,visible);
  assert.equal(fit.level.id,2);
  assert.equal(fit.specs.length,7);
  assert.equal(fit.resolutionLimited,true);
  assert.ok(fit.bytes<=tiles.demVisiblePolicy.byteBudget);
  assert.equal(tiles.admitVisibleTiles(manifest,1600,visible,{...tiles.demVisiblePolicy,byteBudget:256*1024*1024}).level.id,3);
  assert.throws(()=>tiles.admitVisibleTiles(manifest,1600,visible,{...tiles.demVisiblePolicy,byteBudget:1}),/memory admission/);
});

test('GPU RGBA8 admission and Canvas 12-byte presentation admission retain independently valid LODs', t => {
  const runtime={URL,location:{href:'https://example.test/assets/js/workers/canvas-render-worker.js'},PandoLabResourceUpdatePolicy:resourcePolicy};
  runtime.self=runtime;
  vm.createContext(runtime);
  for(const path of ['../../../assets/js-vendor/d3.min.js','../../../src/rendering/workers/terrain-tile-selection-core.js'])
    vm.runInContext(readFileSync(new URL(path,import.meta.url),'utf8'),runtime);
  const core=readFileSync(new URL('../../../src/rendering/workers/canvas-render-core.js',import.meta.url),'utf8');
  vm.runInContext(core.replace('self.onmessage = event => {',`self.admissionForTest=(manifest,message,scale,width,height,dpr)=>{
    terrainDemManifest=manifest;return terrainRenderPlan(message,{scale:()=>scale},width,height,dpr);
  };self.onmessage = event => {`),runtime);
  runtime.PandoLabCanvasRenderer.install(runtime);
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))));
  const owner=createGpuTerrainPreparation({readTile:(spec,signal)=>fetchTerrainTile({url:`https://example.test/${spec.key}`},{signal}),isMobile:()=>false,invalidate(){},geoDistance:runtime.d3.geo.distance});
  t.after(()=>owner.dispose());
  owner.setContext({gl:{},ready:true,projectGeneration:1,contextGeneration:1,scheduler:{}});
  const manifest={gutter:1,levels:Array.from({length:6},(_,id)=>({id,width:1350*2**id,height:675*2**id,tileSize:1024,columns:Math.ceil(1350*2**id/1024),rows:Math.ceil(675*2**id/1024)}))};
  owner.setManifest(manifest);
  const observed=new Set();let limited=false;
  for(const [scale,width,height,dpr,sourceDpr,projection] of [[100,1280,720,1,1,'flat'],[350,2560,1440,2,3,'globe'],[1700,1280,720,1.5,2,'flat'],[6000,1280,720,2,3,'globe']]){
    const center=[127,37],rotation=[-127,-37,0];
    const frame={scale:scale*dpr,dpr,viewport:[width*dpr,height*dpr],viewState:{projection,projectionCenter:center,rotation}};
    owner.prepare(frame,{visible:true,projection,flatCenter:center,rotation,width,height,devicePixelRatio:sourceDpr,cacheBudgetBytes:128*1024*1024});
    const plan=runtime.admissionForTest(manifest,{projection,terrainDpr:sourceDpr,physicalSettings:{terrainVisible:true},view:{flatCenter:center,globeRotation:rotation}},scale,width,height,dpr);
    const stats=owner.stats(),gpuKeys=stats.terrainTargetKey.split(':').at(-1).split(',');
    // GPU and Canvas intentionally differ in byte footprint: RGBA8 GPU
    // texture = 4B/texel; Canvas conversion = three RGBA planes (12B).
    // Compare each backend's correct admission, not accidental LOD equality.
    assert.ok(stats.terrainLevel>=plan.demLevel.id);
    if(stats.terrainLevel===plan.demLevel.id)
      assert.deepEqual(gpuKeys,Array.from(plan.demSpecs,spec=>spec.key).sort());
    assert.equal(stats.terrainAdmissionBytesPerPixel,4);
    assert.ok(stats.terrainAdmissionBytes>0);
    assert.ok(stats.terrainAdmissionTotalBytes<=128*1024*1024);
    assert.ok(plan.demSpecs.length>0);
    observed.add(plan.demLevel.id);limited ||= plan.resolutionLimited;
  }
  assert.ok(observed.size>=3,'fixtures cross multiple source levels');
  assert.ok(limited,'fixtures include common memory admission downgrade');
});

test('both rendering backends share source-resolution LOD decisions', () => {
  const coarse = { id: 0, width: 256, height: 128, tileSize: 128, rows: 1, columns: 2 };
  const detailed = { id: 1, width: 1024, height: 512, tileSize: 256, rows: 2, columns: 4 };
  const manifest = { levels: [coarse, detailed] };
  assert.equal(tiles.chooseLevel(manifest, 200).level, coarse);
  assert.equal(tiles.chooseLevel(manifest, 400).level, detailed);
  assert.equal(tiles.chooseLevel(manifest, 1200).resolutionLimited, true);
  assert.equal(tiles.chooseLevel(null, 100).level, null);
});

test('shared ready draw selection retains numerical coverage until each target is ready', () => {
  const manifest={levels:[
    {id:0,width:256,height:128,tileSize:128,columns:2,rows:1},
    {id:1,width:512,height:256,tileSize:128,columns:4,rows:2},
  ]};
  const select=level=>tiles.visible(level,{includeAll:true,viewport:[256,128],scale:40});
  const base=select(manifest.levels[0]),target=select(manifest.levels[1]);
  const ready=new Set(base.map(spec=>spec.key));
  const draw=()=>tiles.readyDrawSpecs(manifest,manifest.levels[1],target,select,key=>ready.has(key));
  assert.deepEqual(Array.from(draw(),spec=>spec.key),Array.from(base,spec=>spec.key));
  ready.add(target[0].key);
  assert.deepEqual(Array.from(draw(),spec=>spec.key),[...base,target[0]].map(spec=>spec.key));
  for(const spec of target)ready.add(spec.key);
  assert.deepEqual(Array.from(draw(),spec=>spec.key),Array.from(target,spec=>spec.key));
  ready.delete(base[0].key);
  const zoomOut=tiles.readyDrawSpecs(manifest,manifest.levels[0],base,select,key=>ready.has(key));
  assert.ok(zoomOut.some(spec=>Number(spec.level)===1),'ready finer tiles cover missing coarse replacements');
  assert.equal(zoomOut.at(-1).key,base[1].key,'ready current targets paint after inherited coverage');
});

test('per-backend visibility cache reuses identical views and invalidates changes', () => {
  const level = { id: 2, width: 512, height: 256, tileSize: 256, rows: 1, columns: 2 };
  const cache = tiles.createVisibilityCache({ distance: () => 0, numericLevel: true });
  const query = { cameraKey: [100, 100, 50, 'flat', 0, 0, 0, 0],
    viewport: [100, 100], scale: 50, projection: 'flat',
    flatCenter: [0, 0], globeCenter: [0, 0] };
  const first = cache.select(level, query);
  assert.equal(cache.select(level, query), first);
  assert.equal(typeof first[0].level, 'number');
  assert.equal(cache.select(level, { ...query, includeAll: true }).length, 2);
  assert.notEqual(cache.select(level, { ...query, cameraKey: [100, 100, 60, 'flat', 0, 0, 0, 0] }), first);
  cache.clear();
  assert.notEqual(cache.select(level, query), first);
});

test('flat visible scan matches the exhaustive wrapped predicate with partial edge tiles', () => {
  const level = { id: 4, width: 1030, height: 515, tileSize: 128, rows: 5, columns: 9 };
  const reference = ({viewport, scale, flatCenter}) => {
    const keys = [];
    for (let row = 0; row < level.rows; row++) for (let column = 0; column < level.columns; column++) {
      const spec = tiles.tileSpec(level, column, row);
      const [west, north, east, south] = spec.bounds;
      const centerLon = (west + east) / 2, centerLat = (north + south) / 2;
      const lon = Math.abs((((centerLon - flatCenter[0]) + 540) % 360) - 180);
      if (lon <= viewport[0] / Math.max(1, scale) * 90 / Math.PI + (east - west) / 2 + 2
        && Math.abs(centerLat - flatCenter[1])
          <= viewport[1] / Math.max(1, scale) * 90 / Math.PI + (north - south) / 2 + 2)
        keys.push(spec.key);
    }
    return keys;
  };
  for (const flatCenter of [[0, 0], [179, 12], [-179, -35], [540, 0]]) {
    for (const scale of [20, 250, 2400]) {
      const input = { viewport: [400, 230], scale, flatCenter, projection: 'flat' };
      assert.deepEqual(Array.from(tiles.visible(level, input), row => row.key), reference(input));
    }
  }
  assert.equal(tiles.visible(level, { includeAll: true, viewport: [200, 100], scale: 1,
    projection: 'flat', flatCenter: [0, 0] }).length, 45);
});


test('spherical globe tile bounds admit the actual polar surface without wide-longitude overfetch', () => {
  const levels = Array.from({length:6},(_,id)=>({
    id,width:1350*2**id,height:675*2**id,tileSize:1024,
    columns:Math.ceil(1350*2**id/1024),rows:Math.ceil(675*2**id/1024),
  }));
  const manifest={levels,gutter:1};
  const scale=4994.08,viewport=[1100,712],center=[-44,76];
  const specs=level=>tiles.visible(level,{projection:'globe',globeCenter:center,viewport,scale});
  const polar=specs(levels[4]);
  assert.ok(polar.some(spec=>spec.key==='4/7-0'),'Greenland observed tile must be requested');
  assert.equal(polar.length,12,'pole-angle longitude overfetch must be removed');
  // A resident world overview remains present on the GPU, and up to two
  // optional natural tiles consume the same fixed 64 MiB RGBA8 budget.
  const base=levels[0],gutter=1,baseBytes=Array.from({length:base.rows},(_,r)=>
    Array.from({length:base.columns},(_,col)=>{
      const w=Math.min(1024,base.width-col*1024),h=Math.min(1024,base.height-r*1024);
      return (w+2*gutter)*(h+2*gutter)*4;
    }).reduce((a,b)=>a+b,0)).reduce((a,b)=>a+b,0);
  const naturalBytes=(1026*1026*4)*2;
  const policy=budget=>({byteBudget:budget,bytesPerPixel:4,
    reserveBytes:level=>level.id===0?0:baseBytes+(level.id===4?naturalBytes:0)});
  const desired=2*Math.PI*scale;
  const at64=tiles.admitVisibleTiles(manifest,desired,specs,policy(64*1024*1024));
  assert.equal(at64.level.id,4);
  assert.ok(at64.specs.some(spec=>spec.key==='4/7-0'));
  assert.ok(at64.totalBytes<=64*1024*1024);
  const canvas=tiles.admitVisibleTiles(manifest,desired,specs);
  assert.ok(canvas.level.id<4,'Canvas still uses 12-byte conversion footprint');
  for(const mib of [32,64,128]){
    const result=tiles.admitVisibleTiles(manifest,desired,specs,policy(mib*1024*1024));
    assert.ok(result.totalBytes<=mib*1024*1024);
    assert.ok(result.specs.length>0);
  }
});

test('spherical globe culling keeps every actually visible sampled tile near poles and dateline', () => {
  const level={id:4,width:21600,height:10800,tileSize:1024,columns:22,rows:11};
  const viewport=[1100,712],scale=4994.08;
  const radius=Math.asin(Math.min(1,Math.hypot(...viewport)*.5/scale));
  const rad=Math.PI/180;
  const distance=([lonA,latA],[lonB,latB])=>Math.acos(Math.max(-1,Math.min(1,
    Math.sin(latA*rad)*Math.sin(latB*rad)+Math.cos(latA*rad)*Math.cos(latB*rad)*Math.cos((lonA-lonB)*rad))));
  for(const center of [[-44,76],[0,0],[179,1],[-179,0],[89,88],[-95,-89]]){
    const chosen=new Set(tiles.visible(level,{projection:'globe',globeCenter:center,viewport,scale}).map(spec=>spec.key));
    for(let row=0;row<level.rows;row++)for(let col=0;col<level.columns;col++){
      const spec=tiles.tileSpec(level,col,row);
      const [west,north,east,south]=spec.bounds;
      for(let y=0;y<=5;y++)for(let x=0;x<=5;x++){
        const sample=[west+(east-west)*x/5,south+(north-south)*y/5];
        if(distance(center,sample)<=radius)
          assert.ok(chosen.has(spec.key),`missing visible sphere tile ${spec.key} at ${center}`);
      }
    }
  }
  const dateline=new Set(tiles.visible(level,{projection:'globe',globeCenter:[179,0],viewport,scale}).map(x=>x.column));
  assert.ok(dateline.has(0)&&dateline.has(21),'both sides of the dateline must remain visible');
});
