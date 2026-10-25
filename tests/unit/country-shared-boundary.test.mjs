import '../helpers/spherical-core.mjs';
import { createMapVisualFrame } from "../../shared/frontend/js/modules/map-visual-frame.js";
import { resolveMapStrokeStyle } from "../../shared/frontend/js/modules/map-interaction-style.js";
import { createEnvironment } from "../../apps/editor/frontend/js/modules/app-environment.js";
import { layerStyle, normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";
import { createRenderingDomain } from "../../shared/frontend/js/modules/rendering-domain.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountrySharedBoundarySegments } from "../../shared/frontend/js/modules/boundary-topology.js";
import { prepareCountrySharedBoundaryPacket, visibleCountrySharedSegments, shouldShowSharedCountryBorders, createCountrySharedBoundaryState } from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import { countryGeometrySignature, changedCountryGeometryIds } from "../../shared/frontend/js/modules/country-shared-boundary-cache.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";
import { connectBoundarySegments } from "../../shared/frontend/js/modules/boundary-lines.js";

const displayLength = segments => segments.reduce((sum, segment) => sum
  + Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]), 0);

const rectangle = (id, west, south, east, north) => ({
  type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]] },
});

test('one shared packet owns parent and child outlines with the same coast policy and distinct line shapes', () => {
  const parent = { ...rectangle('ROOT', 0, 0, 2, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('CHILD', 2, 0, 3, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: 'ROOT' } };
  const features = [parent, child], contacts = buildCountrySharedBoundarySegments(features);
  const terrain = prepareCountrySharedBoundaryPacket(contacts, features, { includeOutlines: false });
  assert.ok(terrain.segments.length);
  assert.ok(terrain.segments.every(segment => segment.start[0] === 2 && segment.end[0] === 2));
  assert.equal(terrain.outlineOverrides.segments.length, 0);
  const outline = prepareCountrySharedBoundaryPacket(contacts, features, { includeOutlines: true });
  assert.ok(outline.outlineOverrides.segments.some(segment => segment.ownerIds.includes('CHILD') && segment.start[0] === 3 && segment.end[0] === 3));
  assert.deepEqual(outline.outlineOverrides.internalOwners.CHILD, ['CHILD']);
  assert.deepEqual(outline.outlineOwnerIds, ['CHILD', 'ROOT']);
  const before = structuredClone(features);
  prepareCountrySharedBoundaryPacket(contacts, features);
  assert.deepEqual(features, before);
});

test('general siblings and child boundaries wholly inside a parent remain in the single shared owner', () => {
  const parent = { ...rectangle('ROOT', 0, 0, 4, 4), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('CHILD', 1, 1, 2, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: 'ROOT' } };
  const packet = prepareCountrySharedBoundaryPacket([], [parent, child], { includeOutlines: false });
  assert.ok(packet.segments.length, 'a child inside the parent has a land boundary even without matching source perimeter contacts');
  assert.ok(Object.values(packet.internalOwners).some(ids => ids.includes('CHILD')));
});

test('production theme applies effective country opacity once to shared and native boundaries', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = Object.assign(new globalThis.EventTarget(), { documentElement: { dataset: { theme: 'dark' } } });
    const layerPresentation = normalizeLayerPresentation({ styles: { objects: { opacity: 0.5 } } });
    const env = createEnvironment();
    env.connect({ projectState: { state: { physicalSettings: { terrainVisible: false }, layerPresentation } },
      applicationServicesB: { layerStyle } });
    const theme = env.mapTheme();
    const features = [rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1)];
    const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments(features), features);
    const batches = globalThis.PandoLabCanvasSceneComposition.countryBoundaryBatches(packet, theme, true,
      () => layerStyle(layerPresentation, 'objects'));
    assert.ok(batches.length > 0);
    assert.equal(theme.borderAlpha, 0.46);
    for (const batch of batches) assert.equal(batch.style.alpha, theme.borderAlpha);
  } finally { globalThis.document = previousDocument; }
});

