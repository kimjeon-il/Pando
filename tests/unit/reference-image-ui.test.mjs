import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceImageEditorMarkup } from '../../assets/js/modules/reference-image-ui.js';

function record(overrides = {}) {
  return {
    id: 'ref-a',
    name: 'map',
    opacity: 0.5,
    blendMode: 'source-over',
    warpMode: 'auto',
    visible: true,
    locked: false,
    flipX: false,
    flipY: false,
    controlPoints: [],
    anchor: null,
    ...overrides,
  };
}

const options = {
  warp: { ok: false, minimumPoints: 2 },
  placementEditing: false,
  freeTransformEditing: false,
  index: 0,
  count: 1,
  blendOptions: [['source-over', '일반']],
  warpOptions: [['auto', '자동']],
};

test('free transform button is available and reports active state for an uncalibrated image', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record(),
    freeTransformEditing: true,
  });
  assert.match(markup, /data-ref-action="free-transform"/);
  assert.match(markup, /data-ref-action="free-transform" aria-pressed="true"/);
  assert.match(markup, /Projective Corner Pin/);
});

test('anchor, GCP and free transform controls stay available together', () => {
  const combined = referenceImageEditorMarkup({
    ...options,
    record: record({
      anchor: { image: [0.5, 0.5], coordinate: [10, 20] },
      controlPoints: [{ id: 'p', image: [0.25, 0.25], coordinate: [8, 18] }],
    }),
    warp: {
      ok: true,
      minimumPoints: 2,
      diagnostics: { rmsMeters: 1200, maxMeters: 1800, hardMaxMeters: 0.002, warnings: [] },
    },
    freeTransformEditing: true,
  });
  assert.doesNotMatch(combined, /data-ref-action="anchor"[^>]* disabled/);
  assert.doesNotMatch(combined, /data-ref-action="gcp"[^>]* disabled/);
  assert.doesNotMatch(combined, /data-ref-action="free-transform"[^>]* disabled/);
  assert.match(combined, /TPS rubber-sheet/);
  assert.match(combined, /고정 오차/);
  assert.match(combined, /0\.002 m/);
});

test('rubber-sheet calibration shows TPS as the effective locked warp mode', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record({
      cornerPinEnabled: true,
      warpMode: 'auto',
      anchor: { image: [0.5, 0.5], coordinate: [10, 20] },
      controlPoints: [{ id: 'p', image: [0.25, 0.25], coordinate: [8, 18] }],
    }),
    warp: {
      ok: true,
      mode: 'tps',
      minimumPoints: 3,
      diagnostics: { rmsMeters: 1000, maxMeters: 1500, hardMaxMeters: 0.001, warnings: [] },
    },
    warpOptions: [['auto', '자동'], ['tps', 'TPS 비선형']],
  });
  assert.match(markup, /data-ref-field="warp" disabled/);
  assert.match(markup, /<option value="tps" selected>TPS 비선형<\/option>/);
});

test('free transform is disabled only by record lock', () => {
  const anchored = referenceImageEditorMarkup({
    ...options,
    record: record({ anchor: { image: [0.5, 0.5], coordinate: [10, 20] } }),
  });
  assert.doesNotMatch(anchored, /data-ref-action="free-transform"[^>]* disabled/);

  const withGcp = referenceImageEditorMarkup({
    ...options,
    record: record({ controlPoints: [{ id: 'p', image: [0.5, 0.5], coordinate: [10, 20] }] }),
  });
  assert.doesNotMatch(withGcp, /data-ref-action="free-transform"[^>]* disabled/);

  const locked = referenceImageEditorMarkup({
    ...options,
    record: record({ locked: true }),
  });
  assert.match(locked, /data-ref-action="free-transform"[^>]* disabled/);
});
