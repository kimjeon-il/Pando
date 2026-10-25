import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionPacket } from "../../shared/frontend/js/modules/selection-packet.js";
import { createSelectionPass } from "../../shared/frontend/js/modules/selection-pass.js";
import { resolveMapInteractionStyle } from "../../shared/frontend/js/modules/map-interaction-style.js";

test('common entity keys survive the static boundary optimization and geometry replacement', () => {
  const key = 'territorial:entity:A';
  const pass = createSelectionPass();
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy' }),
    drawBatches: batches => ({ succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 }),
  } });
  pass.setCountryBoundaryResources({ revision: 'r1', visibleIds: ['asset-A'], strokeResources: {
    selectionBase: { ownerIds: ['asset-A'], packet: { key: 'base', preparedGeometry: {} } },
  } });
  const packet = createSelectionPacket({ channels: { primary: [{ key, boundaryOwnerId: 'asset-A', geometryRevision: 'r1' }] } });
  assert.equal(packet.channels.primary[0].key, key);
  assert.equal(Object.hasOwn(packet, 'country'), false);
  assert.equal(Object.hasOwn(packet, 'generic'), false);
  pass.updateData(packet);
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, [key]);
  const geometry = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0,0],[1,1]] } };
  pass.updateData(createSelectionPacket({ channels: { primary: [{ key, geometryRevision: 'r2', geometry }] } }));
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, [key]);
  pass.updateData(createSelectionPacket());
  assert.deepEqual(pass.draw({}, {}, { frameContext: {} }).channels.primary.renderedKeys, []);
});

test('selection pass forwards union coverage for hover and both selection channels in paint order', () => {
  const draws = [];
  const pass = createSelectionPass();
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true, stats: () => ({ gpuHealth: 'healthy' }),
    drawBatches: batches => {
      draws.push(...batches);
      return { succeeded: true, renderedKeys: batches.map(batch => batch.key), drawCallCount: 1 };
    },
  } });
  const source = { ownerIds: ['asset-A'], packet: { key: 'base', preparedGeometry: {} } };
  pass.setCountryBoundaryResources({ revision: 'r1', visibleIds: ['asset-A'], strokeResources: { base: source, selectionBase: source } });
  pass.updateData(createSelectionPacket({
    style: resolveMapInteractionStyle({ selectionColor: '#315e9d', antiAlias: true }),
    channels: Object.fromEntries(['hover', 'secondary', 'primary'].map(role => [role, [{ key: `${role}:A`, boundaryOwnerId: 'asset-A' }]])),
  }));
  const result = pass.draw({}, {}, { frameContext: {} });
  assert.equal(result.succeeded, true);
  assert.deepEqual(draws.map(batch => [batch.style.width, batch.style.alpha, batch.style.coverage, batch.style.antiAlias]),
    [[1.5, 0.85, 'union', true], [1.5, 0.72, 'union', true], [2.5, 1, 'union', true]]);
  assert.ok(draws.every(batch => batch.style.color === '#315e9d'));
});
