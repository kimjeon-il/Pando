import { describe as contractSuite } from 'node:test';
import * as __canvas_dep0 from "node:test";
import * as __canvas_dep1 from "node:assert/strict";
import * as __canvas_dep2 from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import * as __canvas_dep3 from "../../shared/frontend/js/modules/geometry-versions.js";
import * as __canvas_dep4 from "node:fs";
import * as __canvas_dep5 from "node:vm";
import * as __canvas_dep6 from "node:crypto";
import * as __canvas_dep7 from "../../shared/frontend/js/modules/resource-update-policy.js";
import * as __canvas_dep8 from "../../shared/frontend/js/modules/country-mesh-zoom-policy.js";
import * as __canvas_dep9 from "../../shared/frontend/js/modules/gpu-canvas-worker.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";
// Shared imports and fixtures used by the independent Canvas feature groups.
const __dep0 = __canvas_dep0;
const __dep1 = __canvas_dep1;
const __dep2 = __canvas_dep2;
const __dep3 = __canvas_dep3;
const __dep4 = __canvas_dep4;
const __dep5 = __canvas_dep5;
const __dep6 = __canvas_dep6;
const __dep7 = __canvas_dep7;
const __dep8 = __canvas_dep8;
const __dep9 = __canvas_dep9;
const { describe : featureDescribe }=__dep0;
const __suiteDependency0=__dep0;
const __suiteDependency1=__dep1;
const __suiteDependency2=__dep2;
const __suiteDependency3=__dep3;
const __suiteDependency4=__dep1;
const __suiteDependency5=__dep4;
const __suiteDependency6=__dep5;
const __suiteDependency7=__dep0;
const __suiteDependency8=__dep1;
const __suiteDependency9=__dep0;
featureDescribe("canvas-country-geometry", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const {  canvasCountryGeometrySignature  } = __suiteDependency2;
  const {  touchGeometry  } = __suiteDependency3;
const feature = id => ({ id, geometry: { type:'Polygon', coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]] },
  properties: { entityKind:'general', style:{} } });

test('Canvas country data identity ignores presentation wrappers but follows geometry and membership', () => {
  const root=feature('CHN'), child=feature('HKG');
  child.boundaryRootId='CHN';child.boundaryPristine=true;
  const rows=[root,child], key=canvasCountryGeometrySignature(rows);
  assert.equal(canvasCountryGeometrySignature(rows.map(row=>({...row,properties:{...row.properties,style:{color:'#ff0000'}}}))),key);
  assert.notEqual(canvasCountryGeometrySignature([root]),key);
  assert.notEqual(canvasCountryGeometrySignature([child,root]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,id:'MAC'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,geometry:structuredClone(child.geometry)}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryRootId:'OTHER'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryPristine:false}]),key);
  touchGeometry(child.geometry);
  assert.notEqual(canvasCountryGeometrySignature(rows),key);
});
});
featureDescribe("canvas-coupled-land", () => {
  const assert = __suiteDependency4.default;
  const {  readFileSync  } = __suiteDependency5;
  const vm = __suiteDependency6.default;
  const test = __suiteDependency7.default;
test('Canvas land uses the admitted physical packet independently from countries', () => {
  const scope={};vm.runInNewContext(readFileSync(new URL("../../shared/frontend/js/workers/canvas-scene-composition-core.js",import.meta.url),'utf8'),scope);
  const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[0,1],[0,0]]]},paths=[];
  const context={beginPath(){},fill(){}};
  const packet={role:'physical-land',ringCoordinates:new Float64Array([5,5,6,5,5,6,5,5]),ringOffsets:[0,4],polygonOffsets:[0,1]};
  scope.PandoLabCanvasSceneComposition.drawGeneralLand(context,value=>paths.push(value),[packet]);
  assert.equal(paths.length,1);
  assert.notEqual(paths[0],geometry);
  assert.deepEqual(JSON.parse(JSON.stringify(paths[0].coordinates)),[[[[5,5],[6,5],[5,6],[5,5]]]]);
  assert.equal(scope.PandoLabCanvasSceneComposition.generalLandShapes([packet])[0],paths[0],
    'country deletion, including the last country, cannot replace or erase physical land');
});

