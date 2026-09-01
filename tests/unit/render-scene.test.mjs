import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPolygonGeometryPacket,
  buildStrokeGeometryPacket,
  createRenderSceneBuilder,
  isRenderScene,
} from '../../assets/js/modules/render-scene.js';

const polygon = color => ({
  type: 'Feature',
  properties: { name: 'must-not-reach-renderer', color },
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]],
  },
});

test('RenderScene stores typed renderer packets without project or GeoJSON properties', () => {
  const builder = createRenderSceneBuilder();
  const scene = builder.build({
    revision: 7,
    revisions: { geometry: 3, style: 4, selection: 8 },
    polygons: [{ key: 'region:one', geometryRevision: 3, geometry: polygon('#ff0000').geometry, style: { color: '#ff0000', alpha: 0.5 } }],
    strokes: [{ key: 'region:one:boundary', geometryRevision: 3, geometry: polygon('#ff0000').geometry, style: { color: '#ffffff', width: 2 } }],
    interaction: { selectionPacket: { revision: 8 } },
  });
  assert.equal(isRenderScene(scene), true);
  assert.equal(scene.polygons[0].positions instanceof Float32Array, true);
  assert.equal(scene.polygons[0].indices instanceof Uint32Array, true);
  assert.equal(scene.strokes[0].startsEnds instanceof Float32Array, true);
  assert.equal('geometry' in scene.polygons[0], false);
  assert.equal('properties' in scene.polygons[0], false);
  assert.equal(JSON.stringify(scene).includes('must-not-reach-renderer'), false);
});

test('geometry packets are reused across style and selection revisions', () => {
  const builder = createRenderSceneBuilder();
  const first = builder.build({
    revision: 1,
    revisions: { geometry: 2, style: 1, selection: 1 },
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#f00').geometry, style: { color: '#ff0000' } }],
  });
  const second = builder.build({
    revision: 2,
    revisions: { geometry: 2, style: 2, selection: 9 },
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#00f').geometry, style: { color: '#0000ff' } }],
  });
  assert.equal(second.polygons[0].positions, first.polygons[0].positions);
  assert.equal(second.polygons[0].indices, first.polygons[0].indices);
  assert.equal(second.polygons[0].style.color, '#0000ff');
  assert.equal(builder.stats().polygonCacheHits, 1);
});

test('polygon and stroke packet builders reject degenerate coordinates and preserve dateline splits', () => {
  const polygonPacket = buildPolygonGeometryPacket({
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  });
  assert.equal(polygonPacket.triangleCount, 1);
  const strokePacket = buildStrokeGeometryPacket({
    type: 'LineString',
    coordinates: [[179, 0], [-179, 1], [-179, 1], [Number.NaN, 2]],
  });
  assert.ok(strokePacket.segmentCount >= 2);
  assert.equal([...strokePacket.startsEnds].every(Number.isFinite), true);
});

test('preview and draft interaction packets remain typed renderer data', () => {
  const builder = createRenderSceneBuilder();
  const previewScene = builder.build({
    revision: 1,
    polygons: [{
      key: 'interaction:preview:0:fill',
      geometryRevision: 'preview-1',
      geometry: polygon('#ff0000').geometry,
      style: { color: '#ff0000', fillAlpha: 0.2 },
    }],
    strokes: [{
      key: 'interaction:draft:0:stroke',
      geometryRevision: 'draft-1',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      style: { color: '#ffffff', alpha: 1, width: 2 },
    }],
  });
  const scene = builder.build({
    revision: 2,
    interaction: {
      previewPackets: [{ kind: 'polygon', packet: previewScene.polygons[0] }],
      draftPackets: [{ kind: 'stroke', packet: previewScene.strokes[0] }],
    },
  });
  assert.equal(scene.interaction.previewPackets[0].packet.positions instanceof Float32Array, true);
  assert.equal(scene.interaction.draftPackets[0].packet.startsEnds instanceof Float32Array, true);
  assert.equal('geometry' in scene.interaction.previewPackets[0].packet, false);
  assert.equal('properties' in scene.interaction.draftPackets[0].packet, false);
});

test('RenderScene patch replaces only affected packets and reuses the rest', () => {
  const builder = createRenderSceneBuilder();
  const first = builder.build({
    revision: 1,
    revisions: { geometry: 1 },
    polygons: [
      { key: 'region:one', geometryRevision: 1, geometry: polygon('#f00').geometry, style: { color: '#ff0000' } },
      { key: 'region:two', geometryRevision: 1, geometry: polygon('#0f0').geometry, style: { color: '#00ff00' } },
    ],
    strokes: [{ key: 'region:one:outline', geometryRevision: 1, geometry: polygon('#f00').geometry, style: { color: '#ffffff' } }],
  });
  const second = builder.patch(first, {
    revision: 2,
    revisions: { geometry: 2 },
    removePolygonKeys: ['region:one'],
    removeStrokeKeys: ['region:one:outline'],
    polygons: [{ key: 'region:one', geometryRevision: 2, geometry: polygon('#00f').geometry, style: { color: '#0000ff' } }],
  });
  const untouched = second.polygons.find(packet => packet.key === 'region:two');
  assert.equal(untouched, first.polygons.find(packet => packet.key === 'region:two'));
  assert.notEqual(second.polygons.find(packet => packet.key === 'region:one'), first.polygons.find(packet => packet.key === 'region:one'));
  assert.equal(second.strokes.some(packet => packet.key === 'region:one:outline'), false);
  assert.equal(builder.stats().patchCount, 1);
});

test('RenderScene uses display LOD only for independent unprotected chunks', () => {
  const builder = createRenderSceneBuilder({ cacheByteBudget: 1024 * 1024 });
  const geometry = {
    type: 'Polygon',
    coordinates: [[...Array.from({ length: 80 }, (_value, index) => {
      const angle = index / 79 * Math.PI * 2;
      return [Math.cos(angle) + Math.sin(index) * 0.001, Math.sin(angle)];
    }), [1, 0]]],
  };
  const coarse = builder.build({
    renderQuality: { backgroundLod: 'coarse' },
    projection: 'flat',
    polygons: [{ key: 'independent', objectKey: 'generic:feature:one', geometryRevision: 1, geometry, lodPolicy: 'independent' }],
  });
  const protectedScene = builder.build({
    renderQuality: { backgroundLod: 'coarse' },
    projection: 'flat',
    protectedKeys: new Set(['generic:feature:one']),
    polygons: [{ key: 'independent', objectKey: 'generic:feature:one', geometryRevision: 1, geometry, lodPolicy: 'independent' }],
  });
  assert.equal(coarse.polygons[0].lod, 'coarse');
  assert.equal(protectedScene.polygons[0].lod, 'high');
  assert.equal(protectedScene.polygons[0].protected, true);
  assert.ok(protectedScene.polygons[0].vertexCount >= coarse.polygons[0].vertexCount);
  assert.ok(builder.stats().cacheBytes <= builder.stats().cacheBudgetBytes);
});
