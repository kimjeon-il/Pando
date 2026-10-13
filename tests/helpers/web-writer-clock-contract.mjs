import { historySnapshotFixture } from './editable-history-fixture.mjs';
import { loadWebOracle } from './web-oracle.mjs';

const { createGenericFeatureService, genericFeatureGeometryKind } = await loadWebOracle('assets/js/modules/generic-feature-service.js');
const { createDistributionService } = await loadWebOracle('assets/js/modules/distribution-service.js');
const { createProjectCommandPipeline } = await loadWebOracle('assets/js/modules/project-command-pipeline.js');
const { createHistoryService } = await loadWebOracle('assets/js/modules/history-service.js');
const { createObjectMetadata } = await loadWebOracle('assets/js/modules/app-object-metadata.js');
const { createObjectDeletion } = await loadWebOracle('assets/js/modules/app-object-deletion.js');
const implementation = Object.assign({}, ...await Promise.all(['tests/helpers/timeline-project.mjs',
  'assets/js/modules/app-project-snapshots.js','assets/js/modules/territorial-entity-store.js',
  'assets/js/modules/territorial-entity-repository.js','assets/js/modules/project-state.js',
  'assets/js/modules/save-state-controller.js'].map(loadWebOracle)));

/** Original domain writers + original app snapshot/history; platform publication ports are inert. */
export function captureWebWriterClockContract() {
  const { owner,state,saveState } = historySnapshotFixture({ implementation });
  state.stateRevision=0;
  const history = createHistoryService({ store: { history: [],historyMeta: [],future: [],futureMeta: [] },
    snapshot: owner.snapshotEditable,restore: owner.restoreEditable,normalizeMetadata: value => value,
    onRecord: () => saveState.markContentChanged() });
  let rollbackRevision=0;
  // This is the exact composition advanceRevision port in original app-history-assembly.
  const pipeline = createProjectCommandPipeline({ captureSnapshot: () => {
    rollbackRevision=state.stateRevision;return owner.snapshotEditable();
  },recordHistory: (meta,snapshot) => history.commitSnapshot(snapshot,meta),discardHistory: history.discardLast,
  restoreSnapshot: snapshot => { owner.restoreEditable(snapshot,{ mode: 'rollback' });state.stateRevision=rollbackRevision; },
  advanceRevision: () => ++state.stateRevision });
  const generic = createGenericFeatureService({ documentStore: { readFeatures: () => state.genericFeatures,
    replaceFeatures: rows => { state.genericFeatures=rows; } },commandPipeline: pipeline,
  writeColor: (feature,color) => { feature.properties.color=color; } });
  const distribution = createDistributionService({ documentStore: { readLayers: () => state.distributionLayers,
    readEntries: () => state.distributionEntries,replaceLayers: rows => { state.distributionLayers=rows; },
    replaceEntries: rows => { state.distributionEntries=rows; } },commandPipeline: pipeline,
  presentationStore: { setRenderMode: value => { state.distributionSettings.renderMode=value; },
    setBoundaryVisible: value => { state.distributionSettings.boundaryVisible=value; } },
  writeLayerColor: (layer,color) => { layer.color=color; },territorialExists: () => true });
  const rows=[];
  const capture = (operation,action) => {
    let value,error=null;
    try { value=action(); } catch (caught) { error={ name: caught.name,message: caught.message,code: caught.code ?? null }; }
    const save=saveState.snapshot();
    rows.push({ operation,result: value===undefined ? null : structuredClone(value),error,
      stateRevision: state.stateRevision,contentToken: save.currentContentToken,presentationToken: save.currentPresentationToken,
      dirty: save.documentDirty,presentationDirty: save.presentationDirty,undo: history.canUndo(),redo: history.canRedo(),
      genericFeatures: structuredClone(state.genericFeatures),distributionLayers: structuredClone(state.distributionLayers),
      distributionEntries: structuredClone(state.distributionEntries),hydroEdits: structuredClone(state.hydroEdits) });
  };
  const feature={ type: 'Feature',id: 'G',geometry: { type: 'Point',coordinates: [1.125,2.25] },
    properties: { schemaVersion: 2,name: 'G',notes: '',color: '#8c68d8',locked: false,
      source: { kind: 'drawn',license: '',details: {} } } };
  capture('initial',() => {});
  capture('generic.create',() => generic.add(feature));
  capture('generic.metadata noop',() => generic.updateMetadata('G','name',' G '));
  capture('generic.metadata',() => generic.updateMetadata('G','notes','  kept  '));
  capture('generic.metadata missing',() => generic.updateMetadata('missing','notes','x'));
  capture('generic.metadata unsupported',() => generic.updateMetadata('G','unsupported','x'));
  capture('generic.import empty',() => generic.addMany([]));
  capture('generic.remove',() => generic.remove('G'));
  capture('generic.remove missing',() => generic.remove('G'));
  capture('distribution.layer.create',() => distribution.createLayer({ id: 'L',name: 'L' }));
  capture('distribution.layer.metadata noop',() => distribution.updateLayer('L','name',' L '));
  capture('distribution.entry.create',() => distribution.addEntry({ id: 'E',layerId: 'L',mode: 'geometry',
    geometry: { type: 'Polygon',coordinates: [[[0,0],[1,0],[1,1],[0,0]]] },value: '2.125' }));
  capture('distribution.entry.value noop',() => distribution.updateEntry('E',' 2.125 '));
  capture('distribution.entry.value',() => distribution.updateEntry('E','3.25'));
  capture('distribution.import empty',() => distribution.append({}));
  capture('distribution.layer.remove',() => distribution.deleteLayer('L'));
  capture('Undo layer removal',() => history.undo());
  capture('Redo layer removal',() => history.redo());

  const hydro={ type: 'Feature',id: 'H',geometry: { type: 'LineString',coordinates: [[1.125,2.25],[3.5,4.75]] },
    properties: { category: 'river',name: 'H',notes: '',locked: false } };
  state.hydroEdits=[hydro];state.selected={ domain: 'hydro',type: 'river',id: 'H' };
  const project={ recordHistory: history.record,queueAutosave() {} };
  const metadata=createObjectMetadata();
  const ports={ projectState: { state },domains: { projectDomain: project,
    selectionUiController: { clear() { state.selected=null; } },renderingDomain: { invalidateHydroPatch() {} } },
    hydroPresentation: { hydroEditById: id => state.hydroEdits.find(row => row.id===id),hydroCategoryLabel: () => '강',
      hydroFallbackName: () => 'river',hydroEditorName: name => name },
    hydroModel: { hydroFeatureById: id => state.hydroEdits.find(row => row.id===id),
      hydroEditById: id => state.hydroEdits.find(row => row.id===id) },objectModelA: { hydroAccusativeLabel: () => '강을' },
    readinessUi: { requireCanonicalData: () => true },
    propertyEditingA: { applyHydroSelectionIntent() {} },layers: { markLayerTreeDirty() {} },feedback: { setActionStatus() {} } };
  metadata.connect(ports);
  const deletion=createObjectDeletion();deletion.connect(ports);
  capture('hydro.metadata noop',() => metadata.commitHydroEdit('name','H'));
  capture('hydro.metadata raw',() => metadata.commitHydroEdit('name','  raw H  '));
  capture('hydro.remove direct',() => deletion.deleteSelected());
  return { rows,geometryKind: genericFeatureGeometryKind(feature) };
}