test('Canvas pending surface suppresses regional fills as well as country fills', () => {
  const scope={};vm.runInNewContext(readFileSync(new URL("../../shared/frontend/js/workers/canvas-scene-composition-core.js",import.meta.url),'utf8'),scope);
  scope.PandoLabCanvasSceneComposition.drawTerritorialFills(new Proxy({}, {get(){assert.fail('pending territorial fill touched the Canvas');}}),
    ()=>assert.fail('pending territorial fill drew a path'),[{role:'territorial-fill'}],null,1,{quality:'pending'});
});
});
featureDescribe("canvas-stroke-preparation", () => {
  const assert = __suiteDependency8.default;
  const test = __suiteDependency9.default;
const draw = globalThis.PandoLabCanvasSceneComposition.drawStrokes;
const context = () => ({ save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {} });
const fixture = () => ({ geometryRevision: 'shape:1', startsEnds: new Float32Array([0, 0, 1, 0, 1, 0, 2, 0]),
  ownerRanges: { LEFT: { first: 0, count: 1 }, RIGHT: { first: 1, count: 1 } },
  ownerIds: ['LEFT', 'RIGHT'], style: { alpha: 1, color: '#ffffff', width: 1 } });

test('Canvas reuses prepared shared coordinates across pan/style paints while projecting each frame', () => {
  const packet = fixture(), target = context(), paints = [];
  draw(target, geometry => paints.push({ geometry, view: 'first' }), [packet]);
  draw(target, geometry => paints.push({ geometry, view: 'panned' }), [{ ...packet,
    style: { ...packet.style, color: '#123456', width: 2 } }]);
  assert.equal(paints.length, 2);
  assert.strictEqual(paints[0].geometry, paints[1].geometry);
  assert.notEqual(paints[0].view, paints[1].view);
  assert.deepEqual(paints[0].geometry.coordinates, [[[0, 0], [1, 0], [2, 0]]]);
  assert.equal(target.strokeStyle, '#123456');
  assert.equal(target.lineWidth, 2);
});

test('Canvas owner selection uses only current ranges and reuses a restored selection', () => {
  const packet = fixture(), paints = [], target = context();
  const paint = ownerIds => draw(target, geometry => paints.push(geometry), [{ ...packet, ownerIds }]);
  paint(['LEFT', 'RIGHT']); paint(['LEFT']); paint(['RIGHT']); paint(['LEFT', 'RIGHT']);
  assert.deepEqual(paints[1].coordinates, [[[0, 0], [1, 0]]]);
  assert.deepEqual(paints[2].coordinates, [[[1, 0], [2, 0]]]);
  assert.strictEqual(paints[0], paints[3]);
});

test('Canvas invalidates prepared strokes on changed revision, buffer identity or actual range layout', () => {
  const packet = fixture(), target = context(), paints = [];
  const paint = current => draw(target, geometry => paints.push(geometry), [current]);
  paint(packet);
  packet.startsEnds[6] = 3;
  paint({ ...packet, geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[0], paints[1]);
  assert.equal(paints[0].coordinates[0].at(-1)[0], 2);
  assert.equal(paints[1].coordinates[0].at(-1)[0], 3);
  paint({ ...packet, startsEnds: packet.startsEnds.slice(), geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[1], paints[2]);
  paint({ ...packet, geometryRevision: 'shape:2', ownerIds: ['LEFT'], ownerRanges: { LEFT: { first: 1, count: 1 } } });
  assert.deepEqual(paints[3].coordinates, [[[1, 0], [3, 0]]]);
});
});
contractSuite("canvas-globe-viewport", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { readFileSync }=__dep4;
const { createHash }=__dep6;
const vm=__dep5.default;
const resourceUpdatePolicy=__dep7;

const root = new URL('../../shared/frontend/js/', import.meta.url);
function runtime() {
  const scope = { URL, location: { href: 'https://example.test/assets/js/workers/canvas-render-worker.js' }, importScripts() {} };
  scope.self = scope;
  scope.PandoLabResourceUpdatePolicy = resourceUpdatePolicy;
  vm.createContext(scope);
  vm.runInContext(readFileSync(new URL('vendor/d3.min.js', root), 'utf8'), scope);
  vm.runInContext(readFileSync(new URL('workers/terrain-tile-selection-core.js', root), 'utf8'), scope);
  const source = readFileSync(new URL('workers/canvas-render-worker.js', root), 'utf8');
  const anchor = 'self.onmessage = event => {';
  assert.ok(source.includes(anchor));
  vm.runInContext(source.replace(anchor, `self.setHydroForTest = features => { hydroEditFeatures = features; };
    self.hydroPassForTest = renderHydroPass; self.projectionForTest = createProjection;
    self.cachedPathForTest = typeof createCanvasPath === 'function' ? createCanvasPath : undefined;
    self.traceTerrainGrid = (spec,projection,message) => {
      const previousDraw=drawTexturedTriangle,previousManifest=terrainManifest,triangles=[];
      terrainManifest={gutter:1};
      drawTexturedTriangle=(_image,source,destination)=>triangles.push([source,destination]);
      try { for (const _ of drawGlobeTerrainTile(spec,{},projection,message,1,false)) { /* Drain cooperative terrain rows. */ } return triangles; }
      finally { drawTexturedTriangle=previousDraw; terrainManifest=previousManifest; }
    }; ` + anchor), scope);
  return scope;
}

test('Canvas terrain preserves exact horizon triangles with real globe projection across repeated calls', () => {
  const scope=runtime(),spec={bounds:[78.75,11.25,101.25,-11.25],pixelWidth:1024,pixelHeight:1024};
  const projection=scope.d3.geo.orthographic().rotate([0,0,0]).scale(6000).translate([640,400]);
  const message={view:{globeZoom:16,globeRotation:[0,0,0]}};
  for(let i=0;i<2;i++) {
    const triangles=scope.traceTerrainGrid(spec,projection,message);
    assert.equal(triangles.length,8460);
    assert.equal(createHash('sha256').update(JSON.stringify(triangles)).digest('hex'),
      '34278a0134e2b3ed66fbcfdbaa47b1ff6ee36295703fe6261ee26361aee3bbf4');
  }
});

test('zoomed Canvas globe clips projected land and mask paths to the frame without losing viewport crossings', () => {
  const scope = runtime(), width = 1280, height = 752;
  for (const zoom of [1, 16, 64]) {
    const projection = scope.projectionForTest({ projection: 'globe', view: { globeZoom: zoom, globeRotation: [-114.17, -22.27, 0] } }, width, height);
    const points = [];
    const context = { moveTo: (x, y) => points.push([x, y]), lineTo: (x, y) => points.push([x, y]), closePath() {} };
    scope.d3.geo.path().projection(projection).context(context)({ type: 'Sphere' });
    assert.ok(points.length > 3, 'the visible globe must remain drawable');
    assert.ok(points.every(([x,y]) => x >= -6 - 1e-6 && x <= width + 6 + 1e-6 && y >= -6 - 1e-6 && y <= height + 6 + 1e-6),
      `zoom ${zoom}: offscreen globe paths must not reach Canvas rasterization`);
    if (zoom > 1) {
      assert.ok(points.some(([x]) => Math.abs(x + 6) < 1e-6));
      assert.ok(points.some(([x]) => Math.abs(x - width - 6) < 1e-6));
    }
    assert.equal(projection.clipAngle(), 90, 'retain far hemisphere clipping');
  }
});

test('Canvas reuses exact projected paths across land, terrain and paint-only frames, and invalidates view or geometry changes', () => {
  const scope = runtime();
  assert.equal(typeof scope.cachedPathForTest, 'function');
  const geometry = { type: 'LineString', coordinates: [[113,22], [114,23], [115,22]] };
  const frame = { projection:'globe', view:{globeZoom:16,globeRotation:[-114.17,-22.27,0]} };
  const projection = scope.projectionForTest(frame,1280,752), points=[];
  const target={moveTo:(x,y)=>points.push(['M',x,y]),lineTo:(x,y)=>points.push(['L',x,y]),closePath:()=>points.push(['Z']),arc:(...args)=>points.push(['A',...args])};
  let traversals=0;
  Object.defineProperty(geometry,'coordinates',{get(){traversals++;return [[113,22],[114,23],[115,22]];}});
  const path=scope.cachedPathForTest(projection,target);
  path(geometry);const first=structuredClone(points);points.length=0;
  path({type:'Feature',geometry,properties:{color:'#123456'}});
  assert.deepEqual(points,first);assert.equal(traversals,1);
  const next=scope.cachedPathForTest(scope.projectionForTest(frame,1280,752),target);
  next(geometry);assert.equal(traversals,1,'style-only frames reuse exact projected geometry');
  scope.cachedPathForTest(scope.projectionForTest({...frame,view:{...frame.view,globeZoom:32}},1280,752),target)(geometry);
  assert.equal(traversals,2,'camera changes invalidate paths');
  const replacement={type:'LineString',coordinates:[[114,22],[115,22]]};
  scope.cachedPathForTest(projection,target)(replacement);
  points.length=0;
  scope.cachedPathForTest(projection,target)(geometry);
  assert.deepEqual(points,first);
});



test('Canvas river paints reuse projected segments without changing per-segment widths or water colors', () => {
  const scope=runtime();
  let coordinateReads=0; const coordinate=values=>new Proxy(values,{get(target,key){if(key==='0'||key==='1')coordinateReads++;return target[key];}});
  const geometry={type:'LineString',coordinates:[[113,22],[114,22.5],[115,22]].map(coordinate)};
  scope.setHydroForTest([{type:'Feature',geometry,properties:{category:'river',stroke_widths:[[1,3,5]]}}]);
  const message={riversVisible:true,lakesVisible:true,theme:{ocean:'#123456',riverOpacity:.7,strokes:{river:{width:2}}}};
  const frame={projection:'globe',view:{globeZoom:16,globeRotation:[-114.17,-22.27,0]}};
  const projection=scope.projectionForTest(frame,1280,752), widths=[], colors=[], commands=[];
  const target={save(){},restore(){},setTransform(){},beginPath(){},moveTo:(x,y)=>commands.push([x,y]),lineTo:(x,y)=>commands.push([x,y]),stroke(){widths.push(this.lineWidth);colors.push(this.strokeStyle);}};
  let streams=0;const original=projection.stream;
  projection.stream=function(...args){streams++;return original.apply(this,args);};
  scope.hydroPassForTest(message,projection,1,'river',target);
  const first=structuredClone(commands), readsAfterFirst=coordinateReads;commands.length=0;
  scope.hydroPassForTest(message,projection,1,'river',target);
  assert.deepEqual(commands,first);
  assert.deepEqual(widths,[4,8,4,8]);assert.deepEqual(colors,Array(4).fill('#123456'));
  assert.equal(streams,1,'one D3 stream compiles all segments in a paint');assert.equal(coordinateReads,readsAfterFirst,'unchanged segments must not be reprojected');
});

test('cached Canvas paths preserve D3 polygon holes, disjoint islands, globe clipping and point arcs exactly', () => {
  const scope=runtime();
  const ring=[[113,22],[113,23],[114,23],[114,22],[113,22]];
  const hole=[[113.2,22.2],[113.8,22.2],[113.8,22.8],[113.2,22.8],[113.2,22.2]];
  const shapes=[{type:'Polygon',coordinates:[ring,hole]},
    {type:'MultiPolygon',coordinates:[[ring],[ring.map(([x,y])=>[x+1,y])]]},
    {type:'Point',coordinates:[114,22]}, {type:'Sphere'}, {type:'Feature',geometry:null,properties:{}}];
  for(const zoom of [1,16]) {
    const projection=scope.projectionForTest({projection:'globe',view:{globeZoom:zoom,globeRotation:[-114,-22,0]}},1280,752);
    const record=rows=>({moveTo:(x,y)=>rows.push(['M',x,y]),lineTo:(x,y)=>rows.push(['L',x,y]),closePath:()=>rows.push(['Z']),
      arc:(x,y,r,start,end,reverse=false)=>rows.push(['A',x,y,r,start,end,Boolean(reverse)])});
    for(const shape of shapes) {
      const direct=[],cached=[];
      scope.d3.geo.path().projection(projection).context(record(direct))(shape);
      const path=scope.cachedPathForTest(projection,record(cached));path(shape);
      assert.deepEqual(cached,direct);
      cached.length=0;path(shape);assert.deepEqual(cached,direct);
    }
  }
});

test('Canvas globe retains strokes whose centers sit outside the viewport but whose ink overlaps its edge', () => {
  const scope=runtime();
  for(const [width,outside] of [[4,-1],[40,-15]]) {
    const projection=scope.projectionForTest({projection:'globe',view:{globeZoom:16,globeRotation:[-114,-22,0]},theme:{strokes:{country:{width,join:'round',cap:'round'}}}},1280,752);
    const points=[];
    const geometry={type:'LineString',coordinates:[projection.invert([outside,340]),projection.invert([outside,410])]};
    scope.d3.geo.path().projection(projection).context({moveTo:(x,y)=>points.push([x,y]),lineTo:(x,y)=>points.push([x,y])})(geometry);
    assert.ok(points.length>=2,'visible stroke overlap must not disappear at the canvas edge');
  }
});
});
contractSuite("canvas-worker-background-admission", () => {
const test=__dep0.default;
const assert=__dep1.default;
const policy=__dep8;
const { createGpuCanvasWorker }=__dep9;
const { readFileSync }=__dep4;

const input = Object.freeze({
  rendererMode: 'canvas-worker',
  committedBitmap: true,
  physicalSceneMatched: true,
  temporalPending: false,
});
const surface = Object.freeze({
  cssScale: 700,
  canonicalReady: true,
  focus: true,
});

test('a genuine current Canvas Worker bitmap admits an initial canonical country surface even while terrain tiles continue', () => {
  assert.equal(policy.resolveMapSurfacePresentation({...surface, backgroundPresented:false}).quality,'pending');
  const accepted=policy.canAdmitCanvasWorkerPartialBackground?.(input);
  assert.equal(accepted,true, 'a painted physical background must release the first country frame');
  assert.equal(policy.resolveMapSurfacePresentation({...surface,backgroundPresented:accepted}).quality,'canonical');
});
test('unpainted, wrong-backend and temporal replacements never authorize partial background admission', () => {
  for(const change of [
    {committedBitmap:false},{physicalSceneMatched:false},{temporalPending:true},
    {rendererMode:'webgl2'},{rendererMode:'webgl1'},{rendererMode:'canvas2d'},
  ])assert.equal(policy.canAdmitCanvasWorkerPartialBackground?.({...input,...change}),false);
});

const physical = Object.freeze({ready:true,landRevision:'land-v2',waterRevision:'water-v3'});
const painted = Object.freeze({physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:1,physicalWaterRevision:'water-v3'});
test('only a bitmap containing current physical land and water may certify a Canvas Worker country frame',()=>{
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,physical),true);
  for(const input of [
    {physicalLandCount:0},{physicalLandCount:2},{physicalLandRevision:'land-v1'},
    {physicalWaterCount:0},{physicalWaterCount:2},{physicalWaterRevision:'water-v2'},
  ])assert.equal(policy.canvasWorkerFrameMatchesPhysical({...painted,...input},physical),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,{...physical,ready:false}),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical({},physical),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical(painted,{ready:true,landRevision:'land-v2',waterRevision:null}),false);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical({physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:0},
    {ready:true,landRevision:'land-v2',waterRevision:null}),true);
});

