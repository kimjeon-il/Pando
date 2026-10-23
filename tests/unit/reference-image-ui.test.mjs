import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceImageEditorMarkup, referenceImageWorkflow } from '../../assets/js/modules/reference-image-ui.js';

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

test('layout review exposes separate crop actions and excludes recognized legends', () => {
  const value = record({ analysis: { stage: 'layout', busy: false, layout: { panels: [
    { id: 'main', kind: 'main', sourceRect: { x: 10, y: 20, width: 500, height: 400 } },
    { id: 'legend', kind: 'legend', sourceRect: { x: 30, y: 40, width: 50, height: 40 } },
  ] } } });
  assert.equal(referenceImageWorkflow({ record: value }).id, 'layout');
  const markup = referenceImageEditorMarkup({ ...options, record: value });
  assert.match(markup, /data-panel-id="main">이 영역 맞춤/);
  assert.match(markup, /data-panel-id="legend" disabled/);
  assert.match(markup, /원본 \(10, 20\)/);
});

test('editor groups placement, match and display into accessible tabs while keeping image controls shared', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record(),
  });
  assert.match(markup, /data-ref-tab="placement"/);
  assert.match(markup, /data-ref-tab="match"/);
  assert.match(markup, /data-ref-tab="display"/);
  assert.match(markup, /data-ref-section="placement"/);
  assert.match(markup, /data-ref-section="match"/);
  assert.match(markup, /data-ref-section="display"/);
  assert.match(markup, /aria-selected="true" tabindex="0">배치<\/button>/);
  assert.match(markup, />표시<\/strong>/);
  assert.match(markup, />배치 도구<\/strong>/);
  assert.match(markup, />맞추기 도구<\/strong>/);
  assert.match(markup, /reference-image-selected-card/);
  assert.match(markup, /data-ref-field="name"/);
  assert.match(markup, /data-ref-field="opacity"/);
  assert.match(markup, /data-ref-field="locked"/);
  assert.match(markup, /data-ref-action="delete"/);

  const placement = markup.indexOf('data-ref-action="placement"');
  const free = markup.indexOf('data-ref-action="free-transform"');
  const gcp = markup.indexOf('data-ref-action="gcp"');
  assert.ok(placement >= 0 && free > placement && gcp > free);
  assert.match(markup, /data-ref-action="placement"[^>]*>배치<\/button>/);
  assert.match(markup, /data-ref-action="free-transform"[^>]*>자유 변형<\/button>/);
  assert.match(markup, /data-ref-action="gcp"[^>]*>기준점<\/button>/);
  assert.doesNotMatch(markup, />배치 편집<\/button>/);
  assert.doesNotMatch(markup, />기준점 추가<\/button>/);
});

test('task tab preserves selected panel and hides inactive sections without removing tool actions', () => {
  const markup = referenceImageEditorMarkup({
    ...options, activeTab: 'match',
    record: record(),
  });
  assert.match(markup, /id="reference-image-panel-placement"[^>]* hidden>/);
  assert.match(markup, /id="reference-image-panel-match"[^>]*aria-labelledby="reference-image-tab-match">/);
  assert.match(markup, /id="reference-image-panel-display"[^>]* hidden>/);
  assert.match(markup, /aria-selected="true" tabindex="0">맞추기<\/button>/);
  assert.match(markup, /data-ref-action="linear-river"/);
  assert.match(markup, /data-ref-action="auto-georef"/);
  assert.match(markup, /reference-image-advanced/);
  assert.match(markup, /<summary>고급 보정 방식 및 상세 오차<\/summary>/);
  assert.match(markup, /data-ref-field="warp"/);
});

test('calibration list shows hard anchor and per-GCP residuals next to each point', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record({
      anchor: { image: [0.5, 0.5], coordinate: [10, 20] },
      controlPoints: [
        { id: 'a', image: [0.25, 0.25], coordinate: [8, 18] },
        { id: 'b', image: [0.75, 0.7], coordinate: [12, 22] },
      ],
    }),
    warp: {
      ok: true,
      mode: 'projective',
      minimumPoints: 4,
      diagnostics: {
        rmsMeters: 2200,
        maxMeters: 3100,
        hardMaxMeters: 0.002,
        warnings: [],
        residuals: [
          { id: 'anchor', pinned: true, meters: 0.002 },
          { id: 'a', pinned: false, meters: 2500 },
          { id: 'b', pinned: false, meters: 310 },
        ],
      },
    },
  });
  assert.match(markup, /📌 고정점/);
  assert.match(markup, /오차 0\.002 m/);
  assert.match(markup, /기준점 1/);
  assert.match(markup, /오차 2\.5 km/);
  assert.match(markup, /기준점 2/);
  assert.match(markup, /오차 310\.0 m/);
  assert.match(markup, />이미지점<\/button>/);
  assert.match(markup, />지도점<\/button>/);
});

