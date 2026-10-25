import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceCapabilities } from "../../shared/frontend/js/modules/resource-capabilities.js";
import { createProductModePolicy } from "../../shared/frontend/js/modules/product-mode-policy.js";
import { defaultUserPreferences, normalizeUserPreferences } from "../../shared/frontend/js/modules/user-preferences.js";
import { createCameraNavigation } from "../../shared/frontend/js/modules/camera-navigation.js";
import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { createAtomicMapStateController } from "../../shared/frontend/js/modules/map-state-transition.js";
import { createMapLayoutMetricsSnapshot } from "../../shared/frontend/js/modules/map-layout-metrics.js";
import { createMapProjection } from "../../shared/frontend/js/modules/map-projection.js";

test('editor policy excludes globe and decorations without changing viewer support or preferences', () => {
  const editor = resourceCapabilities('editor'), viewer = resourceCapabilities('viewer');
  for (const name of ['globe', 'graticule', 'globeShadow']) {
    assert.equal(editor[name], false); assert.equal(viewer[name], true);
  }
  assert.throws(() => createProductModePolicy('editor').assertProjection('globe'), { code: 'PL-PRODUCT-PROJECTION' });
  assert.doesNotThrow(() => createProductModePolicy('editor').assertProjection('flat'));
  assert.doesNotThrow(() => createProductModePolicy('viewer').assertProjection('globe'));
  const saved = normalizeUserPreferences({ version: 2, backgrounds: { editor: { graticule: true, globeShadow: true, terrainVisible: true }, viewer: { graticule: false, globeShadow: true, terrainStyle: 'political' } } });
  assert.deepEqual(defaultUserPreferences().backgrounds.editor, {});
  assert.deepEqual(saved.backgrounds.editor, {});
  assert.equal(saved.backgrounds.viewer.graticule, false);
  assert.equal(saved.backgrounds.viewer.globeShadow, true);
  assert.equal(saved.backgrounds.viewer.terrainStyle, 'political');
});

test('editor atomic camera restore converts a current globe workspace without touching other state', () => {
  const layout = createMapLayoutMetricsSnapshot({ width: 844, height: 390, mobile: true });
  const navigation = createCameraNavigation();
  navigation.connect({ platform: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }, mapView: { projectionLayoutMetrics: () => layout } });
  const session = createProjectSession({ productMode: 'editor' });
  session.connect({ readiness: { DATA_READINESS: { PREVIEW: 'preview' } }, applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },
    modelValidation: { normalizeLayerPresentation: () => ({}) }, physicalConfig: { PHYSICAL_DATASET: 'fixture' }, domains: {},
    applicationFactories: { createGeometryPreviewState: () => ({}) }, uiFactoriesB: { createSaveStateController: () => ({}) },
    uiFactoriesA: { createAtomicMapStateController }, mapNavigation: navigation });
  session.initializeMapWorkScheduler();
  const draft = session.state.geometryPreview, selection = { id: 'selected' };
  session.state.multiDraft = selection;
  const camera = session.atomicMapStateController, view = { ...session.state.view, globeRotation: [-114.17, -22.27, 0], globeZoom: 4 };
  assert.equal(camera.commit(camera.begin(), { projection: 'globe', view }), true);
  assert.equal(session.state.projection, 'flat');
  assert.ok(Math.abs(session.state.view.flatCenter[0] - 114.17) < 1e-10);
  assert.equal(session.state.view.flatCenter[1], 22.27);
  assert.equal(session.state.view.flatZoom, 4 * layout.globeBaseScale / layout.flatBaseScale);
  assert.deepEqual(view.flatCenter, [0, 20]);
  assert.strictEqual(session.state.geometryPreview, draft); assert.strictEqual(session.state.multiDraft, selection);
  assert.deepEqual(session.state.backgroundSettings, {});
  const before = structuredClone(session.state.view);
  camera.commit(camera.begin(), { projection: 'flat', view: { ...before, flatZoom: 7 } });
  assert.equal(session.state.view.flatZoom, 7); assert.deepEqual(session.state.view.flatCenter, before.flatCenter);
});

test('camera reprojection normalizes either direction after multiple globe revolutions', () => {
  const navigation = createCameraNavigation();
  const layout = createMapLayoutMetricsSnapshot({ width: 1000, height: 700, mobile: false });
  navigation.connect({ platform: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }, mapView: { projectionLayoutMetrics: () => layout } });
  for (const [rotation, longitude] of [[735, -15], [-735, 15], [1455, -15], [-1455, 15], [895, -175]]) {
    const view = { globeRotation: [rotation, -25, 0], globeZoom: 2, flatCenter: [0, 0], flatZoom: 1 };
    const next = navigation.reprojectView(view, 'globe', 'flat');
    assert.deepEqual(next.flatCenter, [longitude, 25]);
    assert.equal(next.flatZoom, 2 * layout.globeBaseScale / layout.flatBaseScale);
    assert.deepEqual(view.globeRotation, [rotation, -25, 0]);
  }
});

test('editor projection initialization never constructs orthographic or graticule geometry', () => {
  for (const mode of ['editor', 'viewer']) {
    const calls = { globe: 0, graticule: 0, flat: 0 };
    const projection = { clipAngle() { return this; }, precision() { return this; } };
    const owner = createMapProjection({ capabilities: resourceCapabilities(mode) });
    owner.connect({ platform: { d3: { geo: {
      orthographic: () => { calls.globe++; return projection; }, equirectangular: () => { calls.flat++; return projection; },
      graticule: () => { calls.graticule++; return () => ({}); }, path: () => ({ pointRadius() { return this; } }),
    } } }, surfaces: { isMobile: () => false } });
    owner.initializeProjections();
    assert.deepEqual(calls, { globe: mode === 'viewer' ? 1 : 0, graticule: mode === 'viewer' ? 1 : 0, flat: 1 });
  }
});
