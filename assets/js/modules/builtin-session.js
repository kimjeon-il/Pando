import { normalizeCountryCollection } from './country-feature.js';
import { geometryRevision } from './geometry-versions.js';
import { territorialSceneDisplayId } from './builtin-subunits.js';
import { territorialRootId } from './territorial-units.js';
import { createHistoricalWorldLoader } from './historical-world-loader.js';
/** BuiltinSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createBuiltinSession({ historicalWorldLoader = null } = {}) {
  let dependencies;
  let pristineCountriesFallback;
  let canonicalCountryStore;
  let builtinCountryIds;
  let PRISTINE_LABEL_ANCHORS;
  let builtinRenderCache;
  let builtinGeometryCache;
  let builtinGeometryStore;
  let baseSceneFeatureById;
  let territorialLabelFeatureById;
  let builtinPaletteKey;
  let builtinPaletteVisibility;
  let projectBaseline = null;
  let projectBaselinePending = null;
  function connect(ports) {
    if (dependencies) throw new Error('builtin-session already connected');
    dependencies = ports;
  }

  function installCanonicalCountryStore(store) {
    if (!store || typeof store.materializeCollectionSync !== 'function'
        || typeof store.materializeFeature !== 'function' || typeof store.geometryEquals !== 'function') {
      throw new Error('무손실 국가 packet store가 올바르지 않습니다.');
    }
    if (canonicalCountryStore === store) return;
    canonicalCountryStore = store;
    builtinCountryIds = new Set(store.ids());
    pristineCountriesFallback = null;
  }

  async function prepareProjectBaseline() {
    if (projectBaseline) return projectBaseline;
    if (projectBaselinePending) return projectBaselinePending;
    projectBaselinePending = (async () => {
      if (!historicalWorldLoader) {
        const meta = window.PANDOLAB_BUILD_META;
        historicalWorldLoader = createHistoricalWorldLoader({ manifestUrl: meta?.historicalWorld?.url,
          manifestSpec: meta?.historicalWorld, dataRevision: meta?.dataRevision });
      }
      const domain=dependencies.domains.projectDomain,expectedGeneration=domain.getGeneration();
      const facts=({sourceBytes,manifest})=>({kind:'stored-asset',sourceBytes,encoding:manifest.project.encoding,
        compressedBytes:manifest.project.compressedBytes,decodedBytes:manifest.project.decodedBytes,sourceMonth:manifest.sourceMonth,
        baseDataset:dependencies.platformConfigurationA.BASE_DATASET,fingerprint:manifest.project.sha256});
      const {sourceBytes,manifest,admission}=await historicalWorldLoader.loadSource(async source=>{
        try {const accepted=await domain.admitStorageBaseline(facts(source),{expectedGeneration});return {baselineId:accepted.storageBaselineId};}
        catch(error){if(error.code==='PL-CORE-STALE'||error.code==='STALE_REVISION'){error.name='AbortError';error.cancelled=true;}throw error;}
      });
      if(!(sourceBytes instanceof Uint8Array)||!Number.isSafeInteger(admission?.baselineId)||admission.baselineId<=0)
        throw new TypeError('The verified stored source and admitted Core baseline handle are required.');
      if(domain.getGeneration()!==expectedGeneration)throw Object.assign(new Error('Historical source admission crossed a project replacement.'),{code:'PL-CORE-STALE',name:'AbortError',cancelled:true});
      projectBaseline=Object.freeze({...facts({sourceBytes,manifest}),baselineId:admission.baselineId});
      return projectBaseline;
    })();
    try { return await projectBaselinePending; }
    finally { projectBaselinePending = null; }
  }

  function materializePristineCountriesSync() {
    return normalizeCountryCollection(canonicalCountryStore?.materializeCollectionSync?.()
      || pristineCountriesFallback || { type: 'FeatureCollection', features: [] });
  }

  async function materializePristineCountries() {
    if (!canonicalCountryStore?.materializeCollection) return materializePristineCountriesSync();
    const result = await canonicalCountryStore.materializeCollection({
      budgetMs: 4,
      coordinateBudget: 4096,
      waitForQuiet: async () => {},
      yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
    });
    return normalizeCountryCollection(result.collection);
  }

  function freshPristineCountries() {
    const countries = (0, dependencies.geometryMutation.reindexCountries)(materializePristineCountriesSync());
    (0, dependencies.countryRecords.applyPristineLabelAnchors)(countries);
    return countries;
  }

  function builtinTerritorialScene({ canonical = false } = {}) {
    if (builtinGeometryStore !== canonicalCountryStore) {
      builtinGeometryStore = canonicalCountryStore;
      builtinGeometryCache = new WeakMap();
      builtinRenderCache = null;
    }
    const entities = canonical ? dependencies.territorialModel.entityRepository.list()
      : dependencies.objectModelB.territorialScope.displayEntities();
    const nativeGeometryRevision = entities.reduce((revision, entity) => revision + geometryRevision(
      entity.properties.entityKind === 'general' && entity.properties.parentId
        ? dependencies.territorialModel.entityRepository.get(entity.id).geometry : entity.geometry), 0);
    if (builtinRenderCache?.entities === entities && builtinRenderCache.nativeGeometryRevision === nativeGeometryRevision
      && builtinRenderCache.presentation === dependencies.projectState.state.layerPresentation) return builtinRenderCache;
    const features = entities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId);
    const boundaryFeatures = [...features];
    const byId = new Map(features.map(feature => [String(feature.id), feature]));
    const countryIds = new Set(byId.keys());
    const labelById = new Map(byId);
    const labelRefs = new Map(features.map(feature => [String(feature.id), { domain: 'territorial', type: 'entity', id: String(feature.id) }]));
    const units = new Map();
    for (const unit of entities.filter(entity => entity.properties.entityKind === 'regional' || !!entity.properties.parentId)) {
      const sourceId = (0, dependencies.objectDefinitions.builtinSubunitSourceId)(unit);
      const id = territorialSceneDisplayId(unit, countryIds);
      const feature = { type: 'Feature', id, properties: unit.properties, geometry: unit.geometry,
        boundaryRootId: territorialRootId(unit, entityId => dependencies.territorialModel.entityRepository.get(entityId)) };
      labelById.set(id, feature);
      labelRefs.set(id, { domain: 'territorial', type: 'entity', id: unit.id });
      if (unit.properties.entityKind === 'general') boundaryFeatures.push(feature);
      if (!sourceId || byId.has(sourceId)) continue;
      const style = (0, dependencies.applicationServicesB.layerStyle)(dependencies.projectState.state.layerPresentation, 'objects', `territorial:entity:${unit.id}`);
      const canonicalGeometry = dependencies.territorialModel.entityRepository.get(unit.id).geometry;
      const revision = geometryRevision(canonicalGeometry);
      let cached = builtinGeometryCache.get(canonicalGeometry);
      if (!cached || cached.revision !== revision) {
        const unchanged = canonicalCountryStore ? canonicalCountryStore.geometryEquals(sourceId, canonicalGeometry)
          : JSON.stringify(canonicalGeometry) === JSON.stringify(pristineCountriesFallback?.features.find(feature => feature.id === id)?.geometry);
        cached = { revision, unchanged };
        builtinGeometryCache.set(canonicalGeometry, cached);
      }
      feature.boundaryPristine = cached.unchanged;
      if (style.opacity !== 1 || style.blendMode !== 'normal') continue;
      if (!cached.unchanged) continue;
      features.push(feature); byId.set(id, feature); units.set(id, unit);
    }
    const order = new Map((canonicalCountryStore?.ids() || pristineCountriesFallback?.features.map(feature => feature.id) || []).map((id, index) => [id, index]));
    features.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    builtinRenderCache = { entities, nativeGeometryRevision, presentation: dependencies.projectState.state.layerPresentation,
      collection: { type: 'FeatureCollection', features }, boundaryCollection: { type: 'FeatureCollection', features: boundaryFeatures },
      byId, labelById, labelRefs, nativeUnits: units };
    return builtinRenderCache;
  }

  function syncBuiltinPalette() {
    const cache = builtinTerritorialScene();
    const visibility = JSON.stringify([dependencies.projectState.state.layerVisibility.objects, dependencies.projectState.state.itemVisibility.objects]);
    if (builtinPaletteKey === cache && builtinPaletteVisibility === visibility) return;
    builtinPaletteKey = cache;
    builtinPaletteVisibility = visibility;
    dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true }, 'builtin-subunit-presentation');
    dependencies.rendering.gpuMapRenderer.syncCountryBoundaryScene();
  }

  function isNativeBuiltinSubunit(unit) {
    const sourceId = (0, dependencies.objectDefinitions.builtinSubunitSourceId)(unit);
    return !!sourceId && builtinTerritorialScene().nativeUnits.get(sourceId)?.id === unit.id;
  }

  function isRenderCountryVisible(id) {
    const unit = builtinTerritorialScene().nativeUnits.get(String(id));
    return unit ? dependencies.projectState.state.layerVisibility.objects !== false && (0, dependencies.layerPresentation.isLayerItemVisible)('objects', unit.id)
      : !!dependencies.territorialModel.entityRepository.get(id) && (0, dependencies.layerPresentation.isCountryVisibleById)(id);
  }

  function renderCountryBoundaryStyle(id) {
    const scene = builtinTerritorialScene();
    const feature = scene.labelById.get(String(id));
    if (!feature) return null;
    const entityId = scene.labelRefs.get(String(id)).id;
    const group = 'objects';
    if (dependencies.projectState.state.layerVisibility[group] === false
      || !dependencies.layerPresentation.isLayerItemVisible(group, entityId)) return null;
    const style = dependencies.applicationServicesB.layerStyle(dependencies.projectState.state.layerPresentation,
      group, `territorial:entity:${entityId}`);
    return style.boundaryVisible && style.opacity > 0 ? style : null;
  }

  function initializePristineCountriesFallback() {
    (pristineCountriesFallback = window.PANDOLAB_COUNTRIES || { type: 'FeatureCollection', features: [] });

    (canonicalCountryStore = null);

    (builtinCountryIds = new Set(pristineCountriesFallback.features.map(feature => String(feature.id))));

    (PRISTINE_LABEL_ANCHORS = window.PANDOLAB_LABEL_ANCHORS || {});

    (builtinRenderCache = null);

    (builtinGeometryCache = new WeakMap());

    (builtinGeometryStore = null);

    (baseSceneFeatureById = id => builtinTerritorialScene({ canonical: true }).byId.get(String(id)) || null);

    (territorialLabelFeatureById = id => builtinTerritorialScene().labelById.get(String(id)) || null);

    (builtinPaletteKey = null);

    (builtinPaletteVisibility = '');
  }

  return Object.freeze({
    connect,
    initializePristineCountriesFallback,
    get PRISTINE_LABEL_ANCHORS() { return PRISTINE_LABEL_ANCHORS; },
    get builtinCountryIds() { return builtinCountryIds; },
    get builtinTerritorialScene() { return builtinTerritorialScene; },
    get canonicalCountryStore() { return canonicalCountryStore; },
    get territorialLabelFeatureById() { return territorialLabelFeatureById; },
    get freshPristineCountries() { return freshPristineCountries; },
    get installCanonicalCountryStore() { return installCanonicalCountryStore; },
    get isNativeBuiltinSubunit() { return isNativeBuiltinSubunit; },
    get isRenderCountryVisible() { return isRenderCountryVisible; },
    get renderCountryBoundaryStyle() { return renderCountryBoundaryStyle; },
    get materializePristineCountries() { return materializePristineCountries; },
    get materializePristineCountriesSync() { return materializePristineCountriesSync; },
    get prepareProjectBaseline() { return prepareProjectBaseline; },
    get projectBaseline() { return projectBaseline; },
    get pristineCountriesFallback() { return pristineCountriesFallback; },
    get baseSceneFeatureById() { return baseSceneFeatureById; },
    get syncBuiltinPalette() { return syncBuiltinPalette; },
  });
}
