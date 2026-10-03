import { createTerritorialFeature } from './territorial-units.js';
const text = value => String(value ?? '').trim();
export const countryId = feature => text(feature?.id);
export const countryName = feature => text(feature?.properties?.name) || countryId(feature) || '국가';
// Source asset/GIS ingress: raw country attributes become common entity metadata.
export function normalizeCountryFeature(feature, { id = countryId(feature), name = '', clone = structuredClone } = {}) {
  const source = feature?.properties || {};
  const entity = createTerritorialFeature({ id: text(id), unitType: 'country',
    name: name || (source.unitType === 'country' ? source.name ?? '' : source.name || id),
    geometry: feature.geometry, validFrom: source.validFrom ?? null, validTo: source.validTo ?? null,
    notes: source.notes || '', color: source.style?.color || '', locked: source.locked === true,
    metadata: source.unitType === 'country' ? source.metadata : { ...source.metadata, sourceProperties: clone(source) },
    sourceFolderId: source.sourceFolderId, sourceLibraryId: source.sourceLibraryId, sourceGeometryVersion: source.sourceGeometryVersion });
  if (source.unitType === 'country') entity.properties.style = clone(source.style || {});
  return entity;
}

export const normalizeCountryCollection = collection => ({ type: 'FeatureCollection', features: (collection?.features || []).map(feature => normalizeCountryFeature(feature)) });
