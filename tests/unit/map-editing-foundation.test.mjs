import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBoundaryTopology, moveTopologyNode, planCoastEdit, planSharedBoundaryEdit, topologyNodeKey } from '../../assets/js/modules/boundary-topology.js';
import { geometryAreaKm2, lineDistanceKm, percentChange } from '../../assets/js/modules/geometry-metrics.js';
import { beginGeometryPreview, clearGeometryPreview, createGeometryPreviewState, previewIsCurrent } from '../../assets/js/modules/geometry-preview.js';
import { resolveSnap, snapThreshold } from '../../assets/js/modules/geometry-snap.js';
import { runMapAudit, validateGeometry } from '../../assets/js/modules/geometry-validation.js';
import { automaticLabelSettings, LABEL_PRIORITIES, layoutLabels } from '../../assets/js/modules/label-layout.js';
import { createAtomicMapStateController } from '../../assets/js/modules/map-state-transition.js';

const feature = (id, coordinates) => ({
  type: 'Feature',
  id,
  properties: { editor_id: id },
  geometry: { type: 'Polygon', coordinates: [coordinates] },
});
const clone = value => JSON.parse(JSON.stringify(value));

test('spherical metrics provide useful live distance, area and percentage feedback', () => {
  assert.ok(lineDistanceKm([[0, 0], [1, 0]]) > 111);
  assert.ok(lineDistanceKm([[0, 0], [1, 0]]) < 112);
  assert.ok(geometryAreaKm2(feature('A', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]).geometry) > 12_000);
  assert.equal(percentChange(100, 125), 25);
  assert.equal(percentChange(0, 10), null);
});

test('snap resolution uses screen-space thresholds and nearest candidates', () => {
  const project = coordinate => coordinate;
  const result = resolveSnap({
    coordinate: [5, 5],
    screenPoint: [5, 5],
    project,
    candidates: [
      { kind: 'edge', a: [0, 4], b: [10, 4], segmentKey: 'edge' },
      { kind: 'vertex', coordinate: [5, 5.5], nodeKey: 'vertex' },
    ],
  });
  assert.equal(result.kind, 'vertex');
  assert.equal(result.nodeKey, 'vertex');
  assert.equal(snapThreshold('mouse'), 10);
  assert.equal(snapThreshold('touch'), 18);
});

