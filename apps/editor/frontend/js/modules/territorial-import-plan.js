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

function intersectionGeometry(clipper, left, right) {
  const coordinates = clipper.intersection(polygonCoordinates(left), polygonCoordinates(right));
  return geometryFromCoordinates(coordinates);
}

function unionGeometries(clipper, geometries) {
  const coordinates = geometries.map(polygonCoordinates).filter(item => item.length);
  if (!coordinates.length) return null;
  return geometryFromCoordinates(coordinates.length === 1 ? coordinates[0] : clipper.union(...coordinates));
}

function differenceGeometry(clipper, left, right) {
  if (!left) return null;
  if (!right) return clone(left);
  return geometryFromCoordinates(clipper.difference(polygonCoordinates(left), polygonCoordinates(right)));
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
  return { assignments, groups: plan.groups.map(group => ({ countryId: ids[group.index],
    items: group.features.map(index => assignments[index]) })) };
}

export function assignImportedCountries(features, options = {}) {
  return prepareImportedCountries(features, options).assignments;
}

export function buildTerritorialImportTransactionPlan({
  features = [], countries = [], targetCountryId = '', useFeatureCountryField = false,
  countryField = '', clipper, areaKm2 = () => 0,
} = {}) {
  if (!clipper?.intersection || !clipper?.union || !clipper?.difference) throw new Error('영토 계산 엔진을 사용할 수 없습니다.');
  const polygonFeatures = features.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!polygonFeatures.length) throw new Error('가져올 Polygon 또는 MultiPolygon 객체가 없습니다.');
  const { assignments, groups: grouped } = prepareImportedCountries(polygonFeatures, { countries, targetCountryId, useFeatureCountryField, countryField });
  const unresolved = assignments.filter(item => !item.countryId);
  if (unresolved.length) {
    const values = [...new Set(unresolved.map(item => item.unresolvedValue).filter(Boolean))];
    throw new Error(values.length
      ? `객체별 소속 국가 값 "${values.slice(0, 3).join(', ')}"을(를) 현재 지도에서 찾을 수 없습니다.`
      : `소속 국가를 정하지 못한 객체가 ${unresolved.length}개 있습니다.`);
  }

  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
      const left = assignments[leftIndex];
      const right = assignments[rightIndex];
      const overlap = intersectionGeometry(clipper, left.feature.geometry, right.feature.geometry);
      const leftArea = areaKm2(left.feature.geometry), rightArea = areaKm2(right.feature.geometry);
      if (overlap && sharedCalculationCore.gisTerritorialAreaDecision('input-overlap', areaKm2(overlap), leftArea, rightArea)) {
        throw new Error(`가져올 객체끼리 겹칩니다: ${left.name} · ${right.name}`);
      }
    }
  }

  const countryIndex = new Map(countries.map(feature => [countryId(feature), feature]));
  const groups = [];
  for (const { countryId: ownerId, items } of grouped) {
    const target = countryIndex.get(ownerId);
    if (!target?.geometry) throw new Error(`소속 국가 ${ownerId}을(를) 현재 지도에서 찾을 수 없습니다.`);
    const importedGeometry = unionGeometries(clipper, items.map(item => item.feature.geometry));
    const importedAreaKm2 = areaKm2(importedGeometry);
    const coveredParts = [];
    const donors = [];
    let existingOwnerAreaKm2 = 0;
    for (const country of countries) {
      if (!country?.geometry) continue;
      const overlapGeometry = intersectionGeometry(clipper, importedGeometry, country.geometry);
      if (!overlapGeometry) continue;
      const overlapAreaKm2 = areaKm2(overlapGeometry);
      if (!sharedCalculationCore.gisTerritorialAreaDecision('country-overlap', overlapAreaKm2, importedAreaKm2, 0)) continue;
      coveredParts.push(overlapGeometry);
      const id = countryId(country);
      if (id === ownerId) {
        existingOwnerAreaKm2 += overlapAreaKm2;
        continue;
      }
      const remainder = differenceGeometry(clipper, country.geometry, importedGeometry);
      donors.push({
        countryId: id,
        areaKm2: overlapAreaKm2,
        fullyAbsorbed: !remainder || sharedCalculationCore.gisTerritorialAreaDecision('absorbed', areaKm2(remainder), overlapAreaKm2, 0),
      });
    }
    const covered = unionGeometries(clipper, coveredParts);
    const unclaimedGeometry = differenceGeometry(clipper, importedGeometry, covered);
    const newAreaKm2 = unclaimedGeometry ? areaKm2(unclaimedGeometry) : 0;
    groups.push({
      targetCountryId: ownerId,
      importedGeometry,
      importedAreaKm2,
      featureIndexes: items.map(item => item.index),
      donorIds: donors.map(item => item.countryId),
      donors,
      existingOwnerAreaKm2,
      newAreaKm2,
      absorbedCountryIds: donors.filter(item => item.fullyAbsorbed).map(item => item.countryId),
    });
  }

  return {
    assignments: assignments.map(({ feature: _feature, ...item }) => item),
    groups,
    featureCount: assignments.length,
    totalAreaKm2: groups.reduce((sum, group) => sum + group.importedAreaKm2, 0),
    transferAreaKm2: groups.reduce((sum, group) => sum + group.donors.reduce((donorSum, donor) => donorSum + donor.areaKm2, 0), 0),
    existingOwnerAreaKm2: groups.reduce((sum, group) => sum + group.existingOwnerAreaKm2, 0),
    newAreaKm2: groups.reduce((sum, group) => sum + group.newAreaKm2, 0),
    absorbedCountryIds: [...new Set(groups.flatMap(group => group.absorbedCountryIds))],
    unresolvedCountryValueCount: assignments.filter(item => item.unresolvedValue).length,
  };
}
