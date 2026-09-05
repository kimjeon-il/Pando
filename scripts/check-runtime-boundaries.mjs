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
  'hydro-tile-window.js',
  'selection-packet.js',
  'selection-pass.js',
  'selection-stroke-geometry.js',
  'project-domain.js',
  'selection-domain.js',
  'gis-domain.js',
  'editing-domain.js',
  'editing-render-packet.js',
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
const bootstrapSource = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
if (appSource.includes("worker.postMessage({ type: 'execute'")) {
  throw new Error('app.js bypasses map-edit-worker-client.js');
}

for (const token of [
  'createObjectSelectionController',
  'objectSelectionSyncing',
  'selectHandlers:',
  'selectionController:',
]) {
  if (appSource.includes(token)) throw new Error(`app.js bypasses the selection domain: ${token}`);
}
for (const legacyFunction of [
  'selectCountry',
  'selectTerritorialUnit',
  'selectDistributionLayer',
  'selectGenericFeature',
  'selectHydro',
  'selectLabel',
]) {
  if (new RegExp(`function\\s+${legacyFunction}\\b`).test(appSource)) {
    throw new Error(`app.js retains a mixed selection/editor owner: ${legacyFunction}`);
  }
}
const selectionDomainSource = sourceByFile.get(path.join(modulesDirectory, 'selection-domain.js')) || '';
const renderingDomainSource = sourceByFile.get(path.join(modulesDirectory, 'rendering-domain.js')) || '';
if (selectionDomainSource.includes('JSON.stringify')) {
  throw new Error('selection-domain.js must use controller change events instead of serialized snapshots');
}

const editingDomainSource = sourceByFile.get(path.join(modulesDirectory, 'editing-domain.js')) || '';
const editingPacketSource = sourceByFile.get(path.join(modulesDirectory, 'editing-render-packet.js')) || '';
if (!editingDomainSource.includes("from './editing-render-packet.js'")) {
  throw new Error('EditingDomain must own immutable EditingRenderPacket creation');
}
if (!renderingDomainSource.includes('getEditingRenderPacket') || !renderingDomainSource.includes('emitEditingInteraction')) {
  throw new Error('RenderingDomain must consume editing packets and emit typed editing interactions');
}
if (!editingPacketSource.includes('createEditingRenderPacket') || !editingPacketSource.includes('EMPTY_EDITING_RENDER_PACKET')) {
  throw new Error('editing-render-packet.js must expose the production packet contract');
}
for (const token of [
  'state.draftCoords',
  'state.draftHover',
  'state.draftCutAssessment',
  'state.draftEdit',
  'state.draftStroke',
  'state.activeSnap',
]) {
  if (appSource.includes(token)) throw new Error(`app.js retains mutable editing state ownership: ${token}`);
}
for (const name of [
  'queueDraftStrokeRender',
  'genericDraftIssues',
  'refreshDraftDerivedState',
  'getEditableVertices',
  'setEditableVertexCoord',
  'editableVertexPreviewSegments',
  'boundaryTopologyPreviewTargets',
  'moveBoundaryTopologyPreviewTargets',
  'vertexDragBehavior',
  'countryBoundaryVertexDragBehavior',
]) {
  if (new RegExp(`function\\s+${name}\\b`).test(appSource)) throw new Error(`app.js retains legacy editing implementation: ${name}`);
}
if (/renderingDomain\?\.render(?:Draft|DraftInsertionHandle|Vertices|Snap)\?\./.test(appSource)) {
  throw new Error('app.js must invalidate editing overlays instead of directly rendering editing passes');
}
for (const token of ['const editingDomain =', 'state.draftEdit.', 'state.draftCutAssessment']) {
  if (renderingDomainSource.includes(token)) throw new Error(`RenderingDomain mutates or shims editing state: ${token}`);
}
for (const [file, source] of sourceByFile) {
  const name = path.basename(file);
  if (name === 'selection-domain.js' || name === 'object-selection-controller.js') continue;
  if (source.includes('createObjectSelectionController(')) {
    throw new Error(`${name} creates a selection controller outside SelectionDomain`);
  }
}

