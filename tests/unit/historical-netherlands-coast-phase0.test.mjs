import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

const events = read('../../tools/historical-library/sources/netherlands/change-events.json');
const probes = read('../../tools/historical-library/sources/netherlands/canonical-phase0-probes.json');
const germanEvents = read('../../tools/historical-library/sources/german-coastline/change-events.json');

const registry = read('../../tools/historical-library/sources/coastline-catalogs.json');
const nld = read('../../assets/data/territorial-entities/source/countries/nld.json');

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > y) !== (b[1] > y) &&
        x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function containsPoint(geometry, point) {
  const polygons = geometry.type === 'MultiPolygon'
    ? geometry.coordinates
    : geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : null;
  assert.ok(polygons, 'national baseline must be polygonal');
  return polygons.some((rings) =>
    insideRing(point, rings[0]) && !rings.slice(1).some((ring) => insideRing(point, ring)));
}

test('Dutch physical shoreline events remain unmodified evidence, independently of national ownership', () => {
  assert.equal(events.schemaVersion, 1);
  assert.equal(events.dataPolicy.ownershipSeparateFromCoastalChange, true);
  assert.equal(events.dataPolicy.doNotAutoReplaceCoastline, true);
  assert.equal(events.dataPolicy.closureDateIsNotDryLandDate, true);
  assert.equal(events.dataPolicy.waterBodyTopologySeparateFromCountryPolygon, true);
  assert.equal(events.baseline.toleranceCssPx, 0.5);
  assert.equal(events.baseline.maxFlatZoom, 64);
  assert.equal(events.baseline.contentWidthCssPx, 2560);
  assert.equal(germanEvents.dataPolicy.doNotAutoReplaceCoastline, true);
  assert.equal(germanEvents.dataPolicy.ownershipSeparateFromCoastalChange, true);

  const germanIDs = new Set(germanEvents.events.map((event) => event.id));
  const dutchIDs = new Set();
  for (const event of events.events) {
    assert.match(event.id, /^[a-z0-9-]+$/);
    assert.ok(!dutchIDs.has(event.id), 'duplicate Dutch event: ' + event.id);
    assert.ok(!germanIDs.has(event.id), 'duplicated across indexes: ' + event.id);
    dutchIDs.add(event.id);
    assert.equal(event.modernCountry, 'NLD');
    assert.ok(Number.isInteger(event.datedWorks.startYear));
    assert.ok(Number.isInteger(event.datedWorks.endYear));
    assert.ok(event.datedWorks.startYear <= event.datedWorks.endYear);
    assert.equal(event.datedWorks.exactCoastlineSwitchDate, null);
    assert.equal(event.geometry.status, 'not-digitized');
    assert.equal(event.geometry.screenDiscrepancyCssPx, null);
    assert.equal(event.evidence.status, 'source-indexed');
    assert.ok(event.evidence.sourceIds.length > 0);
    for (const key of event.evidence.sourceIds) {
      assert.ok(Object.hasOwn(events.sources, key), event.id + ': unknown source ' + key);
      assert.match(events.sources[key].url, /^https:\/\//);
    }
  }
  assert.ok(events.events.length >= 9);
  assert.equal(events.events.find((event) => event.id === 'afsluitdijk-1927-1932').datedWorks.hydraulicClosureDate, '1932-05-28');
  assert.equal(events.events.find((event) => event.id === 'lauwerszee-1969').datedWorks.hydraulicClosureDate, '1969-05-23');
  assert.equal(events.events.find((event) => event.id === 'houtribdijk-1963-1976').datedWorks.hydraulicClosureDate, '1975-09-04');
});

test('canonical NLD phase-0 probes reproduce the actual current country geometry, not an inferred coastline', () => {
  assert.equal(probes.schemaVersion, 1);
  assert.equal(probes.method.noHistoricalGeometryCompared, true);
  assert.equal(probes.method.noLandWaterClassificationInferred, true);
  assert.equal(probes.method.notAnEventFootprintInventory, true);
  assert.equal(probes.method.coastToleranceCssPx, 0.5);
  assert.equal(probes.crs, 'EPSG:4326');
  const entity = nld.entities.find((value) => value.entityId === probes.entityId);
  assert.ok(entity, 'NLD catalog entry missing');
  const version = entity.geometryVersions.find((value) => value.versionId === probes.geometryVersionId);
  assert.ok(version, 'NLD baseline version missing');
  const geometry = version.geometry;
  assert.equal(geometry.type, 'MultiPolygon');
  const parts = geometry.coordinates;
  assert.equal(parts.length, probes.baselineGeometry.totalPolygons);
  assert.equal(parts.reduce((count, rings) => count + rings.length - 1, 0), probes.baselineGeometry.totalInteriorRings);
  assert.equal(parts.filter((rings) => rings[0].some(([lon]) => lon > 0)).length, probes.baselineGeometry.europeanPolygons);
  assert.equal(parts.filter((rings) => rings[0].every(([lon]) => lon < 0)).length, probes.baselineGeometry.caribbeanPolygons);

  const ids = new Set();
  for (const sample of probes.points) {
    assert.ok(!ids.has(sample.id), 'duplicate control point: ' + sample.id);
    ids.add(sample.id);
    assert.equal(sample.coordinates.length, 2);
    assert.ok(sample.coordinates[0] >= -180 && sample.coordinates[0] <= 180);
    assert.ok(sample.coordinates[1] >= -90 && sample.coordinates[1] <= 90);
    assert.match(sample.locationMethod, /checkpoint|place point/);
    assert.equal(containsPoint(geometry, sample.coordinates), sample.expectedInsideCountryPolygon, sample.id);
  }
  assert.equal(probes.points.length, 12);
  assert.equal(probes.points.filter((point) => !point.expectedInsideCountryPolygon).length, 1);
  assert.equal(probes.points.find((point) => point.id === 'maasvlakte-2').expectedInsideCountryPolygon, false);
  assert.equal(probes.points.find((point) => point.id === 'maasvlakte-1').expectedInsideCountryPolygon, true);
});

test('country polygon deliberately cannot be used as a lake or island-presence oracle', () => {
  const waterPoints = probes.points.filter((point) => point.kind === 'inland-water' || point.kind === 'enclosed-water');
  assert.ok(waterPoints.length >= 3);
  assert.ok(waterPoints.every((point) => point.expectedInsideCountryPolygon));
  assert.equal(probes.points.find((point) => point.id === 'marker-wadden').expectedInsideCountryPolygon, true);
  // These positions inside a national footprint say nothing about whether
  // islands, floodwater or enclosed lakes exist in their historically dated form.
});

test('worldwide regional coast-catalog registry references evidence without duplicating source events', () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.dataPolicy.noEventCopyInManifest, true);
  assert.equal(registry.dataPolicy.ignoreUnverifiedGeometryForWorldBuild, true);
  assert.deepEqual(
    registry.catalogs.map((catalog) => catalog.path),
    [
      'tools/historical-library/sources/german-coastline/change-events.json',
      'tools/historical-library/sources/netherlands/change-events.json',
    ],
  );
  const seen = new Set();
  for (const catalog of registry.catalogs) {
    assert.ok(!Object.hasOwn(catalog, 'events'));
    assert.ok(catalog.scope.trim().length > 0);
    const contents = read('../../' + catalog.path);
    assert.equal(contents.dataPolicy.ownershipSeparateFromCoastalChange, true);
    for (const event of contents.events) {
      assert.ok(!seen.has(event.id), 'duplicate across geographic catalogs: ' + event.id);
      seen.add(event.id);
    }
  }
});
