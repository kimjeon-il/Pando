import { describe as contractSuite } from 'node:test';
import * as __perf_dep0 from "node:assert/strict";
import * as __perf_dep1 from "node:fs";
import * as __perf_dep2 from "node:path";
import * as __perf_dep3 from "node:test";
import * as __perf_dep4 from "node:zlib";
import * as __perf_dep5 from "node:url";
import * as __perf_dep6 from "../../src/rendering/gpu-map-renderer.js";
import * as __perf_dep7 from "../../src/app/startup-readiness.js";
import * as __perf_dep8 from "../../src/rendering/canonical-country-packet.js";
import * as __perf_dep9 from "../../src/rendering/adaptive-render-quality.js";
import * as __perf_dep10 from "../helpers/source-functions.mjs";
import * as __perf_dep11 from "../helpers/read-frontend-source.mjs";
import * as __perf_dep12 from "node:fs/promises";

// Static source comparison must complete before registering synchronous suites.
const [__labelRendering, __labelContent, __labelSource] = await Promise.all([
  __perf_dep12.readFile(new URL("../../src/rendering/rendering-domain.js", import.meta.url), 'utf8'),
  __perf_dep12.readFile(new URL("../../src/ui/map-content-presentation.js", import.meta.url), 'utf8'),
  __perf_dep12.readFile(new URL("../../src/rendering/label-presentation.js", import.meta.url), 'utf8'),
]);

// Original feature contract: startup-performance.test.mjs
contractSuite("startup-performance", () => {
const assert = __perf_dep0.default;
const fs = __perf_dep1.default;
const path = __perf_dep2.default;
const test = __perf_dep3.default;
const zlib = __perf_dep4.default;
const { fileURLToPath } = __perf_dep5;
const { resolveRenderPixelRatioValue, visibleFlatWorldOffsets } = __perf_dep6;
const { DATA_READINESS, READINESS_EVENTS, canMutateProject, resolveStartupLoadPolicy, transitionDataReadiness } = __perf_dep7;
const { inspectCanonicalCountryPacket } = __perf_dep8;


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const worldBundle = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world/current.json'), 'utf8'));
const buildInput = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world/build-input.json'), 'utf8'));
const legacyManifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data', buildInput.legacyPreviewManifest), 'utf8'));
const manifest = { ...legacyManifest, assets: worldBundle.assets };
const preview = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data', manifest.assets.previewCountries.url))));
const canonicalSource = fs.readFileSync(path.join(root, 'assets/data/territorial-entities/generated/current-world.geojson'), 'utf8').replaceAll('\r\n', '\n');
const canonical = JSON.parse(canonicalSource);
const canonicalPacketGzip = fs.readFileSync(path.join(root, 'assets/data', manifest.assets.canonicalCountryPacket.url));
const canonicalPacketBytes = zlib.gunzipSync(canonicalPacketGzip);
const canonicalPacketBuffer = canonicalPacketBytes.buffer.slice(
  canonicalPacketBytes.byteOffset,
  canonicalPacketBytes.byteOffset + canonicalPacketBytes.byteLength,
);
const canonicalPacketHeader = inspectCanonicalCountryPacket(canonicalPacketBuffer);
const meshHeader = bytes => {
  const prefix = new Uint32Array(bytes.buffer, bytes.byteOffset, 8);
  return new Uint32Array(bytes.buffer, bytes.byteOffset, prefix[1] >= 2 ? 12 : 8);
};
const previewMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data', manifest.assets.previewMesh.url)));
const previewMeshHeader = meshHeader(previewMeshBytes);
const canonicalMeshBytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'assets/data', manifest.assets.canonicalMesh.url)));
const canonicalMeshHeader = meshHeader(canonicalMeshBytes);

function countCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + countCoordinates(item), 0);
}

test('mobile DPR is capped at two while desktop retains the existing cap', () => {
  assert.equal(resolveRenderPixelRatioValue(4, true), 2);
  assert.equal(resolveRenderPixelRatioValue(3, true), 2);
  assert.equal(resolveRenderPixelRatioValue(1.5, true), 1.5);
  assert.equal(resolveRenderPixelRatioValue(4, false), 3);
  assert.equal(resolveRenderPixelRatioValue(2.5, false), 2.5);
  assert.equal(resolveRenderPixelRatioValue(3, false, 1.25), 1.25);
});

test('flat world copies are limited to intervals intersecting the viewport', () => {
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 100,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [-2 * Math.PI, 0, 2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 1000 / (2 * Math.PI),
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: -6000,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({ scale: 0, viewportWidth: 1000 }), [0]);
});

