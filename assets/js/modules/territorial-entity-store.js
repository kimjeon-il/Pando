import { TERRITORIAL_UNIT_TYPES } from './territorial-units.js';

const text = value => String(value ?? '').trim();
const UNIT_TYPES = new Set([TERRITORIAL_UNIT_TYPES.SUBUNIT, TERRITORIAL_UNIT_TYPES.REGION]);

function validateCollectionIdentity(countries, units) {
  if (!Array.isArray(countries)) throw new TypeError('국가 저장소에는 features 배열이 필요합니다.');
  if (!Array.isArray(units)) throw new TypeError('영역 저장소에는 배열이 필요합니다.');
  const ids = new Set();
  const register = feature => {
    const id = text(feature?.id);
    if (!id) throw new Error('영역 엔티티 ID가 비어 있습니다.');
    if (ids.has(id)) throw new Error(`영역 엔티티 ID가 중복되었습니다: ${id}`);
    ids.add(id);
  };
  for (const feature of countries) {
    const type = feature?.properties?.unitType;
    if (type && type !== TERRITORIAL_UNIT_TYPES.COUNTRY) {
      throw new Error('국가 저장소의 영역 종류가 일치하지 않습니다.');
    }
    register(feature);
  }
  for (const feature of units) {
    if (!UNIT_TYPES.has(feature?.properties?.unitType)) {
      throw new Error('영역 저장소의 영역 종류가 올바르지 않습니다.');
    }
    register(feature);
  }
}

function defaultWriteCountryColor(_feature, override, value) {
  const color = text(value);
  if (color) override.color = color;
  else delete override.color;
}

function defaultWriteUnitColor(feature, value) {
  feature.properties ||= {};
  feature.properties.style = { ...(feature.properties.style || {}) };
  const color = text(value);
  if (color) feature.properties.style.color = color;
  else delete feature.properties.style.color;
}

