import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCountryMeshQuality } from '../../assets/js/modules/country-mesh-zoom-policy.js';

for (const [projection, lower, upper] of [['globe', 1.8, 2.2], ['flat', 2.2, 2.8]]) {
  test(`${projection} uses inclusive thresholds and retains both directions inside the band`, () => {
    for (const previous of ['preview', 'canonical']) {
      assert.equal(resolveCountryMeshQuality({ projection, zoom: lower, previous }), 'preview');
      assert.equal(resolveCountryMeshQuality({ projection, zoom: upper, previous }), 'canonical');
      assert.equal(resolveCountryMeshQuality({ projection, zoom: lower + 0.001, previous }), previous);
      assert.equal(resolveCountryMeshQuality({ projection, zoom: upper - 0.001, previous }), previous);
    }
  });
  test(`${projection} defaults to preview at world scale and in an uninitialized band`, () => {
    assert.equal(resolveCountryMeshQuality({ projection, zoom: 1 }), 'preview');
    assert.equal(resolveCountryMeshQuality({ projection, zoom: (lower + upper) / 2 }), 'preview');
  });
  test(`${projection} does not oscillate across repeated intermediate zoom values`, () => {
    let previous = 'preview';
    for (const zoom of [lower, lower + 0.01, upper - 0.01, lower + 0.01]) {
      previous = resolveCountryMeshQuality({ projection, zoom, previous });
      assert.equal(previous, 'preview');
    }
    previous = resolveCountryMeshQuality({ projection, zoom: upper, previous });
    for (const zoom of [upper - 0.01, lower + 0.01, upper - 0.01]) {
      previous = resolveCountryMeshQuality({ projection, zoom, previous });
      assert.equal(previous, 'canonical');
    }
  });
}

test('mode switches apply destination thresholds with the displayed state in its band', () => {
  assert.equal(resolveCountryMeshQuality({ projection: 'flat', zoom: 2.5, previous: 'canonical' }), 'canonical');
  assert.equal(resolveCountryMeshQuality({ projection: 'flat', zoom: 2.2, previous: 'canonical' }), 'preview');
  assert.equal(resolveCountryMeshQuality({ projection: 'globe', zoom: 2.2, previous: 'preview' }), 'canonical');
});

test('focus and editing force canonical across modes and release to the current zoom policy', () => {
  for (const projection of ['globe', 'flat']) {
    for (const force of [{ focus: true }, { editing: true }, { focus: true, editing: true }]) {
      assert.equal(resolveCountryMeshQuality({ projection, zoom: 1, ...force }), 'canonical');
    }
    assert.equal(resolveCountryMeshQuality({ projection, zoom: 1, previous: 'canonical' }), 'preview');
  }
});