test('calibration section shows a focused empty state when no points exist', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record(),
  });
  assert.match(markup, /reference-image-points-empty/);
  assert.match(markup, /기준점이 없습니다/);
  assert.match(markup, /일반점<\/small><strong>0<\/strong>/);
  assert.match(markup, /고정점<\/small><strong>0<\/strong>/);
});

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


test('automatic georeferencing shows scan action and a review-before-apply preview', () => {
  const previewRecord = record({
    analysis: { georef: {
      ok: true,
      seedCount: 18,
      symbolCandidateCount: 12,
      georef: {
        inlierCount: 9,
        rejectedCount: 3,
        diagnostics: { rmsMeters: 4200 },
      },
    } },
  });
  const markup = referenceImageEditorMarkup({ ...options, record: previewRecord });
  assert.match(markup, /data-ref-action="auto-georef"[^>]*>자동 맞춤<\/button>/);
  assert.match(markup, /탐색 도시<\/small><strong>18<\/strong>/);
  assert.match(markup, /기호 후보<\/small><strong>12<\/strong>/);
  assert.match(markup, /채택<\/small><strong>9<\/strong>/);
  assert.match(markup, /제외<\/small><strong>3<\/strong>/);
  assert.match(markup, /RMS<\/small><strong>4\.2 km<\/strong>/);
  assert.match(markup, /data-ref-action="apply-auto-georef"[^>]*>결과 적용<\/button>/);
  assert.match(markup, /data-ref-action="cancel-auto-georef"[^>]*>결과 취소<\/button>/);
});

test('automatic georeferencing action is disabled while analysis is running or the record is locked', () => {
  const busy = referenceImageEditorMarkup({
    ...options,
    record: record({ analysis: { busy: true } }),
  });
  assert.match(busy, /data-ref-action="auto-georef" disabled>자동 분석 중…<\/button>/);

  const locked = referenceImageEditorMarkup({
    ...options,
    record: record({ locked: true }),
  });
  assert.match(locked, /data-ref-action="auto-georef" disabled>자동 맞춤<\/button>/);
});


test('OCR automatic georeferencing preview identifies the method and place matching counts', () => {
  const markup = referenceImageEditorMarkup({
    ...options,
    record: record({
      analysis: { georef: {
        ok: true,
        source: 'place-ocr',
        ocr: { detections: [{ text: 'Berlin' }, { text: 'Prag' }, { text: 'Wien' }] },
        matching: { matchCount: 2 },
        georef: {
          inlierCount: 2,
          rejectedCount: 0,
          diagnostics: { rmsMeters: 1800 },
        },
      } },
    }),
  });
  assert.match(markup, /방식<\/small><strong>OCR 도시명<\/strong>/);
  assert.match(markup, /인식 문자<\/small><strong>3<\/strong>/);
  assert.match(markup, /지명 매칭<\/small><strong>2<\/strong>/);
  assert.match(markup, /RMS<\/small><strong>1\.8 km<\/strong>/);
  assert.match(markup, /data-ref-action="apply-auto-georef"/);
});

test('map-navigation toggle is independent of image calibration and explains edit limits', () => {
  const ordinary = referenceImageEditorMarkup({ ...options, record: record(), navigationOverride: false });
  const navigation = referenceImageEditorMarkup({ ...options, record: record(), navigationOverride: true });
  assert.match(ordinary, /data-ref-action="navigation-toggle" aria-pressed="false"/);
  assert.match(ordinary, /이미지 편집 중 Space를 누르면 지도를 이동합니다/);
  assert.match(navigation, /data-ref-action="navigation-toggle" aria-pressed="true"/);
  assert.match(navigation, /이미지 조작으로 복귀/);

  const anchored = referenceImageEditorMarkup({
    ...options, record: record({ anchor: { image: [0.5, 0.5], coordinate: [10, 20] } }),
  });
  assert.match(anchored, /고정점이 있어 이미지 본문 이동이 제한됩니다/);
  const locked = referenceImageEditorMarkup({ ...options, record: record({ locked: true }) });
  assert.match(locked, /잠금이 설정되어 이미지 편집이 제한됩니다/);
  const calibrated = referenceImageEditorMarkup({
    ...options, record: record(), warp: { ok: true, mode: 'similarity', minimumPoints: 2 },
  });
  assert.match(calibrated, /기준점 보정이 적용되어 기본 위치 이동 대신 기준점으로 조정합니다/);
});