export function createTerritorialEntityStore({
  getState,
  writeCountryColor = defaultWriteCountryColor,
  writeUnitColor = defaultWriteUnitColor,
  onCountriesReplaced = () => {},
  onUnitsReplaced = () => {},
} = {}) {
  if (typeof getState !== 'function') {
    throw new TypeError('영역 엔티티 저장소에는 프로젝트 상태 공급자가 필요합니다.');
  }

  const state = () => {
    const current = getState();
    if (!current || typeof current !== 'object') throw new Error('프로젝트 상태를 읽을 수 없습니다.');
    current.countriesData ||= { type: 'FeatureCollection', features: [] };
    current.countriesData.features ||= [];
    current.countryOverrides ||= {};
    current.territorialUnits ||= [];
    return current;
  };

  const countriesData = () => state().countriesData;
  const units = () => state().territorialUnits;
  const countryOverrides = () => state().countryOverrides;

  function countryFeature(id) {
    const key = text(id);
    if (!key) return null;
    const current = state();
    const indexed = current.countryIndex?.get?.(key);
    if (indexed !== undefined) {
      const feature = current.countriesData.features?.[indexed];
      if (String(feature?.id || '') === key) return feature;
    }
    return current.countriesData.features.find(feature => String(feature?.id || '') === key) || null;
  }

  function unitFeature(id) {
    const key = text(id);
    if (!key) return null;
    return units().find(feature => String(feature?.id || '') === key) || null;
  }

  function countryOverride(id) {
    return countryOverrides()[text(id)] || {};
  }

  function rawEntity(type, id) {
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) return countryFeature(id);
    const feature = unitFeature(id);
    return feature?.properties?.unitType === type ? feature : null;
  }

  function hasField(type, id, field) {
    const key = text(id);
    if (!key) return false;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      return Object.hasOwn(countryOverride(key), field);
    }
    const feature = rawEntity(type, key);
    if (!feature) return false;
    if (field === 'color') return Object.hasOwn(feature.properties?.style || {}, 'color');
    return Object.hasOwn(feature.properties || {}, field);
  }

  function isLocked(type, id) {
    const key = text(id);
    if (!key || !rawEntity(type, key)) return false;
    return type === TERRITORIAL_UNIT_TYPES.COUNTRY
      ? countryOverride(key).locked === true
      : rawEntity(type, key).properties?.locked === true;
  }

  function setLocked(type, id, locked) {
    const key = text(id);
    const feature = rawEntity(type, key);
    if (!feature) return false;
    const next = !!locked;
    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const override = { ...countryOverride(key) };
      if (next) override.locked = true;
      else delete override.locked;
      if (Object.keys(override).length) countryOverrides()[key] = override;
      else delete countryOverrides()[key];
      return true;
    }
    feature.properties ||= {};
    feature.properties.locked = next;
    return true;
  }

  function setField(type, id, field, value) {
    const key = text(id);
    const feature = rawEntity(type, key);
    if (!feature) return false;

    if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
      const previous = countryOverride(key);
      if (field === 'flagDataUrl' && value === undefined) {
        if (!Object.hasOwn(previous, field)) return true;
        const next = { ...previous };
        delete next[field];
        if (Object.keys(next).length) countryOverrides()[key] = next;
        else delete countryOverrides()[key];
        return true;
      }

      const next = { ...previous };
      countryOverrides()[key] = next;
      if (field === 'color') writeCountryColor(feature, next, value);
      else next[field] = value;
      if (!Object.keys(next).length) delete countryOverrides()[key];
      return true;
    }

    feature.properties ||= {};
    if (field === 'color') writeUnitColor(feature, value);
    else feature.properties[field] = value;
    return true;
  }

  function appendEntities(items, { reindexOptions = {} } = {}) {
    const entries = Array.isArray(items) ? items : [];
    if (!entries.length) return { countries: [], units: [] };
    const countries = [];
    const unitValues = [];
    const overrides = {};
    for (const item of entries) {
      if (!item?.feature || typeof item.feature !== 'object') {
        throw new TypeError('추가할 영역 형식이 올바르지 않습니다.');
      }
      const type = text(item.type || item.feature.properties?.unitType);
      if (item.feature.properties?.unitType && item.feature.properties.unitType !== type) {
        throw new Error('추가할 영역의 종류와 저장 종류가 일치하지 않습니다.');
      }
      if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) {
        countries.push(item.feature);
        const key = text(item.feature?.id);
        if (key && item.countryOverride && typeof item.countryOverride === 'object') {
          overrides[key] = item.countryOverride;
        }
      } else if (UNIT_TYPES.has(type)) {
        unitValues.push(item.feature);
      } else {
        throw new Error(`지원하지 않는 영역 종류입니다: ${type || '(empty)'}`);
      }
    }

    const current = state();
    const nextOverrides = { ...current.countryOverrides };
    for (const feature of countries) {
      const key = text(feature?.id);
      const override = key ? overrides[key] : null;
      if (key && override && Object.keys(override).length) nextOverrides[key] = { ...override };
    }
    replaceCollections({
      ...(countries.length ? {
        countriesData: {
          type: 'FeatureCollection',
          features: [...current.countriesData.features, ...countries],
        },
        countryOverrides: nextOverrides,
      } : {}),
      ...(unitValues.length ? { units: [...current.territorialUnits, ...unitValues] } : {}),
    }, { reindexOptions });
    return { countries, units: unitValues };
  }

  function removeEntities(refs, { reindexOptions = {} } = {}) {
    const values = Array.isArray(refs) ? refs : [];
    const countryIds = new Set();
    const unitRefs = new Set();
    for (const ref of values) {
      const type = text(ref?.type);
      const id = text(ref?.id);
      if (!id) continue;
      if (type === TERRITORIAL_UNIT_TYPES.COUNTRY) countryIds.add(id);
      else if (UNIT_TYPES.has(type)) unitRefs.add(`${type}:${id}`);
      else throw new Error(`지원하지 않는 영역 종류입니다: ${type || '(empty)'}`);
    }

    const current = state();
    const deletedCountries = current.countriesData.features.filter(feature => countryIds.has(text(feature?.id)));
    const matchesUnit = feature => unitRefs.has(`${feature?.properties?.unitType}:${text(feature?.id)}`);
    const deletedUnits = current.territorialUnits.filter(matchesUnit);
    if (!deletedCountries.length && !deletedUnits.length) return { countries: [], units: [] };

    const nextOverrides = { ...current.countryOverrides };
    for (const id of countryIds) delete nextOverrides[id];
    replaceCollections({
      ...(deletedCountries.length ? {
        countriesData: {
          type: 'FeatureCollection',
          features: current.countriesData.features.filter(feature => !countryIds.has(text(feature?.id))),
        },
        countryOverrides: nextOverrides,
      } : {}),
      ...(deletedUnits.length ? {
        units: current.territorialUnits.filter(feature => !matchesUnit(feature)),
      } : {}),
    }, { reindexOptions });
    return { countries: deletedCountries, units: deletedUnits };
  }

  function replaceCollections({
    countriesData: nextCountriesData = null,
    units: nextUnits = null,
    countryOverrides: nextCountryOverrides = undefined,
  } = {}, {
    pruneOverrides = true,
    reindexOptions = {},
  } = {}) {
    const current = state();
    const hasCountryReplacement = nextCountriesData !== null;
    const hasUnitReplacement = nextUnits !== null;
    let replacementCountries = current.countriesData;
    if (hasCountryReplacement) {
      if (Array.isArray(nextCountriesData)) {
        replacementCountries = { type: 'FeatureCollection', features: nextCountriesData };
      } else if (nextCountriesData?.type === 'FeatureCollection' && Array.isArray(nextCountriesData.features)) {
        replacementCountries = nextCountriesData;
      } else {
        throw new TypeError('국가 저장소에는 FeatureCollection 또는 features 배열이 필요합니다.');
      }
    }
    const replacementUnits = hasUnitReplacement ? nextUnits : current.territorialUnits;

    // Validate the complete candidate, including unchanged storage, before
    // publishing any collection or override. Same-ID type conversion is valid
    // when the source removal and destination addition are committed together.
    if (hasCountryReplacement || hasUnitReplacement) {
      validateCollectionIdentity(replacementCountries.features, replacementUnits);
    }

    let replacementOverrides = current.countryOverrides;
    if (nextCountryOverrides !== undefined) {
      replacementOverrides = nextCountryOverrides && typeof nextCountryOverrides === 'object'
        ? { ...nextCountryOverrides }
        : {};
    }
    if (hasCountryReplacement && pruneOverrides) {
      replacementOverrides = { ...replacementOverrides };
      const valid = new Set(replacementCountries.features.map(feature => text(feature.id)));
      for (const id of Object.keys(replacementOverrides)) if (!valid.has(id)) delete replacementOverrides[id];
    }

    current.countryOverrides = replacementOverrides;
    if (hasCountryReplacement) current.countriesData = replacementCountries;
    if (hasUnitReplacement) current.territorialUnits = replacementUnits;

    if (hasCountryReplacement) {
      onCountriesReplaced(
        current.countriesData,
        current.countriesData.features.map(feature => text(feature?.id)).filter(Boolean),
        reindexOptions,
      );
    }
    if (hasUnitReplacement) onUnitsReplaced(current.territorialUnits);

    return {
      countriesData: current.countriesData,
      countryOverrides: current.countryOverrides,
      units: current.territorialUnits,
    };
  }

  return Object.freeze({
    appendEntities,
    countriesData,
    countryFeature,
    countryOverride,
    countryOverrides,
    hasField,
    isLocked,
    rawEntity,
    removeEntities,
    replaceCollections,
    setField,
    setLocked,
    unitFeature,
    units,
  });
}
