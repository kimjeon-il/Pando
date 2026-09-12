import assert from 'node:assert/strict';
import test from 'node:test';

import { createCountryCommits } from '../../assets/js/modules/app-country-commits.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';

const box = (x0, y0, x1, y1) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]],
});

function harness(kind) {
  const features = [
    { type: 'Feature', id: 'T', properties: { name: 'Target' }, geometry: box(-3, 0, -2, 10) },
    { type: 'Feature', id: 'D', properties: { name: 'Donor' }, geometry: box(0, 0, 10, 10) },
  ];
  const session = {
    id: 'selection-1', kind, stage: 'selection', selectionPhase: 'side',
    targetCountryId: 'T', sourceCountryIds: ['D'], generatedId: 'USR-new', name: '새 국가',
    projectGeneration: 1, settingsRevision: 2, sourceRevision: 3, selectionRevision: 4,
    combinedGeometry: box(1, 1, 3, 3),
  };
  const state = {
    territorySelectionSession: session,
    countriesData: { type: 'FeatureCollection', features },
    geometryPreview: { session: null },
  };
  const requests = [];
  const commits = createCountryCommits();
  commits.connect({
    state,
    countryFeatureById: id => features.find(feature => String(feature.id) === String(id)),
    countryName: feature => feature?.properties?.name || '',
    territoryComponentItems: () => [],
    requireCountriesUnlocked: () => true,
    snapshotEditable: () => structuredClone(features),
    beginWorkerGeometryPreview: async options => { requests.push(options); return true; },
    createCountryFeature: name => ({ type: 'Feature', id: 'temporary', properties: { name }, geometry: null }),
    snapGeometryToGrid: geometry => geometry,
    editingDraftCoordinates: () => [],
    setActionStatus() {},
  });
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
