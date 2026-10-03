import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignReferenceImageAnchor,
  applyReferenceImageFreeTransformDrag,
  applyReferenceImagePlacementDrag,
  buildReferenceImagePlacementMesh,
  buildReferenceImagePlacementWarp,
  createReferenceImageFreeTransformDrag,
  createReferenceImagePlacementDrag,
  defaultReferenceImageMapQuad,
  normalizeReferenceImageRotation,
  referenceImageAnchorScreenPoint,
  referenceImageFreeTransformHit,
  referenceImagePlacementCoordinateAtUv,
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

function assertPairClose(actual, expected, epsilon = 1e-8) {
  assert.equal(actual.length, 2);
  assert.ok(Math.abs(actual[0] - expected[0]) <= epsilon);
  assert.ok(Math.abs(actual[1] - expected[1]) <= epsilon);
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

test('small source images are enlarged to a usable initial screen footprint', () => {
  const host = {
    project([lon, lat]) { return [400 + lon * 10, 300 - lat * 10]; },
    unproject([x, y]) { return [(x - 400) / 10, (300 - y) / 10]; },
  };
  const quad = defaultReferenceImageMapQuad(
    { naturalWidth: 64, naturalHeight: 64 },
    mapElement(800, 600),
    host,
  );
  const record = { mapQuad: quad };
  const geometry = referenceImagePlacementGeometry(record, host);
  assert.ok(geometry.width >= 300);
  assert.ok(geometry.height >= 300);
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
  assertPairClose(mesh.vertices[4].coordinate, [10, 5]);
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
  assertPairClose(referenceImagePlacementCoordinateAtUv(record, record.anchor.image), [8, 7]);
  let source = referenceImagePlacementPointAtUv(record, record.anchor.image, host);
  let target = referenceImageAnchorScreenPoint(record, host);
  assert.ok(Math.hypot(source[0] - target[0], source[1] - target[1]) < 1e-6);

  host.view.x += 75;
  host.view.y -= 40;
  host.view.scale *= 1.75;
  source = referenceImagePlacementPointAtUv(record, record.anchor.image, host);
  target = referenceImageAnchorScreenPoint(record, host);
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

test('free transform corner pin moves only the selected corner and keeps a valid projective warp', () => {
  const host = createHost();
  const record = {
    id: 'free',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
    anchor: null,
    controlPoints: [],
  };
  const before = structuredClone(record.mapQuad);
  const geometry = referenceImagePlacementGeometry(record, host);
  const hit = referenceImageFreeTransformHit(record, geometry.corners[1], host);
  assert.equal(hit.corner, 'ne');
  const drag = createReferenceImageFreeTransformDrag(record, hit, 30);
  assert.equal(applyReferenceImageFreeTransformDrag(record, drag, [340, 70], host), true);
  assert.deepEqual(record.mapQuad[0], before[0]);
  assert.deepEqual(record.mapQuad[2], before[2]);
  assert.deepEqual(record.mapQuad[3], before[3]);
  assert.notDeepEqual(record.mapQuad[1], before[1]);
  assert.equal(buildReferenceImagePlacementWarp(record).ok, true);
});

test('free transform rejects self-crossing or collapsed corner layouts', () => {
  const host = createHost();
  const record = {
    id: 'invalid-free',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
    anchor: null,
    controlPoints: [],
  };
  const original = structuredClone(record.mapQuad);
  const geometry = referenceImagePlacementGeometry(record, host);
  const hit = referenceImageFreeTransformHit(record, geometry.corners[1], host);
  const drag = createReferenceImageFreeTransformDrag(record, hit, 31);
  assert.equal(applyReferenceImageFreeTransformDrag(record, drag, [80, 220], host), false);
  assert.deepEqual(record.mapQuad, original);
});

test('basic resize preserves an existing projective trapezoid instead of flattening it', () => {
  const host = createHost();
  const record = {
    id: 'perspective-resize',
    mapQuad: [[0, 10], [20, 9], [16, 0], [2, 0]],
    flipX: false,
    flipY: false,
    anchor: null,
    controlPoints: [],
  };
  const before = referenceImagePlacementGeometry(record, host);
  const beforeTop = Math.hypot(
    before.corners[1][0] - before.corners[0][0],
    before.corners[1][1] - before.corners[0][1],
  );
  const beforeBottom = Math.hypot(
    before.corners[2][0] - before.corners[3][0],
    before.corners[2][1] - before.corners[3][1],
  );
  assert.ok(Math.abs(beforeTop - beforeBottom) > 1);

  const drag = createReferenceImagePlacementDrag(record, { type: 'resize', handle: 'se' }, before.handles.se, host, 40);
  assert.equal(applyReferenceImagePlacementDrag(
    record,
    drag,
    [before.handles.se[0] + 60, before.handles.se[1] + 30],
    host,
  ), true);

  const after = referenceImagePlacementGeometry(record, host);
  const afterTop = Math.hypot(
    after.corners[1][0] - after.corners[0][0],
    after.corners[1][1] - after.corners[0][1],
  );
  const afterBottom = Math.hypot(
    after.corners[2][0] - after.corners[3][0],
    after.corners[2][1] - after.corners[3][1],
  );
  assert.ok(Math.abs(afterTop - afterBottom) > 1);
  assert.equal(buildReferenceImagePlacementWarp(record).ok, true);
});

test('free transform remains available with a manual anchor or GCP', () => {
  const host = createHost();
  const base = referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host);
  const anchored = { id: 'a', mapQuad: base, anchor: { image: [0.5, 0.5], coordinate: [10, 5] }, controlPoints: [] };
  const gcp = { id: 'b', mapQuad: base, anchor: null, controlPoints: [{ id: 'p', image: [0.5, 0.5], coordinate: [10, 5] }] };
  const corner = referenceImagePlacementGeometry(anchored, host).corners[0];
  assert.equal(referenceImageFreeTransformHit(anchored, corner, host).corner, 'nw');
  assert.equal(referenceImageFreeTransformHit(gcp, corner, host).corner, 'nw');

  const anchoredDrag = createReferenceImageFreeTransformDrag(
    anchored,
    referenceImageFreeTransformHit(anchored, corner, host),
    50,
  );
  assert.ok(anchoredDrag);
  assert.equal(applyReferenceImageFreeTransformDrag(anchored, anchoredDrag, [80, 80], host), true);
});

test('corner pin drag keeps stored anchor and GCP metadata intact', () => {
  const host = createHost();
  const record = {
    id: 'combined-free',
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
    anchor: { image: [0.5, 0.5], coordinate: [10, 5] },
    controlPoints: [{ id: 'gcp', image: [0.25, 0.25], coordinate: [5, 7.5] }],
  };
  const anchorBefore = structuredClone(record.anchor);
  const gcpBefore = structuredClone(record.controlPoints);
  const geometry = referenceImagePlacementGeometry(record, host);
  const hit = referenceImageFreeTransformHit(record, geometry.corners[2], host);
  const drag = createReferenceImageFreeTransformDrag(record, hit, 51);
  assert.equal(applyReferenceImageFreeTransformDrag(record, drag, [330, 230], host), true);
  assert.deepEqual(record.anchor, anchorBefore);
  assert.deepEqual(record.controlPoints, gcpBefore);
});

test('placement coordinate lookup uses projective interpolation for a corner-pinned quad', () => {
  const record = {
    mapQuad: [[0, 0], [12, 0], [8, 10], [0, 10]],
    flipX: false,
    flipY: false,
  };
  const warp = buildReferenceImagePlacementWarp(record);
  assert.equal(warp.ok, true);
  const expected = warp.project([0.5, 0.5]);
  const actual = referenceImagePlacementCoordinateAtUv(record, [0.5, 0.5]);
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-10);
  assert.ok(Math.abs(actual[1] - expected[1]) < 1e-10);
  const bilinearCenter = [5, 5];
  assert.ok(Math.abs(actual[0] - bilinearCenter[0]) > 0.05 || Math.abs(actual[1] - bilinearCenter[1]) > 0.05);
});

test('placement UV hit testing follows the geographic quad and reflection flags', () => {
  const host = createHost();
  const record = {
    mapQuad: referenceImageScreenRectToMapQuad({ x: 100, y: 100, width: 200, height: 100 }, 0, host),
    flipX: false,
    flipY: false,
  };
  assertPairClose(referenceImagePlacementUvAtPoint(record, [200, 150], host), [0.5, 0.5]);
  assertPairClose(referenceImagePlacementUvAtPoint(record, [150, 125], host), [0.25, 0.25]);
  record.flipX = true;
  assertPairClose(referenceImagePlacementUvAtPoint(record, [150, 125], host), [0.75, 0.25]);
  assert.equal(referenceImagePlacementUvAtPoint(record, [20, 20], host), null);
});
