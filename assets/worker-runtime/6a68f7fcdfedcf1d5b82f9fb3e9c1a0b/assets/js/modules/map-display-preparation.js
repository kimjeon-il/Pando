import { territorialRootId } from './territorial-units.js';
import { buildTerritorialInternalBoundarySegments } from './boundary-topology.js';
import { excludeAncestorHighlightBoundary } from './territorial-highlight-boundary.js';
import { geometryRevisionKey } from './geometry-versions.js';

export function createMapDisplayPreparation() {
  const groups = new Map();
  const signature = features => features.map(feature => [feature.id, geometryRevisionKey(feature.geometry), feature.properties?.entityKind,
    feature.properties?.parentId, undefined].join(':')).sort().join('|');
  return {
    async prepare(request, countries, units, checkpoint = async () => {}) {
      if (request.kind === 'highlight') {
        const feature=request.feature;
        const owners=request.occluders.map(owner=>owner.feature);
        if (!feature || owners.some(owner => !owner)) throw new Error('강조 원본을 다시 준비하세요.');
        await checkpoint();
        return { feature: excludeAncestorHighlightBoundary(feature, owners) };
      }
      if (request.entities) {
        countries = request.entities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId);
        units = request.entities.filter(entity => entity.properties.entityKind === 'regional');
      }
      const countryById = new Map(countries.map(feature => [String(feature.id), feature]));
      const grouped = new Map();
      const entities = new Map([...countries, ...units].map(feature => [String(feature.id), feature]));
      const hasIndependentRegions = units.some(unit => !(unit.properties?.entityKind === 'general' && !!unit.properties?.parentId));
      for (const unit of units) {
        // Independent regions can cross countries; preserve that existing rule.
        const key = hasIndependentRegions ? '*' : territorialRootId(unit, id => entities.get(id));
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(unit);
      }
      const segments = [];
      for (const [key, members] of grouped) {
        await checkpoint();
        const parents = key === '*' ? countries : [countryById.get(key)].filter(Boolean);
        const input = signature([...parents, ...members]);
        let entry = groups.get(key);
        if (entry?.input !== input) {
          entry = { input, segments: buildTerritorialInternalBoundarySegments(parents, members) };
          groups.set(key, entry);
        }
        segments.push(...entry.segments);
      }
      for (const key of groups.keys()) if (!grouped.has(key)) groups.delete(key);
      return { segments };
    },
  };
}