test('a submitted physical WebGL base frame publishes countries without certifying unfinished terrain LOD',()=>{
  const eligible={rendererMode:'webgl2',submittedBaseFrame:true,physicalSceneMatched:true,temporalPending:false};
  assert.equal(policy.canAdmitWebGlPartialBackground(eligible),true);
  assert.equal(policy.canAdmitWebGlPartialBackground({...eligible,rendererMode:'webgl1'}),true);
  for(const change of [{submittedBaseFrame:false},{physicalSceneMatched:false},{temporalPending:true},
    {rendererMode:'canvas-worker'},{rendererMode:'canvas2d'}])
    assert.equal(policy.canAdmitWebGlPartialBackground({...eligible,...change}),false);
  assert.equal(policy.resolveMapSurfacePresentation({...surface,backgroundPresented:true}).quality,'canonical');
});


const canvasFixture = Object.freeze({
  frameId: 10, viewRevision: 3, projectionRevision: 2, projectGeneration: 1,
  projection: 'globe', cssViewport: [960, 672], dpr: 1,
  cssScale: 430, cssTranslate: [480, 336],
  safeInset: {top: 0, right: 0, bottom: 26, left: 0},
  viewState: {rotation: [-40, -20, 0], projectionCenter: null,
    flatCenter: [0, 20], flatZoom: 1, globeZoom: 1.5},
});
const canvasIdentity = Object.freeze({
  projectGeneration: 1, contextRevision: 2, geometryRevision: 1,
  paletteRevision: 5, physicalStyleRevision: 7, terrainVisible: true,
  surfaceQuality: 'canonical', surfaceGeometryQuality: 'canonical',
  surfaceTargetQuality: 'canonical',
});

