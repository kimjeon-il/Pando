import { normalizeCountryGeometry, multiCoordinates, area } from './map-edit-geometry.js';
import './territorial-edit-plan.js';
import { territorialSegmentCandidates } from './geometry-segment-index.js';
import { createTerritorialGeometryKernel } from './territorial-geometry.js';
import { validateGeometry } from './geometry-validation.js';

export function calculateTerritorialEdit(payload, countries, units, clipper) {
  return globalThis.PandoLabTerritorialEdit.createKernel(clipper, { normalize: normalizeCountryGeometry, segmentCandidates: territorialSegmentCandidates }).plan({ ...payload, countries, units });
}

export function calculateRegionMerge(source, targets, clipper) {
  if (!source || targets.some(feature => !feature) || [source, ...targets].some(feature => feature.properties?.locked || feature.properties?.unitType !== 'region')) throw new Error('합칠 지방이 변경되었거나 잠겨 있습니다.');
  return createTerritorialGeometryKernel(clipper).mergeUnits(source, targets);
}

export function calculateRegionRedraw(source, container, siblings, draft, clipper) {
  if (!source || !container || source.properties?.locked || source.properties?.unitType !== 'region') throw new Error('지방 편집 대상이 변경되었습니다.');
  const geometry = normalizeCountryGeometry({ type: 'MultiPolygon', coordinates: clipper.intersection(draft.coordinates, container.geometry.coordinates) });
  if (!geometry) throw new Error('그린 영역이 상위 영역 안에 없습니다.');
  for (const sibling of siblings) {
    if (!sibling) throw new Error('다른 지방이 변경되었습니다.');
    if (area(clipper.intersection(geometry.coordinates, sibling.geometry.coordinates)) > 1e-9) throw new Error('다른 지방과 영역이 겹칩니다.');
  }
  return { feature: { ...source, geometry } };
}

export function calculateDrawnGeometry(payload, clipper) {
  const draft = normalizeCountryGeometry(payload.draft);
  if (!draft) throw new Error('그린 영역을 닫힌 Polygon으로 만들 수 없습니다.');
  const issues = validateGeometry({ type: 'Feature', id: 'draft', properties: {}, geometry: draft });
  if (issues.length) throw new Error(issues[0].message);
  const source = payload.source;
  const geometry = source ? normalizeCountryGeometry({ type: 'MultiPolygon', coordinates: clipper.intersection(multiCoordinates(draft), multiCoordinates(source)) }) : draft;
  if (!geometry) throw new Error('그린 영역이 기준 영역 안에 없습니다.');
  return { geometry };
}
