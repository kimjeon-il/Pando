import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as resourcePolicy from "../../../src/rendering/resource-update-policy.js";
import {canvasWorkerFrameMatchesPhysical} from "../../../src/rendering/country-mesh-zoom-policy.js";
import {createCanvasScenePackets} from "../../../src/rendering/gpu-canvas-scene-packets.js";
import {terrainTileRequest, fetchTerrainTile} from "../../../src/data/terrain-manifest.js";

const workerSource = readFileSync(new URL("../../../src/rendering/workers/canvas-render-core.js", import.meta.url), 'utf8');
const terrainCoreSource = readFileSync(new URL("../../../src/rendering/workers/canvas-terrain-dem-core.js", import.meta.url), 'utf8');
const terrainTileSource = readFileSync(new URL("../../../src/rendering/workers/terrain-tile-selection-core.js", import.meta.url), 'utf8');
const manifest = { gutter: 1, urlTemplate: 'terrain/v0.12.6/{level}/{column}-{row}.webp', levels: [
  { id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 },
  { id: 1, width: 2700, height: 1350, columns: 3, rows: 2, tileSize: 1024 },
  { id: 2, width: 5400, height: 2700, columns: 6, rows: 3, tileSize: 1024 },
] };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

test('Canvas chooses software backing only when hardware acceleration is unavailable', () => {
  const source=workerSource.replaceAll('\r\n','\n');
  const start=source.indexOf('    function preferSoftwareCanvas() {');
  const end=source.indexOf('\n    function createCanvasPath(',start);
  assert.ok(start>=0&&end>start);
  const evaluate=new Function('OffscreenCanvas',source.slice(start,end)+'\nreturn preferSoftwareCanvas();');
  const probe=renderer=>class {getContext(){return {getExtension(name){
    if(name==='WEBGL_debug_renderer_info')return {UNMASKED_RENDERER_WEBGL:1};
    if(name==='WEBGL_lose_context')return {loseContext(){}};
    return null;
  },getParameter(){return renderer;}};}};
  assert.equal(evaluate(probe('ANGLE (NVIDIA, GeForce GTX 1650, Direct3D11)')),false);
  assert.equal(evaluate(probe('ANGLE (Google, Vulkan SwiftShader)')),true);
  assert.equal(evaluate(probe('llvmpipe')),true);
  assert.equal(evaluate(class {getContext(){return null;}}),true);
  assert.equal(evaluate(class {getContext(){throw Error('unavailable');}}),true);
});

