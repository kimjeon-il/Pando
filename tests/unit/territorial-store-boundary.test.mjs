import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createObjectPresentation } from '../../assets/js/modules/app-object-presentation.js';

const read = name => readFile(new URL(`../../assets/js/modules/${name}`, import.meta.url), 'utf8');

test('presentation does not expose migration transaction or validation APIs', () => {
  const presentation = createObjectPresentation();
  assert.equal(Object.hasOwn(presentation, 'runTerritorialUnitTransaction'), false);
  assert.equal(Object.hasOwn(presentation, 'validateTerritorialUnitRelations'), false);
});

test('every production territorial storage access is classified at its function owner', () => {
  const output = execFileSync(process.execPath, ['scripts/check-territorial-storage.mjs'], { encoding: 'utf8' });
  assert.match(output, /no unclassified or forbidden writes/);
});

test('territorial application service depends on one physical entity store', async () => {
  const [service, history, domain] = await Promise.all([
    read('territorial-service.js'),
    read('app-history-assembly.js'),
    read('app-domain-assembly.js'),
  ]);

  assert.match(service, /entityStore/);
  assert.doesNotMatch(service, /\bcountryCommands\b|\bunitCommands\b/);
  assert.match(history, /entityStore:\s*dependencies\.territorialModel\.entityStore/);
  assert.match(domain, /createTerritorialEntityStore/);
  assert.match(domain, /createTerritorialEntityRepository\)\(\{[\s\S]*entityStore:\s*territorialEntityStore/);
});

// DomainAssembly owns the physical store adapter. Runtime editing, startup,
// restore/history and GIS callers must not mutate country/unit collections directly.
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
    'app-builtin-session.js',
    'gis-import-transaction.js',
  ];
  const sources = await Promise.all(names.map(read));
  const rawWrite = /(?:dependencies\.projectState\.)?state\.(?:territorialUnits|countriesData(?:\.features)?)\s*(?:=|\.push\s*\(|\.splice\s*\()/;

  for (let index = 0; index < names.length; index += 1) {
    const source = sources[index];
    assert.doesNotMatch(source, rawWrite, `${names[index]} must write country/unit collections through TerritorialEntityStore`);
  }
});

test('structural territorial callers use the entity store for collection writes', async () => {
  const [drafts, conversion, generic, land, deletion, cut, startup, restore, snapshots, builtin, gis] = await Promise.all([
    read('app-territorial-drafts.js'),
    read('app-territorial-conversion.js'),
    read('app-generic-commands.js'),
    read('app-land-relations.js'),
    read('app-object-deletion.js'),
    read('app-cut-geometry.js'),
    read('app-progressive-startup.js'),
    read('app-project-restore.js'),
    read('app-project-snapshots.js'),
    read('app-builtin-session.js'),
    read('gis-import-transaction.js'),
  ]);

  assert.match(drafts, /entityStore\.replaceCollections/);
  assert.match(conversion, /entityStore\.replaceCollections/);
  assert.match(generic, /entityStore\.replaceCollections/);
  assert.match(land, /entityStore\.replaceCollections/);
  assert.match(deletion, /entityStore:\s*dependencies\.territorialModel\.entityStore/);
  assert.match(cut, /entityStore\.replaceCollections/);
  assert.match(startup, /entityStore\.replaceCollections/);
  assert.match(restore, /entityStore\.replaceCollections/);
  assert.match(snapshots, /entityStore\.replaceCollections/);
  assert.match(builtin, /entityStore\.replaceCollections/);
  assert.match(gis, /entityStore\.(?:appendEntities|replaceCollections)/);
});

test('territorial store exposes only generic structural write commands', async () => {
  const store = await read('territorial-entity-store.js');
  assert.match(store, /appendEntities/);
  assert.match(store, /removeEntities/);
  assert.match(store, /replaceCollections/);
  assert.doesNotMatch(store, /function\s+(?:appendCountries|appendUnits|removeCountries|removeUnits|replaceCountries|replaceUnits|replaceCountryOverrides)\b/);
});