test('Canvas bitmap picture identity survives only GPU-only frameId churn',()=>{
  const expected=policy.canvasWorkerPresentationKey(canvasFixture,canvasIdentity);
  assert.equal(policy.canvasWorkerPresentationKey({...canvasFixture,frameId:11},canvasIdentity),expected);
  for(const mutation of [
    {viewRevision:4}, {projectionRevision:3}, {projection:'flat'}, {cssScale:431},
    {cssViewport:[960,673]}, {cssTranslate:[481,336]}, {dpr:2},
    {viewState:{...canvasFixture.viewState,rotation:[-41,-20,0]}},
    {viewState:{...canvasFixture.viewState,flatCenter:[1,20]}},
  ])assert.notEqual(policy.canvasWorkerPresentationKey({...canvasFixture,...mutation},canvasIdentity),expected,
    'any distinct camera/viewport must reject the stale picture');
  for(const mutation of [
    {projectGeneration:2},{contextRevision:3},{geometryRevision:2},
    {paletteRevision:6},{physicalStyleRevision:8},{terrainVisible:false},
    {surfaceQuality:'pending'},{surfaceGeometryQuality:'preview'},
    {surfaceTargetQuality:'preview'},
  ])assert.notEqual(policy.canvasWorkerPresentationKey(canvasFixture,{...canvasIdentity,...mutation}),expected,
    'project/scene/style/quality changes must invalidate Worker pictures');
});