function canvasTerrainRuntime({ expectDem = false, timerPorts = null, now = () => 1 } = {}) {
  const messages = [], requests = [], drawn = [], paths = [], substrates = [], triangleCopies = [];
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; this.ctx = null; }
    getContext() {
      if (!this.ctx) {
        const canvas = this;
        this.ctx = {
          canvas, setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
          moveTo() {}, lineTo() {}, arc() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
          drawImage(...args) {
            // Count both existing image draws and real numerical scratch pixels.
            if (args.length === 9 || (args.length===3 && args[0]?.ctx?.numericPixels>0)) drawn.push(args);
            if (args[0]?.probeTriangle) triangleCopies.push(args);
          },
          getImageData() { return { width:canvas.width,height:canvas.height,data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
          putImageData(image) {
            this.numericPixels=0;
            for(let i=3;i<image.data.length;i+=4)if(image.data[i])this.numericPixels++;
          },
        };
      }
      return this.ctx;
    }
    transferToImageBitmap() { return { bitmap: true, width: this.width, height: this.height, close() {} }; }
  }
  function projection() {
    let scale = 350, translate = [500, 300], center = [0, 0];
    const project = point => [translate[0] + point[0] * scale * Math.PI / 180,
      translate[1] - point[1] * scale * Math.PI / 180];
    project.scale = function(value) { if (!arguments.length) return scale; scale = value; return project; };
    project.translate = function(value) { if (!arguments.length) return translate; translate = value; return project; };
    project.center = function(value) { if (!arguments.length) return center; center = value; return project; };
    for (const [field,initial] of Object.entries({rotate:[0,0,0],precision:.1,clipExtent:null,clipAngle:90})) {
      let current=initial;
      project[field]=function(value){if(!arguments.length)return current;current=value;return project;};
    }
    return project;
  }
  const scope = {
    location: { href: 'https://example.test/assets/js/workers/canvas-render-worker.js' },
    d3: { geo: { equirectangular: projection, orthographic: projection, distance: () => 0,
      path: () => {
        const path = geometry => { paths.push(geometry); return path; };
        path.projection = () => path; path.context = () => path; return path;
      } } },
    PandoLabCanvasSceneComposition: {
      drawGeneralLand(_ctx, _path, polygons) { substrates.push(polygons.filter(packet => packet.role === 'physical-land').map(packet => packet.geometry)); },
      drawTerritorialFills(_ctx,_path,packets,substrate,_dpr,presentation) {
        if (presentation?.quality !== 'pending' && packets.some(packet => packet.role === 'territorial-fill'))
          assert.ok(substrate?.width > 0 && substrate?.height > 0,
            'territorial clipping requires a physical background even before optional DEM');
      }, drawOverlays() {}, drawEmphasis() {}, drawPhysicalWater() {},
      countryBoundaryBatches: () => [], drawStrokes() {}, geometryFor: packet => packet.geometry,
      generalLandShapes: packets => packets.filter(packet => packet.role === 'physical-land').map(packet => packet.geometry),
    },
    postMessage(message) { messages.push(message); },
  };
  const fetch = (url, options = {}) => url.endsWith('manifest.json')
    ? Promise.resolve({ ok: true, json: async () => manifest })
    : new Promise((resolve, reject) => {
      const request = { url, resolve, completed: false };
      requests.push(request);
      options.signal?.addEventListener('abort', () => {
        request.completed = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  new Function('self', terrainCoreSource)(scope);
  new Function('self', terrainTileSource)(scope);
  scope.PandoLabResourceUpdatePolicy = resourcePolicy;
  scope.OffscreenCanvas=Canvas;
  scope.terrainTileRequest=terrainTileRequest;
  scope.fetchTerrainTile=(request, options) => fetchTerrainTile(request, {...options,fetchFn:(url, init)=>fetch(String(url),init)});
  new Function('self', 'globalThis', 'fetch', 'createImageBitmap',
    'ImageData', 'performance', workerSource.replace('    function dispose() {',
      `self.drawTerrainTriangle = drawTexturedTriangle;
      self.traceTerrainGrid = (spec, projection, message) => {
        const oldDraw = drawTexturedTriangle, oldManifest = terrainDemManifest, triangles = [];
        terrainDemManifest = { gutter: 0 };
        drawTexturedTriangle = (_image, source, destination) => triangles.push({ source, destination });
        try { for (const _ of drawGlobeTerrainTile(spec, {}, projection, message, 1, false)) {} return triangles; }
        finally { drawTexturedTriangle = oldDraw; terrainDemManifest = oldManifest; }
      };
      self.currentRenderState = () => lastRenderMessage;
      self.numericCacheForTest = () => [...demTiles.entries()].map(([key,tile])=>({
        key,bytes:tile.bytes,rawBytes:tile.raw?.byteLength||0,
        eagerLand:!!tile.land,eagerOcean:!!tile.ocean,eagerPolitical:!!tile.political,
      }));
      self.stageDemForTest = manifest => {
        if(terrainDemManifest!==manifest){
          for(const entry of demRequests.values())entry.controller.abort();
          demRequests.clear();demQueue.length=0;demQueuedKeys.clear();
          demTiles.clear();demCacheBytes=0;
        }
        terrainDemManifest = manifest;
        terrainDemManifestUrl = 'https://example.test/dem/manifest.json';
        terrainTileRequest=self.terrainTileRequest;
        fetchTerrainTile=self.fetchTerrainTile;
        requestLatestTerrainDemand();
      };
      self.stageDemTileForTest = key => {
        const image = {bitmap:true,probeDem:true,width:1026,height:1026,close(){}};
        demTiles.set(key,{land:image,ocean:image,political:image,bytes:1026*1026*12,lastUsed:1});
        demCacheBytes += 1026*1026*12;
      };
      function dispose() {`)+'\nself.PandoLabCanvasRenderer.install(self);')(
    scope, {setTimeout:timerPorts?.setTimeout || (() => 0),clearTimeout:timerPorts?.clearTimeout || (() => {})}, fetch,
    async blob => ({ width:blob.width,height:blob.height,close() {} }),
    class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    { now });
  const country = (id, east = 1) => ({ id, type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [east, 0], [east, 1], [0, 1], [0, 0]]] } });
  const features = [country('VISIBLE'), country('HIDDEN')];
  const land = { key: 'physical-land', role: 'physical-land', geometry: country('LAND', 2).geometry };
  const frame = {
    surfacePresentation: { targetQuality: 'canonical', quality: 'canonical' },
    width: 1000, height: 600, dpr: 1, terrainDpr: 2,
    renderProjection: { scale: 350, translate: [500, 300] }, projection: 'flat',
    view: { flatCenter: [0, 0], flatZoom: 1 },
    physicalSettings: { terrainVisible: true, terrainStyle: 'political' },
    theme: { baseLandAlpha: 1, defaultLand: '#dddddd', strokes: { country: { width: 1 } } },
    fills: { VISIBLE: { fillAlpha: 1, color: '#ffffff' }, HIDDEN: { fillAlpha: 1, color: '#ffffff' } },
    visible: true, hiddenCountryIds: ['HIDDEN'], scenePolygons: [land], sceneStrokes: [],
    interactionFillItems: [], countryEmphasis: {},
    visualOrder: { base: ['substrate', 'terrain', 'country-fill'], hydro: [] },
    projectGeneration: 1, geometryRevision: 0, viewRevision: 1, revision: 1,
    styleRevision: 1, physicalStyleRevision: 1,
  };
  const send = message => {
    scope.onmessage({ data: message });
    if(messages.at(-1)?.type==='error')throw new Error(messages.at(-1).message);
  };
  send({ ...frame, type: 'init', features,terrainEnabled:false });
  if(!expectDem)scope.stageDemForTest(manifest);
  return {
    messages, requests, drawn, paths, substrates, features, land, send, triangleCopies,
    currentRenderState: () => scope.currentRenderState(),
    numericCache: () => scope.numericCacheForTest(),
    stageDem: manifest => scope.stageDemForTest(manifest),
    stageDemTile: key => scope.stageDemTileForTest(key),
    traceGrid: (...args) => scope.traceTerrainGrid(...args),
    drawTriangle: points => scope.drawTerrainTriangle({ probeTriangle: true }, [[0, 0], [1, 0], [0, 1]], points, 1),
    render: extra => send({ ...frame, ...extra, type: 'view' }),
    levels: () => requests.map(request => Number(request.url.match(/\/(\d+)\/\d+-\d+\.webp$/)?.[1])),
    async deliver(request) {
      assert.ok(request && !request.completed, 'tile request must be pending');
      request.completed = true;
      const match=new URL(request.url).pathname.match(/\/(\d+)\/(\d+)-(\d+)\.webp$/);
      const level=manifest.levels[Number(match[1])];
      request.resolve({ ok: true, blob: async () => ({
        width:Math.min(level.tileSize,level.width-Number(match[2])*level.tileSize)+2,
        height:Math.min(level.tileSize,level.height-Number(match[3])*level.tileSize)+2,
      }) });
      await settle();
    },
    find: suffix => requests.find(request => !request.completed && request.url.endsWith(suffix)),
  };
}

test('DEM manifest completion schedules visible detail immediately without another view paint', async () => {
  const h = canvasTerrainRuntime({expectDem:true}); await settle();
  h.render({ terrainDpr: 1, renderProjection: {scale: 100, translate: [500,300]} });
  const before = h.messages.filter(message => message.type === 'frame').length;
  const dem = { ...manifest, version:'0.13.3', urlTemplate:'https://example.test/dem/{level}/{column}-{row}.webp' };
  h.stageDem(dem);
  assert.ok(h.requests.some(request => request.url.includes('/dem/0/')),
    'DEM detail must be requested when its manifest becomes ready, not on the next paint');
  assert.equal(h.messages.filter(message => message.type === 'frame').length, before,
    'resource scheduling cannot certify an unpainted bitmap');
});

test('actual country frame paints before optional Canvas DEM, then accepts full detail',async()=>{
  const h=canvasTerrainRuntime();await settle();
  const view={terrainDpr:1,renderProjection:{scale:100,translate:[500,300]},
    physicalSettings:{terrainVisible:true,terrainStyle:'physical'}};
  const territory={...h.land,key:'territory',role:'territorial-fill'};
  const scenario={...view,scenePolygons:[h.land,territory],
    visualOrder:{base:['substrate','terrain','country-fill','territorial-fill'],hydro:[]}};
  const before=h.drawn.length;
  h.render({...scenario,presentBeforeTerrain:true});
  const first=h.messages.filter(message=>message.type==='frame').at(-1);
  assert.equal(first.physicalLandCount,1);
  assert.equal(first.surfaceQuality,'canonical');
  assert.equal(first.presentBeforeTerrain,true);
  assert.equal(first.terrainComplete,false);
  assert.equal(first.terrainStats.terrainReady,false);
  assert.equal(h.drawn.length,before,'no optional DEM tessellation on first complete country bitmap');
  for(const request of [...h.requests])if(!request.completed && /\/0\//.test(request.url))await h.deliver(request);
  h.render({...scenario,presentBeforeTerrain:false});
  const detailed=h.messages.filter(message=>message.type==='frame').at(-1);
  assert.equal(detailed.presentBeforeTerrain,false);
  assert.equal(detailed.terrainComplete,true);
  assert.ok(h.drawn.length>before,'DEM completes on a later genuine frame');
});

test('replacement numerical DEM invalidates cached substrate while reusing the current camera', async () => {
  const h=canvasTerrainRuntime(); await settle();
  const view={terrainDpr:1,physicalSettings:{terrainVisible:true,terrainStyle:'physical'},
    renderProjection:{scale:100,translate:[500,300]}};
  h.render(view);
  for (const request of [...h.requests]) if (!request.completed && /\/0\//.test(request.url)) await h.deliver(request);
  h.render(view);
  assert.equal(h.messages.at(-1).terrainComplete,true);
  const dem={...manifest,version:'0.13.3',urlTemplate:'https://example.test/dem/{level}/{column}-{row}.webp'};
  h.stageDem(dem);
  h.stageDemTile('0/0-0');
  h.drawn.length=0;
  h.render(view);
  assert.ok(h.drawn.length>0,'the detailed DEM is actually composited');
  assert.ok(h.drawn.every(args=>args[0]?.probeDem),
    'replacement source must paint only its own numerical tiles');
  assert.equal(h.messages.at(-1).terrainComplete,false,
    'one detailed tile cannot certify the complete DEM target');
});

test('Canvas reuses terrain substrate across generations only for the same certified physical source',async()=>{
  const h=canvasTerrainRuntime();await settle();
  const first={...h.land,sourceKey:'physical-land:sha256:a',geometryRevision:'land-a'};
  const view={scenePolygons:[first],terrainDpr:1,renderProjection:{scale:100,translate:[500,300]},
    physicalSettings:{terrainVisible:true,terrainStyle:'physical'}};
  h.render(view);
  const firstPaints=h.substrates.length;
  assert.ok(firstPaints>0);
  h.send({type:'reset-generation',projectGeneration:2});
  const same={...h.land,geometry:structuredClone(h.land.geometry),
    sourceKey:first.sourceKey,geometryRevision:first.geometryRevision};
  h.render({...view,projectGeneration:2,scenePolygons:[same]});
  assert.equal(h.substrates.length,firstPaints,
    'fresh copies of the same certified land must not force a full raster redraw');
  h.send({type:'reset-generation',projectGeneration:3});
  const updated={...same,sourceKey:'physical-land:sha256:b',geometryRevision:'land-b'};
  h.render({...view,projectGeneration:3,scenePolygons:[updated]});
  assert.ok(h.substrates.length>firstPaints,'changed physical provenance must invalidate cached pixels');
});

test('Canvas prepares numerical tiles without tessellating an uncertified zero-land frame',async()=>{
  const h=canvasTerrainRuntime();await settle();
  const noLand={scenePolygons:[],surfacePresentation:{targetQuality:'canonical',quality:'pending'},
    physicalSettings:{terrainVisible:true,terrainStyle:'physical'}};
  h.render(noLand);await settle();
  assert.ok(h.requests.length>0,'tile fetching still progresses while physical source is pending');
  for(const request of [...h.requests])if(!request.completed)await h.deliver(request);
  const prior=h.drawn.length;
  h.render(noLand);
  const pending=h.messages.filter(message=>message.type==='frame').at(-1);
  assert.equal(pending.physicalLandCount,0);
  assert.equal(pending.terrainComplete,false,'an uncertified bitmap cannot claim a completed terrain paint');
  assert.equal(h.drawn.length,prior,'do not rasterize expensive terrain behind an unpresentable bitmap');
  h.render({...noLand,scenePolygons:[h.land]});
  assert.equal(h.messages.filter(message=>message.type==='frame').at(-1).physicalLandCount,1,
    'a later physical scene restores the actual rendering path');
});

test('cooperative globe painting yields, cancels superseded views and publishes only the latest complete bitmap', async () => {
  const timers = [];
  const setTimeout = (fn, ms) => { const task = { fn, ms, cancelled:false }; timers.push(task); return timers.length; };
  const clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cancelled = true; };
  let clock = 0;
  const h = canvasTerrainRuntime({ timerPorts:{setTimeout,clearTimeout},now:() => clock += 15 });
  await settle();
  h.render({ terrainDpr:1, renderProjection:{scale:100,translate:[500,300]} });
  await h.deliver(h.find('/0/0-0.webp'));
  const globe = { projection:'globe', terrainDpr:1,
    view:{globeZoom:1,globeRotation:[0,0,0]},
    renderProjection:{scale:100,translate:[500,300]} };
  const prior = h.messages.filter(message => message.bitmap).length;
  h.render({ ...globe,revision:2,viewRevision:2,renderRequestId:10 });
  assert.equal(h.messages.filter(message => message.bitmap).length,prior,
    'a yielded partial globe cannot be transferred');
  assert.ok(timers.some(timer => timer.ms === 0 && !timer.cancelled));
  h.render({ ...globe,revision:3,viewRevision:3,renderRequestId:11,
    view:{globeZoom:1,globeRotation:[20,0,0]} });
  const cancelled = h.messages.find(message => message.type === 'frame' && message.renderRequestId === 10);
  assert.ok(cancelled && !cancelled.bitmap, 'old render request must be released without stale pixels');
  // Numeric scratch blocks also yield; this fake clock consumes a budget at every read.
  for (let count = 0;count < 20000;count++) {
    const task = timers.find(timer => !timer.cancelled && !timer.ran);
    if (!task) break;
    task.ran = true;
    task.fn();
    if (h.messages.some(message => message.renderRequestId === 11 && message.bitmap)) break;
  }
  assert.ok(h.messages.some(message => message.renderRequestId === 11 && message.bitmap),
    'only the current view completes after cooperative paint slices');
  assert.equal(h.messages.filter(message => message.renderRequestId === 10 && message.bitmap).length,0);
});

test('Canvas globe terrain reuses shared grid vertices while preserving exact triangles', () => {
  const h=canvasTerrainRuntime(), spec={bounds:[0,4,4,0],pixelWidth:4,pixelHeight:4};
  let projections=0;const projection=point=>{projections++;return [point[0],point[1]];};
  const triangles=h.traceGrid(spec,projection,{view:{globeZoom:2,globeRotation:[0,0,0]}});
  const sources=[[[0,0],[2,0],[0,2]],[[2,0],[2,2],[0,2]],
    [[2,0],[4,0],[2,2]],[[4,0],[4,2],[2,2]],
    [[0,2],[2,2],[0,4]],[[2,2],[2,4],[0,4]],
    [[2,2],[4,2],[2,4]],[[4,2],[4,4],[2,4]]];
  assert.deepEqual(triangles,sources.map(source=>({source,destination:source.map(([x,y])=>[x,4-y])})));
  assert.equal(projections,9,'each of the nine shared grid vertices is projected once');
});

test('Canvas Worker echoes the revisions of the physical packets it actually paints', async () => {
  const packet=(role,revision)=>({key:role,role,geometryRevision:revision,sourceKey:`source:${role}:${revision}`,
    ringCoordinates:new Float64Array([0,0,1,0,1,1,0,0]),ringOffsets:new Uint32Array([0,4]),
    polygonOffsets:new Uint32Array([0,1]),style:{color:'#fff',fillAlpha:1}});
  const scene=[packet('physical-land','land-v2'),packet('physical-water','water-v3')];
  const packetOwner=createCanvasScenePackets();
  const project=rows=>packetOwner.scenePolygons(rows);
  const delta=(rows,channel)=>packetOwner.delta(rows,channel);
  const h=canvasTerrainRuntime();await settle();
  let firstCoordinates;
  for(let i=0;i<2;i++){
    const sent=delta(project(scene),'scene');
    assert.equal(sent[0].sourceKey,scene[0].sourceKey,'source identity reaches the Worker');
    if(i===1)assert.equal(Object.hasOwn(sent[0],'ringCoordinates'),false,'unchanged geometry is reused');
    h.render({scenePolygons:sent,physicalSettings:{terrainVisible:false,terrainStyle:'political'},
      visualOrder:{base:['substrate','physical-water'],hydro:[]}});
    const frame=h.messages.filter(message=>message.type==='frame').at(-1);
    assert.equal(frame.physicalLandRevision,'land-v2');assert.equal(frame.physicalWaterRevision,'water-v3');
    assert.equal(canvasWorkerFrameMatchesPhysical(frame,{ready:true,landRevision:'land-v2',waterRevision:'water-v3'}),true);
    if(i===0)firstCoordinates=h.currentRenderState().scenePolygons[0].ringCoordinates;
    else assert.equal(h.currentRenderState().scenePolygons[0].ringCoordinates,firstCoordinates);
  }
  const copied=scene.map(value=>({...value,ringCoordinates:new Float64Array(value.ringCoordinates)}));
  h.render({scenePolygons:delta(project(copied),'scene'),physicalSettings:{terrainVisible:false,terrainStyle:'political'}});
  assert.equal(h.currentRenderState().scenePolygons[0].ringCoordinates,firstCoordinates,'unchanged source retains its Worker geometry');
  h.render({scenePolygons:delta([],'scene'),physicalSettings:{terrainVisible:false,terrainStyle:'political'}});
  h.render({scenePolygons:delta(project(copied),'scene'),physicalSettings:{terrainVisible:false,terrainStyle:'political'}});
  assert.equal(h.currentRenderState().scenePolygons[0].ringCoordinates,firstCoordinates,
    'a temporarily absent physical scene does not discard unchanged land geometry');
  copied[0]={...copied[0],sourceKey:'source:physical-land:land-v3',geometryRevision:'land-v3',
    ringCoordinates:new Float64Array([0,0,2,0,2,1,0,0])};
  h.render({scenePolygons:delta(project(copied),'scene'),physicalSettings:{terrainVisible:false,terrainStyle:'political'}});
  assert.notEqual(h.currentRenderState().scenePolygons[0].ringCoordinates,firstCoordinates,'changed source replaces Worker geometry');
  assert.equal(h.messages.filter(message=>message.type==='frame').at(-1).physicalLandRevision,'land-v3');
});

test('terrain keeps the physical mask when political objects are hidden or absent at the current time', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const geometry = { type: 'MultiPolygon', coordinates: [[[[0,0],[2,0],[2,2],[0,0]]]] };
  h.paths.length = 0;
  h.render({ visible: false, scenePolygons: [{ key: 'physical-land', role: 'physical-land', geometry }] });
  assert.ok(h.paths.includes(geometry), 'terrain clipping must use the independent physical mask');
});

test('Canvas terrain skips wholly offscreen triangles while keeping crossing and antialiased edge triangles', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  h.drawTriangle([[-20, -20], [-10, -20], [-20, -10]]);
  h.drawTriangle([[1010, 100], [1020, 100], [1010, 110]]);
  h.drawTriangle([[100, 610], [110, 610], [100, 620]]);
  assert.equal(h.triangleCopies.length, 0, 'offscreen tiles must not submit image copies');
  h.drawTriangle([[2, 2], [10, 2], [2, 10]]);
  h.drawTriangle([[-100, 300], [1100, 300], [500, -100]]);
  h.drawTriangle([[-.5, 0], [-.2, 10], [-.5, 20]]);
  assert.equal(h.triangleCopies.length, 3, 'viewport crossings and the existing 0.75px clip overlap remain visible');
  const cropped = h.triangleCopies.at(-1);
  assert.equal(cropped.length, 9, 'each globe triangle copies only its source rectangle');
  assert.ok(cropped[3] <= 10 && cropped[4] <= 10,
    'the triangle cannot redraw a full terrain tile beneath its clip');
  assert.equal(cropped[1], cropped[5]);
  assert.equal(cropped[2], cropped[6]);
});

