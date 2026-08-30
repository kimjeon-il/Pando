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
  return text(feature?.properties?.editor_id || feature?.properties?.iso_a3 || feature?.id);
}

function countryNames(feature) {
  const properties = feature?.properties || {};
  return [
    countryId(feature), properties.editor_name, properties.editor_original_name,
    properties.name, properties.NAME, properties.iso_a3, properties.ADM0_A3,
  ].map(value => text(value).toLocaleLowerCase('ko')).filter(Boolean);
}

export function resolveImportedCountryId(value, countries = []) {
  const wanted = text(value).toLocaleLowerCase('ko');
  if (!wanted) return '';
  const matches = [...new Set((countries || [])
    .filter(feature => countryNames(feature).includes(wanted))
    .map(countryId)
    .filter(Boolean))];
  return matches.length === 1 ? matches[0] : '';
}

function importedName(feature, index) {
  const properties = feature?.properties || {};
  return text(properties.name || properties.NAME || properties.pandolab_name || feature?.id, `객체 ${index + 1}`);
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

export function assignImportedCountries(features, {
  countries = [], targetCountryId = '', useFeatureCountryField = false, countryField = '',
} = {}) {
  const fallbackId = resolveImportedCountryId(targetCountryId, countries);
  return (features || []).map((feature, index) => {
    const fieldValue = useFeatureCountryField && countryField ? feature?.properties?.[countryField] : '';
    const resolved = resolveImportedCountryId(fieldValue, countries);
    const hasFieldValue = !!text(fieldValue);
    const assignedCountryId = hasFieldValue ? resolved : fallbackId;
    return {
      feature,
      index,
      name: importedName(feature, index),
      countryId: assignedCountryId,
      usedFallback: !hasFieldValue && !!fallbackId,
      unresolvedValue: hasFieldValue && !resolved ? text(fieldValue) : '',
    };
  });
}

export function buildTerritorialImportTransactionPlan({
  features = [], countries = [], targetCountryId = '', useFeatureCountryField = false,
  countryField = '', clipper, areaKm2 = () => 0,
} = {}) {
  if (!clipper?.intersection || !clipper?.union || !clipper?.difference) throw new Error('영토 계산 엔진을 사용할 수 없습니다.');
  const polygonFeatures = features.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!polygonFeatures.length) throw new Error('가져올 Polygon 또는 MultiPolygon 객체가 없습니다.');
  const assignments = assignImportedCountries(polygonFeatures, { countries, targetCountryId, useFeatureCountryField, countryField });
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
      const smallerArea = Math.max(1, Math.min(areaKm2(left.feature.geometry), areaKm2(right.feature.geometry)));
      if (overlap && areaKm2(overlap) > Math.max(0.000001, smallerArea * 1e-9)) {
        throw new Error(`가져올 객체끼리 겹칩니다: ${left.name} · ${right.name}`);
      }
    }
  }

  const grouped = new Map();
  for (const assignment of assignments) {
    if (!grouped.has(assignment.countryId)) grouped.set(assignment.countryId, []);
    grouped.get(assignment.countryId).push(assignment);
  }

  const countryIndex = new Map(countries.map(feature => [countryId(feature), feature]));
  const groups = [];
  for (const [ownerId, items] of grouped) {
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
      if (overlapAreaKm2 <= Math.max(0.000001, importedAreaKm2 * 1e-10)) continue;
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
        fullyAbsorbed: !remainder || areaKm2(remainder) <= Math.max(0.000001, overlapAreaKm2 * 1e-10),
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
