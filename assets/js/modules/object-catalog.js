import { effectiveTerritorialFlagUrl } from './country-flags.js';
import {BUILTIN_SUBUNITS} from './builtin-subunits.js';
const builtinSubunitSources=Object.freeze(Object.fromEntries(BUILTIN_SUBUNITS.map(row=>[row.id,row.sourceCountryId])));

/** ObjectCatalog: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectCatalog({ isObjectAvailable } = {}) {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('layer-list already connected');
    dependencies = ports;
  }

  function normalizeLayerItemState(value) {
    const output = {};
    for (const group of dependencies.layerPresentation.LAYER_GROUP_KEYS) {
      const source = value?.[group];
      output[group] = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    }
    return output;
  }

  function normalizeLayerFolderState(value) {
    return Object.fromEntries((0, dependencies.hydroPresentation.activeLayerFolderKeys)().map(key => [key, !!value?.[key]]));
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
    return !!dependencies.projectState.state.layerVisibility.countries && isLayerItemVisible('countries', id);
  }


  function isObjectCatalogItemVisible(group, id) {
    const master = group === 'hydro'
      ? ((0, dependencies.hydroPresentation.hydroCategoryKey)(dependencies.hydroPresentation.HYDRO_LAYER_META[id]?.category || (0, dependencies.hydroPresentation.hydroEditById)(id)?.properties?.category) === 'lake' ? 'lakes' : 'rivers')
      : group;
    return dependencies.projectState.state.layerVisibility[master] !== false && isLayerItemVisible(group, id);
  }

  function listObjectCatalogItems(group) {
    if (group === 'countries' || group === 'countryLabels') {
      return dependencies.territorialModel.entityRepository
        .list({ kind: 'general', parentId: '' })
        .map(feature => {
        const id = String(feature.id || '');
        return {
          id,
          name: (0, dependencies.objectPresentation.territorialEntityName)(feature),
          color: (0, dependencies.colorModel.territorialEntityColor)(feature),
          flagUrl: effectiveTerritorialFlagUrl(feature, { assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
          searchText: id,
          meta: group === 'countryLabels' && dependencies.labelPresentation.pendingCountryLabelAnchors.has(id) ? '계산 중' : '',
          selected: (dependencies.projectState.state.selected?.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)) && dependencies.projectState.state.selected.id === id,
        };
      });
    }
    if (group === 'subunits' || group === 'regions') {
      const kind = group === 'subunits'
        ? 'subunit'
        : 'region';
      return dependencies.territorialModel.entityRepository.list({ kind: kind === 'region' ? 'regional' : 'general' }).filter(feature => kind === 'region' || !!feature.properties.parentId).map(feature => {
        const countryLabel = (0, dependencies.objectPresentation.territorialRootName)(feature);

        return {
          id: String(feature.id),
          name: (0, dependencies.objectPresentation.territorialEntityName)(feature),
          color: (0, dependencies.colorModel.territorialEntityColor)(feature),
          flagUrl: effectiveTerritorialFlagUrl(feature, { assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
          meta: '',
          searchText: countryLabel,
          folderName: kind === 'subunit'
            ? `하위단위 · ${countryLabel}`
            : kind === 'region'
            ? `지방${dependencies.territorialModel.entityRepository.root(feature.id)?.id ? ` · ${countryLabel}` : ''}`
            : `하위단위 · ${countryLabel}`,
          countryId: String(dependencies.territorialModel.entityRepository.root(feature.id)?.id || ''),
          parentId: String(feature.properties?.parentId || ''),

          selected: (dependencies.projectState.state.selected?.domain === 'territorial' && !(dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)) && dependencies.projectState.state.selected.id === String(feature.id),
        };
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
    if(typeof isObjectAvailable!=='function')throw new TypeError('Search requires the current-month object availability query.');
    return listObjectCatalogItems(group).filter(item=>isObjectCatalogItemVisible(group,item.id)&&isObjectAvailable(group,item.id));
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
    get normalizeLayerFolderState() { return normalizeLayerFolderState; },
    get normalizeLayerItemState() { return normalizeLayerItemState; },
    get pruneLayerItemVisibility() { return pruneLayerItemVisibility; },
    get presentationCatalog() { return presentationCatalog; },
  });
}
