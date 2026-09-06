const TYPE_LABELS = Object.freeze({
  countries: '국가', subunits: '하위단위', regions: '지방',
  languages: '언어', ethnicities: '민족', religions: '종교', labels: '지명', genericFeatures: '기타 객체',
});

/** Presentation only: membership never depends on geometry, visibility or loading success. */
export function createLayerListModel({ items, groups, itemRef, compare }) {
  const bundles = [
    { kind: 'bundle', key: 'bundle:polities', id: 'polities', name: '정치체', icon: 'country', items: [] },
    { kind: 'bundle', key: 'bundle:landforms', id: 'landforms', name: '지형지물', icon: 'river', items: [] },
  ];
  const objects = [], seen = new Set();
  for (const group of groups) for (const source of items(group)) {
    const layerGroup = source.layerGroup || group;
    const ref = itemRef(layerGroup, source.id);
    const key = ref?.key || `${layerGroup}:${source.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const typeLabel = layerGroup === 'hydro' ? (source.hydroCategory === 'lake' ? '호수' : '강')
      : layerGroup === 'genericFeatures' ? (source.meta?.split(' · ')[0] || TYPE_LABELS[layerGroup])
        : TYPE_LABELS[layerGroup] || layerGroup;
    const item = { ...source, kind: 'object', key, ref, layerGroup, typeLabel };
    if (['countries', 'regions', 'subunits'].includes(layerGroup)) bundles[0].items.push(item);
    else if (layerGroup === 'hydro') bundles[1].items.push(item);
    else objects.push(item);
  }
  // The existing locale name comparator is retained; ties use the full ObjectKey, not a type-local ID.
  const order = (a, b) => compare({ name: a.name, id: '' }, { name: b.name, id: '' }) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  objects.sort(order);
  for (const bundle of bundles) {
    bundle.items.sort(order);
  }
  return { bundles: bundles.filter(bundle => bundle.items.length), objects, order };
}

export function visibleLayerRows(model, folders = {}, search = '') {
  const query = search.trim().toLocaleLowerCase('ko');
  if (query) return [...model.bundles.flatMap(bundle => bundle.items), ...model.objects]
    .filter(item => `${item.name} ${item.typeLabel} ${item.searchText || ''} ${item.id}`.toLocaleLowerCase('ko').includes(query))
    .sort(model.order);
  return [...model.bundles.flatMap(bundle => folders[bundle.id]
    ? [bundle, ...bundle.items.map(item => ({ ...item, bundleId: bundle.id }))] : [bundle]), ...model.objects];
}

/** Lift an old group-wide hidden flag without changing any non-target object's effective visibility. */
export function setScopedItemVisibility({ layerVisibility, itemVisibility, group, allIds, ids, visible }) {
  const values = itemVisibility[group] ||= {};
  if (layerVisibility[group] === false) {
    for (const id of allIds) values[String(id)] = false;
    layerVisibility[group] = true;
  }
  for (const id of ids) {
    if (visible) delete values[String(id)];
    else values[String(id)] = false;
  }
}
