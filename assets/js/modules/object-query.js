import {isBuiltinPlaceId} from './place-contract.js';
import { temporalContains,temporalMonthEnd } from './temporal.js';
import { effectiveTerritorialFlagUrl } from './country-flags.js';
import { placeLabelRowsAtMonth } from './place-name-display.js';
export function createObjectQuery(dependencies) {
  function territorialEntityForRef(ref) {
    if (ref?.domain !== 'territorial') return null;
    const entity = dependencies.territorialModel.entityRepository.get(ref.id);
    return entity && ref.type === 'entity' ? entity : null;
  }

  function layerItemObjectRef(group, id) {
    const key = String(id);
    if (group === 'objects' || group === 'objectLabels') return dependencies.selectionServices.normalizeObjectRef({domain:'territorial',type:'entity',id:key});
    if (group === 'distributions') return (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'distribution', type: 'distribution', id: key });
    if (group === 'hydro' && (0, dependencies.hydroPresentation.hydroEditById)(key)) return (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'hydro', type: (0, dependencies.hydroPresentation.hydroEditById)(key)?.properties?.category || 'river', id: key });
    if (group === 'genericFeatures') return (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'generic', type: 'feature', id: key });
    if (group === 'labels') return (0, dependencies.selectionServices.normalizeObjectRef)({ domain: 'label', type: dependencies.labelPresentation.labelById(key)?.kind || 'label', id: key });
    return null;
  }

  function objectForRef(value) {
    const ref=dependencies.selectionServices.normalizeObjectRef(value);
    if(!ref)return null;
    if(ref.domain==='territorial')return territorialEntityForRef(ref);
    if(ref.domain==='distribution')return dependencies.objectLookup.distributionLayerById(ref.id);
    if(ref.domain==='generic')return dependencies.projectState.state.genericFeatures.find(item=>String(item.id)===ref.id)||null;
    if(ref.domain==='hydro')return dependencies.hydroModel.hydroFeatureById(ref.id);
    return dependencies.labelPresentation.labelById(ref.id);
  }

  function objectRefExists(value) { return !!objectForRef(value); }

  function objectRefVisible(value) {
    const ref = dependencies.selectionServices.normalizeObjectRef(value);
    if(!ref||!isObjectAvailable(ref))return false;
    const state=dependencies.projectState.state;
    const group=layerGroupForObjectRef(ref);
    const master=ref.domain==='hydro'?(ref.type==='lake'?'lakes':'rivers'):group;
    if(!group||state.layerVisibility[master]===false)return false;
    if(ref.domain==='label'&&isBuiltinPlaceId(ref.id)&&state.resourceCapabilities?.builtinPlaces===false)return false;
    if(ref.domain==='hydro'&&!dependencies.hydroPresentation.hydroEditById(ref.id)) {
      const feature=dependencies.hydroModel.hydroFeatureById(ref.id);
      const id=String(feature?.properties?.pandolab_id||feature?.id||ref.id);
      return state.resourceCapabilities?.builtinHydro!==false&&state.itemVisibility.hydro?.[id]!==false
        && state.physicalSettings?.hydroLayers?.[feature?.properties?.layer_id]!==false;
    }
    return dependencies.layerPresentation.isLayerItemVisible(group,ref.id);
  }

  function isObjectAvailable(value) {
    const ref=dependencies.selectionServices.normalizeObjectRef(value);
    const object=objectForRef(value);
    if(ref?.domain==='label'&&isBuiltinPlaceId(ref.id)&&object&&!placeLabelRowsAtMonth(object,dependencies.projectState.state.timelineCursor).length)return false;
    return !!object && temporalContains(object.properties||object,temporalMonthEnd(dependencies.projectState.state.timelineCursor));
  }

  const visibleTerritorialCount = () => dependencies.territorialModel.entityRepository.list()
    .filter(entity=>objectRefVisible({domain:'territorial',type:'entity',id:String(entity.id)})).length;

  function objectDisplayInfo(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return { name: '알 수 없는 객체', type: '' };
    if (ref.domain === 'territorial') {
      const feature = territorialEntityForRef(ref);
      const parent = dependencies.territorialModel.entityRepository.parent(ref.id);
      return { name: feature ? dependencies.objectPresentation.territorialEntityName(feature) : ref.id,
        type: '객체', detail: parent ? dependencies.objectPresentation.territorialEntityName(parent) : '',
        flagUrl: effectiveTerritorialFlagUrl(feature, { assetRevision: dependencies.layerPresentation.ASSET_REVISION }) };
    }
    if (ref.domain === 'distribution') {
      const layer = (0, dependencies.objectLookup.distributionLayerById)(ref.id);
      return { name: layer?.name || ref.id, type: '분포', detail: `${(0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, ref.id).length}개 영역` };
    }
    if (ref.domain === 'generic') {
      const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === ref.id);
      return { name: feature ? (0, dependencies.objectPresentation.genericFeatureName)(feature) : ref.id, type: feature ? (0, dependencies.objectPresentation.genericFeatureRoleLabel)(feature) : '기타 객체', detail: '' };
    }
    if (ref.domain === 'hydro') {
      const feature = (0, dependencies.hydroModel.hydroFeatureById)(ref.id);
      const category = (0, dependencies.hydroPresentation.hydroCategoryKey)(feature?.properties?.category || ref.type);
      return { name: (0, dependencies.hydroPresentation.hydroEditorName)(feature?.properties?.name, (0, dependencies.hydroPresentation.hydroFallbackName)(category)), type: (0, dependencies.hydroPresentation.hydroCategoryLabel)(category), detail: '' };
    }
    const label = dependencies.labelPresentation.labelById(ref.id);
    const labelKind = { capital: '수도', city: '도시', town: '마을', region: '지역명', mountain: '산', water: '수역', custom: '기타' };
    const name = label && isBuiltinPlaceId(ref.id)
      ? placeLabelRowsAtMonth(label, dependencies.projectState.state.timelineCursor, dependencies.preferences.userPreferences.labels.place.languages)[0]?.text
      : label?.name;
    return { name: name || ref.id, type: '지명', detail: labelKind[label?.kind] || '지명' };
  }

  function focusObjectRef(value, { announce = true } = {}) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return false;
    let feature = null;
    if (ref.domain === 'territorial') feature = territorialEntityForRef(ref);
    else if (ref.domain === 'generic') feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === ref.id);
    else if (ref.domain === 'hydro') feature = (0, dependencies.hydroModel.hydroFeatureById)(ref.id);
    else if (ref.domain === 'distribution') {
      const features = (0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL ? dependencies.territorialModel.entityRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? { type: 'Feature', properties: {}, geometry } : null;
      }).filter(Boolean);
      if (features.length) feature = { type: 'FeatureCollection', features };
    } else if (ref.domain === 'label') {
      const label = dependencies.labelPresentation.labelById(ref.id);
      if (label) {
        (0, dependencies.navigation.focusCoordinate)(label.coordinates);
        if (announce) (0, dependencies.feedback.setActionStatus)('선택 객체로 이동했습니다.', 'success', 2200);
        return true;
      }
    }
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return false;
    const countryScope = ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId)
      ? dependencies.objectModelB.territorialScope.scope(ref.id) : null;
    const runtimeAnchor = ref.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(ref?.id)?.properties.parentId)
      ? dependencies.labelPresentation.countryLabelAnchors.get(String(ref.id))
      : null;
    const preferredAnchor = (0, dependencies.countries.validLabelAnchor)(runtimeAnchor)
      ? runtimeAnchor
      : null;
    if (countryScope?.members.length) feature = countryScope.extent;
    (0, dependencies.navigation.fitMapToFeature)(feature, { maxZoom: (0, dependencies.surfaces.isMobile)() ? 12 : 10, preferredAnchor });
    if (announce) (0, dependencies.feedback.setActionStatus)('선택 객체로 이동했습니다.', 'success', 2200);
    return true;
  }

  function layerGroupForObjectRef(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return '';
    if (ref.domain === 'territorial') return 'objects';
    if (ref.domain === 'distribution') return 'distributions';
    if (ref.domain === 'hydro') return 'hydro';
    if (ref.domain === 'generic') return 'genericFeatures';
    if (ref.domain === 'label') return 'labels';
    return '';
  }

  return Object.freeze({layerGroupForObjectRef,objectForRef,isObjectAvailable,visibleTerritorialCount,territorialEntityForRef,layerItemObjectRef,objectRefExists,objectRefVisible,objectDisplayInfo,focusObjectRef});
}
