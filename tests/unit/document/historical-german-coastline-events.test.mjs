import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:test";
import * as __source_dep1 from "node:assert/strict";
import * as __source_dep2 from "node:fs";
contractSuite("historical-german-coastline-events", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const { readFileSync } = __source_dep2;




const file = new URL("../../../tools/historical-library/sources/german-coastline/change-events.json", import.meta.url);
const catalog = JSON.parse(readFileSync(file, 'utf8'));

test('historical coast evidence sources and event IDs are unique and resolvable', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.dataPolicy.recordEventsRegardlessOfEra);
  assert.ok(catalog.dataPolicy.ownershipSeparateFromCoastalChange);
  assert.equal(catalog.dataPolicy.doNotAutoReplaceCoastline, true);
  assert.ok(catalog.baseline.maxFlatZoom > 0);
  assert.ok(catalog.baseline.contentWidthCssPx > 0);
  assert.ok(catalog.baseline.toleranceCssPx > 0);
  assert.ok(Array.isArray(catalog.events) && catalog.events.length > 0);
  const unique = new Set();
  for (const entry of catalog.events) {
    assert.ok(!unique.has(entry.id), 'duplicate event ID: ' + entry.id);
    unique.add(entry.id);
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.match(entry.modernCountry, /^[A-Z]{3}$/);
    assert.ok(['Baltic', 'North Sea'].includes(entry.sea));
    assert.ok(Number.isInteger(entry.datedWorks.startYear));
    assert.ok(Number.isInteger(entry.datedWorks.endYear));
    assert.ok(entry.datedWorks.startYear <= entry.datedWorks.endYear);
    assert.equal(entry.datedWorks.exactCoastlineSwitchDate, null);
    assert.ok(entry.geometry.status === 'not-digitized' || entry.geometry.status === 'provisional');
    if (entry.geometry.status === 'not-digitized') assert.equal(entry.geometry.screenDiscrepancyCssPx, null);
    assert.ok(entry.evidence.sourceIds.length);
    for (const key of entry.evidence.sourceIds)
      assert.ok(Object.hasOwn(catalog.sources, key), entry.id + ': missing source ' + key);
  }
  for (const [id, source] of Object.entries(catalog.sources)) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.match(source.url, /^https:\/\//);
    assert.ok(source.publisher.trim());
  }
});

test('period map inventory marks geologic editions and lacks implied georeferencing', () => {
  assert.ok(catalog.mapSheets.length > 0);
  const ids = new Set();
  for (const sheet of catalog.mapSheets) {
    assert.ok(!ids.has(sheet.id), 'duplicate map sheet: ' + sheet.id);
    ids.add(sheet.id);
    assert.ok(sheet.scaleDenominator > 0);
    assert.equal(sheet.georeferencingVerified, false);
    assert.equal(sheet.surveyAndRevisionDatesChecked, false);
    assert.ok(sheet.editions.length > 0);
    for (const edition of sheet.editions) {
      assert.ok(Number.isInteger(edition.year));
      if (edition.kind === 'geological') assert.equal(edition.notDirectCoastlineControl, true);
    }
    for (const key of sheet.sourceIds)
      assert.ok(Object.hasOwn(catalog.sources, key), sheet.id + ': missing source ' + key);
  }
});

test('retained coastal event inputs do not promote construction dates to verified shoreline geometry', () => {
  // The detailed Dollart–Jade investigation and its diagnostics were retired
  // under historical-border-reconstruction-policy §8. The operating source
  // catalog still owns the distinction between event evidence and geometry.
  assert.equal(catalog.dataPolicy.eventYearIsNotExactShorelineSwitch, true);
  assert.equal(catalog.dataPolicy.enclosedAreaIsNotEquivalentToDryLand, true);
  assert.equal(catalog.dataPolicy.doNotInferGeometryFromConstructionTimeline, true);
  assert.equal(catalog.dataPolicy.doNotAutoReplaceCoastline, true);
  assert.equal(catalog.dataPolicy.geometryState, 'all entries source-indexed; historical geometry not digitized');
});
});
contractSuite("historical-german-coastline-helgoland", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const { readFileSync } = __source_dep2;




const root = new URL("../../../", import.meta.url);
const readJson = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const working = readJson('tools/historical-library/working/german-empire-1914-base.geojson');
const qa = readJson('tools/historical-library/working/german-empire-1914-helgoland-temporal-qa.json');
const events = readJson('tools/historical-library/sources/german-coastline/change-events.json');

const box = ring => ring.reduce(([x0, y0, x1, y1], [x, y]) =>
  [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)],
[Infinity, Infinity, -Infinity, -Infinity]);
const approxArea = (ring, bounds) => {
  let signedTwiceArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    signedTwiceArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(signedTwiceArea / 2) * 111.195 ** 2 *
    Math.cos((bounds[1] + bounds[3]) / 2 * Math.PI / 180);
};
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const getIslands = geometry => geometry.coordinates
  .map((polygon, index) => ({ ring: polygon[0], index, bounds: box(polygon[0]) }))
  .filter(entry => entry.bounds[0] > 7.7 && entry.bounds[2] < 8.1 &&
    entry.bounds[1] > 54.0 && entry.bounds[3] < 54.3)
  .sort((a, b) => a.bounds[0] + a.bounds[2] - b.bounds[0] - b.bounds[2]);

