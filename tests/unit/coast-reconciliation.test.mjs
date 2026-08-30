import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planCoastReconciliation,
  requireImportCoastDecision,
  validateCoastReplacement,
} from '../../assets/js/modules/coast-reconciliation.js';

const square = () => ({
  type: 'Polygon',
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
});

const offsetSquare = () => ({
  type: 'Polygon',
  coordinates: [[[0, 0.1], [2, 0.1], [2, 2], [0, 2], [0, 0.1]]],
});

test('import coast decisions share one cancellation contract', () => {
  assert.equal(requireImportCoastDecision({ direction: 'independent' }), 'independent');
  assert.equal(requireImportCoastDecision({ direction: 'country-to-admin' }), 'country-to-admin');
  assert.equal(requireImportCoastDecision({ direction: 'admin-to-country' }), 'admin-to-country');
  assert.throws(() => requireImportCoastDecision({ direction: 'cancel' }), error => (
    error?.name === 'AbortError' && error?.cancelled === true && !error?.code
  ));
});

test('country and imported-area choices update only their selected geometry', () => {
  const conflict = {
    countryGeometry: square(),
    adminGeometry: offsetSquare(),
    countryRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 1 },
    adminRingRef: { polygonIndex: 0, ringIndex: 0, startIndex: 0, endIndex: 1 },
    countryChain: [{ a: [0, 0], b: [2, 0] }],
    adminChain: [{ a: [0, 0.1], b: [2, 0.1] }],
  };
  const countryToUnit = planCoastReconciliation({ conflict, direction: 'country-to-admin' });
  assert.deepEqual(countryToUnit.countryGeometry, conflict.countryGeometry);
  assert.notDeepEqual(countryToUnit.adminGeometry, conflict.adminGeometry);
  assert.equal(validateCoastReplacement(countryToUnit.adminGeometry).ok, true);

  const unitToCountry = planCoastReconciliation({ conflict, direction: 'admin-to-country' });
  assert.deepEqual(unitToCountry.adminGeometry, conflict.adminGeometry);
  assert.notDeepEqual(unitToCountry.countryGeometry, conflict.countryGeometry);
  assert.equal(validateCoastReplacement(unitToCountry.countryGeometry).ok, true);
});
