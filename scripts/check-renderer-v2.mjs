import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const contract = read('assets/js/modules/renderer-v2-contract.js');
for (const marker of [
  "TERRAIN: 'terrain'",
  "COUNTRY_FILL: 'country-fill'",
  "HYDRO: 'hydro'",
  "BASE_BOUNDARIES: 'base-boundaries'",
  "TERRITORIAL_BOUNDARIES: 'territorial-boundaries'",
  "SELECTION_STROKE: 'selection-stroke'",
  "EDIT_PREVIEW: 'edit-preview'",
  "PICKING: 'picking'",
  'webGlContextCount: 1',
  'viewRebuildsGeometry: false',
]) expect(contract.includes(marker), `renderer-v2 contract is missing ${marker}`);

const renderer = read('assets/js/modules/gpu-map-renderer.js');
const selection = read('assets/js/modules/selection-pass.js');
const stroke = read('assets/js/modules/gpu-stroke-renderer.js');
const scene = read('assets/js/modules/render-scene.js');
const coordinator = read('assets/js/modules/map-render-coordinator.js');
const meshWorker = read('assets/js/workers/gpu-mesh-worker.js');
const app = read('assets/js/app.js');
const css = read('assets/css/app.css');

expect(renderer.includes('createRenderDevice({'), 'main GPU renderer must own the RenderDevice');
expect(renderer.includes('createGpuStrokeRenderer({'), 'main GPU renderer must own the shared stroke renderer');
expect(renderer.includes('selectionPass.initialize?.(renderDevice, { strokeRenderer, polygonPass: polygonOverlayPass })'), 'selection pass must use the main renderer shared GPU resources');
expect(!selection.includes('getContext('), 'selection pass may not create a second WebGL context');
expect(!app.includes('gpu-selection-canvas') && !css.includes('gpu-selection-canvas'), 'selection-only WebGL canvas must stay removed');

for (const marker of [
  'GPU_STROKE_FLAGS',
  'aPrevious',
  'aNext',
  'ownerNodeRanges',
  'uMiterLimit',
  'uAaRadius',
  'smoothstep(-uAaRadius,uAaRadius,edge)',
  'connectedTopology: true',
  'analyticAa: true',
]) expect(stroke.includes(marker), `shared GPU stroke renderer is missing ${marker}`);
expect(stroke.includes("if (join === 'miter') return 1"), 'GPU stroke renderer must expose miter joins');
expect(stroke.includes("if (join === 'bevel') return 2"), 'GPU stroke renderer must expose bevel joins');
expect(stroke.includes("style.cap === 'round'"), 'GPU stroke renderer must expose round caps');

for (const marker of [
  'Object.freeze({',
  'geometryRevision',
  'resolveRenderLod',
  'simplifyRenderGeometry',
  'polygonCache',
  'strokeCache',
]) expect(scene.includes(marker), `RenderScene contract is missing ${marker}`);
expect(scene.includes("projection: input.projection === 'globe' ? 'globe' : 'flat'"), 'RenderScene cache key must separate projection without depending on view position');

const interactionMask = coordinator.slice(
  coordinator.indexOf('const INTERACTION_MASK'),
  coordinator.indexOf('const SETTLE_MASK'),
);
expect(interactionMask.includes('MAP_RENDER_DIRTY.VIEW'), 'view-only dirty mask must include view state');
expect(!interactionMask.includes('MAP_RENDER_DIRTY.GPU_FRAME'), 'view-only dirty mask may not rebuild GPU scene geometry');
expect(!interactionMask.includes('MAP_RENDER_DIRTY.OVERLAY_GEOMETRY'), 'view-only dirty mask may not rebuild overlay geometry');

expect(meshWorker.includes("'geometry.mesh'"), 'country mesh compilation must remain a Worker RPC operation');
expect(meshWorker.includes('transferResult(mesh, meshTransferables(mesh))'), 'mesh Worker must preserve transferable GPU packets');

if (failures.length) {
  console.error(`Renderer v2 architecture check failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Renderer v2 architecture OK: one GPU device, immutable scene packets, view-only frames, and connected AA strokes are canonical.');
