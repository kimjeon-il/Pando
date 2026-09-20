import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSvgSceneProxy, rendererOwnsSceneGeometry } from '../../assets/js/modules/render-channel-ownership.js';

test('every runtime scene renderer owns visual map geometry', () => {
  for (const renderer of ['webgl2', 'webgl1', 'canvas-worker', 'canvas2d']) {
    assert.equal(rendererOwnsSceneGeometry(renderer), true);
  }
  for (const renderer of ['', null, 'svg']) assert.equal(rendererOwnsSceneGeometry(renderer), false);
});

test('scene proxy clears stale inline paint while preserving the SVG node as a hit target', () => {
  const values = new Map([['fill', '#ff00ff'], ['fill-opacity', '.8'], ['stroke', '#ffff00'], ['stroke-opacity', '1']]);
  const classes = new Set();
  const node = {
    style: { setProperty: (name, value) => values.set(name, value) },
    classList: { add: value => classes.add(value) },
  };
  assert.equal(makeSvgSceneProxy(node), true);
  assert.equal(values.get('fill'), 'transparent');
  assert.equal(values.get('fill-opacity'), '0');
  assert.equal(values.get('stroke'), 'transparent');
  assert.equal(values.get('stroke-opacity'), '0');
  assert.equal(values.get('mix-blend-mode'), 'normal');
  assert.equal(classes.has('gpu-scene-hit-proxy'), true);
});

test('persistent territorial paint and derived boundaries have only the scene renderer as visual owner', async () => {
  const source = await readFile(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');
  const territorialStart = source.indexOf('const renderTerritorialUnits');
  const territorialEnd = source.indexOf('const renderGenericFeatures', territorialStart);
  const territorial = source.slice(territorialStart, territorialEnd);
  assert.match(territorial, /style\('fill', 'transparent'\)/);
  assert.doesNotMatch(territorial, /style\('fill', feature => resolveFill/);
  assert.match(source, /if \(plan\.fill && !sceneOwnsFills\)/);
  assert.match(source, /if \(fillOwner === 'svg' && !sceneOwnsFills\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'territorial-internal-boundary'\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'generic-feature-boundary'\)/);
  assert.doesNotMatch(source, /append\('path'\)\.attr\('class', 'distribution-boundary'\)/);
});
