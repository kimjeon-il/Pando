import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignReferenceImageAnchor,
  applyReferenceImagePlacementDrag,
  buildReferenceImagePlacementMesh,
  createReferenceImagePlacementDrag,
  defaultReferenceImageMapQuad,
  normalizeReferenceImageRotation,
  referenceImageAnchorScreenPoint,
  referenceImagePlacementGeometry,
  referenceImagePlacementPointAtUv,
  referenceImagePlacementHit,
  referenceImagePlacementUvAtPoint,
  referenceImageScreenRectToMapQuad,
  setReferenceImagePlacementRotation,
} from '../../assets/js/modules/reference-image-transform.js';

function createHost() {
  const view = { x: 100, y: 200, scale: 10 };
  return {
    view,
    project([lon, lat]) {
      return [view.x + lon * view.scale, view.y - lat * view.scale];
    },
    unproject([x, y]) {
      return [(x - view.x) / view.scale, (view.y - y) / view.scale];
    },
  };
}

function mapElement(width = 800, height = 600) {
  return { getBoundingClientRect: () => ({ width, height }) };
}

test('rotation normalization preserves the signed half-turn contract', () => {
  assert.equal(normalizeReferenceImageRotation(190), -170);
  assert.equal(normalizeReferenceImageRotation(-190), 170);
  assert.equal(normalizeReferenceImageRotation('bad'), 0);
});

test('screen placement is converted once into geographic mapQuad coordinates', () => {
  const host = createHost();
  const quad = referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host);
  assert.deepEqual(quad, [[0, 10], [20, 10], [20, 0], [0, 0]]);
  const image = { naturalWidth: 400, naturalHeight: 200 };
  const initial = defaultReferenceImageMapQuad(image, mapElement(), host);
  assert.equal(initial.length, 4);
  assert.ok(initial.every(point => point.every(Number.isFinite)));
});

test('default placement shrinks until all four corners can be unprojected', () => {
  const host = {
    project([lon, lat]) {
      return [400 + lon * 10, 300 - lat * 10];
    },
    unproject([x, y]) {
      if (Math.hypot(x - 400, y - 300) > 230) return null;
      return [(x - 400) / 10, (300 - y) / 10];
    },
  };
  const image = { naturalWidth: 1000, naturalHeight: 1000 };
  const quad = defaultReferenceImageMapQuad(image, mapElement(800, 600), host);
  assert.equal(quad.length, 4);
  assert.ok(quad.every(point => point.every(Number.isFinite)));
});

