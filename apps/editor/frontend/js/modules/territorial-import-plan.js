import { sharedCalculationCore } from '../../../../../shared/frontend/js/modules/temporal.js';

const clone = value => value == null ? value : structuredClone(value);
const text = (value, fallback = '') => String(value ?? '').trim() || fallback;

function polygonCoordinates(geometry) {
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  return [];
}

function geometryFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  return { type: 'MultiPolygon', coordinates: clone(coordinates) };
}

function countryId(feature) {
  return text(feature?.id);
}

const normalizedCountryValue = value => text(value).toLocaleLowerCase('ko');

function countryLookupInputs(countries) {
  const rows = countries || [];
  const ids = rows.map(countryId);
  return { ids, normalizedIds: ids.map(normalizedCountryValue),
    normalizedNames: rows.map(feature => normalizedCountryValue(feature?.properties?.name)) };
}

function resolveCountryValues(values, countries) {
  if (typeof sharedCalculationCore.resolveGisCountryNames !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS country resolver is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const { ids, normalizedIds, normalizedNames } = countryLookupInputs(countries);
  const indexes = sharedCalculationCore.resolveGisCountryNames(ids, normalizedIds, normalizedNames, values.map(normalizedCountryValue));
  return indexes.map(index => index < 0 ? '' : ids[index]);
}

export function resolveImportedCountryId(value, countries = []) {
  return resolveCountryValues([value], countries)[0];
}

function importedName(feature, index) {
  const properties = feature?.properties || {};
  return text(properties.name || properties.pandolab_name || properties.NAME_KO || properties.NAME_0 || properties.NAME || feature?.id, `객체 ${index + 1}`);
}

function prepareImportedCountries(features, {
  countries = [], targetCountryId = '', useFeatureCountryField = false, countryField = '',
} = {}) {
  const items = features || [];
  const fieldValues = items.map(feature => useFeatureCountryField && countryField ? feature?.properties?.[countryField] : '');
  if (typeof sharedCalculationCore.planGisCountryAssignments !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS country assignment planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const { ids, normalizedIds, normalizedNames } = countryLookupInputs(countries);
  const plan = sharedCalculationCore.planGisCountryAssignments(ids, normalizedIds, normalizedNames,
    normalizedCountryValue(targetCountryId), fieldValues.map(normalizedCountryValue), fieldValues.map(value => !!text(value)));
  const assignments = items.map((feature, index) => {
    const fieldValue = fieldValues[index];
    const decision = plan.assignments[index];
    return {
      feature,
      index,
      name: importedName(feature, index),
      countryId: decision.index < 0 ? '' : ids[decision.index],
      usedFallback: decision.usedFallback,
      unresolvedValue: decision.unresolvedField ? text(fieldValue) : '',
    };
  });
  return { assignments, groups: plan.groups, countryIds: ids };
}

export function assignImportedCountries(features, options = {}) {
  return prepareImportedCountries(features, options).assignments;
}

export function buildTerritorialImportTransactionPlan({
  features = [], countries = [], targetCountryId = '', useFeatureCountryField = false,
  countryField = '',
} = {}) {
  if (typeof sharedCalculationCore.planGisTerritoryGeometry !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS territory planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const polygonFeatures = features.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!polygonFeatures.length) throw new Error('가져올 Polygon 또는 MultiPolygon 객체가 없습니다.');
  const { assignments, groups: grouped, countryIds } = prepareImportedCountries(polygonFeatures, { countries, targetCountryId, useFeatureCountryField, countryField });
  const unresolved = assignments.filter(item => !item.countryId);
  if (unresolved.length) {
    const values = [...new Set(unresolved.map(item => item.unresolvedValue).filter(Boolean))];
    throw new Error(values.length
      ? `객체별 소속 국가 값 "${values.slice(0, 3).join(', ')}"을(를) 현재 지도에서 찾을 수 없습니다.`
      : `소속 국가를 정하지 못한 객체가 ${unresolved.length}개 있습니다.`);
  }

  const plan = sharedCalculationCore.planGisTerritoryGeometry(countryIds, countries.map(country => !!country?.geometry),
    countries.map(country => polygonCoordinates(country?.geometry)), polygonFeatures.map(feature => polygonCoordinates(feature.geometry)), grouped);
  if (plan.status === 'overlap') throw new Error(`가져올 객체끼리 겹칩니다: ${assignments[plan.left].name} · ${assignments[plan.right].name}`);
  if (plan.status === 'missing-owner') throw new Error(`소속 국가 ${countryIds[plan.missing]}을(를) 현재 지도에서 찾을 수 없습니다.`);
  if (plan.status !== 'valid') throw new Error('Unknown C++ GIS territory plan result.');
  const groups = plan.groups.map(group => {
    const donors = group.donors.map(donor => ({ countryId: countryIds[donor.index], areaKm2: donor.area, fullyAbsorbed: donor.absorbed }));
    return { targetCountryId: countryIds[group.index], importedGeometry: geometryFromCoordinates(group.geometry),
      importedAreaKm2: group.importedArea, featureIndexes: group.features, donorIds: donors.map(donor => donor.countryId),
      donors, existingOwnerAreaKm2: group.existingArea, newAreaKm2: group.newArea,
      absorbedCountryIds: donors.filter(donor => donor.fullyAbsorbed).map(donor => donor.countryId) };
  });

  return {
    assignments: assignments.map(({ feature: _feature, ...item }) => item),
    groups,
    featureCount: assignments.length,
    totalAreaKm2: plan.totalArea,
    transferAreaKm2: plan.transferArea,
    existingOwnerAreaKm2: plan.existingArea,
    newAreaKm2: plan.newArea,
    absorbedCountryIds: plan.absorbed.map(index => countryIds[index]),
    unresolvedCountryValueCount: assignments.filter(item => item.unresolvedValue).length,
  };
}
