import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCountrySharedBoundarySegments, buildTerritorialInternalBoundarySegments } from "../../shared/frontend/js/modules/boundary-topology.js";

test('no polygon units never inspect canonical country geometry', () => {
  const countries = [{ get geometry() { throw new Error('must not inspect countries'); } }];
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, []), []);
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, [{ geometry: { type: 'Point', coordinates: [0, 0] } }]), []);
});

const polygon = (id, coordinates, properties = {}) => ({
  type: 'Feature',
  id,
  properties,
  geometry: { type: 'Polygon', coordinates: [coordinates] },
});

const country = (id = 'A') => polygon(id, [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], { entityKind: 'general', parentId: '' });
const leftUnit = (id, properties) => polygon(id, [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], properties);
const rightUnit = (id, properties) => polygon(id, [[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]], properties);
const internalSegments = (countries, units) => buildTerritorialInternalBoundarySegments(countries, units)
  .filter(segment => segment.a[0] === 2 && segment.b[0] === 2);

test('general children with the same root preserve both owners and use the short dashed boundary style', () => {
  const segments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'general', parentId: 'A' }),
  ]);
  assert.ok(segments.length);
  assert.ok(Math.abs(segments.reduce((sum,segment)=>sum+Math.abs(segment.a[1]-segment.b[1]),0)-4)<1e-9);
  assert.ok(segments.every(segment=>segment.styleType==='subunit-internal'));
  assert.equal(segments[0].styleType, 'subunit-internal');
  for(const segment of segments)assert.deepEqual(segment.unitOwners,[
    {id:'left',entityKind:'general',rootId:'A'}, {id:'right',entityKind:'general',rootId:'A'}]);
});

test('a one-sided general perimeter inside its root uses the same short dashed style', () => {
  const segments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
  ]);
  assert.ok(segments.length);
  assert.ok(Math.abs(segments.reduce((sum,segment)=>sum+Math.abs(segment.a[1]-segment.b[1]),0)-4)<1e-9);
  assert.ok(segments.every(segment=>segment.styleType==='subunit-internal'));
  assert.equal(segments[0].styleType, 'subunit-internal');
});

test('valid cross-root general edges are left to the country boundary renderer', () => {
  const countries = [country('A'), country('B')];
  const segments = internalSegments(countries, [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'general', parentId: 'B' }),
  ]);
  assert.deepEqual(segments, []);
});

test('independent regional styling needs no country association and missing parents fail visibly', () => {
  const regionSegments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'regional', parentId: '' }),
  ]);
  assert.ok(regionSegments.length);
  assert.ok(Math.abs(regionSegments.reduce((sum,segment)=>sum+Math.abs(segment.a[1]-segment.b[1]),0)-4)<1e-9);
  assert.ok(regionSegments.every(segment=>segment.styleType==='region'));
  assert.equal(regionSegments[0].styleType, 'region');

  assert.throws(() => internalSegments([country()], [
    leftUnit('invalid', { entityKind: 'general', parentId: 'missing' }),
  ]), /부모/);
});

test('country exteriors are not duplicated by territorial boundary segments', () => {
  assert.deepEqual(buildTerritorialInternalBoundarySegments([country()], [
    polygon('whole', [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], { entityKind: 'general', parentId: 'A' }),
  ]), []);
});

test('exclusive child territory keeps its land contact and excludes its coast and detached islands', () => {
  const root = country();
  const child = polygon('child', [[4, 0], [6, 0], [6, 4], [4, 4], [4, 0]], { entityKind: 'general', parentId: 'A' });
  const island = polygon('island', [[8, 0], [9, 0], [9, 1], [8, 1], [8, 0]], { entityKind: 'general', parentId: 'child' });
  const before = structuredClone([root, child, island]);
  const segments = buildTerritorialInternalBoundarySegments([root], [child, island]);
  assert.ok(segments.length, 'the land contact must remain visible');
  assert.ok(segments.every(segment => segment.a[0] === 4 && segment.b[0] === 4), 'sea-facing child edges must not become internal boundaries');
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + Math.abs(segment.a[1] - segment.b[1]), 0) - 4) < 1e-9);
  assert.ok(segments.every(segment => segment.unitOwners.some(owner => owner.id === 'child')));
  assert.deepEqual([root, child, island], before);
});

test('Hong Kong and Macao source coastlines never enter the persistent child boundary scene', () => {
  const feature = id => {
    const source = JSON.parse(readFileSync(repositoryFrontendUrl(`assets/data/territorial-entities/source/countries/state-${id}.json`), 'utf8'));
    return { type: 'Feature', id, properties: { entityKind: source.entityKind, parentId: source.parentEntityId.replace('state:', '') }, geometry: source.geometryVersions[0].geometry };
  };
  const root = feature('CHN'), children = [feature('HKG'), feature('MAC')];
  const before = structuredClone([root, ...children]);
  const segments = buildTerritorialInternalBoundarySegments([root], children);
  assert.ok(segments.some(segment => segment.unitOwners.some(owner => owner.id === 'HKG')), 'Hong Kong land border must remain');
  // The current Macao source has no shared source edge with CHN. Do not
  // invent a land contact to compensate for that separate data discrepancy.
  const contacts = buildCountrySharedBoundarySegments([root, ...children]);
  const length = rows => rows.reduce((sum, row) => {
    const a = row.a || row.start, b = row.b || row.end;
    return sum + Math.hypot(a[0] - b[0], a[1] - b[1]);
  }, 0);
  assert.ok(Math.abs(length(segments) - length(contacts)) < 1e-7, 'only the actual shared land contact remains');
  assert.equal(segments.filter(segment => segment.unitOwners.some(owner => owner.id === 'HKG') && Math.max(segment.a[1], segment.b[1]) < 22.3).length, 0, 'Hong Kong southern islands are coast, not internal boundary');
  assert.equal(segments.filter(segment => segment.unitOwners.some(owner => owner.id === 'MAC') && Math.max(segment.a[1], segment.b[1]) < 22.18).length, 0, 'Macao southern islands are coast, not internal boundary');
  assert.deepEqual([root, ...children], before);
});
