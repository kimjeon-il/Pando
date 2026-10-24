// Synthetic software integration geometry, with no historical attribution.
export const qgisFixture = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'qgis-line-source',
      geometry: { type: 'LineString', coordinates: [[127, 37], [128, 38]] },
      properties: { schemaVersion: 2, name: 'QGIS 연동 검증 선', notes: 'Synthetic integration fixture', color: '#8c68d8', locked: false,
        source: { schemaVersion: 1, kind: 'gis', dataset: 'QGIS integration fixture', sourceId: 'qgis-line-source', sourceFormat: 'geojson', details: { licence: 'CC0 software test fixture', historicalAccuracy: 'not-evaluated' } } } },
    { type: 'Feature', id: 'qgis-area-source',
      geometry: { type: 'Polygon', coordinates: [[[130, 36], [131, 36], [131, 37], [130, 37], [130, 36]]] },
      properties: { schemaVersion: 2, name: 'QGIS 연동 검증 영역', notes: 'Synthetic integration fixture', color: '#6688aa', locked: false,
        source: { schemaVersion: 1, kind: 'gis', dataset: 'QGIS integration fixture', sourceId: 'qgis-area-source', sourceFormat: 'geojson', details: { licence: 'CC0 software test fixture', historicalAccuracy: 'not-evaluated' } } } },
  ],
};
