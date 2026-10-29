import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import {repositoryFrontendSnapshot} from '../helpers/frontend-source.mjs';
import { UI_BUNDLE_SOURCES } from '../../scripts/lib/ui-source-catalog.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const app = read('shared/frontend/js/modules/mobile-sheet-presentation.js')+readFileSync(new URL("../../apps/editor/frontend/js/modules/app-runtime-dependencies.js",import.meta.url),'utf8')+readApplicationOwners('domain-assembly', 'territorial-labels', 'render-quality', 'gpu-scene', 'workspace-surfaces', 'map-host');
const rendering = read('shared/frontend/js/modules/map-content-presentation.js')+read('shared/frontend/js/modules/rendering-domain.js');
const gpuScene = read('shared/frontend/js/modules/gpu-scene.js');
const coordinator = read('shared/frontend/js/modules/map-render-coordinator.js');
const gpuRenderer = read('shared/frontend/js/modules/gpu-map-renderer.js');
const terrainPreparation = read('shared/frontend/js/modules/gpu-terrain-preparation.js');
const mapVisualFrame = read('shared/frontend/js/modules/map-visual-frame.js');
const bootstrap = read('apps/editor/frontend/js/bootstrap.js');
const loader = read('shared/frontend/js/workers/data-loader-worker.js');
const storedAssetLoader = read('shared/frontend/js/modules/stored-asset-loader.js');
const projectRestore = read('apps/editor/frontend/js/modules/app-project-restore.js');
const lifecycleWiring = read('apps/editor/frontend/js/modules/app-connect-lifecycle-ui.js');
const foundationPorts = read('apps/editor/frontend/js/modules/app-capability-ports-foundation.js');
const meshResourceLoader = read('shared/frontend/js/modules/builtin-mesh-resource.js');
const snapshot=await repositoryFrontendSnapshot();
const metadata = snapshot.assets.get('assets/js/build-meta.js').bytes.toString('utf8');
const bundle = snapshot.assets.get('assets/css/ui.bundle.css').bytes.toString('utf8');
const surfaces = read('shared/frontend/css/layout/surfaces.css');
const editorShell = read('shared/frontend/css/components/editor-shell.css');
const modalBundle = snapshot.assets.get('assets/css/ui-modal.bundle.css').bytes.toString('utf8');
const indexHtml = snapshot.html.editor;

