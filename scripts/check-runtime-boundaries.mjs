import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDirectory = path.join(root, 'assets/js/modules');
const moduleFiles = fs.readdirSync(modulesDirectory)
  .filter(name => name.endsWith('.js'))
  .map(name => path.join(modulesDirectory, name));
const sourceByFile = new Map(moduleFiles.map(file => [file, fs.readFileSync(file, 'utf8')]));

function localImports(file, source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[1].startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), match[1]);
    const target = path.extname(resolved) ? resolved : `${resolved}.js`;
    if (sourceByFile.has(target)) imports.push(target);
  }
  return imports;
}

const graph = new Map([...sourceByFile].map(([file, source]) => [file, localImports(file, source)]));
const visiting = new Set();
const visited = new Set();
const stack = [];
function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map(entry => path.basename(entry)).join(' -> ');
    throw new Error(`Circular module dependency: ${cycle}`);
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) || []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) visit(file);

const domFreeModules = [
  'persistence-service.js',
  'physical-layer-service.js',
  'territorial-service.js',
  'distribution-service.js',
  'generic-feature-service.js',
  'map-render-coordinator.js',
  'history-service.js',
  'historical-library-service.js',
  'import-service.js',
  'map-edit-worker-client.js',
  'render-device.js',
  'render-scene.js',
  'scene-color-cache.js',
  'gpu-polygon-overlay-pass.js',
  'gpu-stroke-renderer.js',
  'selection-packet.js',
  'selection-pass.js',
  'selection-stroke-geometry.js',
  'project-domain.js',
  'selection-domain.js',
  'gis-domain.js',
  'editing-domain.js',
];
for (const name of domFreeModules) {
  const source = sourceByFile.get(path.join(modulesDirectory, name));
  if (!source) throw new Error(`Missing runtime boundary module: ${name}`);
  for (const token of ['document.', 'querySelector(', 'getElementById(']) {
    if (source.includes(token)) throw new Error(`${name} must remain DOM-free: ${token}`);
  }
}

const domainContracts = new Map([
  ['project-domain.js', 'createProjectDomain'],
  ['selection-domain.js', 'createSelectionDomain'],
  ['gis-domain.js', 'createGisDomain'],
  ['editing-domain.js', 'createEditingDomain'],
  ['rendering-domain.js', 'createRenderingDomain'],
]);
for (const [name, factory] of domainContracts) {
  const source = sourceByFile.get(path.join(modulesDirectory, name));
  if (!source || !new RegExp(`export\\s+function\\s+${factory}\\b`).test(source)) {
    throw new Error(`${name} must expose ${factory} as its domain boundary`);
  }
}
for (const name of ['project-domain.js', 'selection-domain.js', 'gis-domain.js', 'editing-domain.js']) {
  const source = sourceByFile.get(path.join(modulesDirectory, name)) || '';
  for (const token of ['document.', 'window.', 'getContext(', 'createElement(']) {
    if (source.includes(token)) throw new Error(`${name} must remain platform-free: ${token}`);
  }
}

const selectionPassSource = sourceByFile.get(path.join(modulesDirectory, 'selection-pass.js')) || '';
for (const token of ['getContext(', 'addEventListener(', 'removeEventListener(']) {
  if (selectionPassSource.includes(token)) throw new Error(`selection-pass.js must not own canvas/context lifecycle: ${token}`);
}
if (sourceByFile.has(path.join(modulesDirectory, 'selection-canvas-host.js'))) {
  throw new Error('selection-canvas-host.js must be removed after single-context integration');
}
for (const name of ['gpu-polygon-overlay-pass.js', 'gpu-stroke-renderer.js', 'selection-pass.js']) {
  const source = sourceByFile.get(path.join(modulesDirectory, name)) || '';
  if (source.includes('getContext(')) throw new Error(`${name} must receive the shared RenderDevice instead of creating a context`);
}

const gpuRendererSource = sourceByFile.get(path.join(modulesDirectory, 'gpu-map-renderer.js')) || '';
for (const token of ['webglcontextlost', 'webglcontextrestored', 'createRenderDevice({']) {
  if (!gpuRendererSource.includes(token)) throw new Error(`gpu-map-renderer.js must own the shared WebGL lifecycle: ${token}`);
}

const javascriptFiles = [path.join(root, 'assets/js/app.js'), ...moduleFiles];
for (const file of javascriptFiles) {
  if (path.basename(file) === 'persistence-service.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const token of ['indexedDB.open(', 'localStorage.setItem(', 'localStorage.removeItem(']) {
    if (source.includes(token)) throw new Error(`${path.relative(root, file)} bypasses persistence-service.js: ${token}`);
  }
}

const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
if (appSource.includes("worker.postMessage({ type: 'execute'")) {
  throw new Error('app.js bypasses map-edit-worker-client.js');
}

console.log(`Runtime boundaries OK: ${moduleFiles.length} modules, no circular imports.`);
