import { effectiveTerritorialFlagUrl } from './country-flags.js';
import {BUILTIN_SUBUNITS} from './builtin-subunits.js';
const builtinSubunitSources=Object.freeze(Object.fromEntries(BUILTIN_SUBUNITS.map(row=>[row.id,row.sourceCountryId])));

/** ObjectCatalog: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectCatalog({ isObjectVisible } = {}) {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('layer-list already connected');
    dependencies = ports;
  }

  function invalidateObjectPresentation() {
    dependencies.projectState.state.objectPresentationRevision += 1;
  }

  function isLayerItemVisible(group, id) {
    if (group === 'hydro' && dependencies.hydroPresentation.HYDRO_LAYER_META[String(id)]) {
      return dependencies.projectState.state.physicalSettings.hydroLayers?.[String(id)] !== false;
    }
    return dependencies.projectState.state.itemVisibility?.[group]?.[String(id)] !== false;
  }

  function isCountryVisibleById(id) {
    return !!dependencies.projectState.state.layerVisibility.objects && isLayerItemVisible('objects', id);
  }


  function isObjectCatalogItemVisible(group, id) {
    if(typeof isObjectVisible!=='function')throw new TypeError('Search requires the common object visibility query.');
    return isObjectVisible(group,id);
  }

  function listObjectCatalogItems(group) {
    if (group === 'objects' || group === 'objectLabels') {
      return dependencies.territorialModel.entityRepository.list().map(feature=>{
        const id=String(feature.id),root=dependencies.territorialModel.entityRepository.root(id);
        return {id,name:dependencies.objectPresentation.territorialEntityName(feature),
          color:dependencies.colorModel.territorialEntityColor(feature),
          flagUrl:effectiveTerritorialFlagUrl(feature,{assetRevision:dependencies.layerPresentation.ASSET_REVISION}),
          searchText:dependencies.objectPresentation.territorialRootName(feature),
          meta:group==='objectLabels'&&dependencies.labelPresentation.pendingCountryLabelAnchors.has(id)?'계산 중':'',
          folderName:'객체',countryId:String(root?.id||''),parentId:String(feature.properties.parentId||''),
          selected:dependencies.projectState.state.selected?.domain==='territorial'&&dependencies.projectState.state.selected.id===id};
      });
    }
    if (group === 'distributions') {
      return dependencies.projectState.state.distributionLayers.map(layer => ({
        id: layer.id,
        name: layer.name,
        color: (0, dependencies.distributionPresentation.distributionColor)(layer),
        folderName: dependencies.layerPresentation.layerGroupNames[group],
        selected: dependencies.projectState.state.selected?.domain === 'distribution' && dependencies.projectState.state.selected.id === layer.id,
      }));
    }
    if (group === 'hydro') {
      const builtIns = Object.entries(dependencies.hydroPresentation.HYDRO_LAYER_META).map(([id, meta]) => ({
          id,
          name: meta.sourceLabel,
          searchText: `${meta.label} ${meta.sourceLabel}`,
          title: `${meta.sourceLabel} 상태 보기`,
          color: (0, dependencies.hydroPresentation.hydroDisplayColor)(meta.category),
          folderName: meta.label,
          hydroCategory: (0, dependencies.hydroPresentation.hydroCategoryKey)(meta.category),
          layerGroup: 'hydro',
          isBuiltin: true,
          selected: false,
        }));
      const userItems = dependencies.projectState.state.hydroEdits.map(feature => ({
        id: String(feature.id),
        name: (0, dependencies.hydroPresentation.hydroEditorName)(feature.properties?.name, (0, dependencies.hydroPresentation.hydroFallbackName)(feature.properties?.category)),
        color: feature.properties?.editorColor || dependencies.hydroPresentation.HYDRO_TOOL_CONFIG[feature.properties?.category || 'river'].color,
        meta: `${(0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties?.category)} · 사용자`,
        folderName: (0, dependencies.hydroPresentation.hydroCategoryLabel)(feature.properties?.category),
        hydroCategory: (0, dependencies.hydroPresentation.hydroCategoryKey)(feature.properties?.category),
        layerGroup: 'hydro',
        isBuiltin: false,
        selected: dependencies.projectState.state.selected?.domain === 'hydro' && dependencies.projectState.state.selected.id === String(feature.id),
      }));
      return [...builtIns, ...userItems];
    }
    if (group === 'genericFeatures') {
      return dependencies.projectState.state.genericFeatures.map(feature => ({
        id: String(feature.id),
        name: (0, dependencies.objectPresentation.genericFeatureName)(feature),
        color: (0, dependencies.colorModel.genericFeatureColor)(feature),
        meta: `${(0, dependencies.objectPresentation.genericFeatureRoleLabel)(feature)} · 사용자`,
        layerGroup: 'genericFeatures',
        selected: dependencies.projectState.state.selected?.domain === 'generic' && dependencies.projectState.state.selected.id === String(feature.id),
      }));
    }
    return dependencies.projectState.state.labels.map(label => ({
      id: String(label.id),
      name: label.name || '이름 없는 지명',
      icon: 'place',
      meta: label.kind || '지명',
      selected: dependencies.projectState.state.selected?.domain === 'label' && dependencies.projectState.state.selected.id === String(label.id),
    }));
  }

  function listObjectSearchItems(group) {
    return listObjectCatalogItems(group).filter(item=>isObjectCatalogItemVisible(group,item.id));
  }

  function presentationCatalog() {
    const hydroLayers=Object.fromEntries(Object.entries(dependencies.hydroPresentation.HYDRO_LAYER_META)
      .map(([id,meta]) => [id,(0,dependencies.hydroPresentation.hydroCategoryKey)(meta.category)]));
    return { hydroLayers,builtinSubunitSources,
      countryLabelIds:[...(0,dependencies.countries.builtinTerritorialScene)().labelById.keys()] };
  }

  async function pruneLayerItemVisibility({ catalogAlreadyAdmitted = false } = {}) {
    if (typeof dependencies.domains.projectDomain?.admitPresentationCatalog !== 'function')
      throw new TypeError('Layer visibility pruning requires the canonical C++ presentation catalog.');
    if (typeof dependencies.domains.selectionDomain?.prune !== 'function')
      throw new TypeError('Layer visibility pruning requires the canonical C++ selection owner.');
    if (!catalogAlreadyAdmitted) await dependencies.domains.projectDomain.admitPresentationCatalog(presentationCatalog());
    dependencies.projectSession.pruneViewingItems(presentationCatalog());
    await dependencies.domains.selectionDomain.prune(null,{ reason:'prune-invalid-selection' });
  }

  return Object.freeze({
    connect,

    get isCountryVisibleById() { return isCountryVisibleById; },
    get isLayerItemVisible() { return isLayerItemVisible; },
    get isObjectCatalogItemVisible() { return isObjectCatalogItemVisible; },
    get listObjectSearchItems(){return listObjectSearchItems;},
    get listObjectCatalogItems() { return listObjectCatalogItems; },
    get invalidateObjectPresentation() { return invalidateObjectPresentation; },
    get pruneLayerItemVisibility() { return pruneLayerItemVisibility; },
    get presentationCatalog() { return presentationCatalog; },
  });
}
