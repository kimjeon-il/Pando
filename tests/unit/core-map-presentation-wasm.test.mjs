import { resourceCapabilities } from "../../shared/frontend/js/modules/resource-capabilities.js";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMapSettings } from "../../shared/frontend/js/modules/app-map-settings.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTestViewingSession } from '../helpers/viewing-project.mjs';

test('production object controls share one Core policy and preserve object overrides',async t => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  seed.layerPresentation.objectStyles['territorial:entity:B']={ opacity: 0.75,colorVisible: true };
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  const viewing=createTestViewingSession(owner);t.after(viewing.dispose);
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  t.after(() => { if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document; });
  const settings=createMapSettings({capabilities:resourceCapabilities('editor'),viewPresentation:{applyPresentation:viewing.session.applyViewingPresentation},authoredStyles:true}),state={ get layerVisibility() { return viewing.session.state.layerVisibility; },
    get layerPresentation() { return owner.documentModel.snapshot().layerPresentation; } };
  settings.connect({ layerResources:{loadHydroData:async()=>{},preparePlaces:async()=>{}},projectState: { state },platform: { $: () => null },feedback: { reportOperationError: error => assert.fail(error.stack) },
    objectModelA: { expandedMapDisplayGroups: new Set() },preferences: { userPreferences: { labels: { place: { languages: { ko: true } } } } },
    objectDisplay: { invalidateObjectPresentation() {} },rendering: { gpuMapRenderer: { invalidateCountryPalette() {} } },
    territorialModel: { DISTRIBUTION_MODES: { TERRITORIAL: 'territorial',GEOMETRY: 'geometry' } },
    applicationConstantsA: {},platformConfigurationA: {},platformConfigurationB: {},projectServices: { createProjectSerializer: () => ({}) },
    domains: { projectDomain: { ...owner.project,queueViewAutosave() {} },renderingDomain: { invalidateLabels() {},invalidateBaseScene() {},invalidateOverlayStyle() {} } } });
  settings.initializeLAYER_STYLE_TARGETS();
  const before=owner.documentModel.snapshot();
  await settings.setLayerVisibility('objectNames',false);
  await settings.setLayerVisibility('objectFlags',false);
  await settings.setLayerVisibility('objects',false);
  assert.equal(state.layerVisibility.objects,false);assert.equal(state.layerVisibility.objectNames,false);assert.equal(state.layerVisibility.objectFlags,false);
  await settings.updateLayerPresentationStyle('objects',{opacity:.25,boundaryVisible:false});
  const actual=owner.documentModel.snapshot();
  assert.equal(actual.layerPresentation.styles.objects.opacity,.25);assert.equal(actual.layerPresentation.styles.objects.boundaryVisible,false);
  assert.equal(actual.layerPresentation.objectStyles['territorial:entity:B'].opacity,.75,'global controls must not rewrite a child override');
  for(const key of ['countries','subunits','regions'])assert.equal(Object.hasOwn(actual.layerPresentation.styles,key),false);
  assert.deepEqual(actual.geometries,before.geometries);assert.deepEqual(actual.territorialEntities,before.territorialEntities);assert.deepEqual(actual.timelineRecords,before.timelineRecords);assert.deepEqual(actual.sourceInfo,before.sourceInfo);
  assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().canUndo,false);
});
