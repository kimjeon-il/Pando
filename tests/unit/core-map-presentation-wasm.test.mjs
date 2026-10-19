import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

test('production object controls share one Core policy and preserve object overrides',async t => {
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
  const before=owner.documentModel.snapshot();
  await settings.setLayerVisibility('objectNames',false);
  await settings.setLayerVisibility('objectFlags',false);
  await settings.setLayerVisibility('objects',false);
  let actual=owner.documentModel.snapshot();
  assert.equal(actual.layerVisibility.objects,false);assert.equal(actual.layerVisibility.objectNames,false);assert.equal(actual.layerVisibility.objectFlags,false);
  await settings.updateLayerPresentationStyle('objects',{opacity:.25,boundaryVisible:false});
  actual=owner.documentModel.snapshot();
  assert.equal(actual.layerPresentation.styles.objects.opacity,.25);assert.equal(actual.layerPresentation.styles.objects.boundaryVisible,false);
  assert.equal(actual.layerPresentation.objectStyles['territorial:entity:B'].opacity,.75,'global controls must not rewrite a child override');
  for(const key of ['countries','subunits','regions'])assert.equal(Object.hasOwn(actual.layerPresentation.styles,key),false);
  assert.deepEqual(actual.geometries,before.geometries);assert.deepEqual(actual.territorialEntities,before.territorialEntities);assert.deepEqual(actual.timelineRecords,before.timelineRecords);assert.deepEqual(actual.sourceInfo,before.sourceInfo);
  assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().canUndo,false);
});