test('mapQuad remains anchored to map coordinates across pan and zoom changes', () => {
  const host = createHost();
  const record = {
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const saved = structuredClone(record.mapQuad);
  const before = referenceImagePlacementGeometry(record, host);
  host.view.x += 80;
  host.view.y -= 30;
  host.view.scale *= 2;
  const after = referenceImagePlacementGeometry(record, host);
  assert.deepEqual(record.mapQuad, saved);
  assert.notDeepEqual(after.corners, before.corners);
  assert.deepEqual(after.corners[0], [180, -30]);
});

test('placement mesh follows mapQuad with enough subdivisions for projected maps', () => {
  const host = createHost();
  const record = {
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const mesh = buildReferenceImagePlacementMesh(record, { columns: 2, rows: 2 });
  assert.equal(mesh.vertices.length, 9);
  assert.equal(mesh.triangles.length, 8);
  assert.deepEqual(mesh.vertices[4].uv, [0.5, 0.5]);
  assert.deepEqual(mesh.vertices[4].coordinate, [10, 5]);
});

test('placement exposes four corner and four edge resize handles plus rotation', () => {
  const host = createHost();
  const record = {
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const geometry = referenceImagePlacementGeometry(record, host);
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    assert.equal(referenceImagePlacementHit(record, geometry.handles[handle], host).handle, handle);
  }
  assert.equal(referenceImagePlacementHit(record, geometry.rotateHandle, host).type, 'rotate');
  assert.equal(referenceImagePlacementHit(record, geometry.center, host).type, 'move');
});

test('corner resize fixes the opposite corner instead of scaling around the center', () => {
  const host = createHost();
  const record = {
    id: 'a',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const before = referenceImagePlacementGeometry(record, host);
  const drag = createReferenceImagePlacementDrag(record, { type: 'resize', handle: 'se' }, before.handles.se, host, 1);
  assert.equal(applyReferenceImagePlacementDrag(record, drag, [350, 250], host), true);
  const after = referenceImagePlacementGeometry(record, host);
  assert.deepEqual(after.corners[0], before.corners[0]);
  assert.deepEqual(after.corners[2], [350, 250]);
});

test('edge resize fixes the opposite edge and corner shift resize preserves aspect ratio', () => {
  const host = createHost();
  const westRecord = {
    id: 'west',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const westBefore = referenceImagePlacementGeometry(westRecord, host);
  const westDrag = createReferenceImagePlacementDrag(westRecord, { type: 'resize', handle: 'w' }, westBefore.handles.w, host, 2);
  assert.equal(applyReferenceImagePlacementDrag(westRecord, westDrag, [50, 150], host), true);
  const westAfter = referenceImagePlacementGeometry(westRecord, host);
  assert.deepEqual(westAfter.corners[1], westBefore.corners[1]);
  assert.deepEqual(westAfter.corners[2], westBefore.corners[2]);

  const ratioRecord = {
    id: 'ratio',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
  };
  const ratioBefore = referenceImagePlacementGeometry(ratioRecord, host);
  const ratioDrag = createReferenceImagePlacementDrag(ratioRecord, { type: 'resize', handle: 'se' }, ratioBefore.handles.se, host, 3);
  assert.equal(applyReferenceImagePlacementDrag(ratioRecord, ratioDrag, [400, 220], host, { shiftKey: true }), true);
  const ratioAfter = referenceImagePlacementGeometry(ratioRecord, host);
  assert.ok(Math.abs(ratioAfter.width / ratioAfter.height - 2) < 1e-9);
});

test('rotation uses mapQuad as the only geometry state and supports 15 degree snapping', () => {
  const host = createHost();
  const record = {
    id: 'r',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 100, height: 100 }, 0, host),
  };
  assert.equal(setReferenceImagePlacementRotation(record, host, 30), true);
  assert.ok(Math.abs(referenceImagePlacementGeometry(record, host).rotation - 30) < 1e-9);
  const geometry = referenceImagePlacementGeometry(record, host);
  const drag = createReferenceImagePlacementDrag(record, { type: 'rotate' }, geometry.rotateHandle, host, 4);
  const target = [geometry.center[0] + 100, geometry.center[1]];
  assert.equal(applyReferenceImagePlacementDrag(record, drag, target, host, { shiftKey: true }), true);
  const snapped = referenceImagePlacementGeometry(record, host).rotation;
  assert.ok(Math.abs(snapped / 15 - Math.round(snapped / 15)) < 1e-9);
  assert.equal('rotation' in record, false);
});

test('manual anchor snaps the selected image point to the chosen map coordinate', () => {
  const host = createHost();
  const record = {
    id: 'anchor',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
    anchor: { image: [0.25, 0.5], coordinate: [8, 7] },
  };
  assert.equal(alignReferenceImageAnchor(record, host), true);
  const source = referenceImagePlacementPointAtUv(record, record.anchor.image, host);
  const target = referenceImageAnchorScreenPoint(record, host);
  assert.ok(Math.hypot(source[0] - target[0], source[1] - target[1]) < 1e-6);
});

test('anchored placement blocks body move and keeps the anchor fixed through resize and rotation', () => {
  const host = createHost();
  const record = {
    id: 'anchor-transform',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
    anchor: { image: [0.25, 0.5], coordinate: [8, 7] },
  };
  assert.equal(alignReferenceImageAnchor(record, host), true);
  const target = referenceImageAnchorScreenPoint(record, host);

  const geometry = referenceImagePlacementGeometry(record, host);
  assert.equal(referenceImagePlacementHit(record, geometry.center, host), null);

  const resize = createReferenceImagePlacementDrag(record, { type: 'resize', handle: 'se' }, geometry.handles.se, host, 20);
  assert.equal(applyReferenceImagePlacementDrag(record, resize, [geometry.handles.se[0] + 80, geometry.handles.se[1] + 40], host), true);
  let source = referenceImagePlacementPointAtUv(record, record.anchor.image, host);
  assert.ok(Math.hypot(source[0] - target[0], source[1] - target[1]) < 0.3);

  assert.equal(setReferenceImagePlacementRotation(record, host, 45), true);
  source = referenceImagePlacementPointAtUv(record, record.anchor.image, host);
  assert.ok(Math.hypot(source[0] - target[0], source[1] - target[1]) < 0.3);
});

test('placement UV hit testing follows the geographic quad and reflection flags', () => {
  const host = createHost();
  const record = {
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
  };
  assert.deepEqual(referenceImagePlacementUvAtPoint(record, [200, 150], host), [0.5, 0.5]);
  assert.deepEqual(referenceImagePlacementUvAtPoint(record, [150, 125], host), [0.25, 0.25]);
  record.flipX = true;
  assert.deepEqual(referenceImagePlacementUvAtPoint(record, [150, 125], host), [0.75, 0.25]);
  assert.equal(referenceImagePlacementUvAtPoint(record, [20, 20], host), null);
});
