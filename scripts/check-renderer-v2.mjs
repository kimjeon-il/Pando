import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  PROJECT_RENDERER_SEQUENCE,
  REQUIRED_STROKE_SOURCE_MARKERS,
} from './lib/renderer-v2-architecture.mjs';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

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

for (const marker of REQUIRED_STROKE_SOURCE_MARKERS) {
  expect(stroke.includes(marker), `shared GPU stroke renderer is missing ${marker}`);
}
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
expect(interactionMask.includes('MAP_RENDER_DIRTY.GPU_FRAME'), 'view-only dirty mask must draw the shared GPU frame');
expect(!interactionMask.includes('MAP_RENDER_DIRTY.OVERLAY_GEOMETRY'), 'view-only dirty mask may not rebuild overlay geometry');
const sceneGpuMask = coordinator.slice(
  coordinator.indexOf('const sceneGpuMask'),
  coordinator.indexOf('let viewFrameResult'),
);
expect(!sceneGpuMask.includes('MAP_RENDER_DIRTY.GPU_FRAME'), 'view-only GPU draws must not rebuild scene geometry');

let previousRendererIndex = -1;
for (const name of PROJECT_RENDERER_SEQUENCE) {
  const index = coordinator.indexOf(`callRenderer('${name}'`, previousRendererIndex + 1);
  expect(index > previousRendererIndex, `project renderer output order is missing or stale at ${name}`);
  if (index >= 0) previousRendererIndex = index;
}

expect(meshWorker.includes("'geometry.mesh'"), 'country mesh compilation must remain a Worker RPC operation');
expect(meshWorker.includes('transferResult(mesh, meshTransferables(mesh))'), 'mesh Worker must preserve transferable GPU packets');

if (failures.length) {
  console.error(`Renderer v2 architecture check failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Renderer v2 architecture OK: one GPU device, immutable scene packets, view-only frames, and connected AA strokes are canonical.');
