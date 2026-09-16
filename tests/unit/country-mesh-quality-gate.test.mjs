import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCountryPatchPresentation } from '../../assets/js/modules/country-mesh-quality-gate.js';

test('preview base queues country patches instead of mixing a canonical override into the frame', () => {
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'webgl2', canonicalMeshReady: false, ids: ['GRC'] }), {
    mode: 'defer',
    ids: ['GRC'],
  });
});

test('canonical and non-WebGL renderers install country patches immediately', () => {
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'webgl2', canonicalMeshReady: true, ids: ['GRC'] }), {
    mode: 'install',
    ids: ['GRC'],
  });
  assert.deepEqual(decideCountryPatchPresentation({ renderer: 'canvas', canonicalMeshReady: false, ids: ['GRC'] }), {
    mode: 'install',
    ids: ['GRC'],
  });
});
