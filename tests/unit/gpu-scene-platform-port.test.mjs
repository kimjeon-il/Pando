import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_INTERACTION_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports-map-interaction.js';
import { createGpuScene } from '../../assets/js/modules/gpu-scene.js';

test('GPU scene owner receives the platform runtime asset resolver', () => {
  assert.ok(MAP_INTERACTION_OWNER_PORTS.gpuScene.includes('platform'));
  assert.equal(typeof createGpuScene().connect,'function');
});
