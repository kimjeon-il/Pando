import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMapSurfacePresentation } from '../../shared/frontend/js/modules/country-mesh-zoom-policy.js';

test('a normal map without a presented background keeps its country surface pending', () => {
  const state = resolveMapSurfacePresentation({ cssScale: 700, canonicalReady: true,
    previewReady: false, backgroundPresented: false });
  assert.equal(state.geometryQuality, 'canonical');
  assert.equal(state.quality, 'pending');
});

test('a restored GPU can redraw the accepted canonical source before the new frame commits', () => {
  const state = resolveMapSurfacePresentation({ cssScale: 700, canonicalReady: true,
    backgroundPresented: false, recoveryDrawing: true });
  assert.equal(state.geometryQuality, 'canonical');
  assert.equal(state.quality, 'canonical');
  const unavailable = resolveMapSurfacePresentation({ cssScale: 700,
    canonicalReady: false, backgroundPresented: false, recoveryDrawing: true });
  assert.equal(unavailable.quality, 'pending');
});

test('a normal frame with an accepted background still selects canonical quality', () => {
  const state = resolveMapSurfacePresentation({ cssScale: 700, canonicalReady: true,
    backgroundPresented: true });
  assert.equal(state.quality, 'canonical');
});
