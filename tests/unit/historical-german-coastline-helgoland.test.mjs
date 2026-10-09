import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
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
