import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { timelineCases, timelineContext } from '../tests/fixtures/timeline-records-cases.mjs';

// Current-source A/B: only the named baseline blobs are read, never a second
// checkout. Run with --expose-gc, with no concurrent builds or browser tests.
const root = fileURLToPath(new URL('../', import.meta.url));
const arg = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--baseline') && process.argv.includes('--output'), 'Required: --baseline REV --output FILE');
const baseline = execFileSync('git', ['rev-parse', '--verify', arg('--baseline') + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
const output = resolve(arg('--output'));
const only = process.argv.includes('--only') ? arg('--only') : null;
assert.ok(only === null || ['timeline', 'source-analysis', 'import'].includes(only), 'Unknown --only operation');
const scratch = resolve(dirname(output), 'baseline-' + baseline.slice(0, 12));
mkdirSync(scratch, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blob = file => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const moduleFrom = async file => {
  let source = blob(file).toString('utf8');
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, quote, specifier) => quote + new URL(specifier, pathToFileURL(resolve(root, file))).href + quote);
  source = source.replace("from 'eslint'", `from '${pathToFileURL(createRequire(import.meta.url).resolve('eslint')).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
};
const coreFile = 'assets/wasm/pandoeditor-core';
const beforeJs = blob(coreFile + '.js'), beforeWasm = blob(coreFile + '.wasm');
writeFileSync(resolve(scratch, 'core.mjs'), beforeJs);
const { default: beforeFactory } = await import(pathToFileURL(resolve(scratch, 'core.mjs')).href);
const { default: afterFactory } = await import(pathToFileURL(resolve(root, coreFile + '.js')).href);
const afterBytes = readFileSync(resolve(root, coreFile + '.wasm'));
async function instantiate(factory, bytes) {
  let memory;
  const core = await factory({ wasmBinary: bytes, instantiateWasm(imports, receive) {
    const module = new globalThis.WebAssembly.Module(bytes), instance = new globalThis.WebAssembly.Instance(module, imports);
    memory = Object.values(instance.exports).find(value => value instanceof globalThis.WebAssembly.Memory);
    assert.ok(memory, 'WASM linear memory must be observable for allocation comparison');
    receive(instance, module);
    return instance.exports;
  } });
  return { core, memoryBytes: () => memory.buffer.byteLength };
}
const beforeRuntime = await instantiate(beforeFactory, beforeWasm), afterRuntime = await instantiate(afterFactory, afterBytes);
const beforeCore = beforeRuntime.core, afterCore = afterRuntime.core;
const beforeParser = await moduleFrom('scripts/lib/source-analysis.mjs');
const afterParser = await import('../scripts/lib/source-analysis.mjs');
const beforeImport = await moduleFrom('assets/js/modules/import-service.js');
const afterImport = await import('../assets/js/modules/import-service.js');
await import('./load-spherical-core.mjs');
await import('../assets/js/vendor/polygon-clipping.min.js');
const geometry = await import('../assets/js/modules/map-edit-geometry.js');
const { geometryAreaKm2 } = await import('../assets/js/modules/geometry-metrics.js');
const capture = fn => { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, code: error.code, message: error.message }; } };
let parityCases = 0;
for (const row of only && only !== 'timeline' ? [] : timelineCases()) for (const month of ['1900-01', '1914-07', '2026-10']) {
  const after = capture(() => afterCore.timelineResolveWorld(row.input, timelineContext(row.context), month));
  const before = capture(() => beforeCore.timelineResolveWorld(row.input, timelineContext(row.context), month));
  assert.deepEqual(after, before, row.name + ':' + month);
  assert.equal(JSON.stringify(after), JSON.stringify(before), row.name + ': serialized output/error');
  parityCases++;
}
const timelineInput = count => {
  const entities = Array.from({ length: count }, (_, i) => ({ id: `entity:${i}`, entityKind: 'general' })).reverse();
  const records = { schemaVersion: 2, lifetimes: [], geometryBindings: [], parentRelations: [], propertyBindings: [] };
  for (let i = 0; i < count; i++) {
    const entityId = `entity:${i}`;
    records.lifetimes.push({ id: `life:${i}`, entityId, validFrom: '1910', validTo: '1915' });
    for (let year = 1910; year <= 1915; year++) {
      const common = { entityId, validFrom: String(year), validTo: String(year) };
      records.geometryBindings.push({ ...common, id: `geometry:${i}:${year}`, geometryRef: { id: 'shape', version: year - 1909 } });
      records.parentRelations.push({ ...common, id: `parent:${i}:${year}`, parentId: i ? `entity:${Math.floor((i - 1) / 4)}` : '', coverageMode: 'explicit' });
      records.propertyBindings.push({ ...common, id: `name:${i}:${year}`, property: 'name', value: { name: `국가:${i}:${year}`, nameExplicit: true } });
    }
  }
  records.geometryBindings.reverse();
  return { records, context: { entities, geometryExists: () => true } };
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = async fn => {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed, started = performance.now();
  const result = await fn();
  const ms = performance.now() - started, heapAfter = process.memoryUsage().heapUsed;
  return { result, ms, heapGrowthBytes: heapAfter - heapBefore };
};
const metrics = [];
async function pairs(name, before, after, inputSha256, work = null) {
  if (only && !name.startsWith(only)) return;
  const beforeResult = await before(), afterResult = await after();
  assert.deepEqual(beforeResult, afterResult, name + ' exact output');
  if (!name.startsWith('source-analysis-')) assert.equal(JSON.stringify(beforeResult), JSON.stringify(afterResult), name + ' serialized output');
  for (let i = 0; i < 2; i++) { await before(); await after(); }
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const left = i % 2 ? await measure(after) : await measure(before);
    const right = i % 2 ? await measure(before) : await measure(after);
    const a = i % 2 ? right : left, b = i % 2 ? left : right;
    assert.deepEqual(a.result, b.result, name + ' paired exact output');
    if (!name.startsWith('source-analysis-')) assert.equal(JSON.stringify(a.result), JSON.stringify(b.result), name + ' paired serialized output');
    samples.push({ baselineMs: a.ms, candidateMs: b.ms, baselineHeapGrowthBytes: a.heapGrowthBytes, candidateHeapGrowthBytes: b.heapGrowthBytes });
  }
  metrics.push({ name, inputSha256, pairs: samples.length, baselineMedianMs: median(samples.map(s => s.baselineMs)),
    candidateMedianMs: median(samples.map(s => s.candidateMs)), baselineWasmMemoryBytes: beforeRuntime.memoryBytes(),
    candidateWasmMemoryBytes: afterRuntime.memoryBytes(), samples, work });
}
for (const size of only && only !== 'timeline' ? [] : [16, 256, 2048]) {
  const { records, context } = timelineInput(size), original = JSON.stringify(records);
  for (const month of ['1909-12', '1910-01', '1912-07', '1915-12', '1916-01']) {
    assert.deepEqual(afterCore.timelineResolveWorld(records, context, month), beforeCore.timelineResolveWorld(records, context, month)); parityCases++;
  }
  await pairs('timeline-' + size, () => beforeCore.timelineResolveWorld(records, context, '1912-07'),
    () => afterCore.timelineResolveWorld(records, context, '1912-07'), sha256(original));
  assert.equal(JSON.stringify(records), original);
}
const sourceFiles = execFileSync('git', ['ls-files', 'assets/js/modules/*.js', 'scripts/*.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort().filter((_, i) => i % 8 === 0);
const sources = sourceFiles.map(file => readFileSync(resolve(root, file), 'utf8'));
const analyze = parser => sources.map(source => {
  const parsed = parser.parseJavaScript(source), rows = [];
  parser.walkJavaScript(parsed, node => rows.push([node.type, node.start, node.end]));
  return { text: parsed.getText(), rows, globals: parsed.scopeManager.globalScope.through.map(ref => ref.identifier.name), tokens: parsed.ast.tokens };
});
await pairs('source-analysis-' + sources.length, () => analyze(beforeParser), () => analyze(afterParser), sha256(sources.join('\0')));
const feature = (id, x, ring = null) => ({ type: 'Feature', id, properties: { name: id },
  geometry: { type: 'Polygon', coordinates: [ring || [[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] } });
const ring = Array.from({ length: 20000 }, (_, i) => [100 + Math.cos(i / 20000 * 2 * Math.PI), -40 + Math.sin(i / 20000 * 2 * Math.PI)]);
ring.push([...ring[0]]);
const current = { type: 'FeatureCollection', features: Array.from({ length: 128 }, (_, i) => feature(`existing:${i}`, -170 + i * 2)) };
const incoming = { type: 'FeatureCollection', features: [feature('incoming', 0, ring)] };
for (const strategy of only && only !== 'import' ? [] : ['id-replace', 'territory-replacement']) {
  const counts = { before: 0, after: 0 };
  const planner = (module, label) => module.createCountryImportMergePlanner({ clipper: globalThis.polygonClipping,
    clone: structuredClone, featureCountryId: item => item.id, countryName: item => item.properties.name,
    geometryBounds: value => { counts[label]++; return geometry.geometryBounds(value); }, boundsOverlap: geometry.boundsOverlap,
    normalizeGeometry: geometry.normalizeClippedPolygonGeometry, geometryCoordinates: geometry.multiCoordinates,
    planarArea: geometry.area, areaKm2: geometryAreaKm2, validateCountryCollection: () => ({ overlapAreaKm2: 0 }) });
  const a = planner(beforeImport, 'before'), b = planner(afterImport, 'after');
  await a(current, incoming, strategy); await b(current, incoming, strategy);
  const work = { baselineBoundsCalls: counts.before, candidateBoundsCalls: counts.after, incomingVertices: ring.length, existingCountries: current.features.length };
  const original = JSON.stringify({ current, incoming });
  await pairs('import-' + strategy, () => a(current, incoming, strategy), () => b(current, incoming, strategy), sha256(original), work);
  assert.equal(JSON.stringify({ current, incoming }), original);
}
const report = { schema: 'pando-exact-calculation-performance-v1', baseline, candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  candidateDiffSha256: sha256(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })),
  dataRevision: JSON.parse(readFileSync(resolve(root, 'config/library-data.json'))).revision, node: process.version,
  cpu: os.cpus()[0]?.model, platform: process.platform, baselineWasmSha256: sha256(beforeWasm), candidateWasmSha256: sha256(afterBytes),
  scope: 'Node adapters and actual WASM, warm cache, exact deep equality and unchanged input JSON; transient JS heap growth and independent WASM linear-memory high-water capacity observed. Native/GPU peak memory and browser/device FPS are unmeasured.', parityCases, metrics };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, parityCases, metrics: metrics.map(({ name, baselineMedianMs, candidateMedianMs, work }) => ({ name, baselineMedianMs, candidateMedianMs, changePercent: (candidateMedianMs / baselineMedianMs - 1) * 100, work })) }, null, 2));
