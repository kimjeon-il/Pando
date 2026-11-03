import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import vm from 'node:vm';
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";
import {createNodeSelection} from '../helpers/core-selection.mjs';

import { createSelectionUiController } from "../../shared/frontend/js/modules/selection-ui-controller.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { editorNode } from './helpers/dom-node-fixture.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const countryLabels = () => {
  const rendering = read('shared/frontend/js/modules/label-presentation.js');
  return rendering.slice(rendering.indexOf('const renderTerritorialLabels ='), rendering.indexOf('enter.append(\'image\')', rendering.indexOf('const renderTerritorialLabels =')));
};









test('ground map clicks keep the common coordinate handler and label rendering does not duplicate editing tools', () => {
  assert.doesNotMatch(countryLabels(), /toggleNewCountrySource|toggleAnnexDonor|toggleMergeTarget|toggleBoundaryEditCountry/);
  assert.match(countryLabels(), /if \(labels\.mapClickBlocked\?\.\(\)\) return;/);
  assert.match(read('shared/frontend/js/modules/map-input-presentation.js'), /svg\.on\('click', function\(\)\s*\{\s*if \(mapClickBlocked\(\)\) return;\s*handleMapClick\(d3\.mouse\(this\)\);/);
});
