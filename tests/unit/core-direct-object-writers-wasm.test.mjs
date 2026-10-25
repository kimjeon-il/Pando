import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createObjectMetadata } from "../../apps/editor/frontend/js/modules/app-object-metadata.js";
import { createObjectDeletion } from "../../apps/editor/frontend/js/modules/app-object-deletion.js";
import { createTerritorialConversion } from "../../apps/editor/frontend/js/modules/app-territorial-conversion.js";

const seed=() => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
test('direct hydro/label property and delete UI delegates to the complete C++ document/history owner',async () => {
  const initial=seed(),owner=await createNodeCoreProject(initial),hydro=initial.hydroEdits[0],label=initial.labels[0],events=[];
  const state={ selected: { domain: 'hydro',type: 'river',id: hydro.id },get labels() { return owner.documentModel.list('label'); } };
  const ports={ projectState: { state },domains: { projectDomain: owner.project,
    selectionUiController: { presentPrimary() {} },
    renderingDomain: { invalidateHydroPatch() {},invalidateLabels() {} } },
    hydroPresentation: { hydroEditById: id => owner.documentModel.get({ domain: 'hydro',id }),hydroCategoryLabel: () => '강',
      hydroFallbackName: () => 'river',hydroEditorName: name => name },
    hydroModel: { hydroFeatureById: id => owner.documentModel.get({ domain: 'hydro',id }) },
    propertyEditingA: { applyHydroSelectionIntent: async () => {},applyLabelSelectionIntent: async () => {} },
    readinessUi: { requireCanonicalData: () => true },objectModelA: { hydroAccusativeLabel: () => '강을' },
    objectDisplay: { invalidateObjectPresentation() {} },feedback: { setActionStatus: (...args) => events.push(args) } };
  const metadata=createObjectMetadata(),deletion=createObjectDeletion(),conversion=createTerritorialConversion();
  metadata.connect(ports);deletion.connect(ports);conversion.connect(ports);
  try {
    assert.equal(await metadata.commitHydroEdit('name',hydro.properties.name),false);
    assert.equal(owner.client.state().stateRevision,0);assert.equal(owner.client.state().canUndo,false);
    assert.equal(await metadata.commitHydroEdit('name','  raw H  '),true);
    assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }).properties.name,'  raw H  ');
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().documentDirty,true);
    assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await deletion.deleteSelected(),true);assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }),null);
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await owner.project.undo(),true);
    assert.equal(owner.documentModel.get({ domain: 'hydro',id: hydro.id }).properties.name,'  raw H  ');
    state.selected={ domain: 'label',type: label.kind,id: label.id };
    assert.equal(await conversion.commitLabelEdit('name','  raw label  '),true);
    assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }).name,'  raw label  ');
    assert.equal(owner.client.state().stateRevision,1);assert.equal(owner.client.state().presentationDirty,false);
    assert.equal(await deletion.deleteSelected(),true);assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }),null);
    assert.equal(Object.hasOwn(owner.documentModel.snapshot().labelSettings,`label:${label.id}`),false);
    assert.equal(owner.client.state().stateRevision,1);assert.equal(await owner.project.undo(),true);
    assert.equal(owner.documentModel.get({ domain: 'label',id: label.id }).name,'  raw label  ');
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.list('label'),initial.labels);
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),initial);
    assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),initial);
    assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().presentationDirty,false);
    assert.ok(events.length>0);
  } finally { owner.dispose(); }
});
