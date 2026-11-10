import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createGpuTerrainPreparation } from '../../../src/rendering/gpu-terrain-preparation.js';
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

test('GPU preparation and Canvas plan admit identical tile lists at mixed levels and DPRs', t => {
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
  const owner=createGpuTerrainPreparation({tileUrl:spec=>`https://example.test/${spec.key}`,isMobile:()=>false,invalidate(){},geoDistance:runtime.d3.geo.distance});
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
    assert.equal(stats.terrainLevel,plan.demLevel.id);
    assert.deepEqual(gpuKeys,Array.from(plan.demSpecs,spec=>spec.key).sort());
    assert.equal(stats.terrainResolutionLimited,plan.resolutionLimited);
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
