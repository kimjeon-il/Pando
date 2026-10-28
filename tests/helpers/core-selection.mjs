import { TIMELINE_RECORD_SCHEMA_VERSION } from "../../shared/frontend/js/modules/timeline-records.js";
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from './core-project.mjs';
import { createSelectionDomain } from "../../shared/frontend/js/modules/selection-domain.js";
import { coreSelectionRefToWeb, webSelectionRefToCore } from "../../shared/frontend/js/modules/core-object-ref.js";

/** Tiny actual Worker fixture. Runtime IDs remain literal; file admission is not weakened. */
export async function createNodeSelection({ territorialIds = ['A','B','C','D','DEU','TUR','country-custom-123','shared:id'],
  genericIds = ['G','A','1'], labelIds = ['L','B','1','x'], distributionIds = ['de','1'],
  onSelectionChanged, onHoverChanged, requestRender } = {}) {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const template = seed.territorialEntities[0];
  seed.territorialEntities = territorialIds.map(id => ({ ...structuredClone(template), id }));
  const admittedPresentationKeys = new Set(territorialIds.map(id => 'territorial:entity:' + id));
  seed.layerPresentation.objectStyles = Object.fromEntries(Object.entries(seed.layerPresentation.objectStyles)
    .filter(([key]) => admittedPresentationKeys.has(key)));
  seed.layerPresentation.objectOrder = seed.layerPresentation.objectOrder.filter(key => admittedPresentationKeys.has(key));
  seed.timelineRecords = { schemaVersion: TIMELINE_RECORD_SCHEMA_VERSION,propertyBindings: [],
    lifetimes: territorialIds.map(id => ({ id: 'life:'+id,objectRef: {domain:'territorial',id},validFrom: null,validTo: null })),
    geometryBindings: territorialIds.map(id => ({ id: 'shape:'+id,objectRef: {domain:'territorial',id},validFrom: null,validTo: null,geometryRef: { id: 'shape',version: 1 } })),
    parentRelations: territorialIds.map(id => ({ id: 'parent:'+id,objectRef: {domain:'territorial',id},validFrom: null,validTo: null,parentId: '',coverageMode: 'explicit' })) };
  const label = seed.labels[0];
  Object.assign(seed, { labels: [],labelSettings: {},genericFeatures: [],hydroEdits: [],distributionLayers: [],distributionEntries: [] });
  const owner = await createNodeCoreProject(seed);
  let generation = 1;
  try {
    for (const id of genericIds) {
      const result = await owner.project.executeCommand({ commandId: 'generic.create',targets: [{ domain: 'generic',id }],
        payload: { feature: { type: 'Feature',id,geometry: { type: 'Point',coordinates: [1,2] },
          properties: { schemaVersion: 2,name: id,notes: '',color: '#8c68d8',locked: false,source: { kind: 'drawn',license: '',details: {} } } } } });
      if (!result.ok) throw new Error(result.error.message);
    }
    for (const id of labelIds) {
      const result = await owner.project.executeCommand({ commandId: 'label.edit',targets: [{ domain: 'label',id }],
        payload: { domain: 'label',id,create: true,value: { ...label,id,source: { ...label.source,details: {} } } } });
      if (!result.ok) throw new Error(result.error.message);
    }
    for (const id of distributionIds) {
      const result = await owner.project.executeCommand({ commandId: 'distribution.layer.create',targets: [{ domain: 'distributionLayer',id }],payload: { options: { id,name: id } } });
      if (!result.ok) throw new Error(result.error.message);
    }
    await owner.client.selectionCatalogLoad('placeBuiltin',[
      { domain: 'placeBuiltin',type: 'city',id: 'builtin:place:fixture:1' },
    ]);
    await owner.client.selectionCatalogLoad('hydroBuiltin',[
      {domain:'hydroBuiltin',type:'river',id:'builtin-hydro',sourceIds:[]},
      {domain:'hydroBuiltin',type:'river',id:'1',sourceIds:[]},
    ]);
    const domain = createSelectionDomain({ commandOwner: owner.client,
      projectDomain: { getGeneration: () => generation },
      refAdapter: { fromCore: coreSelectionRefToWeb,toCore: ref => webSelectionRefToCore(ref,{ isStoredHydro: id => owner.documentModel.list('hydro').some(row => row.id === id) }) },
      onSelectionChanged,onHoverChanged,requestRender });
    return { ...owner,domain,setGeneration(value) { generation = value; },
      dispose() { domain.dispose();owner.dispose(); } };
  } catch (error) { owner.dispose();throw error; }
}
