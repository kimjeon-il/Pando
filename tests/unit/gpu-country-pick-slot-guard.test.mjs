import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Exercise the renderer's private scene entrypoint without constructing a GL device.
// The real function body is evaluated with only its GPU collaborators substituted.
const source = readFileSync(new URL('../../assets/js/modules/gpu-map-renderer.js', import.meta.url), 'utf8');
const start = source.indexOf('    function ensureCountryIdScene() {');
const end = source.indexOf('    function pick(screenPoint)', start);
assert.ok(start >= 0 && end > start);
const ensureScene = new Function('isWebGlRenderer', 'gl', 'mesh', 'state', 'ensurePickTarget',
  'meshVariants', 'activeMeshQuality', 'meshCountryIds', 'countryIdSceneKey', 'pickSceneKey',
  'pickFramebuffer', 'pixelWidth', 'pixelHeight', `${source.slice(start, end)}\nreturn ensureCountryIdScene();`);

for (const [canonicalIds, activeIds, expected] of [
  [['A', 'B'], ['B', 'A'], false],
  [['A', 'B'], ['A'], false],
  [['A'], ['A', 'B'], false],
  [['A', 'B'], ['A', 'B'], true],
]) {
  test(`canonical picking eligibility for canonical ${canonicalIds} and active ${activeIds}`, () => {
    let targetRequests = 0;
    const entry = { mesh: { triangleIndices: [] }, countryIds: canonicalIds };
    const gl = { bindFramebuffer() {}, viewport() {}, enable() {} };
    const result = ensureScene(() => true, gl, {}, { layerVisibility: { countries: true } },
      () => { targetRequests += 1; }, new Map([['canonical', entry]]), 'preview', activeIds,
      () => 'cached-scene', 'cached-scene', {}, 10, 10);
    assert.equal(result, expected);
    assert.equal(targetRequests, expected ? 1 : 0);
  });
}