test('Canvas reuses decoded DEM while repainting bounded numerical blocks for repeated projection', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { terrainDpr: 1, renderProjection: {scale: 100, translate: [500, 300]} };
  h.render(view);
  await h.deliver(h.find('/0/0-0.webp'));
  h.drawn.length = 0;
  h.render(view);
  assert.ok(h.drawn.length > 0);
  assert.ok(h.drawn.every(args => args[0].bitmap || args[0]?.ctx?.numericPixels>0),
    'projection paints actual image or numerical pixels, not only a frame acknowledgement');
  assert.ok(h.drawn.filter(args=>args[0]?.ctx?.numericPixels>0).every(args=>
    args.length===9 && args[3]<=2048 && args[4]<=16),
    'reused numeric backing draws only the populated 2048x16 maximum block');
  const decoded=h.numericCache();
  assert.ok(decoded.length>0);
  assert.ok(decoded.every(row=>row.bytes===row.rawBytes && row.rawBytes>0
    && !row.eagerLand && !row.eagerOcean && !row.eagerPolitical),
    'normal Canvas tiles must retain original DEM only; never eagerly allocate unused theme planes');
  const metrics=h.messages.filter(msg=>msg.type==='frame').at(-1).terrainStats;
  assert.ok(metrics.canvasTerrainNumericPixels>0);
  assert.ok(metrics.canvasTerrainNumericScratchPeakBytes<=256*1024);
  assert.ok(metrics.canvasTerrainNumericScratchAllocations<=2);
  assert.ok(metrics.canvasTerrainNumericBlocks>0);
});

