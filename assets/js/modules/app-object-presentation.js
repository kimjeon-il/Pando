/** ObjectPresentation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectPresentation() {
  let dependencies;
  let genericFeatureLandClipCache;
  let territorialScope;
  let distributionVisibilityRevision;
  let distributionRenderRowCache;
  let territorialRepository;
  let territorialApplicationService;
  let distributionService;
  let genericFeatureService;
  let projectCommandPipeline;
  let runTerritorialUnitTransaction;
  let validateTerritorialUnitRelations;
  let DISTRIBUTION_GROUP_TYPES;
  let DISTRIBUTION_TYPE_GROUPS;
  let DISTRIBUTION_TYPE_LABELS;
  let LAYER_GROUP_KEYS;
  let LAYER_SEARCH_GROUP_KEYS;
  let layerGroupNames;
  let layerNameCollator;
  let expandedMapDisplayGroups;
  function connect(ports) {
    if (dependencies) throw new Error('object-presentation already connected');
    dependencies = ports;
  }

  function defaultGenericFeatureColor(feature) {
    return dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR;
  }

  function genericFeatureColor(feature) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.GENERIC, { feature }, { fallback: defaultGenericFeatureColor(feature) }).value;
  }

  function genericFeatureRoleLabel(feature) {
    return dependencies.objectCatalog.GENERIC_FEATURE_ROLE_RULES[feature?.properties?.role]?.label || '기타 객체';
  }

  function genericFeatureRoleHelp(feature) {
    return '사용자 정의 객체는 육지 결합 방식을 직접 선택할 수 있습니다.';
  }

  function genericFeatureDisplayFeature(feature) {
    if ((0, dependencies.objectPresentation.genericFeatureGeometryKind)(feature) !== 'polygon' || (0, dependencies.objectPresentation.genericFeatureLandBinding)(feature) === 'none') return feature;
    const cached = genericFeatureLandClipCache.get(feature);
    const ownerId = String(feature.properties?.ownerId || '');
    if (cached && cached.revision === dependencies.countries.countryLandRevision && cached.geometry === feature.geometry && cached.ownerId === ownerId) return { ...feature, geometry: cached.feature.geometry };
    const entry = { revision: dependencies.countries.countryLandRevision, geometry: feature.geometry, ownerId, feature: { ...feature, geometry: null } };
    genericFeatureLandClipCache.set(feature, entry);
    dependencies.spatialQuery.mapEditClient.execute('territorial-land-clip', { payload: { targetId: String(feature.id) } },
      { jobKey: `territorial-land-clip:${feature.id}` }).then(response => {
      if (genericFeatureLandClipCache.get(feature) !== entry || entry.geometry !== feature.geometry || entry.revision !== dependencies.countries.countryLandRevision) return;
      entry.feature = { ...feature, geometry: response.result.geometry };
      dependencies.domains.renderingDomain?.invalidateGenericPatch?.('land-clip-ready');
    }).catch(() => { if (genericFeatureLandClipCache.get(feature) === entry) genericFeatureLandClipCache.delete(feature); });
    return entry.feature;
  }

  function genericFeatureName(feature) {
    return feature.properties?.name || `이름 없는 ${genericFeatureRoleLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  function territorialUnitById(id) {
    return territorialApplicationService.get(id);
  }

  function territorialStyleColor(feature) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature }).explicit;
  }

  function setTerritorialStyleColor(feature, color) {
    if (!feature?.properties) return '';
    return (0, dependencies.colorModel.writeDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature }, color, { clear: !color, fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR });
  }

  function territorialUnitName(feature) {
    const properties = feature?.properties || {};
    if (properties.name) return (0, dependencies.objectPresentation.defaultGeographicName)((0, dependencies.objectCatalog.builtinSubunitSourceId)(feature), properties.name);
    if (properties.unitType === dependencies.objectCatalog.TERRITORIAL_UNIT_TYPES.REGION) return '이름 없는 지방';
    return '이름 없는 하위단위';
  }

  function territorialUnitColor(feature) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature }, {
      inherited: territorialScope.color(feature, dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR),
      fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
    }).value;
  }

  function territorialUnitCountryName(feature) {
    const country = (0, dependencies.countries.countryFeatureById)(feature?.properties?.sovereignId);
    return country ? countryName(country) : '소속 국가 미지정';
  }

  function countryColor(feature) {
    const id = String(feature?.id || '');
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.COUNTRY, { feature, override: dependencies.projectState.state.countryOverrides[id] }, { fallback: (0, dependencies.colorModel.defaultCountryColor)() }).value;
  }

  function distributionColor(layer) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.DISTRIBUTION, { layer }, { fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR }).value;
  }

  function countryName(feature) {
    return (0, dependencies.objectPresentation.countryDisplayName)(feature, dependencies.projectState.state.countryOverrides[String(feature?.id || '')]);
  }

  function hydroCategoryKey(value) {
    return value === 'lake' ? 'lake' : 'river';
  }

  function hydroCategoryLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수' : '강';
  }

  function hydroFallbackName(value) {
    return `이름 없는 ${hydroCategoryLabel(value)}`;
  }

  function hydroAccusativeLabel(value) {
    return hydroCategoryKey(value) === 'lake' ? '호수를' : '강을';
  }

  function syncMapObjectCategoryLabels() {
    const buildContent = (0, dependencies.platform.$)('createBuildPanel');
    if (buildContent) {
      dependencies.objectCatalog.MAP_OBJECT_CATEGORY_ORDER.forEach(categoryKey => {
        const categoryNode = buildContent.querySelector(`.ui-menu-group[data-map-category="${categoryKey}"]`);
        const category = dependencies.objectCatalog.MAP_OBJECT_CATEGORIES[categoryKey];
        if (!categoryNode || !category) return;
        categoryNode.setAttribute('role', 'group');
        categoryNode.setAttribute('aria-label', category.label);
        category.createItems.forEach(type => {
          const item = categoryNode.querySelector(`[data-map-object-type="${type}"]`);
          if (!item) return;
          const metadata = dependencies.objectCatalog.MAP_OBJECT_TYPES[type];
          const label = item.querySelector('span');
          const icon = item.querySelector('.ui-icon use');
          if (metadata) {
            if (label) label.textContent = metadata.label;
            if (icon) icon.setAttribute('href', `#${metadata.icon}`);
          }
          categoryNode.appendChild(item);
        });
      });
    }
  }

  function initializeGenericFeatureLandClipCache() {
    (genericFeatureLandClipCache = new WeakMap());
  }

  function initializeTerritorialScope() {
    (territorialScope = (0, dependencies.objectPresentation.createTerritorialScopeResolver)({
      read: () => ({ units: dependencies.projectState.state.territorialUnits, revision: `${dependencies.projectState.state.stateRevision}:${dependencies.countries.countryLandRevision}:${dependencies.spatialQuery.mapObjectGeometryRevisions.territorial}` }),
      countryById: dependencies.countries.countryFeatureById,
      countryColor,
      clipper: () => window.polygonClipping,
    }));

    (distributionVisibilityRevision = 0);

    (distributionRenderRowCache = {
      layers: null,
      entries: null,
      countries: null,
      countryGeometryRevision: -1,
      territorialUnits: null,
      renderMode: '',
      selectedLayerId: '',
      visibilityRevision: -1,
      rows: [],
      rebuildCount: 0,
      buildMs: 0,
    });
  }

  function initializeTerritorialRepository() {










    (runTerritorialUnitTransaction = options => territorialApplicationService.runGeometryTransaction(options));

    (validateTerritorialUnitRelations = (units, options) => territorialApplicationService.validateRelations(units, options));

    (DISTRIBUTION_GROUP_TYPES = Object.freeze({
      languages: dependencies.objectCatalog.DISTRIBUTION_TYPES.LANGUAGE,
      ethnicities: dependencies.objectCatalog.DISTRIBUTION_TYPES.ETHNICITY,
      religions: dependencies.objectCatalog.DISTRIBUTION_TYPES.RELIGION,
    }));

    (DISTRIBUTION_TYPE_GROUPS = Object.freeze(Object.fromEntries(Object.entries(DISTRIBUTION_GROUP_TYPES).map(([group, type]) => [type, group]))));

    (DISTRIBUTION_TYPE_LABELS = Object.freeze({ language: '언어', ethnicity: '민족', religion: '종교' }));

    (LAYER_GROUP_KEYS = Object.freeze([...new Set([
      ...dependencies.objectCatalog.MAP_OBJECT_CATEGORIES.territorial.layerGroups,
      ...dependencies.objectCatalog.MAP_OBJECT_CATEGORIES.distribution.layerGroups,
      'hydro',
      'genericFeatures',
      ...dependencies.objectCatalog.MAP_OBJECT_CATEGORIES.features.viewGroups,
    ])]));

    (LAYER_SEARCH_GROUP_KEYS = LAYER_GROUP_KEYS.filter(group => group !== 'countryLabels'));

    (layerGroupNames = Object.freeze({
      ...Object.fromEntries(Object.values(dependencies.objectCatalog.MAP_OBJECT_TYPES)
        .filter(type => type.layerGroup)
        .map(type => [type.layerGroup, type.label])),
      languages: '언어',
      ethnicities: '민족',
      religions: '종교',
      hydro: '강·호수',
      countryLabels: '국가명',
    }));

    (layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }));

    (expandedMapDisplayGroups = new Set());
  }

  return Object.freeze({
    connect,
    initializeGenericFeatureLandClipCache,
    initializeTerritorialScope,
    initializeTerritorialRepository,
    get DISTRIBUTION_GROUP_TYPES() { return DISTRIBUTION_GROUP_TYPES; },
    get DISTRIBUTION_TYPE_GROUPS() { return DISTRIBUTION_TYPE_GROUPS; },
    get DISTRIBUTION_TYPE_LABELS() { return DISTRIBUTION_TYPE_LABELS; },
    get LAYER_GROUP_KEYS() { return LAYER_GROUP_KEYS; },
    get LAYER_SEARCH_GROUP_KEYS() { return LAYER_SEARCH_GROUP_KEYS; },
    get countryColor() { return countryColor; },
    get countryName() { return countryName; },
    get defaultGenericFeatureColor() { return defaultGenericFeatureColor; },
    get distributionColor() { return distributionColor; },
    get distributionRenderRowCache() { return distributionRenderRowCache; },
    get distributionService() { return distributionService; },
    set distributionService(value) { distributionService = value; },
    get distributionVisibilityRevision() { return distributionVisibilityRevision; },
    set distributionVisibilityRevision(value) { distributionVisibilityRevision = value; },
    get expandedMapDisplayGroups() { return expandedMapDisplayGroups; },
    get genericFeatureColor() { return genericFeatureColor; },
    get genericFeatureDisplayFeature() { return genericFeatureDisplayFeature; },
    get genericFeatureLandClipCache() { return genericFeatureLandClipCache; },
    set genericFeatureLandClipCache(value) { genericFeatureLandClipCache = value; },
    get genericFeatureName() { return genericFeatureName; },
    get genericFeatureRoleHelp() { return genericFeatureRoleHelp; },
    get genericFeatureRoleLabel() { return genericFeatureRoleLabel; },
    get genericFeatureService() { return genericFeatureService; },
    set genericFeatureService(value) { genericFeatureService = value; },
    get hydroAccusativeLabel() { return hydroAccusativeLabel; },
    get hydroCategoryKey() { return hydroCategoryKey; },
    get hydroCategoryLabel() { return hydroCategoryLabel; },
    get hydroFallbackName() { return hydroFallbackName; },
    get layerGroupNames() { return layerGroupNames; },
    get layerNameCollator() { return layerNameCollator; },
    get projectCommandPipeline() { return projectCommandPipeline; },
    set projectCommandPipeline(value) { projectCommandPipeline = value; },
    get runTerritorialUnitTransaction() { return runTerritorialUnitTransaction; },
    get setTerritorialStyleColor() { return setTerritorialStyleColor; },
    get syncMapObjectCategoryLabels() { return syncMapObjectCategoryLabels; },
    get territorialApplicationService() { return territorialApplicationService; },
    set territorialApplicationService(value) { territorialApplicationService = value; },
    get territorialRepository() { return territorialRepository; },
    set territorialRepository(value) { territorialRepository = value; },
    get territorialScope() { return territorialScope; },
    get territorialStyleColor() { return territorialStyleColor; },
    get territorialUnitById() { return territorialUnitById; },
    get territorialUnitColor() { return territorialUnitColor; },
    get territorialUnitCountryName() { return territorialUnitCountryName; },
    get territorialUnitName() { return territorialUnitName; },
    get validateTerritorialUnitRelations() { return validateTerritorialUnitRelations; },
  });
}