test('transport accepts a visually identical older scheduled frame but rejects wrong physical data and rotations',()=>{
  const sent=[],shown=[],rejected=[];let currentFrame=canvasFixture;
  const physical={ready:true,landRevision:'land-v2',waterRevision:null};
  const native={postMessage:message=>sent.push(message),terminate(){}};
  const channel=createGpuCanvasWorker({
    worker:native,generation:1,
    acceptFrame:message=>message.presentationKey===policy.canvasWorkerPresentationKey(currentFrame,canvasIdentity)
      && message.styleRevision===4
      && message.geometryRevision===1
      && message.surfaceQuality==='canonical'
      && policy.canvasWorkerFrameMatchesPhysical(message,physical),
    onStale:message=>rejected.push(message),
  });
  channel.onmessage=event=>{if(event.data.type==='frame')shown.push(event.data);};
  const sourceKey=policy.canvasWorkerPresentationKey(canvasFixture,canvasIdentity);
  channel.queueFrame({type:'view',frameId:10,revision:3,projectGeneration:1,presentationKey:sourceKey});
  native.onmessage({data:{type:'ready'}});
  assert.equal(sent.length,1);
  currentFrame={...canvasFixture,frameId:11};
  native.onmessage({data:{...sent[0],type:'frame',frameId:10,styleRevision:4,geometryRevision:1,
    surfaceQuality:'canonical',physicalLandCount:1,physicalLandRevision:'land-v2',
    physicalWaterCount:0,bitmap:{close(){assert.fail('current picture must not be closed');}}}});
  assert.equal(shown.length,1,'same camera with a newer coordinator frameId is admissible');
  assert.equal(rejected.length,0);
  const moved={...canvasFixture,frameId:12,viewState:{...canvasFixture.viewState,rotation:[-41,-20,0]}};
  currentFrame=moved;
  let closed=0;
  native.onmessage({data:{type:'frame',projectGeneration:1,revision:3,frameId:10,
    presentationKey:sourceKey,styleRevision:4,geometryRevision:1,surfaceQuality:'canonical',
    physicalLandCount:1,physicalLandRevision:'land-v2',physicalWaterCount:0,
    bitmap:{close(){closed++;}}}});
  assert.equal(closed,1);
  assert.equal(rejected.length,1,'a changed camera cannot inherit an old picture');
  currentFrame={...canvasFixture,frameId:13};
  native.onmessage({data:{type:'frame',projectGeneration:1,revision:3,frameId:10,
    presentationKey:sourceKey,styleRevision:4,geometryRevision:1,surfaceQuality:'canonical',
    physicalLandCount:0,physicalWaterCount:0,bitmap:{close(){closed++;}}}});
  assert.equal(closed,2);
  assert.equal(rejected.length,2,'zero physical-land packets must still be rejected');
  channel.terminate();
});

