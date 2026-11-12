const freezeList = values => Object.freeze([...(values || [])]);
const freezeType = type => Object.freeze({
  ...type,
  layerGroups: freezeList(type.layerGroups),
  presentationGroups: freezeList(type.presentationGroups),
});
const freezeCategory = category => Object.freeze({
  ...category,
  layerGroups: freezeList(category.layerGroups),
  viewGroups: freezeList(category.viewGroups),
});

const MAP_OBJECT_DOMAINS = Object.freeze({
  TERRITORIAL: 'territorial',
  DISTRIBUTION: 'distribution',
  HYDRO: 'hydro',
  LABEL: 'label',
  GENERIC: 'generic',
});

/**
 * Canonical semantic metadata for map objects.
 *
 * This registry does not define storage schemas. It is the single source of
 * truth for object presentation and UI routing: domain, category, label, icon,
 * and layer/presentation mapping.
 */
export const MAP_OBJECT_TYPES = Object.freeze({
  entity: freezeType({ key: 'entity', domain: MAP_OBJECT_DOMAINS.TERRITORIAL, type: 'entity', category: 'territorial', label: '객체', icon: 'icon-territory', layerGroup: 'objects', presentationGroup: 'objects' }),
  distribution: freezeType({
    key: 'distribution',
    domain: MAP_OBJECT_DOMAINS.DISTRIBUTION,
    type: 'distribution',
    category: 'distribution',
    label: '분포',
    icon: 'icon-area-draw',
    layerGroup: 'distributions',
    layerGroups: ['distributions'],
    presentationGroup: 'distributions',
    presentationGroups: ['distributions'],
  }),
  label: freezeType({
    key: 'label',
    domain: MAP_OBJECT_DOMAINS.LABEL,
    type: 'label',
    category: 'features',
    label: '도시',
    icon: 'icon-place',
    layerGroup: 'labels',
    presentationGroup: 'labels',
  }),
  river: freezeType({
    key: 'river',
    domain: MAP_OBJECT_DOMAINS.HYDRO,
    type: 'river',
    category: 'features',
    label: '강',
    icon: 'icon-river',
    layerGroup: 'rivers',
    presentationGroup: 'rivers',
  }),
  lake: freezeType({
    key: 'lake',
    domain: MAP_OBJECT_DOMAINS.HYDRO,
    type: 'lake',
    category: 'features',
    label: '호수',
    icon: 'icon-lake',
    layerGroup: 'lakes',
    presentationGroup: 'lakes',
  }),
  generic: freezeType({
    key: 'generic',
    domain: MAP_OBJECT_DOMAINS.GENERIC,
    type: 'feature',
    category: 'features',
    label: '기타 객체',
    icon: 'icon-shape',
    layerGroup: 'genericFeatures',
    presentationGroup: 'genericFeatures',
  }),
});

export const MAP_OBJECT_CATEGORIES = Object.freeze({
  territorial: freezeCategory({
    key: 'territorial',
    label: '영토·구역',
    layerGroups: ['objects'],
  }),
  distribution: freezeCategory({
    key: 'distribution',
    label: '분포',
    layerGroups: ['distributions'],
  }),
  features: freezeCategory({
    key: 'features',
    label: '지형지물',
    layerGroups: ['rivers', 'lakes', 'genericFeatures'],
    viewGroups: ['labels', 'objectLabels'],
  }),
});

export const MAP_OBJECT_CATEGORY_ORDER = Object.freeze(Object.keys(MAP_OBJECT_CATEGORIES));