test('Canvas terrain demand ignores country LOD and backing DPR, but follows source DPR', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  assert.deepEqual(h.levels(), [2, 2], 'current visible detail consumes both initial fetch slots');
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
  for (let round=0; round<30 && !h.messages.filter(message=>message.type==='frame').at(-1).terrainStats.terrainReady; round++) {
    const request=h.requests.find(request=>!request.completed); if(!request)break;
    await h.deliver(request);h.render();
  }
  h.render({ dpr: 1.5 });
  assert.ok(h.levels().every(level => level === 0 || level === 2));
  h.render({ surfacePresentation: {quality:'lod',targetQuality:'canonical'}, terrainDpr: 1 });
  await settle();
  assert.equal(h.messages.filter(message=>message.type==='frame').at(-1).terrainStats.terrainTargetLevel,1);
  assert.ok(h.levels().includes(1), 'a lower source DPR selects a lower terrain level');
});

test('Canvas retains ready world tiles across zoom thresholds while target detail is pending', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const render = scale => h.render({ terrainDpr: 1, renderProjection: { scale, translate: [500, 300] } });
  render(100);
  await h.deliver(h.find('/0/0-0.webp'));
  await h.deliver(h.find('/0/1-0.webp'));
  for (const scale of [503, 505, 641, 643, 800, 643, 641, 505, 503]) {
    h.drawn.length = 0;
    render(scale);
    assert.ok(h.drawn.length > 0, `terrain must remain visible at ${scale}`);
    assert.deepEqual(h.substrates.at(-1), [h.land.geometry]);
    assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
  }
  render(800); await settle();
  h.drawn.length = 0; render(503);
  const beforeDetail=h.messages.at(-1).terrainStats.terrainDetailTileCount;
  const detail = h.requests.find(request => !request.completed && /\/2\//.test(request.url));
  await h.deliver(detail);
  h.drawn.length = 0; render(503);
  assert.ok(h.drawn.length>0,'ready detailed terrain paints destination pixels');
  assert.ok(h.messages.at(-1).terrainStats.terrainDetailTileCount>beforeDetail,
    'the published frame includes more target detail, not only old world coverage');
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
  h.drawn.length = 0;
  h.render({ physicalSettings: { terrainVisible: false, terrainStyle: 'political' } });
  assert.equal(h.drawn.length, 0, 'explicit terrain visibility still controls painting');
});

