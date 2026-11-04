import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createObjectPresentation } from '../../shared/frontend/js/modules/object-presentation.js';

const read = name => readFile(repositoryFrontendUrl(`assets/js/modules/${name}`), 'utf8');
const viewerMap = () => readFile(new URL('../../apps/viewer/js/modules/viewer-map.js', import.meta.url), 'utf8');
const viewerComposition = () => readFile(new URL('../../apps/viewer/js/modules/viewer-composition.js', import.meta.url), 'utf8');

test('presentation does not expose retired transaction or validation APIs', () => {
  const presentation = createObjectPresentation();
  assert.equal(Object.hasOwn(presentation, 'runTerritorialUnitTransaction'), false);
  assert.equal(Object.hasOwn(presentation, 'validateTerritorialUnitRelations'), false);
});

test('every production territorial storage access is classified at its function owner', () => {
  const output = execFileSync(process.execPath, ['scripts/check-territorial-storage.mjs'], { encoding: 'utf8' });
  assert.match(output, /no unclassified or forbidden writes/);
});

test('Viewer territorial repository and selection share the accepted C++ document owner', async () => {
  const [map, composition, service] = await Promise.all([viewerMap(), viewerComposition(),
    readFile(new URL('../helpers/core-command-services/territorial-service.mjs', import.meta.url), 'utf8')]);
  assert.match(map, /createTerritorialEntityStore\(\{documentModel:documentSession\.documentModel,commandOwner:documentSession\.commandOwner/);
  assert.match(map, /createTerritorialEntityRepository\(\{entityStore\}\)/);
  assert.match(composition, /createProjectDomain\(\{productMode,readOnly:true,commandOwner:documentSession\.commandOwner,documentModel:documentSession\.documentModel/);
  assert.match(service, /commandOwner\.executeCommand/);
  assert.doesNotMatch(service, /\bcountryCommands\b|\bunitCommands\b/);
});

test('current Viewer callers do not write raw territorial collections or retired Store APIs', async () => {
  const sources = await Promise.all([viewerMap(), viewerComposition(), read('builtin-session.js')]);
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:dependencies\.projectState\.)?state\.territorialEntities\s*(?:=|\.push\s*\(|\.splice\s*\()/);
    assert.doesNotMatch(source, /\bentityStore\.(?:applyChanges|setField|setLocked|appendEntities|removeEntities|replaceEntities|restoreProject|transaction)\s*\(/);
  }
  assert.match(sources[2], /sourceBytes/);
});

test('territorial Store exposes only accepted views and session-month queries', async () => {
  const store = await read('territorial-entity-store.js');
  assert.match(store, /documentModel\.territorialViews/);
  assert.match(store, /commandOwner\.setTimelineCursor/);
  assert.doesNotMatch(store, /\b(?:function|const)\s+(?:appendEntities|removeEntities|replaceEntities|applyChanges|setField|setLocked|restoreProject|transaction)\b/);
  assert.doesNotMatch(store, /function\s+(?:appendCountries|appendUnits|removeCountries|removeUnits|replaceCountries|replaceUnits|replaceCountryOverrides)\b/);
});
