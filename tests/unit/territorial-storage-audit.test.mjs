import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTerritorialStorage, unclassifiedTerritorialAccesses } from '../../scripts/lib/territorial-storage-audit.mjs';

const writes = source => auditTerritorialStorage(source).filter(entry => entry.access === 'write');
test('a classified reader cannot write and a neighbouring unclassified function cannot borrow its exception', () => {
  const entries = auditTerritorialStorage('function read(state) { state.territorialUnits.push({}); } function other(state) { return state.countriesData; }', 'app.js');
  const failures = unclassifiedTerritorialAccesses(entries, { owners: [{ file: 'app.js', functions: ['read'], access: ['read'] }] });
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(entry => [entry.function, entry.access]).sort(), [['other', 'read'], ['read', 'write']]);
});
test('storage audit follows destructuring, local array/entity aliases and optional chains', () => {
  const found = writes(`function bad(state) {
    const { territorialUnits: units } = state;
    units.push({});
    const feature = units.find(item => item.id === 'A');
    feature.geometry = {};
    const countries = state?.countriesData?.features;
    countries.splice(0, 1);
    for (const country of countries) country.properties.name = 'changed';
    Object.assign(feature.properties, { name: 'changed' });
  }`);
  assert.equal(found.length, 5);
  assert.ok(found.every(entry => entry.function === 'bad'));
});
test('storage audit distinguishes detached containers, shared elements, deep copies and local rebinding', () => {
  const found = writes(`function edit(state) {
    const countries = state.countriesData.features.slice();
    countries.push({});
    countries[0].geometry = {};
    const copied = structuredClone(state.countriesData);
    copied.features.push({});
    let item = state.territorialUnits[0];
    item = { properties: {} };
    item.properties.name = 'detached';
    state.territorialUnits.map(item => ({ ...item })).push({});
  }`);
  // A copied array still aliases its original elements.
  assert.equal(found.length, 1);
  assert.match(found[0].expression, /countries\[0\]/);
});
test('store/repository getters and scope shadowing cannot hide illegal mutations', () => {
  const found = writes(`function bad(entityStore, entityRepository, state) {
    const item = entityRepository.get('A');
    item.geometry = {};
    (0, entityStore.units)().push(item);
    const units = state.territorialUnits;
    function unrelated() { const units = []; units.push({}); }
    unrelated();
    units.reverse();
  }`);
  assert.equal(found.length, 3);
  assert.ok(found.every(entry => entry.function === 'bad'));
});

test('nested destructuring and local returned/getter aliases remain tracked', () => {
  assert.equal(writes(`function bad(state, entityStore) {
    const { countriesData: { features } } = state;
    features.pop();
    const getUnits = entityStore.units;
    getUnits().push({});
    function selected() { return state.territorialUnits[0]; }
    selected().geometry = {};
  }`).length, 3);
});
