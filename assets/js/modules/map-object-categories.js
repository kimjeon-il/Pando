const freezeType = type => Object.freeze({ ...type });

/**
 * Shared semantic metadata for map objects.  The values intentionally mirror
 * the existing canonical unit and layer keys; this registry only describes
 * presentation and entry points, it does not define a second data model.
 */
export const MAP_OBJECT_TYPES = Object.freeze({
  country: freezeType({
    type: 'country',
    label: '국가',
    icon: 'icon-country',
    layerGroup: 'countries',
    createButton: 'addCountryBtn',
    createAction: 'new-country',
  }),
  territory: freezeType({
    type: 'territory',
    label: '권역',
    icon: 'icon-territory',
    layerGroup: 'territories',
    createButton: 'addTerritoryBtn',
    createAction: 'territorial-modal',
    createMethods: Object.freeze(['split', 'draw', 'geojson']),
  }),
  admin: freezeType({
    type: 'admin',
    label: '행정구역',
    icon: 'icon-administrative',
    layerGroup: 'administrative',
    createButton: 'addAdministrativeBtn',
    createAction: 'territorial-modal',
    createMethods: Object.freeze(['split', 'draw', 'geojson']),
  }),
  region: freezeType({
    type: 'region',
    label: '지방',
    icon: 'icon-region',
    layerGroup: 'regions',
    createButton: 'addRegionBtn',
    createAction: 'territorial-modal',
    createMethods: Object.freeze(['draw', 'geojson']),
  }),
  generic: freezeType({
    type: 'feature',
    label: '일반 객체',
    icon: '',
    layerGroup: 'genericFeatures',
    createButton: null,
    createAction: null,
  }),
  distribution: freezeType({
    type: 'distribution',
    label: '분포',
    icon: 'icon-language',
    createButton: 'addDistributionBtn',
    createAction: 'distribution-modal',
  }),
  label: freezeType({
    type: 'label',
    label: '지명',
    icon: 'icon-place',
    layerGroup: 'labels',
    createButton: 'addLabelBtn',
    createAction: 'label-placement',
  }),
  river: freezeType({
    type: 'river',
    label: '강',
    icon: 'icon-river',
    layerGroup: 'rivers',
    createButton: 'addRiverBtn',
    createAction: 'river-create',
  }),
  lake: freezeType({
    type: 'lake',
    label: '호수',
    icon: 'icon-lake',
    layerGroup: 'lakes',
    createButton: 'addLakeBtn',
    createAction: 'lake-create',
  }),
});

export const MAP_OBJECT_CATEGORIES = Object.freeze({
  territorial: Object.freeze({
    label: '영토·구역',
    layerGroups: Object.freeze(['countries', 'territories', 'administrative', 'regions']),
    createItems: Object.freeze(['country', 'territory', 'admin', 'region']),
  }),
  distribution: Object.freeze({
    label: '인문 분포',
    layerGroups: Object.freeze(['languages', 'ethnicities', 'religions']),
    createItems: Object.freeze(['distribution']),
  }),
  features: Object.freeze({
    label: '지형지물',
    layerGroups: Object.freeze(['rivers', 'lakes', 'genericFeatures']),
    createItems: Object.freeze(['label', 'river', 'lake']),
    viewGroups: Object.freeze(['labels', 'countryLabels']),
  }),
});

export const MAP_OBJECT_CATEGORY_ORDER = Object.freeze(Object.keys(MAP_OBJECT_CATEGORIES));

export function categoryForCreateItem(type) {
  return MAP_OBJECT_CATEGORY_ORDER.find(category => MAP_OBJECT_CATEGORIES[category].createItems.includes(type)) || '';
}

export function categoryForLayerGroup(group) {
  return MAP_OBJECT_CATEGORY_ORDER.find(category => MAP_OBJECT_CATEGORIES[category].layerGroups.includes(group)) || '';
}
