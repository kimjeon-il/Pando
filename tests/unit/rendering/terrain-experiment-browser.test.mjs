import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainBrowserArgs} from '../../../scripts/terrain-experiment/browser-options.mjs';

test('terrain GPU selection is explicit and rejects unsupported modes',()=>{
  assert.ok(terrainBrowserArgs('d3d11').includes('--use-angle=d3d11'));
  assert.ok(terrainBrowserArgs('swiftshader').includes('--use-angle=swiftshader'));
  assert.throws(()=>terrainBrowserArgs('unknown'),/Unknown/);
});
