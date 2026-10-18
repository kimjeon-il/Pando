import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { captureWebMapPresentationContract } from '../helpers/web-map-presentation-contract.mjs';

test('actual production map controls match original view fields and explicit dirty requests through C++',async t => {
  const expected=captureWebMapPresentationContract();
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  seed.layerPresentation.objectStyles['territorial:entity:B']={ opacity: 0.75,colorVisible: true };
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  t.after(() => { if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document; });
  const settings=createMapSettings(),state={ get layerVisibility() { return owner.documentModel.snapshot().layerVisibility; },
    get layerPresentation() { return owner.documentModel.snapshot().layerPresentation; } };
  settings.connect({ projectState: { state },platform: { $: () => null },feedback: { reportOperationError: error => assert.fail(error.stack) },
    objectModelA: { expandedMapDisplayGroups: new Set() },preferences: { userPreferences: { labels: { place: { languages: { ko: true } } } } },
    objectDisplay: { invalidateObjectPresentation() {} },rendering: { gpuMapRenderer: { invalidateCountryPalette() {} } },
    territorialModel: { DISTRIBUTION_MODES: { TERRITORIAL: 'territorial',GEOMETRY: 'geometry' } },
    applicationConstantsA: {},platformConfigurationA: {},platformConfigurationB: {},projectServices: { createProjectSerializer: () => ({}) },
    domains: { projectDomain: owner.project,renderingDomain: { invalidateLabels() {},invalidateBaseScene() {},invalidateOverlayStyle() {} } } });
  settings.initializeLAYER_STYLE_TARGETS();
  const actions=[() => {},() => settings.setLayerVisibility('basemapLabels',false),() => settings.setLayerVisibility('basemapLabels',false),
    () => settings.setLayerVisibility('countryFlags',false),() => settings.setLayerVisibility('countries',false),
    () => owner.client.markSaved(owner.client.state().epoch),() => settings.setLayerVisibility('countries',false),
    () => settings.setLayerVisibility('countries',true),
    () => settings.updateLayerPresentationStyle('countries',{ opacity: 0.25,labelsVisible: false,boundaryWidth: 9 }),
    () => settings.updateLayerPresentationStyle('subunits',{ opacity: 0.5 })];
  for(const [index,action] of actions.entries()) {
    await action();const originalRow=expected[index],actual=owner.documentModel.snapshot(),current=owner.client.state();
    assert.deepEqual(actual.layerVisibility,originalRow.layerVisibility,originalRow.operation);
    assert.deepEqual(actual.layerPresentation,originalRow.layerPresentation,originalRow.operation);
    assert.equal(current.documentDirty,originalRow.documentDirty,originalRow.operation);
    assert.equal(current.presentationDirty,originalRow.presentationDirty,originalRow.operation);
    assert.equal(current.dirty,originalRow.hasUnsavedChanges,originalRow.operation);
    assert.equal(current.canUndo,false,'view commands have no content Undo checkpoint');
    assert.equal(current.stateRevision,0,'view commands do not advance the content writer clock');
    assert.deepEqual(actual.sourceInfo,seed.sourceInfo,'source evidence survives view commands');
    assert.deepEqual(actual.geometries,seed.geometries,'stored coordinates/order/archive survive view commands');
  }
});
