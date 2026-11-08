import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadWebOracle } from "../../helpers/web-oracle.mjs";
import { historySnapshotFixture } from "../../helpers/editable-history-fixture.mjs";
import { createNodeCoreProject } from "../../helpers/core-project.mjs";

const original=Object.assign({},...await Promise.all(['tests/helpers/timeline-project.mjs',
  'assets/js/modules/app-project-snapshots.js','assets/js/modules/territorial-entity-store.js','assets/js/modules/territorial-entity-repository.js',
  'assets/js/modules/project-state.js','assets/js/modules/save-state-controller.js','assets/js/modules/history-service.js',
  'assets/js/modules/app-generic-commands.js','assets/js/modules/generic-feature-service.js','assets/js/modules/label-layout.js',
  'assets/js/modules/project-serializer.js'].map(loadWebOracle)));
const gid='11000000-0000-4000-8000-000000000019',lids=['22000000-0000-4000-8000-000000000021','22000000-0000-4000-8000-000000000022'];
function input() {
  const seed=JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json",import.meta.url),'utf8'));
  const source=structuredClone(seed.genericFeatures[0].properties.source);
  Object.assign(seed,{ territorialEntities: [],geometries: [],timelineRecords: { schemaVersion: 3,lifetimes: [],geometryBindings: [],parentRelations: [],propertyBindings: [] },
    labels: [],labelSettings: {},hydroEdits: [],distributionLayers: [],distributionEntries: [] });
  seed.distributionSettings.activeLayerId='';
  seed.layerPresentation.objectStyles={};seed.layerPresentation.objectOrder=[];
  seed.genericFeatures=[{ type: 'Feature',id: gid,geometry: { type: 'MultiPoint',coordinates: [[1.125,2.25],[3.5,4.75]] },
    properties: { schemaVersion: 2,name: 'Points',notes: 'Kept notes',color: '#8c68d8',locked: false,source } }];
  return seed;
}
const noRender={ invalidateGenericPatch() {},invalidateLabels() {} };
const observe=(body,state,history) => ({ labels: structuredClone(body.labels),labelSettings: structuredClone(body.labelSettings),
  genericFeatures: structuredClone(body.genericFeatures),hydroEdits: structuredClone(body.hydroEdits),distributionLayers: structuredClone(body.distributionLayers),
  distributionEntries: structuredClone(body.distributionEntries),geometries: structuredClone(body.geometries),stateRevision: state.stateRevision,
  documentDirty: state.documentDirty,presentationDirty: state.presentationDirty,undo: history.canUndo(),redo: history.canRedo() });
