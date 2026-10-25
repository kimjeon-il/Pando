import assert from 'node:assert/strict';
import test from 'node:test';
import * as layout from '../../plugins/pando-map-tools/lib/analysis/layout.mjs';
function sheet() {
  const width = 240, height = 180, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const line = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3); };
  const frame = (x0, y0, x1, y1) => { line(x0, y0, x1, y0);line(x0, y1, x1, y1);line(x0, y0, x0, y1);line(x1, y0, x1, y1); };
  frame(8, 8, 232, 172);frame(145, 100, 220, 160);
  return { width, height, data };
}
test('map layout separates framed insets from the main map without duplicating nested edges', () => {
  assert.equal(typeof layout.detectReferenceMapLayout, 'function');
  const result = layout.detectReferenceMapLayout(sheet());
  assert.equal(result.panels.length, 2);assert.equal(result.panels[0].kind, 'main');
  assert.deepEqual(result.panels[1].sourceRect, { x: 145, y: 100, width: 76, height: 61 });
  assert.equal(result.panels[1].requiresReview, true);
});
test('only explicit legend evidence excludes a candidate; blank maps do not invent panels', () => {
  const result = layout.detectReferenceMapLayout(sheet(), { blocks: [{ rawValue: '圖例', boundingBox: { x: 152, y: 105, width: 30, height: 15 } }] });
  assert.equal(result.panels[1].kind, 'legend');
  const blank = sheet();blank.data.fill(255);
  assert.deepEqual(layout.detectReferenceMapLayout(blank).panels, []);
});
