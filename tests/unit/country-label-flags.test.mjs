import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCountryFlags } from '../../assets/js/modules/country-label-flags.js';
const item = (id, x) => ({ sourceType: 'country', source: { id }, box: { left: x, right: x + 30, top: 0, bottom: 20 } });
const options = { zoom: 2, enabled: true, flagUrl: f => f.id === 'NONE' ? null : `/${f.id}.svg`, isCountry: f => f.id !== 'SUBUNIT' };
test('flags require zoom, toggle, country membership and an actual flag', () => {
  const rows = [item('POL', 0), item('SUBUNIT', 100), item('NONE', 200)];
  assert.equal(layoutCountryFlags(rows, options).size, 1);
  assert.equal(layoutCountryFlags(rows, { ...options, zoom: 1 }).size, 0);
  assert.equal(layoutCountryFlags(rows, { ...options, enabled: false }).size, 0);
});
test('collision drops only flags and never mutates or removes name candidates', () => {
  const rows = [item('POL', 0), item('DEU', 38)];
  const before = structuredClone(rows);
  assert.equal(layoutCountryFlags(rows, options).size, 0);
  assert.deepEqual(rows, before);
  assert.equal(layoutCountryFlags([item('POL', 0), item('DEU', 100)], options).size, 2);
});
