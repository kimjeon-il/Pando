import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCountryCommits } from '../../assets/js/modules/app-country-commits.js';
import { OBJECT_EDITING_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';
import { buildGeometryPreview } from '../../assets/js/modules/geometry-preview.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { hasCanonicalPolygonWinding, normalizePolygonGeometry } from '../../assets/js/modules/map-edit-geometry.js';

const box = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]],
});

function harness(kind) {
  const features = normalizeCountryCollection({ features: [
    { type: 'Feature', id: 'T', properties: { name: 'Target' }, geometry: box(-3, 0, -2, 10) },
    { type: 'Feature', id: 'D', properties: { name: 'Donor' }, geometry: box(0, 0, 10, 10) },
  ] }).features;
  const session = {
    id: 'selection-1', kind, stage: 'selection', activePhase: 'candidate',
    targetCountryId: 'T', sourceCountryIds: ['D'], generatedId: 'USR-new', name: '새 국가',
    projectGeneration: 1, settingsRevision: 2, sourceRevision: 3, selectionRevision: 4,
    combinedGeometry: box(1, 1, 3, 3),
  };
  const state = {
    territorySelectionSession: session,
    territorialEntities: features,
    geometryPreview: { session: null },
  };
  const requests = [];
  const commits = createCountryCommits();
  commits.connect(capabilityPortsForFixture(OBJECT_EDITING_OWNER_PORTS.countryCommits, {
    state,
    entityRepository: {
      get(id) {
        const feature = features.find(candidate => String(candidate.id) === String(id));
        return feature || null;
      },
    },
    TERRITORIAL_UNIT_TYPES: { COUNTRY: 'country', SUBUNIT: 'subunit', REGION: 'region' },
    territorialEntityName: feature => feature?.properties?.name || '',
    territoryComponentItems: () => [],
    requireObjectsUnlocked: () => true,
    snapshotEditable: () => structuredClone(features),
    beginWorkerGeometryPreview: async options => { requests.push(options); return true; },
    createCountryFeature: name => ({ type: 'Feature', id: 'temporary', properties: { name }, geometry: null }),
    snapGeometryToGrid: geometry => geometry,
    editingDraftCoordinates: () => [],
    setActionStatus() {},
  }));
  return { commits, features, requests, session, state };
}

test('annex adapter converts the common selection into the existing worker contract', async () => {
  const h = harness('annex');
  const key = 'selection-1:1:2:3:4';
  assert.equal(await h.commits.prepareAnnexSelectionPreview(h.session, key), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].operation, 'annex');
  assert.deepEqual(h.requests[0].payload.donorIds, ['D']);
  assert.deepEqual(h.requests[0].payload.transferredGeometry, h.session.combinedGeometry);
  assert.equal(h.requests[0].shouldKeepResult(), true);
  h.session.selectionRevision += 1;
  assert.equal(h.requests[0].shouldKeepResult(), false);
});

test('new-country adapter reuses the session id across preview recalculations', async () => {
  const h = harness('new-country');
  const key = 'selection-1:1:2:3:4';
  assert.equal(await h.commits.prepareNewCountrySelectionPreview(h.session, key), true);
  assert.equal(await h.commits.prepareNewCountrySelectionPreview(h.session, key), true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].operation, 'new-country');
  assert.equal(h.requests[0].payload.newFeature.id, 'USR-new');
  assert.equal(h.requests[1].payload.newFeature.id, 'USR-new');
  assert.deepEqual(h.requests[0].payload.transferredGeometry, h.session.combinedGeometry);
});

test('accumulated territory geometry remains a frozen non-interactive render candidate', () => {
  const packet = createEditingRenderPacket({
    territoryOperation: {
      kind: 'annex-territory', phase: 'line',
      candidates: [{ index: -1, geometry: box(0, 0, 1, 1), selected: true, interactive: false }],
    },
  });
  assert.equal(packet.territoryOperation.candidates[0].interactive, false);
  assert.equal(packet.territoryOperation.candidates[0].selected, true);
  assert.equal(Object.isFrozen(packet.territoryOperation.candidates[0].geometry), true);
});

test('archived and current territory pieces retain distinct presentation keys', () => {
  const packet = createEditingRenderPacket({ territoryOperation: { candidates: [
    { key: 'part:one', index: -1, geometry: box(0, 0, 1, 1), selected: true, interactive: false },
    { key: 'part:two', index: -1, geometry: box(2, 0, 3, 1), selected: true, interactive: false },
    { key: 'current:session', index: -1, geometry: box(4, 0, 5, 1), selected: true, interactive: false },
  ] } });
  assert.deepEqual(packet.territoryOperation.candidates.map(candidate => candidate.key),
    ['part:one', 'part:two', 'current:session']);
});

test('annex review uses the validated transferred geometry even when union differences contain only part of it', () => {
  const transferred = box(1, 1, 4, 4);
  const partial = box(1, 1, 2, 2);
  const before = [{ id: 'D', geometry: box(0, 0, 5, 5) }];
  const after = [{ id: 'D', geometry: box(0, 0, 5, 5) }];
  const preview = buildGeometryPreview({ operation: 'annex', beforeFeatures: before, afterFeatures: after,
    transferredGeometry: transferred, clipper: { union: (...polygons) => polygons[0], difference: () => [partial.coordinates] } });
  assert.deepEqual(preview.delta.addedGeometry, transferred);
  assert.deepEqual(preview.delta.removedGeometry, transferred);
  assert.throws(() => buildGeometryPreview({ operation: 'annex', beforeFeatures: before, afterFeatures: after }),
    /편입.*형상/);
});

test('annex preview rejects reversed transferred rings instead of displaying their globe complement', () => {
  const transferred = box(30, 38, 31, 39);
  transferred.coordinates[0].reverse();
  assert.throws(() => buildGeometryPreview({ operation: 'annex', transferredGeometry: transferred }),
    /편입.*형상/);
});

test('preview unions and differences retain canonical outer and hole winding', () => {
  const hole = box(1, 1, 2, 2).coordinates[0];
  const before = normalizePolygonGeometry({ type: 'Polygon', coordinates: [box(0, 0, 4, 4).coordinates[0], hole] });
  const after = normalizePolygonGeometry({ type: 'Polygon', coordinates: [box(-1, 0, 3, 4).coordinates[0], hole] });
  const preview = buildGeometryPreview({ operation: 'reshape', beforeFeatures: [{ id: 'D', geometry: before }],
    afterFeatures: [{ id: 'D', geometry: after }], clipper: globalThis.polygonClipping });
  for (const name of ['beforeUnion', 'afterUnion', 'addedGeometry', 'removedGeometry']) {
    assert.equal(hasCanonicalPolygonWinding(preview.delta[name]), true, name);
  }
  assert.equal(preview.delta.beforeUnion.coordinates[0].length, 2);
  assert.equal(preview.delta.afterUnion.coordinates[0].length, 2);
});
