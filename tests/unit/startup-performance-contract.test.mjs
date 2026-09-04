import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const app = read('assets/js/app.js');
const rendering = read('assets/js/modules/rendering-domain.js');
const coordinator = read('assets/js/modules/map-render-coordinator.js');
const gpuRenderer = read('assets/js/modules/gpu-map-renderer.js');
const bootstrap = read('assets/js/bootstrap.js');
const loader = read('assets/js/workers/data-loader-worker.js');
const metadata = read('assets/js/build-meta.js');
const bundle = read('assets/css/ui-v2.bundle.css');
const surfaces = read('assets/css/layout/surfaces.css');
const editorShell = read('assets/css/components/editor-shell.css');

const uiSources = Object.freeze([
  'assets/css/tokens/ui-v2.css',
  'assets/css/primitives/controls.css',
  'assets/css/components/surface.css',
  'assets/css/components/content.css',
  'assets/css/components/command-row.css',
  'assets/css/components/workflows.css',
  'assets/css/layout/surfaces.css',
  'assets/css/features/layer-panel.css',
  'assets/css/components/editor-shell.css',
  'assets/css/components/panels.css',
  'assets/css/components/mobile-sheets.css',
  'assets/css/components/feedback.css',
  'assets/css/utilities/accessibility.css',
]);

test('render resources use frame snapshots instead of Proxy traps', () => {
  assert.doesNotMatch(app, /createLiveResources|new\s+Proxy/);
  assert.match(app, /createResourceSnapshot/);
  assert.match(app, /refreshRenderResources/);
  assert.match(rendering, /getRenderResourceSnapshot/);
  assert.match(rendering, /beginFrame/);
  assert.match(rendering, /renderResourceRefreshCount/);
  assert.match(rendering, /renderResourceProxyCount/);
  assert.match(coordinator, /callRenderer\('beginFrame'/);
  assert.match(app, /renderers:\s*{\s*beginFrame:\s*frameContext\s*=>\s*renderingDomain\?\.beginFrame\?\.\(frameContext\)/);
  assert.doesNotMatch(app, /beginFrame:\s*frameContext\s*=>\s*renderingDomain\.beginFrame/);
});

test('label and terrain view work scales with the visible frame', () => {
  const labelMetricsStart = app.indexOf('function countryLabelScreenMetrics');
  const labelMetricsEnd = app.indexOf('function shouldShowCountryLabel', labelMetricsStart);
  const labelMetricsSource = app.slice(labelMetricsStart, labelMetricsEnd);
  assert.ok(labelMetricsStart >= 0 && labelMetricsEnd > labelMetricsStart);
  assert.doesNotMatch(labelMetricsSource, /path\.bounds/);
  assert.match(labelMetricsSource, /geometryBounds\(geometry\)/);
  assert.match(gpuRenderer, /const globe = Number\(frameContext\?\.mode\) === 0/);
  assert.match(gpuRenderer, /const angularStep = globe/);
  assert.doesNotMatch(gpuRenderer, /Math\.ceil\(spanLon \/ 0\.499\)/);
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
  const interactionEnd = gpuRenderer.indexOf('function drawInteractionPasses', interactionStart);
  const interactionSource = gpuRenderer.slice(interactionStart, interactionEnd);
  assert.doesNotMatch(interactionSource, /ensureCountryIdScene\(\)/);
  assert.match(interactionSource, /triangleRangesByCountryId\?\.get\(id\)/);
  assert.doesNotMatch(interactionSource, /createCountryTriangleRangeMap|countryTriangleRanges|for\s*\(/);
  assert.doesNotMatch(app, /const gpuId = gpuMapRenderer\.pick\(screenPoint\)/);
});

test('flat rendering only submits world copies that intersect the viewport', () => {
  assert.match(gpuRenderer, /export function visibleFlatWorldOffsets/);
  assert.match(gpuRenderer, /worldOffsets: mode === 0 \? \[0\] : visibleFlatWorldOffsets/);
  assert.doesNotMatch(gpuRenderer, /worldOffsets: mode === 0 \? \[0\] : \[-2 \* PI, 0, 2 \* PI\]/);
});

test('unchanged scene domains do not enter the patch pipeline', () => {
  assert.match(app, /previous\?\.geometrySignature === geometrySignature && previous\?\.styleSignature === styleSignature\) return false/);
  assert.match(rendering, /const sceneChanged = countries\.replaceGpuSceneDomain/);
  assert.match(rendering, /if \(sceneChanged !== false\) countries\.syncGpuRenderScene/);
});

test('data and asset revisions remain separate contracts', () => {
  assert.match(metadata, /"assetRevision":\s*"[^"]+"/);
  assert.match(metadata, /"dataRevision":\s*"data-[a-f0-9]{32}"/);
  assert.match(loader, /const DATA_REVISION/);
  assert.match(loader, /const DATA_CACHE_PREFIX = 'pandolab-data-'/);
  assert.match(loader, /url\.searchParams\.set\('v', DATA_REVISION\)/);
  assert.match(bootstrap, /window\.PANDOLAB_DATA_REVISION = DATA_REVISION/);
  assert.match(bootstrap, /firstCanonicalFrameMs: null/);
  assert.match(bootstrap, /canonicalFrameFallbackCount: 0/);
});

test('UI bundle contains every canonical stylesheet exactly once in order', () => {
  let previous = -1;
  for (const source of uiSources) {
    const marker = `/* source: ${source} */`;
    const index = bundle.indexOf(marker);
    assert.ok(index > previous, `missing or out-of-order bundle source: ${source}`);
    assert.equal(bundle.indexOf(marker, index + marker.length), -1, `duplicate bundle source: ${source}`);
    previous = index;
  }
  assert.match(bootstrap, /const UI_BUNDLE = '\.\.\/css\/ui-v2\.bundle\.css'/);
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
  assert.match(editorShell, /\.topbar[\s\S]*backdrop-filter: none/);
  assert.match(editorShell, /\[data-layout="wide"\] \.left-panel,[\s\S]*backdrop-filter: none/);
});
