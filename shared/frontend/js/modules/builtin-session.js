import { normalizeCountryCollection } from './country-feature.js';
import { geometryRevision } from './geometry-versions.js';
import { territorialSceneDisplayId } from './builtin-subunits.js';
import { territorialRootId } from './territorial-units.js';
import {createBuiltinWorldLoader} from './builtin-world-loader.js';
import {deviceCurrentMonth} from './builtin-month-clock.js';
/** BuiltinSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createBuiltinSession({ builtinWorldLoader = null,buildMeta,sourceCacheLimits=null } = {}) {
  const maxEntries=sourceCacheLimits?.maxEntries ?? 3;
  const maxBytes=sourceCacheLimits?.maxBytes ?? (24 * 1024 * 1024);
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>3
    ||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)
    throw new RangeError('Prepared source cache limits exceed bounded session budget.');
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
  let projectBaseline = null,projectBaselineGeneration=null;
  const injectedWorldLoader=builtinWorldLoader!==null;
  // Only verified, immutable source bytes can be retained: never a Core handle,
  // active document, world object graph, or mutable candidate.
  const sourceCache=new Map();
  let cacheBytes=0,cacheEpoch=0,cacheIdentity=null,disposed=false;
  let cacheHits=0,cacheMisses=0,cacheEvictions=0,cacheOversize=0;
  let backgroundSkipped=0,protectedSkipped=0,presentedSourceMonth=null;
  const pendingSourceMonths=new Map();
  const protectPendingSource=month=>{
    pendingSourceMonths.set(month,(pendingSourceMonths.get(month)||0)+1);
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      const count=pendingSourceMonths.get(month)||0;
      if(count<=1)pendingSourceMonths.delete(month);
      else pendingSourceMonths.set(month,count-1);
    };
  };
  const isProtectedSource=month=>month===presentedSourceMonth||pendingSourceMonths.has(month);
  function setPresentedSourceMonth(month=null){
    if(disposed)return false;
    if(month!==null&&(typeof month!=='string'||!month))
      throw new TypeError('A committed source month or null is required.');
    presentedSourceMonth=month;
    if(month!==null&&sourceCache.has(month)){
      const record=sourceCache.get(month);
      record.background=false;
      sourceCache.delete(month);sourceCache.set(month,record);
    }
    return true;
  }
  const staleBuiltin=()=>Object.assign(new Error('Builtin source request was superseded'),
    {name:'AbortError',cancelled:true,code:'PL-CORE-STALE'});
  const preparedSources=new WeakSet();
  const candidateIdentities=new WeakMap();
  function clearPreparedSourceCache(){
    sourceCache.clear();cacheBytes=0;cacheEpoch++;
  }
  function sourceCacheStats(){
    return Object.freeze({entries:sourceCache.size,bytes:cacheBytes,maxEntries,maxBytes,
      hits:cacheHits,misses:cacheMisses,evictions:cacheEvictions,oversized:cacheOversize,
      backgroundEntries:[...sourceCache.values()].filter(record=>record.background).length,
      protectedEntries:[...sourceCache.keys()].filter(isProtectedSource).length,
      backgroundSkipped,protectedSkipped});
  }
  function currentSourceIdentity(){
    const meta=buildMeta;
    if(!meta?.dataRevision || !/^[a-f0-9]{64}$/.test(meta?.builtinWorld?.sha256||''))return null;
    return JSON.stringify([meta.dataRevision,meta.builtinWorld.sha256,
      dependencies.platformConfigurationA.BASE_DATASET]);
  }
  function refreshSourceIdentity(){
    if(disposed)throw staleBuiltin();
    const identity=currentSourceIdentity();
    if(cacheIdentity!==identity){
      clearPreparedSourceCache();cacheIdentity=identity;
      // The old displayed source cannot pin data from a different revision.
      presentedSourceMonth=null;
      projectBaseline=null;projectBaselineGeneration=null;
      if(!injectedWorldLoader)builtinWorldLoader=null; // Rebind after a data revision.
    }
    return identity;
  }
  function cachedBytesFor(month,identity,{background=false}={}){
    if(!identity){cacheMisses++;return null;}
    const record=sourceCache.get(month);
    if(!record){cacheMisses++;return null;}
    // Speculative hits must not outrank a real visit. Real visits promote a
    // prior background entry and keep ordinary LRU semantics.
    if(!background){
      record.background=false;
      sourceCache.delete(month);sourceCache.set(month,record);
    }
    cacheHits++;return record;
  }
  function rememberSource(month,identity,record,epoch,{background=false}={}){
    if(!identity||epoch!==cacheEpoch||disposed)return false;
    const size=record.bytes.byteLength;
    if(size>maxBytes){cacheOversize++;return false;}
    const prior=sourceCache.get(month);
    let bytes=cacheBytes-(prior?.bytes.byteLength||0)+size;
    let entries=sourceCache.size-(prior?1:0)+1;
    // Prefer evicting speculative entries first; a speculative write may not
    // replace a real user's recent visit. The visible month and outstanding
    // Core candidates cannot be evicted by either kind of write.
    const victims=[...sourceCache.entries()]
      .filter(([key,entry])=>key!==month&&!isProtectedSource(key)
        &&(!background||entry.background))
      .sort((left,right)=>Number(right[1].background)-Number(left[1].background));
    const evict=[];
    for(const [key,candidate] of victims){
      if(entries<=maxEntries&&bytes<=maxBytes)break;
      evict.push(key);entries--;bytes-=candidate.bytes.byteLength;
    }
    if(entries>maxEntries||bytes>maxBytes){
      if(background)backgroundSkipped++;else protectedSkipped++;
      return false;
    }
    if(prior){sourceCache.delete(month);cacheBytes-=prior.bytes.byteLength;}
    for(const key of evict){
      const old=sourceCache.get(key);
      sourceCache.delete(key);cacheBytes-=old.bytes.byteLength;cacheEvictions++;
    }
    sourceCache.set(month,{...record,background:background&&prior?.background!==false});
    cacheBytes+=size;
    return true;
  }
  function dispose(){
    if(disposed)return;
    disposed=true;clearPreparedSourceCache();
    presentedSourceMonth=null;pendingSourceMonths.clear();
    projectBaseline=null;projectBaselineGeneration=null;
  }
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

  async function prepareProjectSource(month=deviceCurrentMonth(),{isCurrent=()=>true,background=false,waitForIdle=null}={}) {
    if(background&&typeof waitForIdle!=='function')
      throw new TypeError('Background source preparation requires idle yield.');
    const domain=dependencies.domains.projectDomain,expectedGeneration=domain.getGeneration();
    if(disposed||!isCurrent())throw staleBuiltin();
    const identity=refreshSourceIdentity(),epoch=cacheEpoch;
    let record=cachedBytesFor(month,identity,{background});
    if(!record){
      if(!builtinWorldLoader){
        const meta=buildMeta,spec=meta.builtinWorld;
        builtinWorldLoader=createBuiltinWorldLoader({manifestUrl:new URL(spec.url,new URL('../../../',import.meta.url)).href,
          manifestSpec:spec,dataRevision:meta.dataRevision});
      }
      const {project}=await builtinWorldLoader.loadProject(month,{isCurrent,
        concurrency:background?1:6,waitForIdle:background?waitForIdle:null});
      if(background)await waitForIdle();
      if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
        ||currentSourceIdentity()!==identity)throw staleBuiltin();
      const bytes=new TextEncoder().encode(JSON.stringify(project));
      if(background)await waitForIdle();
      if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
        ||currentSourceIdentity()!==identity)throw staleBuiltin();
      const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
        .map(value=>value.toString(16).padStart(2,'0')).join('');
      if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
        ||currentSourceIdentity()!==identity)throw staleBuiltin();
      record={bytes,fingerprint};
      rememberSource(month,identity,record,epoch,{background});
    }
    if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
      ||currentSourceIdentity()!==identity)throw staleBuiltin();
    // A hit always returns a fresh Core-generation-scoped candidate. Its bytes
    // are copied on every external access; cache entries are not exposed.
    const prepared=Object.freeze({kind:'stored-asset',encoding:'identity',
      compressedBytes:record.bytes.byteLength,decodedBytes:record.bytes.byteLength,
      sourceMonth:month,baseDataset:dependencies.platformConfigurationA.BASE_DATASET,
      fingerprint:record.fingerprint,expectedGeneration,
      get sourceBytes(){return record.bytes.slice();}});
    candidateIdentities.set(prepared,identity);
    preparedSources.add(prepared);
    return prepared;
  }

  async function admitPreparedProjectSource(prepared,{isCurrent=()=>true}={}) {
    if(!preparedSources.has(prepared))throw new TypeError('A prepared builtin source candidate from this session is required.');
    const releasePending=protectPendingSource(prepared.sourceMonth);
    try {
    const domain=dependencies.domains.projectDomain,expectedGeneration=prepared.expectedGeneration;
    if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
      ||candidateIdentities.get(prepared)!==refreshSourceIdentity())throw staleBuiltin();
    if(projectBaseline?.queryKey===prepared.sourceMonth
      && projectBaselineGeneration===expectedGeneration
      && domain.state().storageBaselineId===projectBaseline.baselineId)return projectBaseline;
    const facts={kind:prepared.kind,sourceBytes:prepared.sourceBytes,encoding:prepared.encoding,
      compressedBytes:prepared.compressedBytes,decodedBytes:prepared.decodedBytes,
      sourceMonth:prepared.sourceMonth,baseDataset:prepared.baseDataset,fingerprint:prepared.fingerprint};
    const accepted=await domain.admitStorageBaseline(facts,{expectedGeneration});
    if(disposed||!isCurrent()||domain.getGeneration()!==expectedGeneration
      ||candidateIdentities.get(prepared)!==refreshSourceIdentity())throw staleBuiltin();
    if(!Number.isSafeInteger(accepted.storageBaselineId)||accepted.storageBaselineId<=0)
      throw new Error('Core rejected the assembled builtin source');
    projectBaselineGeneration=expectedGeneration;
    projectBaseline=Object.freeze({kind:facts.kind,encoding:facts.encoding,
      compressedBytes:facts.compressedBytes,decodedBytes:facts.decodedBytes,
      sourceMonth:facts.sourceMonth,baseDataset:facts.baseDataset,fingerprint:facts.fingerprint,
      baselineId:accepted.storageBaselineId,queryKey:prepared.sourceMonth});
    return projectBaseline;
    } finally { releasePending(); }
  }

  async function prepareProjectBaseline(month=deviceCurrentMonth(),{isCurrent=()=>true}={}) {
    const releasePending=protectPendingSource(month);
    try {
      const domain=dependencies.domains.projectDomain;
      refreshSourceIdentity();
      if(projectBaseline?.queryKey===month
        && projectBaselineGeneration===domain.getGeneration()
        && domain.state().storageBaselineId===projectBaseline.baselineId)return projectBaseline;
      const prepared=await prepareProjectSource(month,{isCurrent});
      return await admitPreparedProjectSource(prepared,{isCurrent});
    } finally { releasePending(); }
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
    get sourceCacheStats() { return sourceCacheStats; },
    get clearPreparedSourceCache() { return clearPreparedSourceCache; },
    get setPresentedSourceMonth() { return setPresentedSourceMonth; },
    dispose,
    get prepareProjectSource() { return prepareProjectSource; },
    get admitPreparedProjectSource() { return admitPreparedProjectSource; },
    get prepareProjectBaseline() { return prepareProjectBaseline; },
    get projectBaseline() { return projectBaseline; },
    get pristineCountriesFallback() { return pristineCountriesFallback; },
    get baseSceneFeatureById() { return baseSceneFeatureById; },
    get syncBuiltinPalette() { return syncBuiltinPalette; },
  });
}
