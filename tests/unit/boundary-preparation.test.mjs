import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { topologyNodeKey } from "../../shared/frontend/js/modules/boundary-topology.js";
import { createBoundarySpatialIndex } from "../../shared/frontend/js/modules/boundary-spatial-index.js";

import { createMapVisualFrame } from "../../shared/frontend/js/modules/map-visual-frame.js";


const feature = (id, ring, properties = {}) => ({ type: 'Feature', id, properties, geometry: { type: 'Polygon', coordinates: [ring] } });
const fixtures = () => [
  feature('A', [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]),
  feature('B', [[2, 0], [4, 0], [4, 2], [2, 2], [2, 1], [2, 0]]),
  feature('C', [[2, 2], [4, 2], [3, 3], [2, 2]]),
];
const request = { targetIds: ['A', 'B'], mode: 'border' };













test('dateline queries split without losing a long segment crossing the viewport', () => {
  const index = createBoundarySpatialIndex();
  index.insert('east', 'east', [178, 0, 179, 1]); index.insert('west', 'west', [-179, 0, -178, 1]);
  index.insert('long', 'long', [-10, 0, 10, 0]);
  assert.deepEqual(index.query([177, -1, -177, 2]).sort(), ['east', 'west']);
  assert.deepEqual(index.query([-1, -1, 1, 1]), ['long']);
});
