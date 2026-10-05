import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import { resolveMapStrokeStyle } from '../../assets/js/modules/map-interaction-style.js';
import { createEnvironment } from '../../assets/js/modules/app-environment.js';
import { layerStyle, normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountrySharedBoundarySegments } from '../../assets/js/modules/boundary-topology.js';
import { prepareCountrySharedBoundaryPacket, visibleCountrySharedSegments, shouldShowSharedCountryBorders, reconcileCountrySharedBoundarySegments } from '../../assets/js/modules/country-shared-boundary-packet.js';
import { countryGeometrySignature, changedCountryGeometryIds } from '../../assets/js/modules/country-shared-boundary-cache.js';
import { excludeCountryBoundaryOwners } from '../../assets/js/modules/country-shared-boundary-packet.js';
import '../../assets/js/workers/canvas-scene-composition-core.js';

const rectangle = (id, west, south, east, north) => ({
  type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]] },
});

test('production theme applies effective country opacity once to shared and native boundaries', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = Object.assign(new globalThis.EventTarget(), { documentElement: { dataset: { theme: 'dark' } } });
    const layerPresentation = normalizeLayerPresentation({ styles: { countries: { opacity: 0.5 } } });
    const env = createEnvironment();
    env.connect({ projectState: { state: { physicalSettings: { terrainVisible: false }, layerPresentation } },
      applicationServicesB: { layerStyle } });
    const theme = env.mapTheme();
    const features = [rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1)];
    const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments(features), features);
    const batches = globalThis.PandoLabCanvasSceneComposition.countryBoundaryBatches(packet, theme, true,
      () => layerStyle(layerPresentation, 'countries'));
    assert.ok(batches.length > 0);
    assert.equal(theme.borderAlpha, 0.46);
    for (const batch of batches) assert.equal(batch.style.alpha, theme.borderAlpha);
  } finally { globalThis.document = previousDocument; }
});

test('pending country packet preserves the production theme opacity until native handoff', () => {
  const previousDocument = globalThis.document;
  let rendering;
  try {
    globalThis.document = Object.assign(new globalThis.EventTarget(), { documentElement: { dataset: { theme: 'dark' } } });
    const entity = createTerritorialFeature({ id: 'LEFT', entityKind: 'general', geometry: rectangle('LEFT', 0, 0, 1, 1).geometry });
    const state = { territorialEntities: [entity], physicalSettings: { terrainVisible: false },
      pendingCountryRenderIds: new Set(['LEFT']), layerVisibility: { countries: true },
      layerPresentation: normalizeLayerPresentation({ styles: { countries: { opacity: 0.5 } } }) };
    initializeTestTerritorialState(state);
    const store = createTerritorialEntityStore({ getState: () => state });
    const repo = createTerritorialEntityRepository({ entityStore: store });
    const env = createEnvironment(); env.connect({ projectState: { state }, applicationServicesB: { layerStyle } });
    let actual; const frames = [];
    rendering = createRenderingDomain({ requestFrame: callback => frames.push(callback),
      prepareView: ({ frameId }) => createMapVisualFrame({ frameId, viewState: { projection: 'flat', size: { width: 800, height: 600 }, scale: 100 }, projectPath: () => '' }), territorialResources: { entityRepository: repo },
      countryResources: { getState: () => state, getEntity: repo.get, mapTheme: env.mapTheme,
        countryOutlineFeature: feature => feature, replaceGpuSceneDomain: (_domain, packets) => { actual = packets; } } });
    rendering.invalidateCountryPatch('pending-country-packet'); frames.shift()();
    assert.equal(actual.strokes.length, 1);
    assert.equal(actual.strokes[0].key, 'pending-country-outline:LEFT');
    assert.equal(actual.strokes[0].style.alpha, 0.46);
    assert.equal(actual.strokes[0].style.width, env.mapTheme().strokes.country.width);
  } finally { rendering?.dispose(); globalThis.document = previousDocument; }
});

test('physical country boundaries contain shared land borders exactly once, without coasts', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
    rectangle('ISLAND', 5, 0, 6, 1),
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].ownerIds, ['LEFT', 'RIGHT']);
  assert.deepEqual([segments[0].start, segments[0].end].sort((a, b) => a[1] - b[1]), [[1, 0], [1, 1]]);
});

test('a deleted neighbor turns a former shared border into a coast', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  assert.equal(buildCountrySharedBoundarySegments([left, right]).length, 1);
  assert.equal(buildCountrySharedBoundarySegments([left]).length, 0);
  const previous = buildCountrySharedBoundarySegments([left, right]);
  assert.deepEqual(reconcileCountrySharedBoundarySegments(previous, [left], new Set(['RIGHT'])), []);
});

test('a changed country updates only its shared contact and does not reuse stale cache', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  const island = rectangle('ISLAND', 4, 0, 5, 1);
  const signatures = Object.fromEntries([left, right, island]
    .map(feature => [feature.id, countryGeometrySignature(feature)]));
  const moved = rectangle('RIGHT', 1, 1, 2, 2);
  assert.deepEqual([...changedCountryGeometryIds([left, moved, island], signatures)], ['RIGHT']);
  const previous = buildCountrySharedBoundarySegments([left, right, island]);
  assert.deepEqual(reconcileCountrySharedBoundarySegments(previous, [left, moved, island], new Set(['RIGHT'])), []);
});

test('artificial dateline edges do not become country borders', () => {
  const east = rectangle('EAST', 179, 0, 180, 1);
  const west = rectangle('WEST', 180, 0, 181, 1);
  assert.deepEqual(buildCountrySharedBoundarySegments([east, west]), []);
});

test('physical style alone switches the base border to the shared packet', () => {
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'physical' }), true);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: false, terrainStyle: 'physical' }), false);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'political' }), false);
});

