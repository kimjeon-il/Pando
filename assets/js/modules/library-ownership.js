import { territorialRootId } from './territorial-units.js';
const text = value => String(value || '');

// Relation choices share stored IDs; labels never participate in identity resolution.
// Read-only callers may pass TerritorialEntityRepository instead of raw country/unit arrays.
export function territorialParentChoices(countryId, countriesOrRepository, unitsOrOptions = [], maybeOptions = {}) {
  const repository = countriesOrRepository
    && typeof countriesOrRepository.get === 'function'
    && typeof countriesOrRepository.list === 'function'
    ? countriesOrRepository
    : null;
  const options = repository && !Array.isArray(unitsOrOptions) ? unitsOrOptions || {} : maybeOptions || {};
  const { exclude = [], name = feature => feature.properties?.name || feature.id } = options;
  const country = repository
    ? repository.get(countryId)
    : (countriesOrRepository || []).find(feature => text(feature.id) === text(countryId));
  if (!country || (repository && !(country.properties?.entityKind === 'general' && !country.properties?.parentId))) return [];
  const units = repository
    ? repository.list({ kind: 'general', rootId: text(countryId) }).filter(feature => !!feature.properties.parentId)
    : Array.isArray(unitsOrOptions) ? unitsOrOptions : [];
  const blocked = new Set(exclude.map(text));
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (blocked.has(text(unit.properties?.parentId)) && !blocked.has(text(unit.id))) {
        blocked.add(text(unit.id));
        changed = true;
      }
    }
  }
  const candidates = units.filter(unit => (unit.properties?.entityKind === 'general' && !!unit.properties?.parentId)
    && territorialRootId(unit, id => repository ? repository.get(id) : [...countriesOrRepository, ...units].find(entity => text(entity.id) === id)) === text(countryId) && !blocked.has(text(unit.id)));
  const result = [{ value: text(countryId), label: name(country) }];
  const seen = new Set([text(countryId)]);
  function visit(parentId, depth) {
    for (const unit of candidates.filter(item => text(item.properties.parentId) === parentId)
      .sort((a, b) => name(a).localeCompare(name(b), 'ko') || text(a.id).localeCompare(text(b.id)))) {
      if (seen.has(text(unit.id))) continue;
      seen.add(text(unit.id));
      result.push({ value: text(unit.id), label: `${'　'.repeat(depth)}${name(unit)}` });
      visit(text(unit.id), depth + 1);
    }
  }
  visit(text(countryId), 1);
  return result;
}

export function shouldShowTerritorialParentChoice({ rootId = '', parentId = '', options = [] } = {}) {
  const root = text(rootId);
  const parent = text(parentId);
  if (!root || !parent || parent !== root) return true;
  const candidates = [...new Set((options || [])
    .map(option => text(option?.value ?? option?.id))
    .filter(Boolean))];
  return candidates.length !== 1 || candidates[0] !== root;
}

export function missingLibraryOwnership(descriptors, resolve, countries, units) {
  const included = new Map(descriptors.map(item => [item.entityId, item]));
  const existing = new Map([...countries, ...units].map(item => [text(item.id), item]));
  return descriptors.filter(item => item.entityKind === 'general' && !!item.parentEntityId && !resolve(item.entityId)).filter(item => {
    if (included.has(item.parentEntityId)) return false;
    const parent = included.get(item.parentEntityId) || existing.get(resolve(item.parentEntityId));
    return !parent;
  }).map(item => ({
    entityId: item.entityId, name: item.name,
    countryId: '',
  }));
}

export function prepareLibraryOwnership({ descriptors, resolve, countries, units, choices = {}, allocateId, contains }) {
  const pending = descriptors.filter(item => !resolve(item.entityId));
  const ids = new Map(pending.map(item => [item.entityId,
    item.entityKind === 'general' && (!item.parentEntityId || choices[item.entityId]?.mode === 'root') ? item.entityId : allocateId(item.entityKind)]));
  const existing = new Map([...countries, ...units].map(item => [text(item.id), item]));
  const byLibrary = new Map(pending.map(item => [item.entityId, item]));
  const prepared = new Map();
  const visiting = new Set();
  function prepare(item) {
    if (prepared.has(item.entityId)) return prepared.get(item.entityId);
    if (visiting.has(item.entityId)) throw new Error('라이브러리 상위 객체 관계가 순환합니다.');
    visiting.add(item.entityId);
    const choice = choices[item.entityId];
    if (choice && !['child', 'root'].includes(choice.mode)) throw new Error('추가 방식을 선택하세요.');
    const root = item.entityKind === 'general' && (choice?.mode === 'root' || !item.parentEntityId);
    const next = { ...item, id: ids.get(item.entityId), parentId: '' };
    if (existing.has(next.id)) throw new Error('추가할 객체 ID가 현재 프로젝트와 중복됩니다.');
    if (root) {
      next.name = String(choice?.name ?? item.name).trim();
      if (!next.name) throw new Error('객체 이름을 입력하세요.');
    } else if (item.entityKind === 'general') {
      let parent;
      if (choice) {
        if (!countries.some(country => text(country.id) === text(choice.countryId))) throw new Error('소속 국가를 선택하세요.');
        const parentId = text(choice.parentId || choice.countryId);
        if (!territorialParentChoices(choice.countryId, countries, units).some(option => option.value === parentId)) {
          throw new Error('선택한 국가에 속하는 상위 단위를 선택하세요.');
        }
        parent = existing.get(parentId);
        next.parentId = parentId;
      } else {
        const descriptor = byLibrary.get(item.parentEntityId);
        parent = descriptor ? prepare(descriptor) : existing.get(resolve(item.parentEntityId));
        if (!parent) throw new Error(`${item.name}의 소속 국가와 상위 단위를 선택하세요.`);
        const parentKind = parent.type === 'Feature' ? parent.properties.entityKind : parent.entityKind;
        if (parentKind !== 'general') throw new Error('상위 단위는 국가 또는 하위단위여야 합니다.');
        next.parentId = text(parent.id);
      }
      // Country expansion is planned separately. Never expand an intermediate subunit.
      const parentIsSubunit = parent.entityKind === 'general' && !!parent.parentId || (parent.properties?.entityKind === 'general' && !!parent.properties?.parentId);
      if (parentIsSubunit && contains && !contains(item.geometry, parent.geometry)) {
        throw new Error(`${item.name}의 경계가 상위 단위 안에 포함되지 않습니다. 국가 자신이나 적합한 상위 단위를 선택하세요.`);
      }
    } else {
      if (item.parentEntityId) throw new Error('독립 권역에는 부모를 지정할 수 없습니다.');
    }
    visiting.delete(item.entityId);
    prepared.set(item.entityId, next);
    return next;
  }
  for (const item of pending) prepare(item);
  return [...prepared.values()];
}
