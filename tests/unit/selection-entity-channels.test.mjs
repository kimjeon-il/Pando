import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionPacket } from '../../assets/js/modules/selection-packet.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';

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
