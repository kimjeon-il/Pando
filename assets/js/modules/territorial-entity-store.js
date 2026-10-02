import { TERRITORIAL_UNIT_TYPES } from './territorial-units.js';

const text = value => String(value ?? '').trim();

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

  function replaceCountries(collection) {
    const next = collection?.type === 'FeatureCollection'
      ? collection
      : { type: 'FeatureCollection', features: Array.isArray(collection) ? collection : [] };
    state().countriesData = next;
    onCountriesReplaced(next, next.features.map(feature => text(feature?.id)).filter(Boolean));
    return state().countriesData;
  }

  function appendCountries(features, overrides = {}) {
    const additions = Array.isArray(features) ? features.filter(Boolean) : [];
    if (!additions.length) return [];
    const current = state();
    current.countriesData.features = [...current.countriesData.features, ...additions];
    for (const feature of additions) {
      const key = text(feature?.id);
      const override = key ? overrides?.[key] : null;
      if (key && override && typeof override === 'object' && Object.keys(override).length) {
        current.countryOverrides[key] = { ...override };
      }
    }
    onCountriesReplaced(current.countriesData, additions.map(feature => text(feature?.id)).filter(Boolean));
    return additions;
  }

  function appendUnits(features) {
    const additions = Array.isArray(features) ? features.filter(Boolean) : [];
    if (!additions.length) return [];
    const current = state();
    current.territorialUnits = [...current.territorialUnits, ...additions];
    onUnitsReplaced(current.territorialUnits);
    return additions;
  }

  function removeCountries(ids) {
    const removed = new Set((ids || []).map(text).filter(Boolean));
    if (!removed.size) return [];
    const current = state();
    const deleted = current.countriesData.features.filter(feature => removed.has(text(feature?.id)));
    if (!deleted.length) return [];
    current.countriesData.features = current.countriesData.features.filter(feature => !removed.has(text(feature?.id)));
    for (const id of removed) delete current.countryOverrides[id];
    onCountriesReplaced(current.countriesData, [...removed]);
    return deleted;
  }

  function removeUnits(ids) {
    const removed = new Set((ids || []).map(text).filter(Boolean));
    if (!removed.size) return [];
    const current = state();
    const deleted = current.territorialUnits.filter(feature => removed.has(text(feature?.id)));
    if (!deleted.length) return [];
    current.territorialUnits = current.territorialUnits.filter(feature => !removed.has(text(feature?.id)));
    onUnitsReplaced(current.territorialUnits);
    return deleted;
  }

  function replaceUnits(nextUnits) {
    if (!Array.isArray(nextUnits)) throw new TypeError('하위 영역 저장값은 배열이어야 합니다.');
    state().territorialUnits = nextUnits;
    onUnitsReplaced(nextUnits);
    return nextUnits;
  }

  return Object.freeze({
    appendCountries,
    appendUnits,
    countriesData,
    countryFeature,
    countryOverride,
    hasField,
    isLocked,
    rawEntity,
    removeCountries,
    replaceCountries,
    removeUnits,
    replaceUnits,
    setField,
    setLocked,
    unitFeature,
    units,
  });
}
