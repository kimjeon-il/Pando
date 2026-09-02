import { expect, test } from '@playwright/test';

function sortResult(result) {
  return {
    candidates: [...(result?.candidates || [])].sort((left, right) => String(left.key).localeCompare(String(right.key))),
    donorResults: [...(result?.donorResults || [])].sort((left, right) => String(left.donorCountryId).localeCompare(String(right.donorCountryId))),
  };
}

test('isolated browser river partition and Worker compatibility contracts agree', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__gis-math-contract.html', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><meta charset="utf-8"><script src="/assets/js/vendor/polygon-clipping.min.js"></script>',
  }));
  await page.goto('/__gis-math-contract.html');
  const result = await page.evaluate(async () => {
    const partitionModule = await import('/assets/js/modules/river-territory-partition.js?contract=1');
    const ring = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];
    const donors = [
      { countryId: 'donor-a', geometryRevision: 1, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10)] } },
      { countryId: 'donor-b', geometryRevision: 1, geometry: { type: 'MultiPolygon', coordinates: [[ring(20, 0, 30, 10)], [ring(40, 0, 41, 1)]] } },
      { countryId: 'date-line', geometryRevision: 1, geometry: { type: 'Polygon', coordinates: [[[179, 0], [179, 10], [-179, 10], [-179, 0], [179, 0]]] } },
    ];
    const riverFeatures = [
      { type: 'Feature', id: 'vertical', geometry: { type: 'LineString', coordinates: [[5, -1], [5, 11]] } },
      { type: 'Feature', id: 'horizontal', geometry: { type: 'LineString', coordinates: [[-1, 5], [11, 5]] } },
      { type: 'Feature', id: 'b-vertical', geometry: { type: 'LineString', coordinates: [[25, -1], [25, 11]] } },
      { type: 'Feature', id: 'date-vertical', geometry: { type: 'LineString', coordinates: [[179, -1], [179, 11]] } },
      { type: 'Feature', id: 'dangling', geometry: { type: 'LineString', coordinates: [[5, 5], [6, 6]] } },
      { type: 'Feature', id: 'unsplit', geometry: { type: 'LineString', coordinates: [[35, 0], [36, 0]] } },
    ];
    const donorSnapshot = structuredClone(donors);
    const riverSnapshot = structuredClone(riverFeatures);
    const payload = { donors, riverFeatures, hydroRevision: 'gis-contract' };
    const direct = partitionModule.buildRiverTerritoryPartitions({ ...payload, clipper: window.polygonClipping });
    const worker = new Worker('/assets/js/workers/river-territory-partition-worker.js?contract=1');
    let workerResult;
    try {
      workerResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('river partition contract Worker timeout')), 15_000);
        worker.addEventListener('error', event => { clearTimeout(timer); reject(new Error(event.message || 'Worker error')); }, { once: true });
        worker.addEventListener('message', event => {
          if (event.data?.type === 'error') { clearTimeout(timer); reject(new Error(event.data.message)); return; }
          clearTimeout(timer);
          resolve(event.data?.result || null);
        }, { once: true });
        worker.postMessage({ type: 'compute', requestId: 1, payload });
      });
    } finally {
      worker.terminate();
    }
    const pairwiseOverlap = [];
    for (let left = 0; left < direct.candidates.length; left += 1) {
      for (let right = left + 1; right < direct.candidates.length; right += 1) {
        if (direct.candidates[left].donorCountryId !== direct.candidates[right].donorCountryId) continue;
        const overlap = window.polygonClipping.intersection(
          direct.candidates[left].geometry.coordinates,
          direct.candidates[right].geometry.coordinates,
        );
        if (overlap.length) pairwiseOverlap.push([direct.candidates[left].key, direct.candidates[right].key]);
      }
    }
    return { direct, worker: workerResult, donorSnapshot, riverSnapshot, donors, riverFeatures, pairwiseOverlap };
  });

  const direct = sortResult(result.direct);
  const worker = sortResult(result.worker);
  expect(worker).toEqual(direct);
  expect(direct.candidates.every(candidate => candidate.algorithmRevision === 'river-partitions-v1')).toBe(true);
  expect(direct.candidates.every(candidate => candidate.sourceRiverIds.length > 0 && candidate.riverBoundarySegments.length > 0)).toBe(true);
  expect(direct.donorResults).toEqual([
    { donorCountryId: 'date-line', status: 'ready', candidateCount: 2, reason: '' },
    { donorCountryId: 'donor-a', status: 'ready', candidateCount: 4, reason: '' },
    { donorCountryId: 'donor-b', status: 'ready', candidateCount: 2, reason: '' },
  ]);
  expect(result.pairwiseOverlap).toEqual([]);
  expect(result.donors).toEqual(result.donorSnapshot);
  expect(result.riverFeatures).toEqual(result.riverSnapshot);
  expect(errors).toEqual([]);
});
