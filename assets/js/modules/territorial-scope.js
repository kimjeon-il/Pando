const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const featureFor = coordinates => coordinates?.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } } : null;

/** Read model only. Its geometry never replaces canonical entity geometry.
 * parentId here is strictly the administrative/spatial hierarchy. Political
 * dependency relations must not participate in scope geometry.
 */
export function createTerritorialScopeResolver({ entityRepository, clipper }) {
  if (!entityRepository?.list || !entityRepository?.get) {
    throw new TypeError('영역 범위 계산에는 TerritorialEntityRepository가 필요합니다.');
  }
  let sourceEntities = null;
  let scopes = new Map();
  function refresh() {
    const entities = entityRepository.list();
    if (sourceEntities === entities) return;
    sourceEntities = entities;
    scopes = new Map();
  }
  function members(countryId) {
    return entityRepository.descendants(countryId, { type: 'subunit' });
  }

  function scope(countryId) {
    refresh();
    const id = String(countryId);
    if (scopes.has(id)) return scopes.get(id);
    const candidate = entityRepository.get(id);
    const country = candidate?.properties?.unitType === 'country' ? candidate : null;
    const descendants = members(id);
    const base = polygons(country?.geometry);
    let extent = country, extra = null;
    if (descendants.length && base.length) {
      const engine = clipper();
      if (!engine?.union || !engine?.difference) return { country, members: descendants, extent, extra };
      const combined = engine.union(base, ...descendants.map(unit => polygons(unit.geometry)).filter(value => value.length));
      extent = featureFor(combined) || country;
      extra = featureFor(engine.difference(combined, base));
    }
    const result = { country, members: descendants, extent, extra };
    scopes.set(id, result);
    return result;
  }

  return Object.freeze({ members, scope,  });
}

export function validateSubunitParentChanges(previous, next, countryExists) {
  const old=new Map((previous||[]).map(unit=>[String(unit.id),unit]));
  const units=new Map((next||[]).map(unit=>[String(unit.id),unit]));
  const issues=[];
  for(const unit of next||[]) {
    if(unit.properties?.unitType !== 'subunit') continue;
    const before=old.get(String(unit.id));
    const parentId=String(unit.properties.parentId||'');
    let cursor=parentId;
    const seen=new Set([String(unit.id)]);
    while(cursor && units.has(cursor)) {
      const parent=units.get(cursor);
      if(seen.has(cursor)||parent.properties.unitType!=='subunit') { issues.push(unit.id+': 잘못된 부모 또는 순환 관계입니다.'); cursor=''; break; }
      seen.add(cursor); cursor=String(parent.properties.parentId||'');
    }
    if(!cursor||!countryExists(cursor)) issues.push(unit.id+': 부모 체인이 국가까지 연결되어야 합니다.');
    if(before?.properties.locked && before.properties.parentId!==parentId) issues.push(unit.id+': 잠긴 객체의 부모를 변경할 수 없습니다.');
  }
  return {ok:!issues.length,issues};
}
