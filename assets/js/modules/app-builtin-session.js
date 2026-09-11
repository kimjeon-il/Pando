/** BuiltinSession: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createBuiltinSession() {
  let dependencies;
  let pristineCountriesFallback;
  let canonicalCountryStore;
  let builtinCountryIds;
  let PRISTINE_LABEL_ANCHORS;
  let builtinRenderCache;
  let builtinGeometryCache;
  let builtinGeometryStore;
  let renderCountryFeatureById;
  let countryLabelFeatureById;
  let builtinPaletteKey;
  let builtinPaletteVisibility;
  function connect(ports) {
    if (dependencies) throw new Error('builtin-session already connected');
    dependencies = ports;
  }

  function installCanonicalCountryStore(store) {
    if (!store || typeof store.materializeCollectionSync !== 'function'
        || typeof store.materializeFeature !== 'function' || typeof store.geometryEquals !== 'function') {
      throw new Error('무손실 국가 packet store가 올바르지 않습니다.');
    }
    canonicalCountryStore = store;
    builtinCountryIds = new Set(store.ids());
    pristineCountriesFallback = null;
  }

  function materializePristineCountriesSync() {
    return canonicalCountryStore?.materializeCollectionSync?.()
      || (0, dependencies.deepClone)(pristineCountriesFallback || { type: 'FeatureCollection', features: [] });
  }

  async function materializePristineCountries() {
    if (!canonicalCountryStore?.materializeCollection) return materializePristineCountriesSync();
    const result = await canonicalCountryStore.materializeCollection({
      budgetMs: 4,
      coordinateBudget: 4096,
      waitForQuiet: async () => {},
      yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)),
    });
    return result.collection;
  }

  function freshPristineCountries(applyOverrides = true) {
    const countries = (0, dependencies.reindexCountries)(materializePristineCountriesSync(), applyOverrides, { assumeCanonical: !!canonicalCountryStore });
    (0, dependencies.applyPristineLabelAnchors)(countries);
    return countries;
  }

  function applyFreshBuiltinClassification() {
    const result = (0, dependencies.classifyBuiltinCountries)(dependencies.state.countriesData);
    dependencies.state.territorialUnits = result.subunits;
    dependencies.state.countriesData = (0, dependencies.reindexCountries)(result.countries, true, { assumeCanonical: true });
    (0, dependencies.applyPristineLabelAnchors)({ features: result.subunits.map(unit => ({ id: (0, dependencies.builtinSubunitSourceId)(unit) })) });
  }

  function builtinRenderCountries() {
    if (builtinGeometryStore !== canonicalCountryStore) {
      builtinGeometryStore = canonicalCountryStore;
      builtinGeometryCache = new WeakMap();
      builtinRenderCache = null;
    }
    if (builtinRenderCache?.countries === dependencies.state.countriesData && builtinRenderCache.units === dependencies.state.territorialUnits
      && builtinRenderCache.presentation === dependencies.state.layerPresentation) return builtinRenderCache;
    const features = [...(dependencies.state.countriesData?.features || [])];
    const byId = new Map(features.map(feature => [String(feature.id), feature]));
    const labelById = new Map(byId);
    const labelRefs = new Map();
    const units = new Map();
    for (const unit of dependencies.state.territorialUnits || []) {
      const id = (0, dependencies.builtinSubunitSourceId)(unit);
      if (!id || byId.has(id)) continue;
      const feature = { type: 'Feature', id, properties: unit.properties, geometry: unit.geometry };
      labelById.set(id, feature);
      labelRefs.set(id, { domain: 'territorial', type: 'subunit', id: unit.id });
      const style = (0, dependencies.layerStyle)(dependencies.state.layerPresentation, 'subunits', `territorial:subunit:${unit.id}`);
      if (style.opacity !== 1 || style.blendMode !== 'normal' || !style.boundaryVisible) continue;
      let unchanged = builtinGeometryCache.get(unit.geometry);
      if (unchanged === undefined) {
        unchanged = canonicalCountryStore ? canonicalCountryStore.geometryEquals(id, unit.geometry)
          : JSON.stringify(unit.geometry) === JSON.stringify(pristineCountriesFallback?.features.find(feature => feature.id === id)?.geometry);
        builtinGeometryCache.set(unit.geometry, unchanged);
      }
      if (!unchanged) continue;
      features.push(feature); byId.set(id, feature); units.set(id, unit);
    }
    const order = new Map((canonicalCountryStore?.ids() || pristineCountriesFallback?.features.map(feature => feature.id) || []).map((id, index) => [id, index]));
    features.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    builtinRenderCache = { countries: dependencies.state.countriesData, units: dependencies.state.territorialUnits, presentation: dependencies.state.layerPresentation,
      collection: { type: 'FeatureCollection', features }, byId, labelById, labelRefs, nativeUnits: units };
    return builtinRenderCache;
  }

  function syncBuiltinPalette() {
    const cache = builtinRenderCountries();
    const visibility = JSON.stringify([dependencies.state.layerVisibility.subunits, dependencies.state.itemVisibility.subunits]);
    if (builtinPaletteKey === cache && builtinPaletteVisibility === visibility) return;
    builtinPaletteKey = cache;
    builtinPaletteVisibility = visibility;
    dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true }, 'builtin-subunit-presentation');
  }

  function isNativeBuiltinSubunit(unit) {
    const sourceId = (0, dependencies.builtinSubunitSourceId)(unit);
    return !!sourceId && builtinRenderCountries().nativeUnits.get(sourceId) === unit;
  }

  function isRenderCountryVisible(id) {
    const unit = builtinRenderCountries().nativeUnits.get(String(id));
    return unit ? dependencies.state.layerVisibility.subunits !== false && (0, dependencies.isLayerItemVisible)('subunits', unit.id)
      : !!(0, dependencies.countryFeatureById)(id) && (0, dependencies.isCountryVisibleById)(id);
  }

  function initializePristineCountriesFallback() {
    (pristineCountriesFallback = window.PANDOLAB_COUNTRIES || { type: 'FeatureCollection', features: [] });

    (canonicalCountryStore = null);

    (builtinCountryIds = new Set(pristineCountriesFallback.features.map(feature => String(feature.id))));

    (PRISTINE_LABEL_ANCHORS = window.PANDOLAB_LABEL_ANCHORS || {});

    (builtinRenderCache = null);

    (builtinGeometryCache = new WeakMap());

    (builtinGeometryStore = null);

    (renderCountryFeatureById = id => builtinRenderCountries().byId.get(String(id)) || null);

    (countryLabelFeatureById = id => builtinRenderCountries().labelById.get(String(id)) || null);

    (builtinPaletteKey = null);

    (builtinPaletteVisibility = '');
  }

  return Object.freeze({
    connect,
    initializePristineCountriesFallback,
    get PRISTINE_LABEL_ANCHORS() { return PRISTINE_LABEL_ANCHORS; },
    get applyFreshBuiltinClassification() { return applyFreshBuiltinClassification; },
    get builtinCountryIds() { return builtinCountryIds; },
    get builtinRenderCountries() { return builtinRenderCountries; },
    get canonicalCountryStore() { return canonicalCountryStore; },
    get countryLabelFeatureById() { return countryLabelFeatureById; },
    get freshPristineCountries() { return freshPristineCountries; },
    get installCanonicalCountryStore() { return installCanonicalCountryStore; },
    get isNativeBuiltinSubunit() { return isNativeBuiltinSubunit; },
    get isRenderCountryVisible() { return isRenderCountryVisible; },
    get materializePristineCountries() { return materializePristineCountries; },
    get materializePristineCountriesSync() { return materializePristineCountriesSync; },
    get pristineCountriesFallback() { return pristineCountriesFallback; },
    get renderCountryFeatureById() { return renderCountryFeatureById; },
    get syncBuiltinPalette() { return syncBuiltinPalette; },
  });
}