async function originalTrace(seed) {
  const f=historySnapshotFixture({ implementation: original });
  // This historical trace receives only the stable operation input. Its own
  // empty document remains on the frozen schema; the current seed is never loaded.
  f.state.genericFeatures=structuredClone(seed.genericFeatures);
  f.state.layerPresentation={ schemaVersion: 4,styles: {},objectStyles: {},objectOrder: [] };
  f.state.stateRevision=0;
  f.state.selected={ domain: 'generic',type: 'feature',id: gid };
  const history=original.createHistoryService({ store: { history: [],historyMeta: [],future: [],futureMeta: [] },
    snapshot: f.owner.snapshotEditable,restore: f.owner.restoreEditable,normalizeMetadata: value => value,
    onRecord: () => f.saveState.markContentChanged() });
  let index=0;const commands=original.createGenericCommands();
  commands.connect({ projectState: { state: f.state },platform: { deepClone: structuredClone },surfaces: { uid: () => lids[index++] },
    objectPresentation: { genericFeatureGeometryKind: original.genericFeatureGeometryKind },
    labelPresentation: { labelKey: (domain,id) => `${domain}:${id}`,automaticLabelSettings: original.automaticLabelSettings },
    spatialQuery: { mapObjectGeometryRevisions: { generic: 0 } },objectDisplay: { invalidateObjectPresentation() {} },
    layers: { markLayerTreeDirty() {} },
    propertyEditingA: { applyLabelSelectionIntent() {} },feedback: { setActionStatus() {},reportOperationError: error => { throw error; } },
    domains: { projectDomain: { recordHistory: history.record,queueAutosave() {} },renderingDomain: noRender } });
  const capture=() => observe({ ...f.owner.snapshotEditable(),labelSettings: f.state.labelSettings },{ ...f.saveState.snapshot(),stateRevision: f.state.stateRevision },history);
  const rows=[capture()];assert.equal(await commands.convertSelectedGenericFeature({target:'label'}),true);rows.push(capture());
  const serializer=original.createProjectSerializer({ appVersion: seed.version,baseDataset: seed.baseDataset,
    distributionModes: seed.distributionModel.sourceModes,terrainDataset: 'fixture-terrain',hydroDataset: 'fixture-hydro',
    now: () => new Date(seed.savedAt),readSnapshot: () => ({ territorialEntities: f.entityStore.identities(),projectFields: original.pickProjectFields(f.state),
      fullAutosave: true,terrainSourceInfo: { dataset: 'fixture-terrain' },hydroManifest: { dataset: 'fixture-hydro' } }) });
  const saved=serializer.buildProject();assert.deepEqual(saved.labels,rows[1].labels);
  assert.deepEqual(original.prepareProjectForStorage(saved).labels,rows[1].labels);
  assert.equal(history.undo(),true);rows.push(capture());assert.equal(history.redo(),true);rows.push(capture());return rows;
}

test('two-point generic conversion commits both labels, automatic settings and removal in one Core history entry matching original Web',async t => {
  const seed=input(),expected=await originalTrace(seed),owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  // The active test drives the Core-owned immutable batch directly; the
  // historical UI is used only through a frozen Web oracle above.
  const convert=async()=>{
    const feature=owner.documentModel.list('generic').find(row=>row.id===gid);
    const points=feature.geometry.coordinates;
    const labels=points.map((coordinates,index)=>({
      id:lids[index],name:points.length>1?`Points ${index+1}`:'Points',
      kind:'custom',coordinates:coordinates.slice(),
      notes:feature.properties.notes,
      metadata:{compatibilitySource:structuredClone(feature.properties)}
    }));
    const expectedEpoch=owner.project.state().epoch;
    const operations=[
      ...labels.map(label=>({
        commandId:'label.edit',
        targets:[{domain:'label',id:label.id}],
        payload:{domain:'label',id:label.id,value:label,create:true,labelSettings:{pinned:false}}
      })),
      {commandId:'content.edit',targets:[{domain:'generic',id:gid}],
        payload:{domain:'generic',id:gid,value:null,create:false}}
    ];
    const result=await owner.project.executeCommand({
      commandId:'document.batch',targets:[],expectedEpoch,payload:{operations}
    });
    assert.equal(result.ok,true);
    return result.changed;
  };
  const capture=() => observe(owner.documentModel.snapshot(),owner.client.state(),owner.project),actual=[capture()];
  assert.equal(await convert(),true);actual.push(capture());
  assert.equal(await owner.project.undo(),true);actual.push(capture());assert.equal(owner.project.canUndo(),false,'The whole conversion has one history boundary.');
  assert.equal(await owner.project.redo(),true);actual.push(capture());assert.deepEqual(actual,expected);
  const saved=await owner.client.exportSnapshot({ format: 'pandolab-project-state',version: seed.version,savedAt: seed.savedAt });
  assert.deepEqual(JSON.parse(saved.storageJson).labels,expected[1].labels);
  assert.deepEqual((await owner.client.validateImport(saved.storageJson)).labels,expected[1].labels);
  assert.deepEqual(owner.documentModel.snapshot().territorialEntities,seed.territorialEntities);
  assert.deepEqual(owner.documentModel.snapshot().timelineRecords,seed.timelineRecords);
  assert.deepEqual(owner.documentModel.snapshot().sourceInfo,seed.sourceInfo);
});
