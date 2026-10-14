import { historySnapshotFixture } from './editable-history-fixture.mjs';
import { loadWebOracle } from './web-oracle.mjs';

const { createGenericCommands } = await loadWebOracle('assets/js/modules/app-generic-commands.js');
const { createObjectDeletion } = await loadWebOracle('assets/js/modules/app-object-deletion.js');
const { automaticLabelSettings } = await loadWebOracle('assets/js/modules/label-layout.js');
const { createHistoryService } = await loadWebOracle('assets/js/modules/history-service.js');
const implementation = Object.assign({}, ...await Promise.all(['tests/helpers/timeline-project.mjs',
  'assets/js/modules/app-project-snapshots.js','assets/js/modules/territorial-entity-store.js',
  'assets/js/modules/territorial-entity-repository.js','assets/js/modules/project-state.js',
  'assets/js/modules/save-state-controller.js'].map(loadWebOracle)));

/** Actual original creation/deletion plus app history/dirty owners, no fake dirty policy. */
export function captureWebContentDirtyContract() {
  const { owner, state, saveState } = historySnapshotFixture({ implementation });
  state.stateRevision = 0;
  const history = createHistoryService({ store: { history: [],historyMeta: [],future: [],futureMeta: [] },
    snapshot: owner.snapshotEditable,restore: owner.restoreEditable,normalizeMetadata: value => value,
    onRecord: () => saveState.markContentChanged() });
  const project = { recordHistory: history.record,queueAutosave() {} };
  const labelKey = (domain,id) => `${domain}:${id}`;
  const id = '22000000-0000-4000-8000-000000000011';
  const creation = createGenericCommands();
  creation.connect({ projectState: { state },domains: { projectDomain: project,renderingDomain: { invalidateLabels() {} } },
    surfaces: { uid: () => id },labelPresentation: { labelKey,automaticLabelSettings },countryEditingB: { exitLabelMode() {} },
    propertyEditingA: { applyLabelSelectionIntent() {} },feedback: { setActionStatus() {} } });
  const deletion = createObjectDeletion();
  deletion.connect({ projectState: { state },readinessUi: { requireCanonicalData: () => true },
    domains: { projectDomain: project,selectionUiController: { clear() { state.selected=null; } },renderingDomain: { invalidateLabels() {} } },
    labelPresentation: { labelKey },layers: { markLayerTreeDirty() {} },feedback: { setActionStatus() {} } });
  const rows = [];
  const capture = (operation, action) => {
    action(); const save = saveState.snapshot();
    rows.push({ operation,labels: structuredClone(state.labels),labelSettings: structuredClone(state.labelSettings),
      layerVisibility: structuredClone(state.layerVisibility),stateRevision: state.stateRevision,
      documentDirty: save.documentDirty,presentationDirty: save.presentationDirty,hasUnsavedChanges: save.hasUnsavedChanges,
      file: save.file,currentContentToken: save.currentContentToken,currentPresentationToken: save.currentPresentationToken,
      undo: history.canUndo(),redo: history.canRedo() });
  };
  const previousPrompt = Object.getOwnPropertyDescriptor(globalThis,'prompt');
  Object.defineProperty(globalThis,'prompt',{ configurable: true,value: () => 'New label' });
  try {
    capture('initial',() => {});
    capture('create label and automatic settings through the original command',() => creation.addLabelAt([1.125,2.25]));
    capture('Undo label creation',() => history.undo());
    capture('Redo label creation',() => history.redo());
    capture('explicit file saved with the label',() => saveState.markFileSaved());
    capture('delete label and its settings through the original command',() => {
      state.selected={ domain: 'label',type: 'city',id };deletion.deleteSelected();
    });
    capture('Undo label deletion',() => history.undo());
    capture('Redo label deletion',() => history.redo());
    capture('explicit presentation edit after deletion',() => {
      state.layerVisibility.labels=false;saveState.markPresentationChanged();
    });
    capture('Undo content deletion retains independent presentation dirtiness',() => history.undo());
  } finally {
    if (previousPrompt) Object.defineProperty(globalThis,'prompt',previousPrompt);else delete globalThis.prompt;
  }
  return rows;
}
