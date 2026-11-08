// GIS country identity and overlay planning delegated to the shared C++ Core.
// No Worker, DOM, editor state, or project mutation owner.
import {sharedCalculationCore} from "../../src/document/temporal.js";

const text = value => String(value ?? '');

export function createCountryImportMergePlanner({
  clipper,
  clone,
  featureCountryId,
  countryName,
  geometryBounds,
  boundsOverlap,
  normalizeGeometry,
  geometryCoordinates,
  planarArea,
  areaKm2,
  validateCountryCollection,
}) {
  function mergeImportedCountryProperties(existing, imported, geometry) {
    const importedId = text(existing?.id || imported?.id);
    const existingProperties = existing?.properties || {};
    const importedProperties = imported?.properties || {};
    const properties = {
      name: text(existingProperties.name || importedProperties.name || importedId),
    };
    const validFrom = text(existingProperties.validFrom || importedProperties.validFrom);
    const validTo = text(existingProperties.validTo || importedProperties.validTo);
    if (validFrom) properties.validFrom = validFrom;
    if (validTo) properties.validTo = validTo;
    return {
      type: 'Feature',
      id: importedId,
      properties,
      geometry,
    };
  }

  return async function planMerge(currentCountries, importedCountries, strategy) {
    if (!clipper?.union || !clipper?.difference || !clipper?.intersection) throw new Error('국가 병합 연산 엔진을 불러오지 못했습니다.');
    // Only an affected wrapper is written; source geometries remain read-only.
    const current = (currentCountries?.features || []).map(feature => ({ ...feature }));
    const imported = (clone(importedCountries)?.features || []).map((feature, index) => {
      feature.id = featureCountryId(feature, index);
      return feature;
    });
    const incomingIds = imported.map(feature => text(feature?.id));
    if (typeof sharedCalculationCore.planGisCountryMerge !== 'function') {
      throw Object.assign(new Error('Canonical C++ GIS country merge planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    const identityPlan = sharedCalculationCore.planGisCountryMerge(current.map(feature => text(feature?.id)), incomingIds);
    if (identityPlan.status === 'empty') throw new Error('병합할 국가 객체가 없습니다.');
    if (identityPlan.status === 'invalid-ids') {
      throw new Error('가져온 국가 ID 연결 결과가 비어 있거나 중복되었습니다.');
    }
    if (identityPlan.status !== 'valid') throw new Error('Unknown C++ GIS country merge plan result.');
    const affectedIds = new Set(incomingIds);
    const matched = identityPlan.matched;
    const counts = {
      matched,
      added: imported.length - matched,
      replaced: 0,
      subtracted: 0,
      deleted: 0,
      overlapAreaKm2: 0,
      residualOverlapAreaKm2: 0,
    };
    let result;
    if (typeof sharedCalculationCore.planGisCountryGeometry !== 'function'
        || typeof sharedCalculationCore.gisCountryMergeCanCommit !== 'function') {
      throw Object.assign(new Error('Canonical C++ GIS geometry planner is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    let importedRawUnion, importedBounds, overlap;
    const incomingBounds = [], remainders = new Map();
    const operations = {
      prepare() {
        importedRawUnion = normalizeGeometry(clipper.union(...imported.map(feature => feature.geometry.coordinates)));
        if (!importedRawUnion) throw new Error('가져온 영토를 결합할 수 없습니다.');
      },
      bounds(index, currentIndex) {
        const existing = current[currentIndex];
        return index >= 0
          ? boundsOverlap(incomingBounds[index] ??= geometryBounds(imported[index].geometry), geometryBounds(existing.geometry))
          : boundsOverlap(geometryBounds(existing.geometry), importedBounds ??= geometryBounds(importedRawUnion));
      },
      intersection(index, currentIndex) {
        const existing = current[currentIndex];
        overlap = index >= 0
          ? normalizeGeometry(clipper.intersection(imported[index].geometry.coordinates, existing.geometry.coordinates))
          : normalizeGeometry(clipper.intersection(existing.geometry.coordinates, importedRawUnion.coordinates));
        return overlap ? planarArea(geometryCoordinates(overlap)) : null;
      },
      area() { return areaKm2(overlap); },
      subtract(index) {
        const remainder = normalizeGeometry(clipper.difference(current[index].geometry.coordinates, importedRawUnion.coordinates));
        remainders.set(index, remainder);
        return !!remainder;
      },
    };

    if (strategy === 'id-replace') {
      counts.replaced = matched;
      const unaffected = identityPlan.unaffected.map(index => current[index]);
      result = [...unaffected];
      result.push(...imported.map((feature, index) => mergeImportedCountryProperties(
        identityPlan.existing[index] < 0 ? undefined : current[identityPlan.existing[index]],
        feature,
        clone(feature.geometry),
      )));
      counts.overlapAreaKm2 = sharedCalculationCore.planGisCountryGeometry(imported.length, identityPlan.unaffected, true, operations).overlapAreaKm2;
      return {
        countriesData: { type: 'FeatureCollection', features: result },
        counts,
        affectedIds: [...affectedIds],
        canCommit: sharedCalculationCore.gisCountryMergeCanCommit(counts.overlapAreaKm2),
      };
    }

    const geometryPlan = sharedCalculationCore.planGisCountryGeometry(imported.length, identityPlan.unaffected, false, operations);
    counts.overlapAreaKm2 = geometryPlan.overlapAreaKm2;
    const donorIds = [];
    result = [];
    const donors = new Map(geometryPlan.donors.map(row => [row.index, row]));
    for (const currentIndex of identityPlan.unaffected) {
      const existing = current[currentIndex];
      const id = text(existing?.id);
      const donor = donors.get(currentIndex);
      if (!donor) {
        result.push(existing);
        continue;
      }
      affectedIds.add(id);
      donorIds.push(id);
      counts.subtracted += 1;
      if (donor.removed) {
        counts.deleted += 1;
        continue;
      }
      existing.geometry = remainders.get(currentIndex);
      result.push(existing);
    }
    for (const [index, incoming] of imported.entries()) {
      const existing = identityPlan.existing[index] < 0 ? undefined : current[identityPlan.existing[index]];
      const geometry = clone(incoming.geometry);
      if (!geometry) throw new Error(`${countryName(incoming)} 영토를 결합할 수 없습니다.`);
      result.push(mergeImportedCountryProperties(existing, incoming, geometry));
    }
    const countriesData = { type: 'FeatureCollection', features: result };
    counts.residualOverlapAreaKm2 = (await validateCountryCollection(countriesData, affectedIds)).overlapAreaKm2;
    return {
      countriesData,
      counts,
      affectedIds: [...affectedIds],
      donorIds,
      transferredGeometry: clone(importedRawUnion),
      canCommit: sharedCalculationCore.gisCountryMergeCanCommit(counts.residualOverlapAreaKm2),
    };
  };
}
