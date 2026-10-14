import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWebMapPresentationContract } from '../helpers/web-map-presentation-contract.mjs';
test('frozen actual Web map controls preserve explicit view dirty requests and per-group style policy',() => {
  const rows=captureWebMapPresentationContract();
  assert.equal(rows.length,10);
  assert.deepEqual(rows.map(row=>row.documentDirty),Array(10).fill(false));
  assert.equal(rows[5].presentationDirty,false);assert.equal(rows[6].presentationDirty,true);
  assert.equal(rows[1].layerVisibility.countryFlags,undefined);
  assert.equal(rows[2].layerVisibility.basemapLabels,false);
  assert.notEqual(rows[1].currentPresentationToken,rows[2].currentPresentationToken);
  assert.equal(rows[8].layerPresentation.styles.countries.boundaryWidth,1);
  assert.equal(rows[8].layerPresentation.styles.countries.labelsVisible,true);
  assert.equal(rows[9].layerPresentation.objectStyles['territorial:entity:B'].opacity,0.5);
});
