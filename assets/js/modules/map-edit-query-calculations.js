import { normalizeCountryGeometry, multiCoordinates, geometryBounds, boundsOverlap, featureId } from './map-edit-geometry.js';
import './territorial-edit-plan.js';
import { analyzeAdminCountryCoast } from './coast-reconciliation.js';

export function calculateLandClip(feature, countries, clipper) {
  if (!feature) throw new Error('영역 객체를 찾을 수 없습니다.');
  const owner = countries.find(country => featureId(country) === String(feature.properties?.ownerId || ''));
  const bounds = geometryBounds(feature.geometry);
  const nearby = owner ? [owner] : countries;
  const pieces = [];
  for (const country of nearby) {
    if (!boundsOverlap(bounds, geometryBounds(country.geometry))) continue;
    pieces.push(...clipper.intersection(multiCoordinates(feature.geometry), multiCoordinates(country.geometry)));
  }
  return { geometry: normalizeCountryGeometry(pieces) };
}

export function calculateParents(feature, candidates, clipper) {
  if (!feature) throw new Error('하위단위를 찾을 수 없습니다.');
  return { ids: candidates.filter(({ parent }) => parent?.geometry
    && clipper.difference(multiCoordinates(feature.geometry), multiCoordinates(parent.geometry)).length === 0).map(({ id }) => id) };
}

export function calculateUncoveredSource(parent, children, clipper) {
  if (!parent) throw new Error('상위 단위를 찾을 수 없습니다.');
  const occupied = children.length ? clipper.union(...children.map(feature => multiCoordinates(feature.geometry))) : [];
  return { geometry: normalizeCountryGeometry({ type: 'MultiPolygon', coordinates: occupied.length
    ? clipper.difference(multiCoordinates(parent.geometry), occupied) : multiCoordinates(parent.geometry) }) };
}

export function calculateCoastAvailability(unit, country, countryTopology, clipper) {
  const kernel = globalThis.PandoLabTerritorialEdit.createKernel(clipper);
  const coastal = [...countryTopology.segments.values()].some(segment => segment.kind === 'coast'
    && segment.ownerIds.has(featureId(country)) && kernel.adjacent(unit.geometry,
      { type: 'Polygon', coordinates: [[segment.a, segment.b]] }));
  const analysis = analyzeAdminCountryCoast({ adminFeature: unit, countryFeature: country, countryTopology });
  return { coastal, reconciliation: analysis.status !== 'unavailable' && !!analysis.conflicts?.length };
}
