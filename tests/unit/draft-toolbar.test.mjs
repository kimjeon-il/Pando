import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskPresentation, draftToolbarStatus } from '../../assets/js/modules/app-task-presentation.js';

const options = (overrides = {}) => ({
  state: { tool: 'river', geometryPreview: { session: null } },
  draft: { coords: [[0, 0], [1, 0]], issues: [], inputPhase: 'refine', selectedVertexIndex: null },
  draftMode: true, hasDraftTool: true, minimumPoints: 2, cutLineReady: true,
  ...overrides,
});

test('shared toolbar is visible even for an empty draft and enforces completion/deletion readiness', () => {
  const initial = options();
  assert.equal(draftToolbarStatus(initial).complete, true);
  assert.equal(draftToolbarStatus(initial).remove, false);
  initial.draft.selectedVertexIndex = 0;
  assert.equal(draftToolbarStatus(initial).remove, true);
  initial.draft.strokeActive = true;
  assert.equal(draftToolbarStatus(initial).complete, false);
  initial.draft.strokeActive = false;
  assert.equal(draftToolbarStatus({ ...initial, cutLineReady: false }).complete, false);
  initial.draft.issues = [{ message: 'invalid' }];
  assert.equal(draftToolbarStatus(initial).complete, false);
  initial.draft.coords = [];
  const empty = draftToolbarStatus(initial);
  assert.equal(empty.visible, true);
  assert.equal(empty.insert, false);
  assert.equal(empty.complete, false);
});

test('completed candidates and previews only allow redraw, never a second drawing completion', () => {
  for (const state of [
    { tool: 'annex-territory', annexPhase: 'side', geometryPreview: { session: null } },
    { tool: 'annex-territory', annexPhase: 'polygon-preview', geometryPreview: { session: {} } },
    { tool: 'new-country', newCountryPhase: 'side', geometryPreview: { session: null } },
    { tool: 'split-territorial-unit', geometryPreview: { session: {} } },
  ]) {
    const result = draftToolbarStatus(options({ state, draftMode: false }));
    assert.equal(result.visible, true);
    assert.equal(result.redraw, true);
    assert.equal(result.insert, false);
    assert.equal(result.remove, false);
    assert.equal(result.complete, false);
  }
});

test('annex can review accumulated land from an empty draft but cannot ignore an unfinished path', () => {
  const input = options({
    state: { tool: 'annex-territory', annexPhase: 'line', annexDrawnSelections: [{}], geometryPreview: { session: null } },
    draft: { coords: [], issues: [] }, cutLineReady: false,
  });
  assert.equal(draftToolbarStatus(input).complete, true);
  input.draft.coords = [[0, 0]];
  assert.equal(draftToolbarStatus(input).complete, false);
  input.state.modeProcessing = true;
  input.draft.coords = [];
  assert.equal(draftToolbarStatus(input).complete, false);
  input.state.annexPhase = 'components';
  assert.equal(draftToolbarStatus({ ...input, draftMode: false, hasDraftTool: false }).visible, false);
});

test('a finalized multi-piece draft stays in review without treating an unfinished new path as a piece', () => {
  const input = options({
    state: { tool: 'river', multiDraft: { kind: 'hydro', shape: 'line', parts: [{}], current: null }, geometryPreview: { session: null } },
    draft: { coords: [], issues: [] }, draftMode: false,
  });
  const review = draftToolbarStatus(input);
  assert.equal(review.visible, true);
  assert.equal(review.redraw, true);
  assert.equal(review.complete, false, 'the final creation button, not drawing completion, owns review');
  input.draftMode = true;
  input.draft.coords = [[0, 0]];
  assert.equal(draftToolbarStatus(input).complete, false, 'an unfinished second path cannot be treated as finalized');
});

test('completion awaits the drawing operation, rejects duplicate clicks and never applies a preview', async t => {
  const priorFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => {
    if (priorFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', priorFrame);
    else delete globalThis.requestAnimationFrame;
  });
  const input = options();
  Object.assign(input.state, { annexCandidates: [], annexSelectedComponentKeys: [] });
  const done = { disabled: false, setAttribute() {} };
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const presentation = createTaskPresentation();
  presentation.connect({
    state: input.state, $: id => id === 'modeDraftDoneBtn' ? done : null,
    editingDraftSnapshot: () => input.draft, editingDomain: { draftInputActive: () => true },
    isGenericFeatureDraftTool: () => true, draftMinimumPoints: () => 2,
    describeTool: () => ({ name: '강 추가', stage: '경로 그리기' }),
    hydroToolConfig: () => null, isSpecialTool: () => true,
    editorWorkspacePresentation: { sync() {} }, projectUi: { syncHistory() {} },
    syncStatusBar() {}, layoutMode: 'wide',
    finishDraft: () => { calls++; return pending; },
    applyActiveGeometryPreview: () => assert.fail('completion must not apply the preview'),
    reportOperationError: error => { throw error; },
  });
  const completion = presentation.completeCurrentDraft();
  assert.equal(input.state.modeProcessing, true);
  assert.equal(done.disabled, true);
  assert.equal(presentation.completeCurrentDraft(), false);
  assert.equal(calls, 1);
  release(true);
  assert.equal(await completion, true);
  assert.equal(input.state.modeProcessing, false);
  input.state.geometryPreview.session = {};
  assert.equal(presentation.completeCurrentDraft(), false);
  assert.equal(calls, 1);
});
