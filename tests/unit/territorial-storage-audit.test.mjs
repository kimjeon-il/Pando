import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditTerritorialStorage, unclassifiedTerritorialAccesses } from '../../scripts/lib/territorial-storage-audit.mjs';

const writes = source => auditTerritorialStorage(source).filter(entry => entry.access === 'write');
test('a classified reader cannot write and a neighbouring unclassified function cannot borrow its exception', () => {
  const entries = auditTerritorialStorage('function read(state) { state.territorialEntities.push({}); } function other(state) { return state.territorialEntities; }', 'app.js');
  const failures = unclassifiedTerritorialAccesses(entries, { owners: [{ file: 'app.js', functions: ['read'], access: ['read'] }] });
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(entry => [entry.function, entry.access]).sort(), [['other', 'read'], ['read', 'write']]);
});
test('storage audit follows destructuring, local array/entity aliases and optional chains', () => {
  const found = writes(`function bad(state) {
    const { territorialEntities: units } = state;
    units.push({});
    const feature = units.find(item => item.id === 'A');
    feature.geometry = {};
    const countries = state?.territorialEntities;
    countries.splice(0, 1);
    for (const country of countries) country.properties.name = 'changed';
    Object.assign(feature.properties, { name: 'changed' });
  }`);
  assert.equal(found.length, 5);
  assert.ok(found.every(entry => entry.function === 'bad'));
});
test('storage audit distinguishes detached containers, shared elements, deep copies and local rebinding', () => {
  const found = writes(`function edit(state) {
    const countries = state.territorialEntities.slice();
    countries.push({});
    countries[0].geometry = {};
    const copied = structuredClone(state.territorialEntities);
    copied.push({});
    let item = state.territorialEntities[0];
    item = { properties: {} };
    item.properties.name = 'detached';
    state.territorialEntities.map(item => ({ ...item })).push({});
  }`);
  // A copied array still aliases its original elements.
  assert.equal(found.length, 1);
  assert.match(found[0].expression, /countries\[0\]/);
});
test('store/repository getters and scope shadowing cannot hide illegal mutations', () => {
  const found = writes(`function bad(entityStore, entityRepository, state) {
    const item = entityRepository.get('A');
    item.geometry = {};
    (0, entityStore.snapshot)().push(item);
    const units = state.territorialEntities;
    function unrelated() { const units = []; units.push({}); }
    unrelated();
    units.reverse();
  }`);
  assert.equal(found.length, 3);
  assert.ok(found.every(entry => entry.function === 'bad'));
});

test('nested destructuring and local returned/getter aliases remain tracked', () => {
  assert.equal(writes(`function bad(state, entityStore) {
    const { territorialEntities: features } = state;
    features.pop();
    const getUnits = entityStore.snapshot;
    getUnits().push({});
    function selected() { return state.territorialEntities[0]; }
    selected().geometry = {};
  }`).length, 3);
});

test('candidate write ownership requires a fresh detached initializer', () => {
  const file = 'apps/editor/'+'frontend/js/modules/library-geometry-context.js';
  const policy = { owners: [{ file, functions: ['prepare'], access: ['read', 'write'], detachedCandidate: true }] };
  const source = (initializer, prefix = '', declaration = 'const') => `${prefix}
    function prepare(input, documentModel) {
      ${declaration} project = ${initializer};
      project.territorialEntities.push({});
      return project;
    }`;
  const check = value => {
    const entries = auditTerritorialStorage(value, file);
    assert.equal(entries.length, 2, 'both the raw access and mutation stay in the inventory');
    return unclassifiedTerritorialAccesses(entries, policy);
  };
  assert.deepEqual(check(source('structuredClone(input)')), []);
  assert.deepEqual(check(source('createInitialDocument({appVersion:"test"})',
    'import {createInitialDocument} from "../../../../../shared/frontend/js/modules/initial-document.js";')), []);
  for (const value of [
    source('input'),
    source('input.project'),
    source('documentModel.snapshot()'),
    source('structuredClone(input)', 'function structuredClone(value) { return value; }'),
    source('createInitialDocument(input)', 'import {createInitialDocument} from "./untrusted-document.js";'),
    source('structuredClone(input)', '', 'let'),
    'const project = structuredClone({}); function prepare() { project.territorialEntities.push({}); }',
    'function factory(input) { const project = structuredClone(input); return function prepare() { project.territorialEntities.push({}); }; }',
    'function prepare(input) { const project = structuredClone(input); return () => project.territorialEntities.push({}); }',
  ]) {
    assert.deepEqual(check(value).map(entry => entry.access).sort(), ['read', 'write']);
  }
});

const currentPolicy = JSON.parse(fs.readFileSync(new URL('../../scripts/contracts/territorial-storage-access.json', import.meta.url), 'utf8'));
const currentOwners = [
  ['shared/frontend/js/modules/app-map-settings.js', 'mapDisplayAvailability', false],
  ['shared/frontend/js/modules/project-session.js', 'pruneViewingItems', false],
  ['shared/frontend/js/modules/timeline-records.js', 'timelineObjectCatalog', false],
  ['shared/frontend/js/modules/builtin-world-loader.js', 'assembleBuiltinWorld', true],
];

test('current projection readers and detached source builders have explicit storage owners', () => {
  const entries = currentOwners.flatMap(([file, name]) => auditTerritorialStorage(
    fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), file)
    .filter(entry => entry.function === name));
  assert.ok(entries.length >= 1, 'Canonical projection readers must remain audited');
  assert.equal(entries.filter(entry => entry.access === 'write').length, 2,
    'Only canonical detached source builders retain the classified writes');
  assert.deepEqual(unclassifiedTerritorialAccesses(entries, currentPolicy), []);
});

test('current reader permissions and detached builders cannot authorize active document mutations', () => {
  for (const [file, name, candidate] of currentOwners) {
    const entries = auditTerritorialStorage(`function ${name}(project) {
      const rows = project.territorialEntities;
      rows.push({});
    }`, file);
    const failures = unclassifiedTerritorialAccesses(entries, currentPolicy);
    assert.deepEqual(failures.map(entry => entry.access).sort(), candidate ? ['read', 'write'] : ['write']);
    const neighbour = auditTerritorialStorage('function unrelated(input) { const project = structuredClone(input); project.territorialEntities.push({}); }', file);
    assert.equal(unclassifiedTerritorialAccesses(neighbour, currentPolicy).length, 2);
  }
});
