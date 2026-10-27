import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relativePath => JSON.parse(
  readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

const events = read('../../tools/historical-library/sources/netherlands/change-events.json');
const germanEvents = read('../../tools/historical-library/sources/german-coastline/change-events.json');
const registry = read('../../tools/historical-library/sources/coastline-catalogs.json');
const nld = read('../../assets/data/territorial-entities/source/countries/state-NLD.json');

test('Dutch source-indexed changes preserve chronology without inventing historical shoreline geometry', () => {
  assert.equal(events.schemaVersion, 1);
  for (const flag of ['ownershipSeparateFromCoastalChange','doNotAutoReplaceCoastline',
    'closureDateIsNotDryLandDate','waterBodyTopologySeparateFromCountryPolygon']) {
    assert.equal(events.dataPolicy[flag], true);
  }
  assert.equal(germanEvents.dataPolicy.doNotAutoReplaceCoastline, true);
  const germanIds = new Set(germanEvents.events.map(item => item.id));
  const identifiers = new Set();
  assert.equal(events.events.length, 9, 'Source chronology inventory must not disappear during scope cleanup');
  for (const event of events.events) {
    assert.match(event.id, /^[a-z0-9-]+$/);
    assert.ok(!identifiers.has(event.id) && !germanIds.has(event.id), 'Duplicate event: ' + event.id);
    identifiers.add(event.id);
    assert.equal(event.modernCountry, 'NLD');
    assert.ok(Number.isInteger(event.datedWorks.startYear));
    assert.ok(Number.isInteger(event.datedWorks.endYear));
    assert.ok(event.datedWorks.startYear <= event.datedWorks.endYear);
    assert.equal(event.datedWorks.exactCoastlineSwitchDate, null);
    assert.equal(event.geometry.status, 'not-digitized');
    assert.equal(event.evidence.status, 'source-indexed');
    assert.ok(event.evidence.sourceIds.length);
    for (const key of event.evidence.sourceIds) {
      assert.ok(Object.hasOwn(events.sources, key), event.id + ': missing source ' + key);
      assert.match(events.sources[key].url, /^https:\/\//);
    }
  }
  assert.equal(events.events.find(item => item.id === 'afsluitdijk-1927-1932').datedWorks.hydraulicClosureDate, '1932-05-28');
  assert.equal(events.events.find(item => item.id === 'lauwerszee-1969').datedWorks.hydraulicClosureDate, '1969-05-23');
  assert.equal(events.events.find(item => item.id === 'houtribdijk-1963-1976').datedWorks.hydraulicClosureDate, '1975-09-04');
});

test('current NLD country source is not itself a dry-land mask or a historical coastline', () => {
  assert.equal(nld.entityId, 'state:NLD');
  const current = nld.geometryVersions.find(v => v.versionId === 'state:NLD:natural-earth-5.1.1');
  assert.ok(current, 'Current NLD geometry is missing');
  assert.equal(current.geometry.type, 'MultiPolygon');
  assert.ok(current.geometry.coordinates.length >= 1);
  assert.ok(events.events.every(event => event.geometry.status === 'not-digitized'));
  // The national country polygon includes inland waters; a point-membership
  // test cannot classify dry land, artificial islands, or historical coastlines.
  // Do not recreate the retired 12-point / 0.5-CSS-pixel validation gate.
});

test('regional registry refers to only one independent source for each event', () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.dataPolicy.noEventCopyInManifest, true);
  assert.equal(registry.dataPolicy.ignoreUnverifiedGeometryForWorldBuild, true);
  assert.deepEqual(registry.catalogs.map(catalog => catalog.path), [
    'tools/historical-library/sources/german-coastline/change-events.json',
    'tools/historical-library/sources/netherlands/change-events.json',
  ]);
  const seen = new Set();
  for (const catalog of registry.catalogs) {
    assert.ok(!Object.hasOwn(catalog, 'events'));
    assert.ok(catalog.scope.trim().length);
    for (const event of read('../../' + catalog.path).events) {
      assert.ok(!seen.has(event.id), 'Duplicate regional event ' + event.id);
      seen.add(event.id);
    }
  }
});
