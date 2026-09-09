/** TerritoryComponents: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritoryComponents() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('territory-components already connected');
    dependencies = ports;
  }

  function geometryMultiCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function multiPolygonPlanarArea(multiPolygon) {
    return (multiPolygon || []).reduce((total, polygon) => {
      if (!polygon?.length) return total;
      const exterior = Math.abs((0, dependencies.ringSignedArea)((0, dependencies.ensureClosedRing)(polygon[0])));
      const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs((0, dependencies.ringSignedArea)((0, dependencies.ensureClosedRing)(ring))), 0);
      return total + Math.max(0, exterior - holes);
    }, 0);
  }

  function territoryComponentKey(countryId, polygonIndex) {
    return `component:${String(countryId)}:${Number(polygonIndex)}`;
  }

  function territoryComponentContext() {
    if (dependencies.state.tool === 'annex-territory') {
      const donorIds = new Set(dependencies.state.annexDonorCountryIds.map(String));
      return {
        selectedKeys: dependencies.state.annexSelectedComponentKeys,
        features: (dependencies.state.countriesData?.features || []).filter(feature => donorIds.has(String(feature?.id || ''))),
      };
    }
    if (dependencies.state.tool === 'new-country') {
      const sourceIds = new Set(dependencies.state.newCountrySourceIds.map(String));
      return {
        selectedKeys: dependencies.state.newCountrySelectedComponentKeys,
        features: (dependencies.state.countriesData?.features || []).filter(feature => sourceIds.has(String(feature?.id || ''))),
      };
    }
    return { selectedKeys: [], features: [] };
  }

  function territoryBaseComponentItems(context = territoryComponentContext()) {
    const items = [];
    for (const feature of context.features) {
      const countryId = String(feature?.id || '');
      (0, dependencies.geometryPolygonSets)(feature.geometry).forEach((polygon, polygonIndex) => {
        const geometry = (0, dependencies.normalizeClippedLandGeometry)([(0, dependencies.deepClone)(polygon)]);
        if (!geometry) return;
        const key = territoryComponentKey(countryId, polygonIndex);
        const areaKm2 = Math.max(0, dependencies.d3.geo.area(geometry) * 6371.0088 * 6371.0088);
        items.push({
          key, countryId, polygonIndex, componentKey: `${countryId}:${polygonIndex}`, geometry, areaKm2,
          countryName: (0, dependencies.countryName)(feature),
        });
      });
    }
    return items;
  }

  function annexRiverBoundaryComposition(baseItems = territoryBaseComponentItems()) {
    return (0, dependencies.composeRiverBoundaryTerritoryComponents)({
      components: baseItems,
      candidates: dependencies.state.annexRiverPartitionCandidates,
      donorResults: dependencies.state.annexRiverPartitionDonorResults,
    });
  }

  function territoryComponentItems() {
    const context = territoryComponentContext();
    const selected = new Set(context.selectedKeys);
    const baseItems = territoryBaseComponentItems(context);
    let items = baseItems;
    if (dependencies.state.tool === 'annex-territory' && dependencies.state.annexUseRiverBoundaries) {
      if (dependencies.state.annexRiverPartitionStatus !== 'ready') return [];
      const baseByComponent = new Map(baseItems.map(item => [item.componentKey, item]));
      items = annexRiverBoundaryComposition(baseItems).items.map(item => {
        const base = baseByComponent.get(item.componentKey);
        const geometry = item.geometry;
        const areaKm2 = Number.isFinite(Number(item.areaKm2))
          ? Number(item.areaKm2)
          : Number.isFinite(Number(item.areaM2))
            ? Math.max(0, Number(item.areaM2) / 1e6)
            : Math.max(0, dependencies.d3.geo.area(geometry) * 6371.0088 * 6371.0088);
        return {
          ...item,
          key: String(item.key),
          countryName: item.countryName || base?.countryName || (0, dependencies.countryName)((0, dependencies.countryFeatureById)(item.countryId)),
          areaKm2,
          usesRiverBoundary: item.partitionKind === 'river',
          riverBoundarySegments: item.riverBoundarySegments || [],
        };
      });
    }
    return items.map(item => ({ ...item, selected: selected.has(item.key) }));
  }

  function selectedTerritoryComponentItems() {
    return territoryComponentItems().filter(item => item.selected);
  }

  function selectedTerritoryComponentGeometry() {
    const clipper = window.polygonClipping;
    if (!clipper?.union) throw new Error('영토 조각 결합 엔진을 불러오지 못했습니다.');
    const selected = selectedTerritoryComponentItems();
    if (!selected.length) throw new Error('영토 조각을 하나 이상 선택하세요.');
    const union = clipper.union(...selected.map(item => geometryMultiCoordinates(item.geometry)));
    const geometry = (0, dependencies.normalizeClippedLandGeometry)(union);
    if (!geometry) throw new Error('선택한 영토 조각을 결합할 수 없습니다.');
    return geometry;
  }

  function formatTerritoryArea(areaKm2) {
    const area = Math.max(0, Number(areaKm2) || 0);
    const maximumFractionDigits = area < 10 ? 2 : area < 100 ? 1 : 0;
    return `${area.toLocaleString('ko-KR', { maximumFractionDigits })} km²`;
  }

  function countryUnionFromFeatures(features, ids) {
    const clipper = window.polygonClipping;
    const wanted = new Set([...ids].map(String));
    const pieces = (features || [])
      .filter(feature => wanted.has(String(feature?.id || '')))
      .map(feature => feature.geometry?.coordinates)
      .filter(Boolean);
    if (!pieces.length) return [];
    return clipper.union(...pieces);
  }



  return Object.freeze({
    connect,

    get annexRiverBoundaryComposition() { return annexRiverBoundaryComposition; },
    get countryUnionFromFeatures() { return countryUnionFromFeatures; },
    get formatTerritoryArea() { return formatTerritoryArea; },
    get geometryMultiCoordinates() { return geometryMultiCoordinates; },
    get multiPolygonPlanarArea() { return multiPolygonPlanarArea; },
    get selectedTerritoryComponentGeometry() { return selectedTerritoryComponentGeometry; },
    get territoryBaseComponentItems() { return territoryBaseComponentItems; },
    get territoryComponentItems() { return territoryComponentItems; },
  });
}
