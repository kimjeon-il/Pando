import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskPresentation, draftToolbarStatus, multiDraftReviewActive } from '../../assets/js/modules/app-task-presentation.js';

const options = (overrides = {}) => ({
  state: { tool: 'river', geometryPreview: { session: null } },
  draft: { coords: [[0, 0], [1, 0]], issues: [], inputPhase: 'refine', selectedVertexIndex: null },
  draftMode: true, hasDraftTool: true, minimumPoints: 2, cutLineReady: true,
  ...overrides,
});

const territorySession = (overrides = {}) => ({
  kind: 'annex', tool: 'annex-territory', stage: 'selection', activePhase: 'drawing', activeMethod: 'line',
  parts: [], currentGeometry: null, previewPending: false,
  ...overrides,
});

test('shared toolbar is visible even for an empty draft and enforces completion and deletion readiness', () => {
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

test('all four territory operations use the same candidate-review toolbar contract', () => {
  for (const [tool, kind] of [
    ['annex-territory', 'annex'],
    ['new-country', 'new-country'],
    ['draw-territorial-unit', 'subunit'],
    ['draw-territorial-unit', 'region'],
  ]) {
    const state = {
      tool,
      geometryPreview: { session: {} },
      territorySelectionSession: territorySession({ tool, kind, activePhase: 'candidate', activeMethod: 'polygon' }),
    };
    const result = draftToolbarStatus(options({ state, draftMode: false, hasDraftTool: false }));
    assert.equal(result.visible, true);
    assert.equal(result.redraw, true);
    assert.equal(result.insert, false);
    assert.equal(result.remove, false);
    assert.equal(result.complete, false);
  }
});

test('territory review hides drawing tools even when the prepared result remains available', () => {
  const session = territorySession({ stage: 'review', activePhase: 'candidate', activeMethod: 'polygon' });
  const result = draftToolbarStatus(options({
    state: { tool: session.tool, territorySelectionSession: session, geometryPreview: { session: {} } },
    draftMode: false,
    hasDraftTool: false,
  }));
  assert.equal(result.visible, false);
  assert.equal(result.editable, false);
  assert.equal(result.redraw, false);
});

test('stored territory areas can return to review but an unfinished path cannot be completed', () => {
  const session = territorySession({ parts: [{ geometry: {} }] });
  const input = options({
    state: { tool: session.tool, territorySelectionSession: session, geometryPreview: { session: null } },
    draft: { coords: [], issues: [], strokeActive: false },
    cutLineReady: false,
  });
  assert.equal(draftToolbarStatus(input).complete, true);
  input.draft.coords = [[0, 0]];
  assert.equal(draftToolbarStatus(input).complete, false);
  session.activePhase = 'components';
  assert.equal(draftToolbarStatus({ ...input, draftMode: false, hasDraftTool: false }).visible, false);
});

test('hydro keeps its multi-path review while territorial work never uses multiDraft', () => {
  const hydro = { tool: 'river', multiDraft: { kind: 'hydro', shape: 'line', parts: [{}], current: null } };
  assert.equal(multiDraftReviewActive(hydro), true);
  const territorial = {
    tool: 'new-country',
    territorySelectionSession: territorySession({ kind: 'new-country', tool: 'new-country', parts: [{ geometry: {} }] }),
  };
  assert.equal(multiDraftReviewActive(territorial), false);
});

test('completion awaits the drawing operation, rejects duplicate clicks and never applies a preview', async t => {
  const priorFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => {
    if (priorFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', priorFrame);
    else delete globalThis.requestAnimationFrame;
  });
  const input = options();
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
    TERRITORIAL_UNIT_TYPES: { SUBUNIT: 'subunit' },
    editorWorkspacePresentation: { sync() {} }, projectUi: { syncHistory() {} },
    syncStatusBar() {}, layoutMode: 'wide', territorySelectionPresentation: () => null,
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