test('render resources use frame snapshots instead of Proxy traps', () => {
  assert.doesNotMatch(app, /createLiveResources|new\s+Proxy/);
  assert.match(app, /createResourceSnapshot/);
  assert.match(app, /refreshRenderResources/);
  assert.doesNotMatch(rendering, /getRenderResourceSnapshot/);
  assert.match(rendering, /beginFrame/);
  assert.match(rendering, /renderResourceRefreshCount/);
  assert.match(rendering, /renderResourceProxyCount/);
  assert.match(coordinator, /callRenderer\('beginFrame'/);
  assert.match(rendering, /coordinator\s*=\s*createMapRenderCoordinator\(\{/);
  assert.match(rendering, /renderers:\s*{[\s\S]*?\bbeginFrame,/);
  assert.doesNotMatch(app, /createMapRenderCoordinator|beginFrame:\s*frameContext/);
});

test('label and terrain view work scales with the visible frame', () => {
  const labelMetricsStart = app.indexOf('function territorialLabelScreenMetrics');
  const labelMetricsEnd = app.indexOf('function shouldShowTerritorialLabel', labelMetricsStart);
  const labelMetricsSource = app.slice(labelMetricsStart, labelMetricsEnd);
  assert.ok(labelMetricsStart >= 0 && labelMetricsEnd > labelMetricsStart);
  assert.doesNotMatch(labelMetricsSource, /path\.bounds/);
  assert.match(labelMetricsSource, /geometryBounds\(geometry\)/);
  assert.match(terrainPreparation, /const globe = Number\(frameContext\?\.mode\) === 0/);
  assert.match(terrainPreparation, /const angularStep = globe/);
  assert.doesNotMatch(terrainPreparation, /Math\.ceil\(spanLon \/ 0\.499\)/);
  const adaptiveStart = app.indexOf('function applyAdaptiveRenderQuality');
  const adaptiveEnd = app.indexOf('function queueAdaptiveRenderQualityRefresh', adaptiveStart);
  const adaptiveSource = app.slice(adaptiveStart, adaptiveEnd);
  assert.ok(adaptiveStart >= 0 && adaptiveEnd > adaptiveStart);
  assert.doesNotMatch(adaptiveSource, /MAP_RENDER_DIRTY\.OVERLAY_DATA/);
  assert.match(app, /shouldSampleInteractionBudget = sample\.interactionActive/);
});

test('render hot paths avoid heavyweight diagnostics and eager picking', () => {
  assert.match(gpuRenderer, /function getRuntimeState\(\)/);
  assert.doesNotMatch(rendering, /getStats\?\.\(\{ detailed: false \}\)/);
  assert.match(app, /gpuMapRenderer\.getRuntimeState\?\.\(\)/);
  assert.doesNotMatch(app, /if \(needsBaseScene\) ensureCountryIdScene\(\)/);
  const interactionStart = gpuRenderer.indexOf('function drawCountryInteractionFills');
  const interactionEnd = gpuRenderer.indexOf('function drawCountryBoundaryMask', interactionStart);
  const interactionSource = gpuRenderer.slice(interactionStart, interactionEnd);
  assert.doesNotMatch(interactionSource, /ensureCountryIdScene\(\)/);
  assert.match(interactionSource, /for \(const ranges of \[base, override\]\)/);
  assert.match(interactionSource, /drawProgram\(fillProgram[\s\S]*base\)/);
  assert.match(interactionSource, /drawProgram\(fillProgram[\s\S]*override\)/);
  assert.doesNotMatch(interactionSource, /createCountryTriangleRangeMap|countryTriangleRanges/);
  assert.doesNotMatch(app, /const gpuId = gpuMapRenderer\.pick\(screenPoint\)/);
});

test('flat rendering only submits world copies that intersect the viewport', () => {
  assert.match(gpuRenderer, /export function visibleFlatWorldOffsets/);
  assert.match(mapVisualFrame, /worldOffsets = Object\.freeze\(mode === 0 \? \[0\] : visibleFlatWorldOffsets/);
  assert.doesNotMatch(mapVisualFrame, /worldOffsets = Object\.freeze\(mode === 0 \? \[0\] : \[-2 \* PI, 0, 2 \* PI\]/);
});

test('unchanged scene domains do not enter the patch pipeline', () => {
  assert.match(gpuScene, /previous\?\.geometrySignature === geometrySignature && previous\?\.styleSignature === styleSignature\) return false/);
  assert.match(rendering, /countries\.replaceGpuSceneDomain\?\.\('country-overlays'/);
  assert.match(rendering, /countries\.syncGpuRenderScene\?\.\(\)/);
});

test('data and asset revisions remain separate contracts', () => {
  assert.match(metadata, /"assetRevision":\s*"[^"]+"/);
  assert.match(metadata, /"dataRevision":\s*"data-[a-f0-9]{32}"/);
  assert.match(loader, /const DATA_REVISION/);
  assert.match(storedAssetLoader, /const DATA_CACHE_PREFIX = 'pandolab-data-'/);
  assert.match(loader, /MANIFEST_URL\.searchParams\.set\('v', DATA_REVISION\)/);
  assert.match(bootstrap, /window\.PANDOLAB_DATA_REVISION = DATA_REVISION/);
  assert.match(bootstrap, /firstCanonicalFrameMs: null/);
  assert.match(bootstrap, /canonicalFrameFallbackCount: 0/);
});

test('UI bundle contains every canonical stylesheet exactly once in order', () => {
  let previous = -1;
  for (const source of UI_BUNDLE_SOURCES) {
    const marker = `/* source: ${source} */`;
    const index = bundle.indexOf(marker);
    assert.ok(index > previous, `missing or out-of-order bundle source: ${source}`);
    assert.equal(bundle.indexOf(marker, index + marker.length), -1, `duplicate bundle source: ${source}`);
    previous = index;
  }
  assert.doesNotMatch(bootstrap, /const UI_BUNDLE = '\.\.\/css\/ui\.bundle\.css'/);
  assert.match(indexHtml, /ui\.bundle\.css[^>]+data-pandolab-ui="ui-bundle"/);
  assert.doesNotMatch(bootstrap, /const UI_STYLES/);
});

test('mobile sheet drag stays compositor-only until snap settlement', () => {
  const moveStart = app.indexOf('function moveMobileSheetDrag');
  const moveEnd = app.indexOf('function finishMobileSheetDrag', moveStart);
  const moveSource = app.slice(moveStart, moveEnd);
  assert.ok(moveStart >= 0 && moveEnd > moveStart);
  assert.match(moveSource, /applyMobileSheetDragPreview/);
  assert.doesNotMatch(moveSource, /setMobileSheetHeight|refreshMapSheetMetrics|queueMapResize/);
  assert.match(app, /function finalizeMobileSheetSettlement/);
  assert.match(surfaces, /\.workspace-surface\.mobile-open:is\(\.is-sheet-dragging, \.is-sheet-settling\)/);
  assert.match(surfaces, /transform: translate3d\(0, var\(--sheet-drag-offset, 0px\), 0\)/);
  assert.match(surfaces, /\.workspace-surface\.is-sheet-dragging[\s\S]*transition: none/);
});

test('map chrome avoids live backdrop blur over animated map content', () => {
  assert.doesNotMatch(editorShell, /(?:-webkit-)?backdrop-filter:\s*blur\(/);
  assert.doesNotMatch(surfaces, /(?:-webkit-)?backdrop-filter:\s*blur\(/);
  assert.doesNotMatch(indexHtml, /selection-card|selectionToolbar/);
});

test('canonical startup is input-gated and strictly sequential', () => {
  assert.match(bootstrap, /createStartupTaskGate/);
  assert.match(bootstrap, /canonicalQuietWindowMs:\s*500/);
  assert.match(bootstrap, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(bootstrap, /type: 'start-geometry'/);
  assert.match(loader, /type === 'start-geometry'/);
  assert.doesNotMatch(loader, /loadPolicy\.mode === 'parallel'/);
  assert.doesNotMatch(loader, /await loadPreview\(\);\s*loadGeometry\(\)/);
  assert.match(bootstrap, /createCanonicalCountryStore/);
  assert.match(bootstrap, /canonicalCountryStore\.materializeCollection/);
  assert.match(bootstrap, /budgetMs:\s*4/);
  assert.match(bootstrap, /coordinateBudget:\s*4096/);
  assert.match(loader, /manifest\.assets\.canonicalCountryPacket/);
  assert.match(loader, /canonicalCountryPacketTransferables/);
  assert.doesNotMatch(loader, /manifest\.assets\.canonicalCountries/);
  assert.doesNotMatch(loader, /countriesSourceBuffer|response\.clone\(\)/);
  assert.doesNotMatch(app, /pristineCountriesSourceBuffer|parsePristineCountries/);
});

test('new project reuses a prepared built-in mesh instead of scheduling a world rebuild', () => {
  assert.match(gpuRenderer, /function ensureBuiltinMeshBaseline/);
  assert.match(gpuRenderer, /function activateBuiltinMeshBaseline/);
  assert.match(gpuRenderer, /resourceUpdate/);
  assert.match(loader, /builtin-mesh-only/);
  assert.match(loader, /type: 'builtin-mesh-ready'/);
  assert.match(bootstrap, /identity:\s*data\.identity \|\| null/);
  assert.match(lifecycleWiring, /connectCapabilityOwners\(LIFECYCLE_UI_OWNER_PORTS/);
  assert.match(foundationPorts, /\["canonicalCountryStore","builtinSession","canonicalCountryStore"\]/);
  assert.match(meshResourceLoader, /if \(pending\) return pending/);
  const resetStart = projectRestore.indexOf('async function resetProjectInPlace');
  const resetEnd = projectRestore.indexOf('function initializeConfirmModalController', resetStart);
  const resetSource = projectRestore.slice(resetStart, resetEnd);
  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  assert.doesNotMatch(resetSource, /scheduleGpuMeshRebuild/);
  assert.match(resetSource, /activateBuiltinMeshBaseline/);
  assert.match(resetSource, /cancelGpuMeshRebuild/);
  assert.match(resetSource, /invalidateProject\?\.\('built-in-project-transition-ready'\)/);
});

test('modal, GIS, and historical runtimes are absent from the initial request graph', () => {
  const eagerImportBlock = app.slice(0, app.indexOf("const { createSemanticIcon }"));
  for (const moduleName of [
    'confirm-modal-controller.js',
    'coast-reconciliation-controller.js',
    'import-service.js',
    'country-import-identity.js',
    'coast-reconciliation.js',
    'annex-geometry.js',
    'river-territory-partition.js',
    'territorial-library.js',
    'territorial-library-service.js',
    'territorial-library-controller.js',
  ]) assert.doesNotMatch(eagerImportBlock, new RegExp(moduleName.replace('.', '\\.')));
  assert.doesNotMatch(indexHtml, /<script\b[^>]*src="[^"]*assets\/js\/gis-(?:adapters|io)\.js/);
  assert.match(app, /async function ensureModalRuntime/);
  assert.match(app, /async function ensureGisRuntime/);
  assert.match(app, /async function ensureTerritorialLibraryRuntime/);
  assert.match(modalBundle, /modal-source-count:\s*1/);
  assert.match(modalBundle, /modal-source: assets\/css\/components\/modals\.css/);
  assert.match(bootstrap, /PANDOLAB_ENSURE_MODAL_STYLES/);
});
