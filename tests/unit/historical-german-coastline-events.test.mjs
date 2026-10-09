import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../../tools/historical-library/sources/german-coastline/change-events.json', import.meta.url);
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

test('Dollart–Jade modern-coast densification does not claim validated 1914 shorelines', () => {
  const url = new URL('../../tools/historical-library/working/german-empire-1914-northsea-dollart-jade.diagnostics.json', import.meta.url);
  const report = JSON.parse(readFileSync(url, 'utf8'));
  assert.equal(report.status, 'applied'); // applied only to the working geometry
  assert.equal(report.historicalValidation.geometryPatchApplied, 'modern-detail-densification-only');
  assert.equal(report.historicalValidation.independent1914CoastlineVectorDigitized, false);
  assert.equal(report.historicalValidation.periodMapWmsLastAccess.includes('401'), true);
  assert.equal(report.historicalValidation.independentHistoricallyCorrectShorelineMeasured, false);
  assert.equal(report.historicalValidation.maxFlatZoom64ScreenDifferenceCssPx, null);
  assert.equal(report.historicalValidation.periodBoundaryVerification, 'not-run');
  assert.equal(report.validation.allRingsClosed, true);
  assert.equal(report.validation.properSelfIntersections, 0);
});