const removedRuntimeSymbols = [
  'topologySnapCandidates',
  'countryGeometryFingerprint',
  'COUNTRY_PROPERTY_KEYS',
  'genericFeatureRoleCompatible',
  'formatDistance',
  'validateSharedBoundary',
  'deleteGpuProgram',
  'buildGpuStrokeRibbon',
  'GRATICULE_MAX_EDGE_DEGREES',
  'COAST_PREFLIGHT_TARGETS',
  'EXPLICIT_IMPORT_TARGETS',
  'assertMapHost',
  'MAP_OBJECT_INDEX_DEFAULTS',
  'objectActionsFor',
  'rendererV2PassIds',
  'buildSelectionPointCoordinates',
  'assertSourceProvenance',
  'sourceProvenanceKind',
  'VERSION_CHANGE_LEVELS',
  'isSupportedProjectSchemaVersion',
];
const runtimeSources = [appSource, bootstrapSource, ...sourceByFile.values()];
for (const symbol of removedRuntimeSymbols) {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  if (runtimeSources.some(source => pattern.test(source))) throw new Error(`Removed runtime symbol was reintroduced: ${symbol}`);
}

const privateModuleDeclarations = new Map([
  ['adaptive-render-quality.js', ['RENDER_QUALITY_TIERS']],
  ['canonical-country-packet.js', ['CANONICAL_COUNTRY_PACKET_VERSION', 'CANONICAL_COUNTRY_PACKET_HEADER_WORDS']],
  ['coast-reconciliation.js', ['COAST_RECONCILIATION_DEFAULTS', 'localMetricDistance', 'extractExteriorSegments']],
  ['country-import-identity.js', ['countryImportIdentity']],
  ['distribution-model.js', ['normalizeDistributionLayer', 'normalizeDistributionEntry']],
  ['draft-editor.js', ['snapshotDraft']],
  ['draft-stroke.js', ['DRAFT_STROKE_PROFILES', 'draftPointerGroup']],
  ['generic-feature-service.js', ['LEGACY_GENERIC_FEATURE_SCHEMA_VERSION', 'genericFeatureRoleRule']],
  ['geometry-snap.js', ['SNAP_THRESHOLDS']],
  ['geometry-validation.js', ['validateAdministrativeContainment', 'validateDistributionReference']],
  ['gpu-stroke-renderer.js', ['GPU_STROKE_NODE_KINDS']],
  ['historical-library.js', ['normalizeGeometryVersion', 'normalizeWorldSnapshot']],
  ['icon-utils.js', ['ICON_REGISTRY', 'createSvgIcon']],
  ['layer-presentation.js', ['PRESENTATION_GROUPS', 'normalizeLayerStyle']],
  ['map-host.js', ['MAP_PROJECTION_KINDS']],
  ['map-object-categories.js', ['MAP_OBJECT_DOMAINS']],
  ['map-object-spatial-index.js', ['splitGeographicBounds']],
  ['project-state.js', ['PROJECT_FORMATS', 'isProjectObjectId']],
  ['reliability-core.js', ['delayWithSignal']],
  ['render-lod.js', ['RENDER_LOD_LEVELS']],
  ['renderer-v2-contract.js', ['RENDERER_V2_PASS_IDS']],
  ['runtime-performance-metrics.js', ['PERFORMANCE_DIAGNOSTIC_THRESHOLDS']],
  ['selection-stroke-geometry.js', ['RIBBON_SEGMENT_SCALAR_COUNT', 'appendSelectionRibbonSegment', 'ribbonVerticesForSelectionSegments', 'flattenSelectionGeometry']],
  ['temporal.js', ['isLeapYear', 'daysInMonth']],
  ['territorial-units.js', ['territorialUnitType', 'isTerritorialFeature', 'normalizeTerritorialFeature']],
  ['tool-controller.js', ['TOOL_DEFINITIONS']],
  ['worker-rpc.js', ['createWorkerRpcError', 'createCanonicalWorkerRpcCodec']],
]);
for (const [name, symbols] of privateModuleDeclarations) {
  const source = sourceByFile.get(path.join(modulesDirectory, name)) || '';
  for (const symbol of symbols) {
    const exported = new RegExp(`\\bexport\\s+(?:async\\s+)?(?:const|function)\\s+${symbol}\\b`);
    if (exported.test(source)) throw new Error(`${name} exposes internal-only declaration: ${symbol}`);
  }
}

