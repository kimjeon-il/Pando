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
  'drawing-service.js',
  'map-render-coordinator.js',
  'history-service.js',
  'historical-library-service.js',
  'import-service.js',
  'map-edit-worker-client.js',
];
for (const name of domFreeModules) {
  const source = sourceByFile.get(path.join(modulesDirectory, name));
  if (!source) throw new Error(`Missing runtime boundary module: ${name}`);
  for (const token of ['document.', 'querySelector(', 'getElementById(']) {
    if (source.includes(token)) throw new Error(`${name} must remain DOM-free: ${token}`);
  }
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