test('readiness transitions enable mutations at geometry-ready and preserve them through enhancement', () => {
  const restoring = transitionDataReadiness('', READINESS_EVENTS.RESTORE_STARTED);
  assert.equal(restoring, DATA_READINESS.RESTORING);
  assert.equal(canMutateProject(restoring), false);
  assert.equal(transitionDataReadiness(restoring, READINESS_EVENTS.GEOMETRY_READY), DATA_READINESS.EDITABLE);
  let readiness = transitionDataReadiness('', READINESS_EVENTS.PREVIEW_READY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_ERROR);
  assert.equal(readiness, DATA_READINESS.ERROR);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.RETRY_GEOMETRY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_READY);
  assert.equal(readiness, DATA_READINESS.EDITABLE);
  assert.equal(canMutateProject(readiness), true);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.MESH_READY);
  assert.equal(readiness, DATA_READINESS.ENHANCED);
  assert.equal(canMutateProject(readiness), true);
});

test('startup load policy is sequential on every device while preserving diagnostic signals', () => {
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', deviceMemory: 8, hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 4, hardwareConcurrency: 12, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '3g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '4g', saveData: true }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 32, hardwareConcurrency: 32, effectiveType: '4g' }).reason, 'interaction-first-v1');
});

test('preview assets preserve country identity within the fixed size and geometry budgets', () => {
  assert.equal(preview.type, 'FeatureCollection');
  assert.equal(preview.features.length, canonical.features.length);
  assert.equal(new Set(preview.features.map(feature => feature.id)).size, preview.features.length);
  assert.deepEqual(
    preview.features.map(feature => String(feature.id)),
    canonical.features.map(feature => String(feature.id)),
  );
  assert.equal(countCoordinates(preview.features.map(feature => feature.geometry.coordinates)), manifest.coordinateCount);
  const originalCoordinates = countCoordinates(canonical.features.map(feature => feature.geometry.coordinates));
  assert.ok(manifest.coordinateCount > 0 && manifest.coordinateCount <= originalCoordinates,
    'the preview cannot gain coordinates beyond its canonical source');
  assert.ok(manifest.combinedCompressedBytes > 0 && manifest.combinedCompressedBytes < Buffer.byteLength(canonicalSource),
    'preview delivery should use fewer bytes than the full canonical geometry');
  assert.equal(manifest.previewDerivation, 'canonical-topology-simplified');
  assert.equal(manifest.previewSourceScale, 'derived');
  assert.match(manifest.previewSourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.previewSourceSha256, manifest.canonicalSourceSha256);
  assert.equal(manifest.supplementedCountryIds, undefined);
  const koreaCoordinateCounts = Object.fromEntries(['KOR', 'PRK'].map(id => [
    id,
    countCoordinates(preview.features.find(feature => feature.id === id)?.geometry?.coordinates),
  ]));
  for (const [id,coordinates] of Object.entries(koreaCoordinateCounts))
    assert.ok(coordinates > 0, id + ': missing visible source geometry');
  assert.equal(previewMeshHeader[2], preview.features.length);
  assert.ok(previewMeshHeader[1] > 0);
  assert.equal(previewMeshHeader[3], manifest.meshVertices);
  assert.equal(previewMeshHeader[6], manifest.coordinateCount);
  assert.equal(canonicalMeshHeader[2], canonical.features.length);
  assert.equal(canonicalMeshHeader[1], previewMeshHeader[1], 'both meshes must use the same public wire format');
  assert.equal(canonicalMeshHeader[3], manifest.assets.canonicalMesh.header[3]);
  assert.equal(canonicalMeshHeader[6], countCoordinates(canonical.features.map(feature => feature.geometry.coordinates)));
  for (const feature of preview.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
    assert.ok(feature.geometry.coordinates.length > 0);
  }
  assert.equal(Object.hasOwn(manifest.assets, "canonicalCountries"),false);
  assert.equal(manifest.assets.canonicalCountryPacket.compressedBytes, canonicalPacketGzip.length);
  assert.equal(manifest.assets.canonicalCountryPacket.decodedBytes, canonicalPacketBytes.length);
  assert.deepEqual(manifest.assets.canonicalCountryPacket.header, canonicalPacketHeader.words);
  assert.deepEqual(manifest.assets.previewMesh.header, [...previewMeshHeader]);
  assert.deepEqual(manifest.assets.canonicalMesh.header, [...canonicalMeshHeader]);
});
});