test('temporal Canvas transitions request missing tiles without painting discarded incomplete terrain', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { deferIncompleteTerrain: true, terrainDpr: 1,
    renderProjection: { scale: 503, translate: [500, 300] } };
  h.render(view);
  await h.deliver(h.requests.find(request => !request.completed));
  h.drawn.length = 0;
  h.render(view);
  assert.equal(h.drawn.length, 0, 'partial terrain cannot be presented during a temporal transition');
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
  for (let round = 0; round < 30 && !h.messages.at(-1).terrainStats.terrainReady; round++) {
    const request = h.requests.find(item => !item.completed);
    assert.ok(request, 'missing tiles must continue loading');
    await h.deliver(request);
    h.render(view);
  }
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, true);
  assert.ok(h.drawn.length > 0, 'the complete terrain is painted before its frame is admitted');
});

test('temporal frames without physical land retain the completed terrain for the next frame', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { terrainDpr: 1, renderProjection: {scale: 100, translate: [500, 300]} };
  h.render(view);
  await h.deliver(h.find('/0/0-0.webp'));
  await h.deliver(h.find('/0/1-0.webp'));
  h.render(view);
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, true);
  h.drawn.length = 0;
  h.render({...view, deferIncompleteTerrain: true, scenePolygons: []});
  assert.equal(h.drawn.length, 0, 'a frame without physical land cannot repaint terrain');
  h.render({...view, deferIncompleteTerrain: true, scenePolygons: [h.land]});
  assert.equal(h.drawn.length, 0, 'the matching complete terrain remains reusable');
});