for (const source of runtimeSources) {
  if (/\bnew\s+KeyboardEvent\s*\(/.test(source)) throw new Error('KeyboardEvent must be created from the target element realm');
}

const removedGlobalAssignments = [
  'PANDOLAB_STARTUP_TASK_GATE',
  'PANDOLAB_BUILD_ID',
  'PANDOLAB_DATA_CACHE_NAME',
  'PANDOLAB_DOMAIN_CONTEXT',
  'PANDOLAB_DOMAINS',
  'PANDOLAB_CANONICAL_DATA_PROMISE',
  '__PANDOLAB_EDITING_DOMAIN__',
  '__PANDOLAB_MAP_LAYOUT_METRICS__',
  '__PANDOLAB_SELECTION_PERFORMANCE__',
  '__PANDOLAB_SELECTION_BASELINE__',
  '__PANDOLAB_RENDER_METRICS__',
  '__PANDOLAB_WORKER_METRICS__',
];
for (const name of removedGlobalAssignments) {
  const assignment = new RegExp(`\\b(?:window|globalThis)\\.${name}\\s*=`);
  if (runtimeSources.some(source => assignment.test(source))) throw new Error(`Write-only global facade was reintroduced: ${name}`);
}

const coordinatorSource = sourceByFile.get(path.join(modulesDirectory, 'map-render-coordinator.js')) || '';
for (const token of ['mapRenderCoordinator', 'MAP_RENDER_DIRTY', 'invalidateMask']) {
  if (appSource.includes(token)) throw new Error(`app.js bypasses RenderingDomain invalidation ownership: ${token}`);
}
for (const helper of [
  'invalidateView',
  'invalidateSelection',
  'invalidateSelectionStyle',
  'invalidateGpuInteraction',
  'invalidateOverlayGeometry',
  'invalidateOverlayStyle',
  'invalidateCountryPatch',
  'invalidateHydroPatch',
  'invalidateTerritorialPatch',
  'invalidateGenericPatch',
  'invalidateLabels',
  'invalidateProjectRender',
  'invalidateBaseScene',
]) {
  if (new RegExp(`function\\s+${helper}\\b`).test(appSource)) {
    throw new Error(`app.js retains duplicate render invalidation helper: ${helper}`);
  }
}
if (!renderingDomainSource.includes('createMapRenderCoordinator({')) {
  throw new Error('rendering-domain.js must create and own MapRenderCoordinator');
}
for (const [file, source] of sourceByFile) {
  const name = path.basename(file);
  if (name === 'map-render-coordinator.js' || name === 'rendering-domain.js') continue;
  if (source.includes('createMapRenderCoordinator(')) {
    throw new Error(`${name} creates MapRenderCoordinator outside RenderingDomain`);
  }
}
for (const token of ['STRING_MASKS', 'scheduleFull', 'scheduleView']) {
  if (coordinatorSource.includes(token)) throw new Error(`Coordinator retains render compatibility API: ${token}`);
}
if (/\bFULL\s*:/.test(coordinatorSource)) throw new Error('Coordinator must not expose a FULL mask alias');
for (const method of ['renderFull', 'renderView', 'renderFrame', 'isInteractionActive', 'advanceRevision']) {
  if (new RegExp(`\\b${method}\\s*:`).test(coordinatorSource)) throw new Error(`Coordinator exposes test-only method: ${method}`);
}
const coordinatorPublicFacade = coordinatorSource.slice(coordinatorSource.lastIndexOf('return Object.freeze({'));
if (/\n\s*revision\s*[:,]/.test(coordinatorPublicFacade)) {
  throw new Error('Coordinator must expose renderRevision through getStats only');
}
if (!appSource.includes("invalidateViewport?.('resize')")) {
  throw new Error('app.js resize path must use RenderingDomain.invalidateViewport');
}
if (!appSource.includes("invalidateProjection?.('projection-change')")) {
  throw new Error('app.js projection path must use RenderingDomain.invalidateProjection');
}
if (appSource.includes('renderAll(')) throw new Error('app.js must not retain renderAll compatibility calls');

// Integration debt remains public until app.js delegates the corresponding legacy flow:
// ProjectDomain createEmpty/undo/redo/save, SelectionDomain remove, GIS planning/worker methods,
// and EditingDomain tool/transaction methods. Domain dispose methods are lifecycle debt until a
// single application teardown boundary owns them.

console.log(`Runtime boundaries OK: ${moduleFiles.length} modules, no circular imports.`);