test('one hidden owner keeps a shared border, while two hidden owners remove it', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
  ]);
  const packet = prepareCountrySharedBoundaryPacket(segments);
  assert.equal(packet.preparedGeometry.segmentCount, 1);
  assert.equal(visibleCountrySharedSegments(packet.segments, id => id === 'LEFT').length, 1);
  assert.equal(visibleCountrySharedSegments(packet.segments, () => false).length, 0);
});

test('native child contact belongs to dashed lower boundaries and is removed from both solid outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 1), boundaryRootId: 'CHN' };
  const child = { ...rectangle('HKG', 1, 0, 2, 1), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  assert.deepEqual(packet.outlineOverrides.ownerIds, ['CHN']);
  assert.equal(packet.outlineOverrides.segments.length, 3);
  assert.ok(packet.outlineOverrides.segments.every(segment => !(segment.start[0] === 1 && segment.end[0] === 1)));
});

test('split contacts remove only their covered interval from solid parent outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 3), boundaryRootId: 'CHN' };
  const child = { ...rectangle('MAC', 1, 1, 2, 2), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|MAC'], ['MAC']);
  const contact = packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN' && segment.start[0] === 1 && segment.end[0] === 1);
  assert.deepEqual(contact.map(segment => [segment.start[1], segment.end[1]]), [[0, 1], [2, 3]]);
});

test('excluded country outline ranges stay excluded even from a full mesh submission', () => {
  const mesh = { metadataCountryIds: ['A', 'HKG', 'CHN', 'B'], countryBoundaryRanges: [0, 6, 6, 4, 10, 8, 18, 6] };
  assert.deepEqual(excludeCountryBoundaryOwners([{ first: 0, count: 24 }], mesh, ['HKG', 'CHN']),
    [{ first: 0, count: 6 }, { first: 18, count: 6 }]);
  assert.deepEqual(excludeCountryBoundaryOwners([{ first: 8, count: 12 }], mesh, ['HKG', 'CHN']), [{ first: 18, count: 2 }]);
});

test('both renderers use lower visibility for internal borders and preserve solid external borders', () => {
  const features = [
    { ...rectangle('CHN', 0, 0, 1, 1), boundaryRootId: 'CHN' },
    { ...rectangle('HKG', 1, 0, 2, 1), boundaryRootId: 'CHN' },
    { ...rectangle('VNM', 0, -1, 1, 0), boundaryRootId: 'VNM' },
  ];
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments(features), features);
  const theme = { border: '#323c46', borderAlpha: 1, borderWidth: 1 };
  theme.strokes = Object.fromEntries(['country', 'country-internal'].map(role => [role, resolveMapStrokeStyle({ theme }, role)]));
  const { countryBoundaryBatches, drawStrokes } = globalThis.PandoLabCanvasSceneComposition;
  for (const sharedOnly of [true, false]) {
    const batches = countryBoundaryBatches(packet, theme, sharedOnly, () => ({ opacity: 1 }));
    assert.equal(batches.filter(batch => batch.style.dash?.[0] > 0).length, 1);
    assert.deepEqual(batches.find(batch => batch.style.dash?.[0] > 0).ownerIds, ['CHN|HKG']);
    assert.ok(batches.some(batch => !(batch.style.dash?.[0] > 0)));
    assert.ok(countryBoundaryBatches(packet, theme, sharedOnly, id => id !== 'HKG' ? { opacity: 1 } : null).every(batch => !(batch.style.dash?.[0] > 0)));
    const transparent = countryBoundaryBatches(packet, theme, sharedOnly, id => ({ opacity: id === 'HKG' ? 0.4 : 1 }));
    assert.equal(transparent.find(batch => batch.style.dash?.[0] > 0).style.alpha, 0.4);
  }
  const calls = [];
  const context = { save() {}, restore() {}, beginPath() {}, stroke() { calls.push('stroke'); }, setLineDash(dash) { calls.push([...dash]); } };
  drawStrokes(context, geometry => calls.push(geometry.coordinates), countryBoundaryBatches(packet, theme, true, () => ({ opacity: 1 })));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 3 && call[1] === 2));
  assert.equal(calls.filter(call => call === 'stroke').length, 2);
});

test('native child outlines never paint solid over territorial dashed strokes', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 1, 1, 2, 2), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket([], [parent, child]);
  assert.deepEqual(packet.outlineOwnerIds, ['HKG']);
  assert.deepEqual(packet.outlineOverrides.segments, []);
  assert.deepEqual(packet.ownerIds, ['CHN', 'HKG']);
});

test('overlapping parent and child coastlines stay exterior and have one solid owner', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 0, 0, 2, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners, {});
  assert.deepEqual(packet.segments, []);
  assert.deepEqual(packet.outlineOwnerIds, ['HKG']);
  assert.deepEqual(packet.outlineOverrides.segments, []);
});

test('the same owner pair can have both a coincident coast and an internal contact', () => {
  const multi = (id, parts, rootId) => ({ type: 'Feature', id, properties: {}, boundaryRootId: rootId,
    geometry: { type: 'MultiPolygon', coordinates: parts.map(feature => feature.geometry.coordinates) } });
  const parent = multi('CHN', [rectangle('a', 0, 0, 1, 1), rectangle('b', 5, 0, 6, 1)], 'CHN');
  const child = multi('HKG', [rectangle('a', 0, 0, 1, 1), rectangle('b', 6, 0, 7, 1)], 'CHN');
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.equal(packet.segments.length, 1);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  assert.equal(packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN' && segment.start[0] <= 1 && segment.end[0] <= 1).length, 4);
  assert.equal(packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'HKG' && segment.start[0] <= 1 && segment.end[0] <= 1).length, 0);
});