test('working 1914 geometry explicitly disclaims the two modern Helgoland proxies', () => {
  assert.equal(working.features.length, 1);
  const feature = working.features[0];
  assert.equal(feature.properties.referenceDate, qa.referenceDate);
  assert.equal(feature.properties.status, 'working-base-modern-coast-not-final');
  const declaration = feature.properties.heligoland1914GeometryStatus;
  assert.equal(declaration.status, 'provisional-modern-proxy');
  assert.equal(declaration.historicalIslandOutlinesDigitized, false);
  assert.equal(declaration.doNotTreatAsVerified1914Shoreline, true);
  assert.equal(declaration.auditedEvidence,
    'tools/historical-library/working/german-empire-1914-helgoland-temporal-qa.json');
  assert.equal(qa.geometryState, 'PROVISIONAL_MODERN_PROXY');
  assert.equal(qa.historicalOverlayMeasured, false);
  assert.equal(qa.historicalScreenHausdorffCssPx, null);
});

test('Helgoland diagnostics are computed from the working geometry, not assumed period coastlines', () => {
  const parts = getIslands(working.features[0].geometry);
  assert.equal(parts.length, 2, 'the 1914 provisional base must show both islands');
  assert.equal(qa.modernProxyComponents.length, 2);
  const pxPerDegree = qa.mapReviewPolicy.zoom * qa.mapReviewPolicy.contentWidthCssPx / 360;
  assert.ok(near(pxPerDegree, qa.mapReviewPolicy.screenPixelsPerDegree, 1e-5));
  assert.equal(qa.mapReviewPolicy.toleranceCssPx, 0.5);
  for (const [i, island] of parts.entries()) {
    const record = qa.modernProxyComponents[i];
    assert.equal(island.index, record.polygonOrdinalInWorkingSource);
    assert.equal(island.ring.length, record.ringVertexCount);
    assert.deepEqual(island.ring[0], island.ring.at(-1), 'ring must close');
    for (let j = 0; j < 4; j++) {
      assert.ok(near(island.bounds[j], record.bboxWgs84[j], 1e-7));
    }
    assert.ok(near(approxArea(island.ring, island.bounds),
      record.approxModernProxyAreaKm2, 0.0001));
    assert.ok(near((island.bounds[2] - island.bounds[0]) * pxPerDegree,
      record.approxScreenWidthCssPx, 0.001));
    assert.ok(near((island.bounds[3] - island.bounds[1]) * pxPerDegree,
      record.approxScreenHeightCssPx, 0.001));
    assert.equal(record.historicalShapeStatus, 'not-digitized');
    assert.ok(record.modernProxyOrigin.startsWith('OpenStreetMap'));
  }
});

test('Helgoland chronology distinguishes 1914 ongoing harbor works from 1938 expansion', () => {
  const south = events.events.find(item => item.id === 'helgoland-south-harbor-1908-1916');
  const expansion = events.events.find(item => item.id === 'helgoland-nordostland-dune-1938-1941');
  assert.ok(south);
  assert.ok(expansion);
  assert.ok(south.datedWorks.startYear < 1914 && south.datedWorks.endYear > 1914);
  assert.equal(expansion.datedWorks.startYear, 1938);
  for (const event of [south, expansion]) {
    assert.equal(event.geometry.status, 'not-digitized');
    assert.equal(event.datedWorks.exactCoastlineSwitchDate, null);
    assert.ok(event.evidence.sourceIds.every(key => !!events.sources[key]));
  }
  const chart = events.mapSheets.find(sheet => sheet.id === 'ukho-chart-126-helgoland-1914');
  assert.equal(chart.georeferencingVerified, false);
  assert.equal(chart.geometryExtracted, false);
  assert.equal(chart.reportedControlPointCount, 6);
});
});
contractSuite("historical-netherlands-coast-events", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const { readFileSync } = __source_dep2;




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
});
