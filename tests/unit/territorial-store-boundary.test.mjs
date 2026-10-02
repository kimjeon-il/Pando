import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../../assets/js/modules/${name}`, import.meta.url), 'utf8');

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
  assert.match(domain, /getCountries:\s*territorialEntityStore\.countriesData/);
  assert.match(domain, /getUnits:\s*territorialEntityStore\.units/);
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
    assert.doesNotMatch(sources[index], rawWrite, `${names[index]} must write country/unit collections through TerritorialEntityStore`);
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

  assert.match(drafts, /entityStore\.(?:appendCountries|replaceUnits)/);
  assert.match(conversion, /entityStore\.replaceUnits/);
  assert.match(generic, /entityStore\.replaceUnits/);
  assert.match(land, /entityStore\.replaceUnits/);
  assert.match(deletion, /entityStore/);
  assert.match(cut, /entityStore\.replaceCountries/);
  assert.match(startup, /entityStore\.(?:replaceCountries|replaceUnits)/);
  assert.match(restore, /entityStore\.(?:replaceCountries|replaceUnits)/);
  assert.match(snapshots, /entityStore\.(?:replaceCountries|replaceUnits)/);
  assert.match(builtin, /entityStore\.(?:replaceCountries|replaceUnits)/);
  assert.match(gis, /entityStore\.(?:replaceCountries|replaceUnits|appendUnits)/);
});
