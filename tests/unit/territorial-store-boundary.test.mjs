import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createObjectPresentation } from "../../shared/frontend/js/modules/object-presentation.js";

const read = name => readFile(repositoryFrontendUrl(`assets/js/modules/${name}`), 'utf8');

test('presentation does not expose retired transaction or validation APIs', () => {
  const presentation = createObjectPresentation();
  assert.equal(Object.hasOwn(presentation, 'runTerritorialUnitTransaction'), false);
  assert.equal(Object.hasOwn(presentation, 'validateTerritorialUnitRelations'), false);
});

test('every production territorial storage access is classified at its function owner', () => {
  const output = execFileSync(process.execPath, ['scripts/check-territorial-storage.mjs'], { encoding: 'utf8' });
  assert.match(output, /no unclassified or forbidden writes/);
});

test('territorial service commands and read-only repositories share one C++ document owner', async () => {
  const [service, history, domain] = await Promise.all([
    read('territorial-service.js'),
    read('app-history-assembly.js'),
    read('app-domain-assembly.js'),
  ]);

  assert.match(service,/commandOwner\.executeCommand/);
  assert.doesNotMatch(service, /\bcountryCommands\b|\bunitCommands\b/);
  assert.match(history,/commandOwner/);
  assert.doesNotMatch(history,/createProjectCommandPipeline|createHistoryService/);
  assert.match(domain, /createTerritorialEntityStore/);
  assert.match(domain, /createTerritorialEntityRepository\)\(\{[\s\S]*entityStore:\s*territorialEntityStore/);
});

// DomainAssembly owns the read projection. Every runtime writer commits through
// C++ rather than a mutable JavaScript Store or parallel collection.
test('territorial callers do not write raw country or unit collection storage', async () => {
  const names = [
    'app-territorial-drafts.js',
    'app-territorial-conversion.js',
    'app-generic-commands.js',
    'app-land-relations.js',
    'app-object-deletion.js',
    'app-object-commands.js',
    'territorial-interaction-policy.js',
    'app-cut-geometry.js',
    'app-progressive-startup.js',
    'app-project-restore.js',
    'app-project-snapshots.js',
    'builtin-session.js',
    'gis-import-transaction.js',
  ];
  const sources = await Promise.all(names.map(read));
  const rawWrite = /(?:dependencies\.projectState\.)?state\.(?:territorialEntities)\s*(?:=|\.push\s*\(|\.splice\s*\()/;

  for (let index = 0; index < names.length; index += 1) {
    const source = sources[index];
    assert.doesNotMatch(source,rawWrite,`${names[index]} must admit document changes through the same C++ owner`);
  }
});

test('structural callers have no retired writable Store APIs', async () => {
  const [drafts, conversion, generic, land, commands, cut, startup, restore, snapshots, builtin, gis] = await Promise.all([
    read('app-territorial-drafts.js'),
    read('app-territorial-conversion.js'),
    read('app-generic-commands.js'),
    read('app-land-relations.js'),
    read('app-object-commands.js'),
    read('app-cut-geometry.js'),
    read('app-progressive-startup.js'),
    read('app-project-restore.js'),
    read('app-project-snapshots.js'),
    read('builtin-session.js'),
    read('gis-import-transaction.js'),
  ]);

  for(const source of [drafts,conversion,generic,land,commands,cut,startup,restore,snapshots,builtin,gis])
    assert.doesNotMatch(source,/\bentityStore\.(?:applyChanges|setField|setLocked|appendEntities|removeEntities|replaceEntities|restoreProject|transaction)\s*\(/);
  assert.match(conversion, /projectDomain\.executeCommand/);
  assert.match(conversion, /commandId:'territorial\.copy-region-for-display'/);
  assert.match(commands,/projectDomain\.executeCommand/);
  assert.match(startup,/projectDomain\.admit/);
  assert.match(restore,/projectDomain\.snapshot/);
  assert.match(snapshots,/projectDomain\.snapshot/);
  assert.match(builtin,/sourceBytes/);
});

test('territorial Store exposes only accepted views and session-month queries', async () => {
  const store = await read('territorial-entity-store.js');
  assert.match(store,/documentModel\.territorialViews/);
  assert.match(store,/commandOwner\.setTimelineCursor/);
  assert.doesNotMatch(store,/\b(?:function|const)\s+(?:appendEntities|removeEntities|replaceEntities|applyChanges|setField|setLocked|restoreProject|transaction)\b/);
  assert.doesNotMatch(store, /function\s+(?:appendCountries|appendUnits|removeCountries|removeUnits|replaceCountries|replaceUnits|replaceCountryOverrides)\b/);
});
