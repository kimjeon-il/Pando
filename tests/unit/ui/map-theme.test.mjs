import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMapTheme} from '../../../src/ui/map-theme.js';

const state = (terrainVisible, terrainStyle) => ({
  physicalSettings: {terrainVisible, terrainStyle},
});

test('colored relief uses no national tint while preserving border presentation', () => {
  for (const theme of ['light', 'dark']) {
    const result = resolveMapTheme({state:state(true,'physical'),theme});
    assert.equal(result.countryColorAlpha,0);
    assert.equal(result.terrainColorAlpha,0);
    assert.equal(result.baseLandAlpha,1);
    assert.ok(result.borderAlpha>0, 'nation boundaries must remain');
  }
});

test('monochrome relief keeps identifiable national tint without hiding shade', () => {
  for (const theme of ['light','dark']) {
    const result = resolveMapTheme({state:state(true,'political'),theme});
    assert.equal(result.countryColorAlpha,0.45);
    assert.equal(result.terrainColorAlpha,0.45);
    assert.equal(result.baseLandAlpha,1);
    assert.ok(result.borderAlpha>0);
  }
});

test('turning terrain off preserves the original standalone nation colors', () => {
  assert.equal(resolveMapTheme({state:state(false,'physical'),theme:'light'}).countryColorAlpha,1);
  assert.equal(resolveMapTheme({state:state(false,'political'),theme:'dark'}).countryColorAlpha,0.74);
});
