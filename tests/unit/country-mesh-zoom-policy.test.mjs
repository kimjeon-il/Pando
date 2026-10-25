import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCountryMeshQuality } from "../../shared/frontend/js/modules/country-mesh-zoom-policy.js";
import * as surfacePolicy from "../../shared/frontend/js/modules/country-mesh-zoom-policy.js";

test('prepared country geometry stays hidden until its background frame is presented', () => {
  const prepared = { cssScale: 700, canonicalReady: true, backgroundPresented: false };
  assert.equal(surfacePolicy.resolveMapSurfacePresentation(prepared).quality, 'pending');
  assert.equal(surfacePolicy.resolveMapSurfacePresentation(prepared).geometryQuality, 'canonical');
  assert.equal(surfacePolicy.resolveMapSurfacePresentation({ ...prepared, backgroundPresented: true }).quality, 'canonical');
});

test('CSS scale uses inclusive thresholds, keeps history in the band and starts precise', () => {
  for (const previous of ['preview', 'canonical']) {
    assert.equal(resolveCountryMeshQuality({ cssScale: 504, previous }), 'preview');
    assert.equal(resolveCountryMeshQuality({ cssScale: 642, previous }), 'canonical');
    assert.equal(resolveCountryMeshQuality({ cssScale: 570, previous }), previous);
  }
  assert.equal(resolveCountryMeshQuality({ cssScale: 570 }), 'canonical');
});

test('projection, DPR, device and dragging cannot change the same CSS scale decision', () => {
  for (const projection of ['flat', 'globe']) for (const dpr of [1, 2, 3]) {
    assert.equal(resolveCountryMeshQuality({ cssScale: 500, projection, dpr, mobile: true, dragging: true }), 'preview');
    assert.equal(resolveCountryMeshQuality({ cssScale: 650, projection, dpr }), 'canonical');
  }
});

test('focus, selection and editing protect precise geometry at low scale', () => {
  for (const forced of [{ focus: true }, { editing: true }, { selected: true }]) {
    assert.equal(resolveCountryMeshQuality({ cssScale: 100, ...forced }), 'canonical');
  }
});

test('invalid scale cannot silently choose simplified geometry', () => {
  for (const cssScale of [undefined, NaN, 0, -1]) assert.equal(resolveCountryMeshQuality({ cssScale }), 'canonical');
});

test('one surface decision withholds both country and land preview at high scale while precise data is pending', () => {
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 700,
    canonicalReady: false, previewReady: true, previewVerified: true }),
  { targetQuality: 'canonical', geometryQuality: 'pending', quality: 'pending' });
});

test('a verified low-scale surface can return to simplified display after precise preparation', () => {
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 400,
    canonicalReady: true, previewReady: true, previewVerified: true }),
  { targetQuality: 'preview', geometryQuality: 'preview', quality: 'preview' });
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 400,
    canonicalReady: true, previewReady: true, previewVerified: false }),
  { targetQuality: 'preview', geometryQuality: 'canonical', quality: 'canonical' });
});

test('selection and missing or invalid derivatives cannot silently admit a simplified surface', () => {
  for (const flags of [{ selected: true }, { editing: true }, { focus: true }]) {
    assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 100,
      canonicalReady: false, previewReady: true, previewVerified: true, ...flags }),
    { targetQuality: 'canonical', geometryQuality: 'pending', quality: 'pending' });
  }
  assert.deepEqual(surfacePolicy.resolveMapSurfacePresentation?.({ cssScale: 100,
    canonicalReady: false, previewReady: true, previewVerified: false }),
  { targetQuality: 'preview', geometryQuality: 'pending', quality: 'pending' });
});
