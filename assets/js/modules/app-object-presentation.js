/** ObjectPresentation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectPresentation() {
  let dependencies;
  let territorialScope;
  let distributionVisibilityRevision;
  let distributionRenderRowCache;
  let territorialEntityRepository;
  let territorialApplicationService;
  let distributionService;
  let genericFeatureService;
  let projectCommandPipeline;
  let runTerritorialUnitTransaction;
  let validateTerritorialUnitRelations;
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
    return '기타 객체는 독립된 형상을 가지며 다른 객체 종류로 전환할 수 있습니다.';
  }

  function genericFeatureDisplayFeature(feature) {
    return feature;
  }

  function genericFeatureName(feature) {
    return feature.properties?.name || `이름 없는 ${genericFeatureRoleLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  function territorialUnitById(id) {
    return territorialEntityRepository.get(id);
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
    const country = territorialEntityRepository.sovereign(feature?.id);
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

  function initializeTerritorialEntityRepository() {










    (runTerritorialUnitTransaction = options => territorialApplicationService.runGeometryTransaction(options));

    (validateTerritorialUnitRelations = (units, options) => territorialApplicationService.validateRelations(units, options));


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
      distributions: '분포',
      hydro: '강·호수',
      countryLabels: '국가명',
    }));

    (layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }));

    (expandedMapDisplayGroups = new Set());
  }

  return Object.freeze({
    connect,
    initializeTerritorialScope,
    initializeTerritorialEntityRepository,
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
    get territorialEntityRepository() { return territorialEntityRepository; },
    set territorialEntityRepository(value) { territorialEntityRepository = value; },
    get territorialScope() { return territorialScope; },
    get territorialStyleColor() { return territorialStyleColor; },
    get territorialUnitById() { return territorialUnitById; },
    get territorialUnitColor() { return territorialUnitColor; },
    get territorialUnitCountryName() { return territorialUnitCountryName; },
    get territorialUnitName() { return territorialUnitName; },
    get validateTerritorialUnitRelations() { return validateTerritorialUnitRelations; },
  });
}
