export function hydroEditorName(value, fallback) {
    const name = String(value || '').trim();
    if (/^미명명 수계(?:\s+\d+)?$/.test(name)) return fallback;
    return name || fallback;
  }
import { resolveTerritorialColor } from "./color-adapter.js";
import {createTerritorialScopeResolver} from "../document/territorial-scope.js";
/** ObjectPresentation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectPresentation() {
  let dependencies;
  let territorialScope;
  let distributionVisibilityRevision;
  let distributionRenderRowCache;
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

  function genericFeatureRoleLabel() {
    return '기타 객체';
  }

  function genericFeatureName(feature) {
    return feature.properties?.name || `이름 없는 ${genericFeatureRoleLabel(feature)} ${String(feature.id || '').slice(0, 8)}`;
  }

  function territorialStyleColor(feature) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature }).explicit;
  }

  function territorialEntityName(feature) {
    const entity = dependencies.territorialModel.entityRepository.get(feature?.id) || feature;
    const properties = entity?.properties || {};
    // Default names come from canonical assets; edited names are literal.
    if (properties.name) return properties.name;
    return '이름 없는 객체';
  }

  function territorialEntityColor(feature) {
    const entity = dependencies.territorialModel.entityRepository.get(feature?.id) || feature;
    const fallback = (entity?.properties?.entityKind === 'general' && !entity?.properties?.parentId)
      ? (0, dependencies.colorModel.defaultCountryColor)(entity) : dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR;
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.TERRITORIAL, { feature: entity }, {
      inherited: resolveTerritorialColor(entity, { entityRepository: dependencies.territorialModel.entityRepository,
        countryColor: country => (0, dependencies.colorModel.defaultCountryColor)(country), fallback }),
      fallback,
    }).value;
  }

  function territorialRootName(feature) {
    const country = dependencies.territorialModel.entityRepository.root(feature?.id);
    return country?.properties.entityKind === 'general' ? territorialEntityName(country) : '';
  }

  function distributionColor(layer) {
    return (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.DISTRIBUTION, { layer }, { fallback: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR }).value;
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

  function initializeTerritorialScope() {
    if(territorialScope)throw new Error('Territorial read model already initialized');
    (territorialScope = createTerritorialScopeResolver({
      entityRepository: dependencies.territorialModel.entityRepository,
      clipper: () => dependencies.platform.polygonClipping,
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

  function initializeObjectPresentationModel() {
    (LAYER_GROUP_KEYS = Object.freeze([...new Set([
      ...dependencies.objectDefinitions.MAP_OBJECT_CATEGORIES.territorial.layerGroups,
      ...dependencies.objectDefinitions.MAP_OBJECT_CATEGORIES.distribution.layerGroups,
      'hydro',
      'genericFeatures',
      ...dependencies.objectDefinitions.MAP_OBJECT_CATEGORIES.features.viewGroups,
    ])]));

    (LAYER_SEARCH_GROUP_KEYS = LAYER_GROUP_KEYS.filter(group => group !== 'objectLabels'));

    (layerGroupNames = Object.freeze({
      ...Object.fromEntries(Object.values(dependencies.objectDefinitions.MAP_OBJECT_TYPES)
        .filter(type => type.layerGroup)
        .map(type => [type.layerGroup, type.label])),
      distributions: '분포',
      hydro: '강·호수',
      objectLabels: '객체 이름',
    }));

    (layerNameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }));

    (expandedMapDisplayGroups = new Set());
  }

  return Object.freeze({
    connect,
    hydroEditorName,
    initializeTerritorialScope,
    initializeObjectPresentationModel,
    get LAYER_GROUP_KEYS() { return LAYER_GROUP_KEYS; },
    get LAYER_SEARCH_GROUP_KEYS() { return LAYER_SEARCH_GROUP_KEYS; },
    get defaultGenericFeatureColor() { return defaultGenericFeatureColor; },
    get distributionColor() { return distributionColor; },
    get distributionRenderRowCache() { return distributionRenderRowCache; },
    get distributionVisibilityRevision() { return distributionVisibilityRevision; },
    set distributionVisibilityRevision(value) { distributionVisibilityRevision = value; },
    get expandedMapDisplayGroups() { return expandedMapDisplayGroups; },
    get genericFeatureColor() { return genericFeatureColor; },
    get genericFeatureName() { return genericFeatureName; },
    get genericFeatureRoleLabel() { return genericFeatureRoleLabel; },
    get hydroCategoryKey() { return hydroCategoryKey; },
    get hydroCategoryLabel() { return hydroCategoryLabel; },
    get hydroFallbackName() { return hydroFallbackName; },
    get layerGroupNames() { return layerGroupNames; },
    get layerNameCollator() { return layerNameCollator; },

    get territorialScope() { return territorialScope; },
    get territorialStyleColor() { return territorialStyleColor; },

    get territorialEntityColor() { return territorialEntityColor; },
    get territorialRootName() { return territorialRootName; },
    get territorialEntityName() { return territorialEntityName; },
  });
}
