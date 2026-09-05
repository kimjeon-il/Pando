import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerritorialInternalBoundarySegments } from '../../assets/js/modules/boundary-topology.js';

test('no polygon units never inspect canonical country geometry', () => {
  const countries = [{ get geometry() { throw new Error('must not inspect countries'); } }];
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, []), []);
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, [{ geometry: { type: 'Point', coordinates: [0, 0] } }]), []);
});