test('topology materializes a vertex into the opposite owner and moves both countries', () => {
  const left = feature('LEFT', [[0, 0], [1, 0], [1, 0.5], [1, 1], [0, 1], [0, 0]]);
  const right = feature('RIGHT', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  const topology = buildBoundaryTopology([left, right]);
  const node = topology.nodes.get(topologyNodeKey([1, 0.5]));
  assert.equal(node.kind, 'shared');
  assert.ok(node.virtualRefs.some(ref => ref.featureId === 'RIGHT'));
  const map = new Map([['LEFT', clone(left)], ['RIGHT', clone(right)]]);
  const changed = moveTopologyNode(map, node, [1.1, 0.5]);
  assert.deepEqual(changed, new Set(['RIGHT', 'LEFT']));
  assert.ok(map.get('RIGHT').geometry.coordinates[0].some(point => point[0] === 1.1 && point[1] === 0.5));
  assert.ok(map.get('LEFT').geometry.coordinates[0].some(point => point[0] === 1.1 && point[1] === 0.5));
});

test('a multi-owner boundary node moves every country that shares the junction', () => {
  const left = feature('LEFT', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  const right = feature('RIGHT', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  const top = feature('TOP', [[0, 1], [1, 1], [2, 1], [1, 2], [0, 1]]);
  const topology = buildBoundaryTopology([left, right, top]);
  const node = topology.nodes.get(topologyNodeKey([1, 1]));
  assert.equal(node.kind, 'multi-owner');
  const map = new Map([['LEFT', clone(left)], ['RIGHT', clone(right)], ['TOP', clone(top)]]);
  assert.deepEqual(moveTopologyNode(map, node, [1, 1.1]), new Set(['LEFT', 'RIGHT', 'TOP']));
});

test('shared-boundary edit plan exposes only internal borders and fixes an unselected third-country junction', () => {
  const left = feature('LEFT', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  const right = feature('RIGHT', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  const top = feature('TOP', [[0, 1], [1, 1], [2, 1], [1, 2], [0, 1]]);
  const topology = buildBoundaryTopology([left, right, top]);
  const pair = planSharedBoundaryEdit(topology, ['LEFT', 'RIGHT']);
  assert.equal(pair.valid, true);
  assert.ok(pair.editableNodeKeys.has(topologyNodeKey([1, 0])));
  assert.ok(pair.fixedNodeKeys.has(topologyNodeKey([1, 1])));
  assert.equal([...pair.segmentKeys].every(key => topology.segments.get(key).ownerIds.has('LEFT') && topology.segments.get(key).ownerIds.has('RIGHT')), true);

  const all = planSharedBoundaryEdit(topology, ['LEFT', 'RIGHT', 'TOP']);
  assert.equal(all.valid, true);
  assert.ok(all.editableNodeKeys.has(topologyNodeKey([1, 1])));
  assert.equal(all.fixedNodeKeys.size, 0);

  const far = feature('FAR', [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]);
  const withFar = planSharedBoundaryEdit(buildBoundaryTopology([left, right, far]), ['LEFT', 'RIGHT', 'FAR']);
  assert.equal(withFar.valid, false);
  assert.deepEqual(withFar.isolatedIds, ['FAR']);
});

test('coast edit plan excludes shared borders and keeps their junctions as fixed anchors', () => {
  const left = feature('LEFT', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  const right = feature('RIGHT', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  const topology = buildBoundaryTopology([left, right]);
  const coast = planCoastEdit(topology, 'LEFT');
  assert.ok(coast.segmentKeys.size > 0);
  assert.equal([...coast.segmentKeys].every(key => topology.segments.get(key).kind === 'coast'), true);
  assert.ok(coast.fixedNodeKeys.has(topologyNodeKey([1, 0])));
  assert.ok(coast.fixedNodeKeys.has(topologyNodeKey([1, 1])));
  assert.ok(coast.editableNodeKeys.has(topologyNodeKey([0, 0])));
});

test('geometry validation returns a located self-intersection issue and relation audit issues', () => {
  const invalid = feature('BAD', [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]);
  const issues = validateGeometry(invalid);
  assert.ok(issues.some(issue => issue.kind === 'self-intersection' && issue.coordinate));
  const report = runMapAudit({
    countries: [feature('A', [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])],
    units: [
      { type: 'Feature', id: 'orphan', properties: { name: '고아', sovereignId: 'MISSING', parentId: 'NO_PARENT' }, geometry: feature('X', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]).geometry },
      { type: 'Feature', id: 'orphan', properties: { name: '중복', sovereignId: 'A' }, geometry: feature('Y', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]).geometry },
    ],
    distributionEntries: [
      { id: 'entry', mode: 'territorial', territorialUnitId: 'missing-unit' },
      { id: 'entry', mode: 'geometry', geometry: feature('Z', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]).geometry },
    ],
  });
  assert.ok(report.issues.some(issue => issue.kind === 'invalid-sovereign'));
  assert.ok(report.issues.some(issue => issue.kind === 'orphan-administrative'));
  assert.ok(report.issues.some(issue => issue.kind === 'missing-territorial-reference'));
  assert.equal(report.issues.filter(issue => issue.kind === 'duplicate-id').length, 2);
});

test('full audit trusts the canonical baseline and clips only dirty countries exactly', () => {
  const countries = [
    feature('A', [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]),
    feature('B', [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]),
  ];
  let intersections = 0;
  const clipper = {
    intersection() {
      intersections += 1;
      return [[[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]];
    },
  };
  const baseline = runMapAudit({ countries, coarseCountries: countries, clipper });
  assert.equal(intersections, 0);
  assert.equal(baseline.issues.some(issue => issue.kind === 'overlap'), false);
  const edited = runMapAudit({ countries, coarseCountries: countries, preciseAffectedIds: ['A'], clipper });
  assert.equal(intersections, 1);
  assert.equal(edited.issues.some(issue => issue.kind === 'overlap'), true);
});

test('full audit structurally validates only dirty countries when a canonical baseline exists', () => {
  const invalidUnchanged = feature('UNCHANGED', [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]);
  const validDirty = feature('DIRTY', [[3, 0], [4, 0], [4, 1], [3, 1], [3, 0]]);
  const trusted = runMapAudit({
    countries: [invalidUnchanged, validDirty],
    coarseCountries: [invalidUnchanged, validDirty],
    preciseAffectedIds: ['DIRTY'],
  });
  assert.equal(trusted.issues.some(issue => issue.entityRefs?.includes('UNCHANGED')), false);
  const checked = runMapAudit({
    countries: [invalidUnchanged, validDirty],
    coarseCountries: [invalidUnchanged, validDirty],
    preciseAffectedIds: ['UNCHANGED'],
  });
  assert.equal(checked.issues.some(issue => issue.kind === 'self-intersection'), true);
});

test('preview sessions never mutate their source and become stale by revision', () => {
  const state = createGeometryPreviewState();
  const source = [feature('A', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])];
  const session = beginGeometryPreview(state, { operation: 'merge', baseDataRevision: 7, beforeFeatures: source });
  session.beforeFeatures[0].geometry.coordinates[0][0][0] = 99;
  assert.equal(source[0].geometry.coordinates[0][0][0], 0);
  assert.equal(previewIsCurrent(state, session.sessionId, 7), true);
  clearGeometryPreview(state);
  assert.equal(previewIsCurrent(state, session.sessionId, 7), false);
});

test('label layout respects priority and pinned labels', () => {
  const common = { point: [50, 50], width: 40, height: 15, collisionGroup: 'map', minZoom: 0, maxZoom: 10 };
  const output = layoutLabels([
    { ...common, key: 'place', priority: LABEL_PRIORITIES.place },
    { ...common, key: 'country', priority: LABEL_PRIORITIES.country },
    { ...common, key: 'pinned', priority: 1, pinned: true },
  ], { zoom: 2 });
  assert.deepEqual(output.map(item => item.key), ['pinned']);
});

test('a selected label wins a collision without persisting a raw priority override', () => {
  const common = { point: [50, 50], width: 40, height: 15, collisionGroup: 'country', minZoom: 0, maxZoom: 10 };
  const output = layoutLabels([
    { ...common, key: 'ordinary', priority: LABEL_PRIORITIES.country },
    { ...common, key: 'selected', priority: LABEL_PRIORITIES.country, selected: true },
  ], { zoom: 1 });
  assert.deepEqual(output.map(item => item.key), ['selected']);
});

test('label policies override legacy tuning while preserving established manual placement', () => {
  const settings = automaticLabelSettings('city', {
    priority: 999,
    minZoom: 0,
    maxZoom: 1,
    collisionGroup: 'legacy',
    manualPosition: [127, 37],
    pinned: false,
  });

  assert.equal(settings.priority, LABEL_PRIORITIES.majorCity);
  assert.equal(settings.minZoom, 1.25);
  assert.equal(settings.maxZoom, Infinity);
  assert.equal(settings.collisionGroup, 'place');
  assert.deepEqual(settings.manualPosition, [127, 37]);
  assert.equal(settings.pinned, true);
});

test('atomic map state rejects stale snapshots', () => {
  const applied = [];
  const controller = createAtomicMapStateController({ applySnapshot: snapshot => applied.push(snapshot) });
  const first = controller.begin({ year: 1900 });
  const second = controller.begin({ year: 1910 });
  assert.equal(controller.commit(first, { countries: ['old'] }), false);
  assert.equal(controller.commit(second, { countries: ['new'] }), true);
  assert.deepEqual(applied[0].countries, ['new']);
});
