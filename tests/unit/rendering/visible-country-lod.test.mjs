import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleCountryMeshIdsForFrame } from '../../../src/rendering/gpu-country-ranges.js';

const mesh = {
  metadataCountryIds: ['front', 'back'],
  countryBounds: new Int32Array([
    0, 0, 4_000_000, 3_000_000,
    175_000_000, 0, 178_000_000, 3_000_000,
  ]),
  countryBoundsFlags: new Uint32Array([0, 0]),
};

test('viewport LOD sees flat on-screen countries without copying offscreen country geometry', () => {
  const frame = {
    mode: 1, cssViewport: [400, 300], cssTranslate: [200, 150], cssScale: 600,
    flatCenter: [0, 0], worldOffsets: [0],
  };
  assert.deepEqual(visibleCountryMeshIdsForFrame(mesh, frame, { paddingPixels: 64 }), ['front']);
});

test('globe rear-hemisphere country is not prepared as a visible LOD polygon', () => {
  const frame = {
    mode: 0, cssViewport: [400, 300], cssTranslate: [200, 150], cssScale: 400,
    rowX: [0, 1, 0], rowY: [0, 0, 1], rowZ: [1, 0, 0],
  };
  assert.deepEqual(visibleCountryMeshIdsForFrame(mesh, frame, { paddingPixels: 64 }), ['front']);
});

test('incomplete canonical bounds metadata fails open to an all-country derivative', () => {
  assert.equal(visibleCountryMeshIdsForFrame({ metadataCountryIds: ['front'] },
    { mode: 1, cssViewport: [400, 300] }), null);
});
