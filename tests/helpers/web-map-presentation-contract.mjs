import { readFileSync } from 'node:fs';
import { loadWebOracle } from './web-oracle.mjs';
const { createMapSettings }=await loadWebOracle('assets/js/modules/app-map-settings.js');
const { createSaveStateController }=await loadWebOracle('assets/js/modules/save-state-controller.js');
const { normalizeLayerPresentation,layerStyle }=await loadWebOracle('assets/js/modules/layer-presentation.js');

/** Original map controls + original dirty owner; only DOM/layout ports are inert. */
export function captureWebMapPresentationContract() {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  seed.layerPresentation.objectStyles['territorial:entity:B']={ opacity: 0.75,colorVisible: true };
  const state={ ...structuredClone(seed),projection: 'flat' },save=createSaveStateController();
  save.markOpenedFile('initial');
  const settings=createMapSettings(),rows=[],events=[];
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  settings.connect({ projectState: { state },platform: { $: () => null },
    objectModelA: { expandedMapDisplayGroups: new Set() },preferences: { userPreferences: { labels: { place: { languages: { ko: true } } } } },
    layers: { markLayerTreeDirty() {} },rendering: { gpuMapRenderer: { invalidateCountryPalette() {},invalidateHydroVisibility() {},invalidatePhysicalStyle() {} } },
    territorialModel: { DISTRIBUTION_MODES: { TERRITORIAL: 'territorial',GEOMETRY: 'geometry' },entityRepository: { get: id => ({ properties: { parentId: id==='B'?'A':'' } }) } },
    applicationServicesB: { layerStyle },modelValidation: { normalizeLayerPresentation },
    applicationConstantsA: {},platformConfigurationA: {},platformConfigurationB: {},
    projectServices: { createProjectSerializer: () => ({}) },distributionPresentation: { bumpVisibilityRevision() {} },
    domains: { renderingDomain: { invalidateLabels: reason => events.push(reason),invalidateBaseScene: reason => events.push(reason),invalidateOverlayStyle: reason => events.push(reason) },
      projectDomain: { queuePresentationAutosave() { save.markPresentationChanged(); } } } });
  try {
    settings.initializeLAYER_STYLE_TARGETS();
    const capture=(operation,action) => { action();rows.push({ operation,layerVisibility: structuredClone(state.layerVisibility),
      layerPresentation: structuredClone(state.layerPresentation),documentDirty: save.snapshot().documentDirty,
      presentationDirty: save.snapshot().presentationDirty,hasUnsavedChanges: save.snapshot().hasUnsavedChanges,
      currentPresentationToken: save.snapshot().currentPresentationToken,events: [...events] });events.length=0; };
    capture('initial',() => {});
    capture('country names hidden independently',() => settings.setLayerVisibility('basemapLabels',false));
    capture('repeating visibility retains explicit dirty notification',() => settings.setLayerVisibility('basemapLabels',false));
    capture('flags hidden independently',() => settings.setLayerVisibility('countryFlags',false));
    capture('master hidden without discarding symbols',() => settings.setLayerVisibility('countries',false));
    capture('explicit file save',() => save.markFileSaved());
    capture('repeating hidden master after save still marks view dirty',() => settings.setLayerVisibility('countries',false));
    capture('master restored',() => settings.setLayerVisibility('countries',true));
    capture('country opacity normalized without changing label setting',() => settings.updateLayerPresentationStyle('countries',{ opacity: 0.25,labelsVisible: false,boundaryWidth: 9 }));
    capture('subunit style applies existing object overrides',() => settings.updateLayerPresentationStyle('subunits',{ opacity: 0.5 }));
    return rows;
  } finally { if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document; }
}
