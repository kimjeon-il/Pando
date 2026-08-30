import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeAdminCountryCoast,
  normalizeCoastDecision,
  planCoastReconciliation,
  planCoastReconciliations,
  validateCoastReplacement,
} from '../../assets/js/modules/coast-reconciliation.js';

const square = () => ({
  type: 'Polygon',
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
});

const offsetSquare = () => ({
  type: 'Polygon',
  coordinates: [[[0, 0.1], [2, 0.1], [2, 2], [0, 2], [0, 0.1]]],
});

test('coast decisions preserve cancellation as a normal result', () => {
  assert.equal(normalizeCoastDecision({ direction: 'independent' }), 'independent');
  assert.equal(normalizeCoastDecision({ direction: 'country-to-admin' }), 'country-to-admin');
  assert.equal(normalizeCoastDecision({ direction: 'admin-to-country' }), 'admin-to-country');
  assert.equal(normalizeCoastDecision({ direction: 'cancel' }), 'cancel');
  assert.throws(() => normalizeCoastDecision({ direction: 'unexpected' }));
});

test('country and imported-area choices update only their selected geometry', () => {
  const conflict = {
    countryGeometry: square(),
    adminGeometry: offsetSquare(),
    countryRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 1 },
    adminRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 1 },
    countryChain: [{ a: [0, 0], b: [2, 0] }],
    adminChain: [{ a: [0, 0.1], b: [2, 0.1] }],
  };
  const countryToUnit = planCoastReconciliation({ conflict, direction: 'country-to-admin' });
  assert.deepEqual(countryToUnit.countryGeometry, conflict.countryGeometry);
  assert.notDeepEqual(countryToUnit.adminGeometry, conflict.adminGeometry);
  assert.equal(validateCoastReplacement(countryToUnit.adminGeometry).ok, true);

  const unitToCountry = planCoastReconciliation({ conflict, direction: 'admin-to-country' });
  assert.deepEqual(unitToCountry.adminGeometry, conflict.adminGeometry);
  assert.notDeepEqual(unitToCountry.countryGeometry, conflict.countryGeometry);
  assert.equal(validateCoastReplacement(unitToCountry.countryGeometry).ok, true);
});

test('coast analysis uses only trusted coast topology and accepts reversed chains', () => {
  const countryFeature = { type: 'Feature', id: 'DEU', properties: { editor_id: 'DEU' }, geometry: square() };
  const adminFeature = {
    type: 'Feature', id: 'SCH', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[0, 0.01], [2, 0.01], [2, 2], [0, 2], [0, 0.01]]] },
  };
  const unavailable = analyzeAdminCountryCoast({ adminFeature, countryFeature, countryTopology: { segments: new Map() } });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.unavailableReason, 'country-coast-not-found');

  const topology = {
    segments: new Map([['bottom', {
      key: 'bottom', kind: 'coast', ownerIds: new Set(['DEU']), a: [2, 0], b: [0, 0],
      refs: [{ featureId: 'DEU', polygonIndex: 0, ringIndex: 0, segmentIndex: 0, a: [2, 0], b: [0, 0], startT: 0, endT: 1 }],
    }]]),
  };
  const analysis = analyzeAdminCountryCoast({ adminFeature, countryFeature, countryTopology: topology });
  assert.equal(analysis.status, 'ready');
  assert.equal(analysis.conflicts.length, 1);
  assert.ok(analysis.conflicts[0].matchedLength > 500);
  assert.ok(analysis.conflicts[0].maxDeviation > 250);
});

test('multiple coast conflicts are applied atomically from original ring indexes', () => {
  const adminGeometry = {
    type: 'Polygon',
    coordinates: [[[0, 0.1], [4, 0.1], [4, 4.1], [0, 4.1], [0, 0.1]]],
  };
  const countryGeometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
  };
  const conflicts = [
    {
      countryGeometry, adminGeometry,
      adminRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 0 },
      countryRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 0 },
      countryChain: [{ a: [0, 0], b: [4, 0] }],
      adminChain: [{ a: [0, 0.1], b: [4, 0.1] }],
    },
    {
      countryGeometry, adminGeometry,
      adminRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 2, endIndex: 2 },
      countryRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 2, endIndex: 2 },
      countryChain: [{ a: [4, 4], b: [0, 4] }],
      adminChain: [{ a: [4, 4.1], b: [0, 4.1] }],
    },
  ];
  const planned = planCoastReconciliations({ conflicts, direction: 'country-to-admin' });
  assert.equal(validateCoastReplacement(planned.adminGeometry).ok, true);
  const ring = planned.adminGeometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(ring.some((point, index) => index && index < ring.length - 1
    && point[0] === ring[index - 1][0] && point[1] === ring[index - 1][1]), false);
  assert.ok(ring.some(point => point[1] === 0));
  assert.ok(ring.some(point => point[1] === 4));
});

test('coast validation rejects self intersections and holes outside the exterior', () => {
  const bowTie = { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] };
  assert.equal(validateCoastReplacement(bowTie).ok, false);
  assert.match(validateCoastReplacement(bowTie).issues.join(' '), /교차|면적/u);

  const outsideHole = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]],
      [[4, 4], [5, 4], [5, 5], [4, 5], [4, 4]],
    ],
  };
  assert.equal(validateCoastReplacement(outsideHole).ok, false);
  assert.match(validateCoastReplacement(outsideHole).issues.join(' '), /exterior/u);
});

test('coast validation unwraps antimeridian rings before intersection and area checks', () => {
  const dateline = {
    type: 'Polygon',
    coordinates: [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]],
  };
  assert.deepEqual(validateCoastReplacement(dateline), { ok: true, issues: [] });
});