test('point workflow distinguishes an unfinished pair from an immediate point replacement', () => {
  const image = record();
  const initial = referenceImageWorkflow({ record: image, gcpState: { recordId: image.id, step: 'image' } });
  const pending = referenceImageWorkflow({ record: image, gcpState: { recordId: image.id, step: 'map', image: [0.2, 0.4] } });
  assert.deepEqual(initial.steps, ['이미지 위치', '지도 위치']);
  assert.equal(initial.step, 0);
  assert.equal(pending.step, 1);
  assert.match(pending.instruction, /같은 지점/);
  assert.match(pending.detail, /이미 추가한 기준점/);
  assert.deepEqual(pending.actions.map(item => item.action), ['cancel']);
  assert.equal(image.controlPoints.length, 0);

  const replacement = referenceImageWorkflow({ record: image, gcpState: { recordId: image.id, step: 'map', pointId: 'point-a' } });
  assert.deepEqual(replacement.steps, ['지도 위치 수정']);
  assert.equal(replacement.step, 0);
  assert.match(replacement.detail, /즉시 반영/);
});

test('line workflow gates progression and keeps preview confirmation separate from cancellation', () => {
  const image = record();
  const draft = { phase: 'image', kind: 'river', anchors: [[0, 0]], image: [[0, 0]], coordinates: [] };
  const start = referenceImageWorkflow({ record: image, linearDraft: draft });
  assert.equal(start.step, 0);
  assert.equal(start.actions.find(item => item.action === 'linear-image-finish').disabled, true);
  const map = referenceImageWorkflow({ record: image, linearDraft: { ...draft, phase: 'map', coordinates: [[10, 20], [11, 21]] } });
  assert.equal(map.step, 1);
  assert.equal(map.actions.find(item => item.action === 'linear-preview').disabled, false);
  const preview = referenceImageWorkflow({ record: image, linearDraft: { ...draft, phase: 'preview' } });
  assert.equal(preview.step, 2);
  assert.deepEqual(preview.steps, ['이미지 선', '지도 선', '미리보기', '적용']);
  assert.deepEqual(preview.actions.map(item => item.action), ['linear-map-redraw', 'linear-apply', 'linear-cancel']);
  assert.match(preview.detail, /아직 적용/);
  assert.equal(preview.actions.some(item => item.action === 'finish'), false);
});

test('automatic workflow offers cancellation during analysis and explicit confirmation after review', () => {
  const busy = referenceImageWorkflow({ record: record({ analysis: { busy: true } }) });
  assert.equal(busy.step, 0);
  assert.deepEqual(busy.actions.map(item => item.action), ['cancel-auto-georef']);
  const ready = referenceImageWorkflow({ record: record({ analysis: { georef: { ok: true, georef: { inlierCount: 4 } } } }) });
  assert.equal(ready.step, 1);
  assert.match(ready.instruction, /분석 결과/);
  assert.match(ready.detail, /결과 적용/);
  assert.deepEqual(ready.actions.map(item => item.action), ['apply-auto-georef', 'cancel-auto-georef']);
  assert.equal(referenceImageWorkflow({ record: record() }), null);
});

test('ambiguous locations require an explicit choice before applying calibration', () => {
  const workflow = referenceImageWorkflow({ record: record({ analysis: { georef: { ok: true, requiresLocationChoice: true, locations: [{}, {}] } } }) });
  assert.equal(workflow.actions.find(row => row.action === 'apply-auto-georef').disabled, true);
});

test('boundary review starts with no selection and disables incomplete faces', () => {
  const image = record({ analysis: { reviewing: true, boundaries: { graph: { width: 100, height: 100, chains: [{ id: 2, points: [[1, 1], [2, 2]], semanticBits: 1 }],
    faces: [{ id: 4, touchesImageEdge: true }], unresolved: [{ point: [1, 1] }] } }, selectedIds: new Set() } });
  const workflow = referenceImageWorkflow({ record: image });
  assert.equal(workflow.id, 'boundaries');
  assert.equal(workflow.actions.find(row => row.action === 'apply-boundaries').disabled, true);
  const markup = referenceImageEditorMarkup({ ...options, record: image });
  assert.match(markup, /data-ref-candidate="line:2"/);
  assert.match(markup, /data-ref-candidate="face:4"[^>]*disabled/);
  assert.match(markup, /미해결/);
  for (const action of ['boundary-exclude', 'boundary-cut', 'boundary-retrace', 'boundary-endpoint']) assert.match(markup, new RegExp(`data-ref-action="${action}"`));
});