// Actual Canvas transport acceptance and frame-identity behavior are
// exercised in gpu-canvas-worker and gpu-scene-staging runtime suites.
test('Canvas admits only a pinned initial physical preview and never replaces authoritative land or temporal frames',()=>{
  const sourceRevision='b'.repeat(64),previewRevision='a'.repeat(64);
  const preview={geometry:{type:'MultiPolygon',coordinates:[]},revision:previewRevision,
    sourceRevision,certified:true};
  const selected=policy.selectCanvasPhysicalSource({actual:null,state:{ready:false},preview,sourceRevision});
  assert.equal(selected.preview,true);
  assert.equal(policy.canvasWorkerFrameMatchesPhysical({
    physicalLandCount:1,physicalLandRevision:previewRevision,physicalWaterCount:0,
  },selected.context),true);
  for(const mutation of [
    {sourceRevision:'c'.repeat(64)}, {temporalPending:true},
    {preview:{...preview,certified:false}}, {preview:{...preview,sourceRevision:'d'.repeat(64)}},
  ])assert.equal(policy.selectCanvasPhysicalSource({
    actual:null,state:{ready:false},preview,sourceRevision,...mutation,
  }).preview,false,'a preview cannot bypass exact pin or a pending temporal change');
  const actual={geometry:{type:'MultiPolygon',coordinates:[]},revision:'e'.repeat(64)};
  const authoritative={ready:true,landRevision:actual.revision,waterRevision:null};
  const full=policy.selectCanvasPhysicalSource({actual,state:authoritative,preview,sourceRevision});
  assert.equal(full.preview,false);
  assert.equal(full.source,actual);
  assert.equal(policy.selectCanvasPhysicalSource({
    actual,state:{...authoritative,landRevision:'f'.repeat(64)},preview,sourceRevision,
  }).context.ready,false,'invalid authoritative physical source must not silently fallback to preview');
});

