const square = x => ({ type: 'Polygon', coordinates: [[[x, 60], [x + 1, 60], [x + 1, 61], [x, 61], [x, 60]]] });
const version = (id, from, to, x) => ({ versionId: id, validFrom: from, validTo: to, geometry: square(x) });
const entity = (id, from, to, versions, parent = '') => ({
  entityId: id, entityKind: 'general', lineageId: 'shared-lineage', names: { ko: id },
  lifetime: { validFrom: from, validTo: to }, parentEntityId: parent,
  instantiation: { entityKind: 'general', coverageMode: 'explicit' }, metadata: { confidence: 'low' },
  geometryVersions: versions,
});
export function historicalWorldCases() {
  // The committed synthetic squares exercise source-month and lineage rules.
  // Full source reconstruction belongs to separate data publication checks.
  // The compiler's current-world ingress requires all default subunit endpoints.
  // Include those identities as the same tiny squares, without reading assets.
  const ids = [...new Set(['RUS', 'KOR', 'PRK', ...BUILTIN_SUBUNITS.flatMap(row => [row.sourceCountryId, row.parentId])])];
  const sources = ids.map((id, index) => ({ ...entity(`current:${id}`, null, null,
    [{...version(`${id}:current`, null, null, index * 2 - 150),}]), sourceInfo: { featureId: id } }));
  const snapshot = { schemaVersion: 1, referenceDate: '2026-10-01', entityRefs: sources.map(row => row.entityId) };
  const currentWorld = { type: 'FeatureCollection', features: ids.map((id, index) => ({
    type: 'Feature', id, geometry: square(index * 2 - 150), properties: { name: id },
  })) };
  return {
    entities: [...sources,
      entity('state:test-ukraine', '1991-08-24', '2014-03-17', [version('ukraine-v1', '1991-08-24', '2014-03-17', 10)]),
      entity('state:single-day', '1989-04-25', '1989-04-25', [version('day-v1', '1989-04-25', '1989-04-25', 12)]),
      entity('state:parent', '1900', '1903', [version('parent-v1', '1900', '1900', 14), version('parent-v2', '1902', '1903', 14)]),
      entity('state:child', '1900', '1903', [version('child-v1', '1900', '1903', 14)], 'state:parent'),
      entity('state:changing', '2020-01-01', '2020-12-31', [version('before', '2020-01-01', '2020-11-09', 16), version('after', '2020-11-10', '2020-12-31', 17)]),
      entity('state:leap', '2000-02-29', '2000-02-29', [version('leap-v1', '2000-02-29', '2000-02-29', 19)]),
    ], currentSnapshot: snapshot, currentWorld,
    policy: { schemaVersion: 1, unknownPeerOverlap: 'exclude-from-all', replacements: [] },
  };
}
import { BUILTIN_SUBUNITS } from '../../assets/js/modules/builtin-subunits.js';
