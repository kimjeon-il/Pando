const text = value => String(value || '');

// Relation choices share stored IDs; labels never participate in identity resolution.
export function subunitParentChoices(countryId, countries, units, { exclude = [], name = feature => feature.properties?.name || feature.id } = {}) {
  const country = countries.find(feature => text(feature.id) === text(countryId));
  if (!country) return [];
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
  const candidates = units.filter(unit => unit.properties?.unitType === 'subunit'
    && text(unit.properties.sovereignId) === text(countryId) && !blocked.has(text(unit.id)));
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

export function missingLibraryOwnership(descriptors, resolve, countries, units) {
  const included = new Map(descriptors.map(item => [item.libraryId, item]));
  const existing = new Map([...countries, ...units].map(item => [text(item.id), item]));
  return descriptors.filter(item => item.type === 'subunit' && !resolve(item.libraryId)).filter(item => {
    if (included.has(item.parentLibraryId)) return false;
    const parent = included.get(item.parentLibraryId) || existing.get(resolve(item.parentLibraryId));
    const sovereign = included.get(item.sovereignLibraryId) || existing.get(resolve(item.sovereignLibraryId));
    return !parent || !sovereign;
  }).map(item => ({
    libraryId: item.libraryId, name: item.name,
    countryId: countries.some(country => text(country.id) === resolve(item.sovereignLibraryId)) ? resolve(item.sovereignLibraryId) : '',
  }));
}

export function prepareLibraryOwnership({ descriptors, resolve, countries, units, choices = {}, allocateId, contains }) {
  const pending = descriptors.filter(item => !resolve(item.libraryId));
  const ids = new Map(pending.map(item => [item.libraryId,
    item.type === 'country' || choices[item.libraryId]?.mode === 'country' ? item.libraryId : allocateId(item.type)]));
  const existing = new Map([...countries, ...units].map(item => [text(item.id), item]));
  const byLibrary = new Map(pending.map(item => [item.libraryId, item]));
  const prepared = new Map();
  const visiting = new Set();
  function prepare(item) {
    if (prepared.has(item.libraryId)) return prepared.get(item.libraryId);
    if (visiting.has(item.libraryId)) throw new Error('라이브러리 상위 소속 관계가 순환합니다.');
    visiting.add(item.libraryId);
    const choice = choices[item.libraryId];
    if (choice && !['subunit', 'country'].includes(choice.mode)) throw new Error('추가 방식을 선택하세요.');
    const type = choice?.mode === 'country' ? 'country' : item.type;
    const next = { ...item, id: ids.get(item.libraryId), type, parentId: '', sovereignId: '' };
    if (existing.has(next.id)) throw new Error('추가할 객체 ID가 현재 프로젝트와 중복됩니다.');
    if (type === 'country') {
      next.name = String(choice?.name ?? item.name).trim();
      if (!next.name) throw new Error('국가 이름을 입력하세요.');
    } else if (type === 'subunit') {
      let parent;
      if (choice) {
        if (!countries.some(country => text(country.id) === text(choice.countryId))) throw new Error('소속 국가를 선택하세요.');
        const parentId = text(choice.parentId || choice.countryId);
        if (!subunitParentChoices(choice.countryId, countries, units).some(option => option.value === parentId)) {
          throw new Error('선택한 국가에 속하는 상위 소속을 선택하세요.');
        }
        parent = existing.get(parentId);
        next.parentId = parentId;
        next.sovereignId = text(choice.countryId);
      } else {
        const descriptor = byLibrary.get(item.parentLibraryId);
        parent = descriptor ? prepare(descriptor) : existing.get(resolve(item.parentLibraryId));
        if (!parent) throw new Error(`${item.name}의 소속 국가와 상위 소속을 선택하세요.`);
        const parentType = parent.type === 'Feature' ? parent.properties?.unitType || 'country' : parent.type;
        if (!['country', 'subunit'].includes(parentType)) throw new Error('상위 소속은 국가 또는 하위단위여야 합니다.');
        next.parentId = text(parent.id);
        next.sovereignId = parentType === 'country' ? text(parent.id) : text(parent.sovereignId || parent.properties?.sovereignId);
      }
      // Country expansion is planned separately. Never expand an intermediate subunit.
      const parentIsSubunit = parent.type === 'subunit' || parent.properties?.unitType === 'subunit';
      if (parentIsSubunit && contains && !contains(item.geometry, parent.geometry)) {
        throw new Error(`${item.name}의 경계가 상위 소속 안에 포함되지 않습니다. 국가 자신이나 적합한 상위 소속을 선택하세요.`);
      }
    } else {
      next.parentId = resolve(item.parentLibraryId);
      next.sovereignId = resolve(item.sovereignLibraryId);
    }
    visiting.delete(item.libraryId);
    prepared.set(item.libraryId, next);
    return next;
  }
  for (const item of pending) prepare(item);
  return [...prepared.values()];
}
