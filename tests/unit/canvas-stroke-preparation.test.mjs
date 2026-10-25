import assert from 'node:assert/strict';
import test from 'node:test';
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";

const draw = globalThis.PandoLabCanvasSceneComposition.drawStrokes;
const context = () => ({ save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {} });
const fixture = () => ({ geometryRevision: 'shape:1', startsEnds: new Float32Array([0, 0, 1, 0, 1, 0, 2, 0]),
  ownerRanges: { LEFT: { first: 0, count: 1 }, RIGHT: { first: 1, count: 1 } },
  ownerIds: ['LEFT', 'RIGHT'], style: { alpha: 1, color: '#ffffff', width: 1 } });

test('Canvas reuses prepared shared coordinates across pan/style paints while projecting each frame', () => {
  const packet = fixture(), target = context(), paints = [];
  draw(target, geometry => paints.push({ geometry, view: 'first' }), [packet]);
  draw(target, geometry => paints.push({ geometry, view: 'panned' }), [{ ...packet,
    style: { ...packet.style, color: '#123456', width: 2 } }]);
  assert.equal(paints.length, 2);
  assert.strictEqual(paints[0].geometry, paints[1].geometry);
  assert.notEqual(paints[0].view, paints[1].view);
  assert.deepEqual(paints[0].geometry.coordinates, [[[0, 0], [1, 0], [2, 0]]]);
  assert.equal(target.strokeStyle, '#123456');
  assert.equal(target.lineWidth, 2);
});

test('Canvas owner selection uses only current ranges and reuses a restored selection', () => {
  const packet = fixture(), paints = [], target = context();
  const paint = ownerIds => draw(target, geometry => paints.push(geometry), [{ ...packet, ownerIds }]);
  paint(['LEFT', 'RIGHT']); paint(['LEFT']); paint(['RIGHT']); paint(['LEFT', 'RIGHT']);
  assert.deepEqual(paints[1].coordinates, [[[0, 0], [1, 0]]]);
  assert.deepEqual(paints[2].coordinates, [[[1, 0], [2, 0]]]);
  assert.strictEqual(paints[0], paints[3]);
});

test('Canvas invalidates prepared strokes on changed revision, buffer identity or actual range layout', () => {
  const packet = fixture(), target = context(), paints = [];
  const paint = current => draw(target, geometry => paints.push(geometry), [current]);
  paint(packet);
  packet.startsEnds[6] = 3;
  paint({ ...packet, geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[0], paints[1]);
  assert.equal(paints[0].coordinates[0].at(-1)[0], 2);
  assert.equal(paints[1].coordinates[0].at(-1)[0], 3);
  paint({ ...packet, startsEnds: packet.startsEnds.slice(), geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[1], paints[2]);
  paint({ ...packet, geometryRevision: 'shape:2', ownerIds: ['LEFT'], ownerRanges: { LEFT: { first: 1, count: 1 } } });
  assert.deepEqual(paints[3].coordinates, [[[1, 0], [3, 0]]]);
});
