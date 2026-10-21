import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTerritorialSources, territorialSourceRoot } from '../../tools/territorial-entity-sources.mjs';
import { buildCurrentWorld } from '../../tools/territorial-current-world.mjs';
import { compileHistoricalWorldTimeline } from '../../tools/historical-world-timeline.mjs';

test('an edited KOR source name and flag reach both current world and historical project identity', () => {
  const entities = readTerritorialSources().map(entity => entity.entityId === 'state:KOR'
    ? { ...structuredClone(entity), names: { ko: '새 대한민국' },
      sourceInfo: { ...entity.sourceInfo, featureProperties: {
        ...entity.sourceInfo.featureProperties, sourceOriginalMarker: 'retained',
      } }, metadata: {
      ...entity.metadata, defaultFlagDataUrl: 'assets/vendor/edited-kor-flag.svg',
    } } : entity);
  const snapshot = JSON.parse(readFileSync(`${territorialSourceRoot}/views/world.json`));
  const currentWorld = buildCurrentWorld({ entities, view: snapshot });
  const current = currentWorld.features.find(feature => feature.id === 'KOR');
  assert.equal(current.properties.name, '새 대한민국');
  assert.equal(current.properties.metadata.flagDataUrl, 'assets/vendor/edited-kor-flag.svg');
  assert.equal(current.properties.sourceOriginalMarker, 'retained');

  const policy = JSON.parse(readFileSync(new URL('../../assets/data/historical-world/policy.json', import.meta.url)));
  const { project } = compileHistoricalWorldTimeline({ entities, currentSnapshot: {schemaVersion:1,referenceDate:'2026-10-06',entityRefs:snapshot.selections.map(row=>row.entityId)},
    currentWorld, policy });
  const published = project.territorialEntities.find(feature => feature.id === 'KOR');
  assert.equal(published.properties.name, '새 대한민국');
  assert.equal(published.properties.metadata.flagDataUrl, 'assets/vendor/edited-kor-flag.svg');
});
