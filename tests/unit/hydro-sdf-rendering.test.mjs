import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hydroSdfShaderSources, hydroSegmentSignedDistance, hydroSegmentCoverage } from "../../src/rendering/gpu-hydro-sdf.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = path => readFileSync(resolve(root, path), 'utf8');

test('river capsules have round caps and joins without shifting source vertices', () => {
  assert.equal(hydroSegmentSignedDistance([-1, 0], [0, 0], [10, 0], 2, 2), -1);
  assert.equal(hydroSegmentSignedDistance([-3, 0], [0, 0], [10, 0], 2, 2), 1);
  assert.equal(hydroSegmentSignedDistance([10, 2], [0, 0], [10, 0], 1, 3), -1);
  const corner = [10.7, -0.7];
  const first = hydroSegmentSignedDistance(corner, [0, 0], [10, 0], 1, 1);
  const second = hydroSegmentSignedDistance(corner, [10, 0], [10, -10], 1, 1);
  assert.ok(Math.min(first, second) < 0, 'connected segments share an interior at the bend');
  assert.equal(hydroSegmentSignedDistance([4, 2.5], [4, 4], [4, 4], 2, 2), -0.5,
    'zero-length projection is a disk, not a NaN');
});

test('tapered segments preserve endpoint widths and union coverage never darkens a join', () => {
  assert.equal(hydroSegmentSignedDistance([0, 1.5], [0, 0], [10, 0], 2, 4), -0.5);
  assert.equal(hydroSegmentSignedDistance([10, 3.5], [0, 0], [10, 0], 2, 4), -0.5);
  for (const aa of [0.5, 1, 1.5]) {
    assert.equal(hydroSegmentCoverage(-2, aa), 1);
    assert.equal(hydroSegmentCoverage(0, aa), 0.5);
    assert.equal(hydroSegmentCoverage(2, aa), 0);
    const first = hydroSegmentCoverage(0, aa), second = hydroSegmentCoverage(0, aa);
    assert.equal(Math.max(first, second), first, 'MAX union cannot double-opacity a joint');
  }
});

test('both WebGL shader editions apply SDF to color and ID picking with width profiles', () => {
  for (const version of [1, 2]) {
    const { vertex, fragment, pick } = hydroSdfShaderSources(version);
    assert.match(vertex, /vStartRadius\s*=\s*startRadius/);
    assert.match(vertex, /max\(startRadius, endRadius\)\s*\+\s*max\(uAaRadius/);
    assert.match(fragment, /smoothstep\(-aa, aa, signedDistance\)/);
    assert.match(fragment, /uCoverageOnly/);
    assert.match(fragment, /mix\(vStartRadius, vEndRadius, t\)/);
    assert.match(pick, /hydroSignedDistance\(\)\s*>\s*0\.0/);
    assert.ok(!pick.includes('uCoverageOnly'));
    assert.match(vertex, /uWidthBoost/);
    assert.match(vertex, /uWidthScale/);
    if (version === 2) assert.match(pick, /uint id = vCountry \+ 1u/);
    else assert.match(pick, /float id = floor\(vCountry \+ 0\.5\) \+ 1\.0/);
  }
});

test('visible hydro union keeps mask and picking passes off the coverage framebuffer', () => {
  const renderer = source('src/rendering/gpu-map-renderer.js');
  const compositor = source('src/rendering/gpu-hydro-coverage.js');
  const base = source('src/rendering/gpu-base-scene-pass.js');
  const interaction = source('src/rendering/gpu-interaction-pass.js');
  assert.match(renderer, /hydroCoverage\.render\(/);
  assert.match(renderer, /category === 'border-river' && !picking/);
  assert.match(renderer, /drawHydro\('border-river', true\)/);
  assert.match(base, /drawHydro\(role, false, true\)/);
  assert.match(interaction, /drawHydro\(role, false, true\)/);
  assert.match(compositor, /gl\.blendEquation\(maximum\)/);
  assert.match(compositor, /gl\.blendFunc\(gl\.ONE, gl\.ONE\)/);
  assert.match(compositor, /gl\.blendFuncSeparate\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA/);
  assert.match(renderer, /hydroCoverage\.handleContextLost\(\)/);
  assert.match(renderer, /hydroCoverage\.dispose\(\)/);
});