test('background picture identity ignores coordinator churn but rejects changed physical view',()=>{
  const frame={frameId:6,viewRevision:8,projectGeneration:1,projection:'globe',dpr:1,
    cssViewport:[960,720],cssScale:300,cssTranslate:[480,360],safeInset:{top:0,bottom:0,left:0,right:0},
    viewState:{rotation:[-20,-15,0],flatCenter:[0,20],globeZoom:1,flatZoom:1}};
  const input={projectGeneration:1,contextRevision:1,physicalStyleRevision:2,
    terrainVisible:true,terrainStyle:'physical',darkTheme:false,
    theme:{baseLandAlpha:1,defaultLand:'#eeeeee',ocean:'#6688aa'}};
  const id=policy.canvasWorkerBackgroundPresentationKey(frame,input);
  assert.equal(policy.canvasWorkerBackgroundPresentationKey({...frame,frameId:9,viewRevision:10},input),id);
  for(const change of [
    {cssScale:301}, {projection:'flat'}, {cssTranslate:[481,360]},
    {viewState:{...frame.viewState,rotation:[-21,-15,0]}},
  ])assert.notEqual(policy.canvasWorkerBackgroundPresentationKey({...frame,...change},input),id);
  for(const change of [{projectGeneration:2},{physicalStyleRevision:3},{terrainStyle:'political'},
    {darkTheme:true},{theme:{...input.theme,ocean:'#114477'}}])
    assert.notEqual(policy.canvasWorkerBackgroundPresentationKey(frame,{...input,...change}),id);
});

