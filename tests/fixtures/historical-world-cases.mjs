import { readTerritorialSources } from '../../tools/territorial-entity-sources.mjs';
import { buildCurrentWorld } from '../../tools/territorial-current-world.mjs';
import fs from 'node:fs';

const sources = readTerritorialSources();
const snapshot = JSON.parse(fs.readFileSync(new URL('../../assets/data/territorial-entities/source/snapshots/current-world.json', import.meta.url)));
const current = new Set(snapshot.entityRefs);
const square = x => ({ type: 'Polygon', coordinates: [[[x, 60], [x + 1, 60], [x + 1, 61], [x, 61], [x, 60]]] });
const version = (id, from, to, x) => ({ versionId: id, validFrom: from, validTo: to, datePrecision: 'date', geometry: square(x) });
const entity = (id, from, to, versions, parent = '') => ({
  entityId: id, entityKind: 'general', lineageId: 'shared-lineage', names: { ko: id },
  lifetime: { validFrom: from, validTo: to }, parentEntityId: parent,
  instantiation: { entityKind: 'general', coverageMode: 'explicit' }, metadata: { confidence: 'low' },
  geometryVersions: versions,
});
export function historicalWorldCases() {
  return {
    entities: [...sources.filter(item => current.has(item.entityId)),
      entity('state:test-ukraine', '1991-08-24', '2014-03-17', [version('ukraine-v1', '1991-08-24', '2014-03-17', 10)]),
      entity('state:single-day', '1989-04-25', '1989-04-25', [version('day-v1', '1989-04-25', '1989-04-25', 12)]),
      entity('state:parent', '1900', '1903', [version('parent-v1', '1900', '1900', 14), version('parent-v2', '1902', '1903', 14)]),
      entity('state:child', '1900', '1903', [version('child-v1', '1900', '1903', 14)], 'state:parent'),
      entity('state:changing', '2020-01-01', '2020-12-31', [version('before', '2020-01-01', '2020-11-09', 16), version('after', '2020-11-10', '2020-12-31', 17)]),
      entity('state:leap', '2000-02-29', '2000-02-29', [version('leap-v1', '2000-02-29', '2000-02-29', 19)]),
    ], currentSnapshot: structuredClone(snapshot), currentWorld: buildCurrentWorld(),
    policy: { schemaVersion: 1, unknownPeerOverlap: 'exclude-from-all', replacements: [] },
  };
}