test('pending country packet preserves the production theme opacity until native handoff', async () => {
  const previousDocument = globalThis.document;
  let rendering;
  try {
    globalThis.document = Object.assign(new globalThis.EventTarget(), { documentElement: { dataset: { theme: 'dark' } } });
    const entity = createTerritorialFeature({ id: 'LEFT', entityKind: 'general', geometry: rectangle('LEFT', 0, 0, 1, 1).geometry });
    const state = { territorialEntities: [entity], physicalSettings: { terrainVisible: false },
      pendingCountryRenderIds: new Set(['LEFT']), layerVisibility: { objects: true },
      layerPresentation: normalizeLayerPresentation({ styles: { objects: { opacity: 0.5 } } }) };
    await initializeTestTerritorialState(state);
    const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
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
  const state = createCountrySharedBoundaryState();
  state.replace([left], { cachedSegments: previous, changedIds: new Set(['RIGHT']) });
  assert.deepEqual(state.segments(), []);
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
  const state = createCountrySharedBoundaryState();
  state.replace([left, moved, island], { cachedSegments: previous,
    changedIds: changedCountryGeometryIds([left, moved, island], signatures) });
  assert.deepEqual(state.segments(), []);
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
  assert.ok(packet.segments.length > 1);
  assert.equal(packet.preparedGeometry.segmentCount, packet.segments.length);
  assert.equal(visibleCountrySharedSegments(packet.segments, id => id === 'LEFT').length, packet.segments.length);
  assert.equal(visibleCountrySharedSegments(packet.segments, () => false).length, 0);
});

test('native child contact belongs to dashed lower boundaries and is removed from both solid outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 1), boundaryRootId: 'CHN' };
  const child = { ...rectangle('HKG', 1, 0, 2, 1), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  assert.deepEqual(packet.outlineOverrides.ownerIds, ['CHN', 'HKG']);
  assert.deepEqual(packet.outlineOverrides.internalOwners.HKG, ['HKG']);
  assert.ok(Math.abs(displayLength(packet.outlineOverrides.segments) - 6) < 1e-9);
  assert.ok(packet.outlineOverrides.segments.every(segment => !(segment.start[0] === 1 && segment.end[0] === 1)));
});

test('split contacts remove only their covered interval from solid parent outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 3), boundaryRootId: 'CHN' };
  const child = { ...rectangle('MAC', 1, 1, 2, 2), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|MAC'], ['MAC']);
  const contact = packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN' && segment.start[0] === 1 && segment.end[0] === 1);
  const intervals = connectBoundarySegments(contact.map(segment => [segment.start, segment.end]))
    .map(line => [Math.min(...line.map(point => point[1])), Math.max(...line.map(point => point[1]))])
    .sort((left, right) => left[0] - right[0]);
  assert.deepEqual(intervals, [[0, 1], [2, 3]]);
  assert.ok(Math.abs(displayLength(contact) - 2) < 1e-9);
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
    const dashed = batches.filter(batch => batch.style.dash?.[0] > 0);
    assert.equal(dashed.length, sharedOnly ? 1 : 2);
    assert.ok(dashed.some(batch => batch.ownerIds.includes('CHN|HKG')));
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

test('the shared owner replaces every native outline and applies dashed style to child coasts', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 1, 1, 2, 2), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket([], [parent, child]);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  assert.ok(packet.segments.some(segment => segment.ownerIds.includes('HKG')));
  assert.deepEqual(packet.outlineOverrides.internalOwners.HKG, ['HKG']);
  assert.deepEqual(packet.ownerIds, ['CHN', 'HKG']);
});

test('overlapping parent and child coastlines follow the shared mode policy and have one owner', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 0, 0, 2, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners, { 'CHN|HKG': ['HKG'] });
  assert.ok(packet.segments.length);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  const terrain = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child], { includeOutlines: false });
  assert.ok(terrain.segments.every(segment => segment.start[0] === 2 && segment.end[0] === 2));
  assert.ok(Math.abs(displayLength(terrain.segments) - 4) < 1e-9);
});

test('the same owner pair can have both a coincident coast and an internal contact', () => {
  const multi = (id, parts, rootId) => ({ type: 'Feature', id, properties: {}, boundaryRootId: rootId,
    geometry: { type: 'MultiPolygon', coordinates: parts.map(feature => feature.geometry.coordinates) } });
  const parent = multi('CHN', [rectangle('a', 0, 0, 1, 1), rectangle('b', 5, 0, 6, 1)], 'CHN');
  const child = multi('HKG', [rectangle('a', 0, 0, 1, 1), rectangle('b', 6, 0, 7, 1)], 'CHN');
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.ok(packet.segments.length > 1);
  assert.ok(Math.abs(displayLength(packet.segments) - 1) < 1e-9);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  const coast = packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN'
    && segment.start[0] <= 1 && segment.end[0] <= 1);
  assert.ok(Math.abs(displayLength(coast) - 4) < 1e-9);
  assert.ok(coast.every(segment => segment.ownerIds.includes('HKG')));
  assert.equal(packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'HKG' && segment.start[0] <= 1 && segment.end[0] <= 1).length, 0);
});