// Background style certificates are exercised above with the real key API;
// exact temporal/partial background admission is covered in this suite.
});
contractSuite("canvas-terrain-dem-core", () => {
const test = __canvas_dep0.default;
const assert = __canvas_dep1.default;
const fs = __canvas_dep4.default;
const vm = __canvas_dep5.default;

const context = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../../shared/frontend/js/workers/canvas-terrain-dem-core.js", import.meta.url), 'utf8'), context);
const { convertTile, affineTransform, flatTileRectangle, triangleClip, budgetedDemTiles, convertedBytesPerPixel } = context.self.PandoLabCanvasTerrainDem;
const presentation = JSON.parse(fs.readFileSync(new URL('../fixtures/terrain-presentation.json', import.meta.url)));
const constantTile = height => {
  const dem = new Uint8ClampedArray(3 * 3 * 4), encoded = height + 12000;
  for (let index=0;index<dem.length;index+=4) dem.set([encoded >> 8, encoded & 255, 212, 255], index);
  return { dem, width:3, height:3, tint:new Uint8ClampedArray([...presentation.tint,255]),tintWidth:1,tintHeight:1,
    bounds:[-1,1,1,-1],pixelWidth:1,pixelHeight:1,levelWidth:1350,levelHeight:675 };
};

test('Canvas converts flat plains and plateaus to the selected elevation colors and grayscale', () => {
  for (const row of presentation.flatLand) {
    const options=constantTile(row.height), before=options.dem.slice(), result=convertTile(options);
    assert.deepEqual([...result.land.slice(16,19)],row.rgb,`${row.height}m land`);
    assert.equal(result.political[16],row.gray,`${row.height}m grayscale`);
    assert.deepEqual(options.dem,before,'presentation cannot change source elevations');
  }
  assert.deepEqual([...convertTile(constantTile(-4000)).ocean.slice(16,19)],[53,98,137]);
});

test('Canvas tile conversion interpolates geographic tint before mixing elevation colors', () => {
  const options=constantTile(0);
  const result=convertTile({...options,tint:new Uint8ClampedArray([0,0,0,255,200,100,50,255]),tintWidth:2});
  assert.deepEqual([...result.land.slice(16,19)],[106,115,70]);
});

test('Canvas detailed DEM uses settled height-derived shade with the original polar fallback', () => {
  const dem = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < dem.length; index += 4) dem.set([72, 68, 128, 255], index); // 6500m
  const tint = new Uint8ClampedArray([220, 180, 120, 255]);
  const options = { dem, width: 3, height: 3, tint, tintWidth: 1, tintHeight: 1,
    bounds: [-1, 1, 1, -1], pixelWidth: 1, pixelHeight: 1, levelWidth: 1350, levelHeight: 675 };
  const result = convertTile(options);
  assert.deepEqual([...result.land.slice(16,19)],[235,217,186]);
  assert.equal(result.political[16], 224);
  const polar = convertTile({ ...options, bounds: [-1, 90, 1, 89.8] });
  assert.equal(polar.political[16], 85, 'polar input uses the new neutral-shade normalization and height tone');
});

test('Canvas triangle projection maps every source corner without checkerboard seams', () => {
  const source = [[40, 50], [70, 50], [40, 80]], destination = [[300, 200], [350, 208], [315, 245]];
  const [a, b, c, d, e, f] = affineTransform(source, destination);
  source.forEach(([x, y], index) => {
    assert.ok(Math.abs(a * x + c * y + e - destination[index][0]) < 1e-8);
    assert.ok(Math.abs(b * x + d * y + f - destination[index][1]) < 1e-8);
  });
  assert.equal(affineTransform([[1, 1], [1, 1], [1, 1]], destination), null);
});

test('flat terrain tiles keep positive dimensions through a dateline-centered camera', () => {
  const ordinary = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [0, 20]);
  const dateline = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [170, 20]);
  assert.equal(dateline[2], ordinary[2]);assert.ok(dateline[2] > 0 && dateline[3] > 0);
  const wrapped = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [170, 20], 360);
  assert.ok(Math.abs(wrapped[0] - dateline[0] - 200 * Math.PI) < 1e-8);
});

test('triangle clips cover shared antialiased edges in either winding without moving texture coordinates', () => {
  for (const points of [[[0, 0], [10, 0], [0, 10]], [[0, 0], [0, 10], [10, 0]]]) {
    const clip = triangleClip(points, 0.5);
    assert.ok(clip.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    assert.ok(clip[0][0] <= -0.5 && clip[0][1] <= -0.5);
    assert.deepEqual(points[0], [0, 0]);
  }
});

test('Canvas DEM uses the highest complete viewport LOD that fits its decoded 96MiB budget', () => {
  assert.equal(convertedBytesPerPixel, 12);
  const levels = [{id:0},{id:1},{id:2},{id:3}];
  const spec = key => ({key, pixelWidth:1024, pixelHeight:1024});
  const visible = level => Array.from({length: [2,4,7,16][level.id]},
    (_, index) => spec(`${level.id}/${index}`));
  const budget = 96 * 1024 * 1024;
  const fit = budgetedDemTiles(levels, levels[3], visible, budget);
  assert.equal(fit.level.id, 2, '16 fully decoded three-plane tiles cannot fit 96MiB');
  assert.equal(fit.specs.length, 7);
  assert.equal(fit.limited, true);
  assert.ok(fit.specs.reduce((sum, tile) =>
    sum + (tile.pixelWidth + 2) * (tile.pixelHeight + 2) * convertedBytesPerPixel, 0) <= budget);
  const roomy = budgetedDemTiles(levels, levels[3], visible, 256 * 1024 * 1024);
  assert.equal(roomy.level.id, 3);
  assert.equal(roomy.limited, false);
  assert.equal(budgetedDemTiles(levels, null, visible, budget).level, null);
});
});