test('physical terrain recomposites cached numerical tiles when the land mask changes', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { terrainDpr: 1, physicalSettings: {terrainVisible: true, terrainStyle: 'physical'},
    renderProjection: {scale: 100, translate: [500, 300]} };
  h.render(view);
  await h.deliver(h.find('/0/0-0.webp'));
  await h.deliver(h.find('/0/1-0.webp'));
  h.render(view);
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, true);
  h.drawn.length = 0;
  const changedLand = {...h.land, geometry: {type: 'Polygon', coordinates: [[[0,0],[3,0],[3,1],[0,0]]]}};
  h.render({...view, scenePolygons: [changedLand]});
  assert.ok(h.drawn.length > 0, 'a new mask must recompose land and ocean from cached numerical tiles');
  h.drawn.length=0;
  h.render({...view, renderProjection: {scale: 110, translate: [500, 300]}, scenePolygons: [changedLand]});
  assert.ok(h.drawn.length > 0, 'camera changes must invalidate the projected base');
});

test('Canvas paints prepared physical terrain while country geometry is pending', async () => {
  const h = canvasTerrainRuntime(); await settle();
  h.render({terrainDpr: 1, renderProjection: {scale: 100, translate: [500, 300]}});
  await h.deliver(h.find('/0/0-0.webp'));
  await h.deliver(h.find('/0/1-0.webp'));
  for (const scale of [503, 800, 503]) {
    const view = { terrainDpr: 1, renderProjection: {scale, translate: [500, 300]} };
    h.drawn.length = 0; h.paths.length = 0;
    h.render({...view, surfacePresentation: {quality: 'pending', targetQuality: 'canonical'}});
    assert.ok(h.drawn.length > 0, 'prepared physical terrain remains visible while country geometry is pending');
    assert.equal(h.messages.at(-1).surfaceQuality, 'pending');
    assert.equal(h.messages.at(-1).physicalLandCount, 1);
    assert.ok(h.messages.at(-1).bitmap);
    assert.deepEqual(h.substrates.at(-1), [h.land.geometry]);
    assert.ok(h.features.every(feature => !h.paths.includes(feature)), 'pending countries are not painted');
    h.render({...view, visible: false});
    assert.ok(h.drawn.length > 0, `retained terrain resumes after the background acknowledgement at ${scale}, even with countries hidden`);
    assert.equal(h.messages.at(-1).surfaceQuality, 'canonical');
    assert.equal(h.messages.at(-1).terrainStats.terrainReady, false, 'painting does not certify missing detail');
    h.drawn.length = 0;
    h.render({...view, visible: false});
    assert.equal(h.drawn.length, 0, 'the admitted terrain paint is reused for an unchanged frame');
  }
});

