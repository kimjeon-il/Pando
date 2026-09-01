import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditPreviewController } from '../../assets/js/modules/edit-preview-controller.js';

test('edit preview reuses its typed buffer and exposes only the latest segments', () => {
  let clock = 0;
  const preview = createEditPreviewController({ now: () => ++clock });
  preview.begin({
    key: 'border:AAA|BBB',
    segments: [{ start: [1, 2], end: [3, 4] }],
    style: { color: '#abcdef', width: 3 },
  });
  const allocated = preview.stats().allocatedBytes;
  preview.update([
    [[5, 6], [7, 8]],
    [[9, 10], [11, 12]],
  ]);
  const packet = preview.packet();
  assert.equal(packet.kind, 'stroke');
  assert.equal(packet.packet.segmentCount, 2);
  assert.deepEqual([...packet.packet.startsEnds], [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(packet.packet.style.color, '#abcdef');
  assert.equal(preview.stats().allocatedBytes, allocated);
  assert.equal(preview.stats().reusedBufferCount, 1);
});

test('edit preview filters invalid segments and clears session-only data', () => {
  const preview = createEditPreviewController();
  preview.begin({
    segments: [
      [[0, 0], [0, 0]],
      [[0, 0], [1, 1]],
      [[Number.NaN, 0], [1, 1]],
    ],
  });
  assert.equal(preview.packet().packet.segmentCount, 1);
  assert.equal(preview.clear(), true);
  assert.equal(preview.packet(), null);
  assert.equal(preview.stats().active, false);
});