// Original feature contract: adaptive-render-quality.test.mjs
contractSuite("adaptive-render-quality", () => {
const assert = __perf_dep0.default;
const test = __perf_dep3.default;
const { createAdaptiveRenderQualityController, renderQualityProfile, resolveInitialRenderQuality } = __perf_dep9;


test('device hints choose a conservative initial quality without relying on user agent strings', () => {
  assert.equal(resolveInitialRenderQuality({ deviceMemory: 2, hardwareConcurrency: 8 }), 'coarse');
  assert.equal(resolveInitialRenderQuality({ mobile: true, deviceMemory: 8, hardwareConcurrency: 8 }), 'medium');
  assert.equal(resolveInitialRenderQuality({ deviceMemory: 16, hardwareConcurrency: 12 }), 'high');
});

test('interaction quality keeps canonical geometry while lowering only work budgets', () => {
  const profile = renderQualityProfile('high', { phase: 'interaction' });
  assert.equal(profile.countryMeshQuality, 'canonical');
  assert.equal(profile.terrainResolutionScale, 1);
  assert.equal(profile.backgroundLod, 'high');
  assert.equal(profile.activeEditLod, 'high');
  assert.equal(profile.selectedLod, 'high');
  assert.ok(profile.uploadBudgetBytes < profile.settleUploadBudgetBytes);
});

test('measured expensive frames downgrade the runtime tier with hysteresis', () => {
  let clock = 10_000;
  const controller = createAdaptiveRenderQualityController({
    deviceMemory: 16,
    hardwareConcurrency: 12,
    evaluationWindow: 4,
    degradeWindows: 1,
    changeCooldownMs: 0,
    now: () => ++clock,
  });
  assert.equal(controller.profile().tier, 'high');
  for (let index = 0; index < 4; index += 1) controller.recordFrame(60);
  assert.equal(controller.profile().tier, 'medium');
  assert.equal(controller.stats().qualityChangeCount, 1);
});

test('phase changes are explicit and revisioned', () => {
  const controller = createAdaptiveRenderQualityController({ deviceMemory: 8, hardwareConcurrency: 8 });
  const initial = controller.profile().revision;
  assert.equal(controller.beginInteraction(), true);
  assert.equal(controller.profile().phase, 'interaction');
  assert.ok(controller.profile().revision > initial);
  assert.equal(controller.endInteraction(), true);
  assert.equal(controller.profile().phase, 'settle');
});

test('mobile sharpness uses DPR two at normal tiers while preserving a low-memory tier', () => {
  assert.equal(renderQualityProfile('medium', { mobile: true }).dprCap, 2);
  assert.equal(renderQualityProfile('high', { mobile: true }).dprCap, 2);
  assert.equal(renderQualityProfile('coarse', { mobile: true }).dprCap, 1.5);
  assert.equal(renderQualityProfile('medium', { mobile: false }).dprCap, 1.75);
  assert.equal(renderQualityProfile('coarse', { mobile: false }).dprCap, 1.25);
});
});

// Original feature contract: label-shell-performance.test.mjs
contractSuite("label-shell-performance", () => {
const { applicationFunctionSource } = __perf_dep10;
const { readFrontendSources } = __perf_dep11;
const assert = __perf_dep0.default;
const test = __perf_dep3.default;

const app = readFrontendSources('map-projection', 'gpu-scene', 'map-workspace-host', 'territorial-labels');
const rendering = __labelRendering;
const content = __labelContent;
const labels = __labelSource;

const functionSource = applicationFunctionSource;

test('globe shell uses frame-context circles instead of rebuilding a D3 Sphere path', () => {
  const shell = functionSource(readFrontendSources('map-projection'), 'updatePandoGlobeShell', 'featureFromGeometry');
  assert.match(shell, /frameContext\.cssTranslate/);
  assert.match(shell, /frameContext\.cssScale/);
  assert.match(shell, /\.attr\('cx', translate\[0\]\)/);
  assert.match(shell, /\.attr\('r', radius\)/);
  assert.doesNotMatch(shell, /Sphere|\.attr\('d'|\bpath\b/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'map-ocean map-ocean-globe'\)/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'globe-shadow'\)/);
  assert.match(content, /const syncBaseView = \(viewState = null\) =>/);
  assert.match(content, /replaceGpuSceneDomain\?\.\('base-graticule', \{ strokes:/);
  assert.doesNotMatch(rendering, /graticuleLayer|gpuOwnsGraticule/);
  assert.match(rendering, /viewPresentation: commitViewAttachedLayers/);
});

test('label positioning commits inside the shared visual frame without a private cadence', () => {
  assert.doesNotMatch(rendering, /labelCadenceIntervalMs|scheduleLabelPositions|pendingLabelPositionFrameContext/);
  assert.doesNotMatch(labels, /labelCadenceIntervalMs|scheduleLabelPositions|pendingLabelPositionFrameContext/);
  assert.match(labels, /renderTerritorialLabelPositions = frameContext => \{/);
  assert.match(labels, /renderUserLabelPositions = frameContext => applyUserLabelPositions\(frameContext\)/);
  assert.match(rendering, /renderTerritorialLabelPositions\(frame\)/);
  assert.match(rendering, /renderUserLabelPositions\(frame\)/);
  assert.match(rendering, /frameProjectCoordinate\(coordinate, frameContext\)/);
  assert.match(app, /territorialLabelPoints: new Map/);
  assert.match(app, /userLabelPoints: new Map/);
  assert.doesNotMatch(app, /if \(!isCoordVisible\(coordinate\)\) continue;\s*const point = activeProjection\(\)\(coordinate\)/);
});
});