test('Canvas terrain acknowledges prepared coverage and its source limit in the actual frame', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { presentationKey: 'current-view', terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } };
  h.render(view);
  const pending = [...h.requests];
  for (const request of pending) await h.deliver(request);
  h.render(view);
  const message = h.messages.at(-1);
  assert.equal(message.presentationKey, 'current-view');
  assert.equal(message.terrainStats.terrainReady, true);
  assert.equal(message.terrainStats.terrainResolutionLimited, false);
  h.render({ ...view, renderProjection: { scale: 2000, translate: [500, 300] } });
  assert.equal(h.messages.at(-1).terrainStats.terrainResolutionLimited, true);
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
});

test('Canvas cannot acknowledge terrain while the selected numerical DEM is pending', async () => {
  const h = canvasTerrainRuntime({ expectDem: true }); await settle();
  h.render({ terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  for (const request of h.requests.filter(request => /\/0\//.test(request.url))) await h.deliver(request);
  h.render({ terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
});

test('Canvas starts terrain requests while the country surface is pending', async () => {
  const h = canvasTerrainRuntime();
  await settle();
  h.render({ surfacePresentation: { quality: 'pending', targetQuality: 'canonical' },
    terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  assert.ok(h.requests.some(request => /\/0\/\d+-\d+\.webp$/.test(request.url)),
    'background preparation must not wait for the country mesh');
  assert.equal(h.drawn.length, 0, 'the pending surface is not painted before admission');
  for (const request of h.requests.filter(request => /\/0\//.test(request.url))) await h.deliver(request);
  h.drawn.length = 0;
  h.render({ surfacePresentation: { quality: 'pending', targetQuality: 'canonical' },
    terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  assert.ok(h.drawn.length > 0, 'a ready physical base paints before country admission');
});

test('Canvas keeps world coverage and the physical mask independently of political geometry and visibility', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  assert.equal(h.drawn.length, 0);
  await h.deliver(h.find('/0/0-0.webp'));
  h.render({surfacePresentation:{quality:'pending',targetQuality:'canonical'},terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  assert.ok(h.drawn.length > 0, 'a certified physical layer can paint ready numerical tiles before country admission');
  assert.equal(h.messages.at(-1).surfaceQuality, 'pending');
  assert.equal(h.messages.at(-1).physicalLandCount, 1);
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry]);
  h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  assert.ok(h.drawn.length > 0, 'the next admitted frame paints the retained ready tile');
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false, 'a partial world is not ready coverage');
  await h.deliver(h.find('/0/1-0.webp'));
  h.drawn.length = 0; h.substrates.length = 0;
  h.render();
  assert.ok(h.drawn.length>0,'ready world coverage paints destination pixels');
  assert.ok(['/0/0-0.webp','/0/1-0.webp'].every(path=>h.requests.some(request=>request.completed&&request.url.includes(path))),
    'both actual world tile deliveries precede the published reserve frame');
  assert.equal(h.messages.at(-1).terrainComplete, false, 'detail is still progressive');
  assert.ok(h.paths.includes(h.land.geometry));
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry]);
  const modified = structuredClone(h.features[0]);
  modified.geometry.coordinates[0][1][0] = 3;
  h.send({ type: 'replace-data', features: [modified, h.features[1]],
    geometryRevision: 1, projectGeneration: 1 });
  h.paths.length = 0; h.drawn.length = 0; h.render();
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry], 'the independent mask survives a political geometry revision');
  assert.equal(h.drawn.length, 0, 'country edits reuse the prepared physical background');
  h.paths.length = 0; h.render({ visible: false });
  assert.deepEqual(h.paths, []);
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry], 'physical land remains when every political object is hidden');
  const detail = h.requests.find(request => !request.completed && /\/2\//.test(request.url));
  assert.ok(detail);
  await h.deliver(detail);
  h.drawn.length = 0; h.render();
  assert.ok(h.drawn.length>0,'arriving detail paints destination pixels');
  assert.ok(h.messages.at(-1).terrainStats.terrainDetailTileCount>0,'ready detail belongs to the published frame');
});

test('Canvas reuses physical terrain through political changes and invalidates it for camera, physical mask and tile changes', async () => {
  const h=canvasTerrainRuntime();await settle();h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  await h.deliver(h.find('/0/0-0.webp'));await h.deliver(h.find('/0/1-0.webp'));h.render();
  h.drawn.length=0;
  h.render({fills:{VISIBLE:{fillAlpha:0,color:''}}});
  assert.equal(h.drawn.length,0,'changing object color must not reproject terrain tiles');
  h.render({view:{flatCenter:[1,0],flatZoom:1},renderProjection:{scale:350,translate:[490,300]}});
  assert.ok(h.drawn.length>0,'camera changes redraw terrain pixels');
  h.drawn.length=0;h.render({visible:false});
  assert.ok(h.drawn.length>0,'visibility changes redraw land-mask pixels');
  h.drawn.length=0;h.render({visible:false,darkTheme:true});
  assert.ok(h.drawn.length>0,'theme changes redraw terrain pixels');
  const detail=h.requests.find(request=>!request.completed && /\/2\//.test(request.url));await h.deliver(detail);
  h.drawn.length=0;h.render({visible:false,darkTheme:true});
  assert.ok(h.drawn.length>0,'arriving detail paints a replacement for the cached preview');
  const child = { role:'territorial-fill', geometry:structuredClone(h.features[0].geometry), style:{fillAlpha:0} };
  h.render();h.drawn.length=0;h.render({scenePolygons:[h.land,child]});
  assert.equal(h.drawn.length,0,'new political land does not invalidate the physical mask');
  h.drawn.length=0;h.render({scenePolygons:[h.land,{...child,style:{fillAlpha:.68}}]});
  assert.equal(h.drawn.length,0,'child paint does not own terrain geometry');
  h.render({scenePolygons:[h.land,{...child,geometry:structuredClone(child.geometry)}]});
  assert.equal(h.drawn.length,0,'replacement political geometry does not invalidate the physical mask');
  h.render({scenePolygons:[{...h.land,geometry:structuredClone(h.land.geometry)}]});
  assert.ok(h.drawn.length>0,'replacement physical source invalidates and repaints the mask');
});

test('an offscreen cached numerical tile does not redraw the ready viewport terrain', async () => {
  const h=canvasTerrainRuntime();await settle();h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  await h.deliver(h.find('/0/0-0.webp'));await h.deliver(h.find('/0/1-0.webp'));h.render();
  for(let count=0;!h.messages.filter(message=>message.type==='frame').at(-1).terrainStats.terrainReady && count<30;count++) {
    const pending=h.requests.find(request=>!request.completed);
    assert.ok(pending);await h.deliver(pending);h.render();
  }
  assert.equal(h.messages.filter(message=>message.type==='frame').at(-1).terrainStats.terrainReady,true);
  h.stageDemTile('2/0-0');h.drawn.length=0;h.render();
  assert.equal(h.drawn.length,0,'offscreen cache entries must not trigger a full terrain repaint');
});

test('P7 Canvas resource redraws coalesce and an explicit newer view cancels the obsolete scheduled paint',async()=>{
  const timers=[],setTimeout=(fn,ms)=>{const token={fn,ms,cancelled:false};timers.push(token);return timers.length;};
  const clearTimeout=id=>{timers[id-1].cancelled=true;};
  const h=canvasTerrainRuntime({timerPorts:{setTimeout,clearTimeout}});await settle();h.render();
  const original=h.messages.filter(message=>message.type==='frame').length;
  h.send({type:'hydro-edits',revision:7,features:[]});
  h.send({type:'hydro-edits',revision:8,features:[]});
  assert.equal(timers.length,1,'several resource updates require one coalesced paint');
  assert.equal(timers[0].ms,16,'a frame-sized window allows the next camera event to take priority');
  h.render({revision:2,viewRevision:2});
  assert.equal(timers[0].cancelled,true,'explicit view cancels the delayed duplicate redraw');
  assert.equal(h.messages.filter(message=>message.type==='frame').length,original+1,
    'a current view still renders exactly once and is never skipped');
  h.send({type:'hydro-edits',revision:9,features:[]});
  assert.equal(timers.length,2);
  h.send({type:'view',projectGeneration:1,revision:1,viewRevision:1,renderRequestId:99});
  assert.equal(timers[1].cancelled,false,
    'a rejected old camera event cannot cancel the current resource repaint');
  const afterStale=h.messages.filter(message=>message.bitmap).length;
  timers[1].fn();
  assert.ok(h.messages.filter(message=>message.bitmap).length>afterStale,
    'the coalesced resource redraw remains executable after stale view rejection');
});


test('P7 accepted Canvas style and physical-style messages redraw the current Worker view', async()=>{
  const timers=[],setTimeout=(fn,ms)=>{const ticket={fn,ms,cancelled:false};timers.push(ticket);return timers.length;};
  const clearTimeout=id=>{timers[id-1].cancelled=true;};
  const h=canvasTerrainRuntime({timerPorts:{setTimeout,clearTimeout}});await settle();h.render();
  const old=h.messages.filter(row=>row.type==='frame').length;
  h.send({type:'style',styleRevision:2});
  h.send({type:'physical-style',physicalStyleRevision:2,terrainFetchConcurrency:2});
  assert.equal(timers.length,1,'two accepted updates coalesce into one redraw');
  assert.equal(timers[0].ms,16,'resource repaint yields once to the browser message loop');
  timers[0].fn();
  const frames=h.messages.filter(row=>row.type==='frame');
  assert.equal(frames.length,old+1,'accepted current style produces an actual bitmap');
  assert.equal(frames.at(-1).styleRevision,2);
  h.send({type:'style',styleRevision:1});
  assert.equal(timers.length,1,'obsolete style updates cannot rewind the presented frame');
});
