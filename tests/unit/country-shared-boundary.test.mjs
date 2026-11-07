import { describe as contractSuite } from 'node:test';
import * as __boundary_dep0 from "../helpers/gis-polygon-fixture.mjs";
import "../helpers/spherical-core.mjs";
import * as __boundary_dep1 from "../../shared/frontend/js/modules/map-interaction-style.js";
import * as __boundary_dep2 from "node:test";
import * as __boundary_dep3 from "node:assert/strict";
import * as __boundary_dep4 from "../../shared/frontend/js/modules/boundary-topology.js";
import * as __boundary_dep5 from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import * as __boundary_dep6 from "../../shared/frontend/js/modules/country-shared-boundary-cache.js";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";
import * as __boundary_dep7 from "../../shared/frontend/js/modules/boundary-lines.js";
import * as __boundary_dep8 from "../../shared/frontend/js/modules/country-contact-core.js";

// Original feature contract: country-shared-boundary.test.mjs
contractSuite("country-shared-boundary", () => {
const { rectanglePolygon } = __boundary_dep0;
const { resolveMapStrokeStyle } = __boundary_dep1;
const test = __boundary_dep2.default;
const assert = __boundary_dep3.default;
const { buildCountrySharedBoundarySegments } = __boundary_dep4;
const { prepareCountrySharedBoundaryPacket, visibleCountrySharedSegments, shouldShowSharedCountryBorders, createCountrySharedBoundaryState } = __boundary_dep5;
const { countryGeometrySignature, changedCountryGeometryIds } = __boundary_dep6;
const { connectBoundarySegments } = __boundary_dep7;











const displayLength = segments => segments.reduce((sum, segment) => sum
  + Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]), 0);

const rectangle = (id, west, south, east, north) => ({
  type: 'Feature', id, properties: {}, geometry: rectanglePolygon(west, south, east, north),
});

test('one shared packet owns parent and child outlines with the same coast policy and distinct line shapes', () => {
  const parent = { ...rectangle('ROOT', 0, 0, 2, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('CHILD', 2, 0, 3, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: 'ROOT' } };
  const features = [parent, child], contacts = buildCountrySharedBoundarySegments(features);
  const terrain = prepareCountrySharedBoundaryPacket(contacts, features, { includeOutlines: false });
  assert.ok(terrain.segments.length);
  assert.ok(terrain.segments.every(segment => segment.start[0] === 2 && segment.end[0] === 2));
  assert.equal(terrain.outlineOverrides.segments.length, 0);
  const outline = prepareCountrySharedBoundaryPacket(contacts, features, { includeOutlines: true });
  assert.ok(outline.outlineOverrides.segments.some(segment => segment.ownerIds.includes('CHILD') && segment.start[0] === 3 && segment.end[0] === 3));
  assert.deepEqual(outline.outlineOverrides.internalOwners.CHILD, ['CHILD']);
  assert.deepEqual(outline.outlineOwnerIds, ['CHILD', 'ROOT']);
  const before = structuredClone(features);
  prepareCountrySharedBoundaryPacket(contacts, features);
  assert.deepEqual(features, before);
});

test('general siblings and child boundaries wholly inside a parent remain in the single shared owner', () => {
  const parent = { ...rectangle('ROOT', 0, 0, 4, 4), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('CHILD', 1, 1, 2, 2), boundaryRootId: 'ROOT', properties: { entityKind: 'general', parentId: 'ROOT' } };
  const packet = prepareCountrySharedBoundaryPacket([], [parent, child], { includeOutlines: false });
  assert.ok(packet.segments.length, 'a child inside the parent has a land boundary even without matching source perimeter contacts');
  assert.ok(Object.values(packet.internalOwners).some(ids => ids.includes('CHILD')));
});

test('physical country boundaries contain shared land borders exactly once, without coasts', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
    rectangle('ISLAND', 5, 0, 6, 1),
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].ownerIds, ['LEFT', 'RIGHT']);
  assert.deepEqual([segments[0].start, segments[0].end].sort((a, b) => a[1] - b[1]), [[1, 0], [1, 1]]);
});

test('a deleted neighbor turns a former shared border into a coast', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  assert.equal(buildCountrySharedBoundarySegments([left, right]).length, 1);
  assert.equal(buildCountrySharedBoundarySegments([left]).length, 0);
  const previous = buildCountrySharedBoundarySegments([left, right]);
  const state = createCountrySharedBoundaryState();
  state.replace([left], { cachedSegments: previous, changedIds: new Set(['RIGHT']) });
  assert.deepEqual(state.segments(), []);
});

test('a changed country updates only its shared contact and does not reuse stale cache', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  const island = rectangle('ISLAND', 4, 0, 5, 1);
  const signatures = Object.fromEntries([left, right, island]
    .map(feature => [feature.id, countryGeometrySignature(feature)]));
  const moved = rectangle('RIGHT', 1, 1, 2, 2);
  assert.deepEqual([...changedCountryGeometryIds([left, moved, island], signatures)], ['RIGHT']);
  const previous = buildCountrySharedBoundarySegments([left, right, island]);
  const state = createCountrySharedBoundaryState();
  state.replace([left, moved, island], { cachedSegments: previous,
    changedIds: changedCountryGeometryIds([left, moved, island], signatures) });
  assert.deepEqual(state.segments(), []);
});

test('artificial dateline edges do not become country borders', () => {
  const east = rectangle('EAST', 179, 0, 180, 1);
  const west = rectangle('WEST', 180, 0, 181, 1);
  assert.deepEqual(buildCountrySharedBoundarySegments([east, west]), []);
});

test('physical style alone switches the base border to the shared packet', () => {
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'physical' }), true);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: false, terrainStyle: 'physical' }), false);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'political' }), false);
});

test('one hidden owner keeps a shared border, while two hidden owners remove it', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
  ]);
  const packet = prepareCountrySharedBoundaryPacket(segments);
  assert.ok(packet.segments.length > 1);
  assert.equal(packet.preparedGeometry.segmentCount, packet.segments.length);
  assert.equal(visibleCountrySharedSegments(packet.segments, id => id === 'LEFT').length, packet.segments.length);
  assert.equal(visibleCountrySharedSegments(packet.segments, () => false).length, 0);
});

test('native child contact belongs to dashed lower boundaries and is removed from both solid outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 1), boundaryRootId: 'CHN' };
  const child = { ...rectangle('HKG', 1, 0, 2, 1), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  assert.deepEqual(packet.outlineOverrides.ownerIds, ['CHN', 'HKG']);
  assert.deepEqual(packet.outlineOverrides.internalOwners.HKG, ['HKG']);
  assert.ok(Math.abs(displayLength(packet.outlineOverrides.segments) - 6) < 1e-9);
  assert.ok(packet.outlineOverrides.segments.every(segment => !(segment.start[0] === 1 && segment.end[0] === 1)));
});

test('split contacts remove only their covered interval from solid parent outlines', () => {
  const parent = { ...rectangle('CHN', 0, 0, 1, 3), boundaryRootId: 'CHN' };
  const child = { ...rectangle('MAC', 1, 1, 2, 2), boundaryRootId: 'CHN' };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners['CHN|MAC'], ['MAC']);
  const contact = packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN' && segment.start[0] === 1 && segment.end[0] === 1);
  const intervals = connectBoundarySegments(contact.map(segment => [segment.start, segment.end]))
    .map(line => [Math.min(...line.map(point => point[1])), Math.max(...line.map(point => point[1]))])
    .sort((left, right) => left[0] - right[0]);
  assert.deepEqual(intervals, [[0, 1], [2, 3]]);
  assert.ok(Math.abs(displayLength(contact) - 2) < 1e-9);
});


test('both renderers use lower visibility for internal borders and preserve solid external borders', () => {
  const features = [
    { ...rectangle('CHN', 0, 0, 1, 1), boundaryRootId: 'CHN' },
    { ...rectangle('HKG', 1, 0, 2, 1), boundaryRootId: 'CHN' },
    { ...rectangle('VNM', 0, -1, 1, 0), boundaryRootId: 'VNM' },
  ];
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments(features), features);
  const theme = { border: '#323c46', borderAlpha: 1, borderWidth: 1 };
  theme.strokes = Object.fromEntries(['country', 'country-internal'].map(role => [role, resolveMapStrokeStyle({ theme }, role)]));
  const { countryBoundaryBatches, drawStrokes } = globalThis.PandoLabCanvasSceneComposition;
  for (const sharedOnly of [true, false]) {
    const batches = countryBoundaryBatches(packet, theme, sharedOnly, () => ({ opacity: 1 }));
    const dashed = batches.filter(batch => batch.style.dash?.[0] > 0);
    assert.equal(dashed.length, sharedOnly ? 1 : 2);
    assert.ok(dashed.some(batch => batch.ownerIds.includes('CHN|HKG')));
    assert.ok(batches.some(batch => !(batch.style.dash?.[0] > 0)));
    assert.ok(countryBoundaryBatches(packet, theme, sharedOnly, id => id !== 'HKG' ? { opacity: 1 } : null).every(batch => !(batch.style.dash?.[0] > 0)));
    const transparent = countryBoundaryBatches(packet, theme, sharedOnly, id => ({ opacity: id === 'HKG' ? 0.4 : 1 }));
    assert.equal(transparent.find(batch => batch.style.dash?.[0] > 0).style.alpha, 0.4);
  }
  const calls = [];
  const context = { save() {}, restore() {}, beginPath() {}, stroke() { calls.push('stroke'); }, setLineDash(dash) { calls.push([...dash]); } };
  drawStrokes(context, geometry => calls.push(geometry.coordinates), countryBoundaryBatches(packet, theme, true, () => ({ opacity: 1 })));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 3 && call[1] === 2));
  assert.equal(calls.filter(call => call === 'stroke').length, 2);
});

test('the shared owner replaces every native outline and applies dashed style to child coasts', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 1, 1, 2, 2), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket([], [parent, child]);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  assert.ok(packet.segments.some(segment => segment.ownerIds.includes('HKG')));
  assert.deepEqual(packet.outlineOverrides.internalOwners.HKG, ['HKG']);
  assert.deepEqual(packet.ownerIds, ['CHN', 'HKG']);
});

test('overlapping parent and child coastlines follow the shared mode policy and have one owner', () => {
  const parent = { ...rectangle('CHN', 0, 0, 4, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: '' } };
  const child = { ...rectangle('HKG', 0, 0, 2, 4), boundaryRootId: 'CHN', properties: { entityKind: 'general', parentId: 'CHN' } };
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.deepEqual(packet.internalOwners, { 'CHN|HKG': ['HKG'] });
  assert.ok(packet.segments.length);
  assert.deepEqual(packet.outlineOwnerIds, ['CHN', 'HKG']);
  const terrain = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child], { includeOutlines: false });
  assert.ok(terrain.segments.every(segment => segment.start[0] === 2 && segment.end[0] === 2));
  assert.ok(Math.abs(displayLength(terrain.segments) - 4) < 1e-9);
});

test('the same owner pair can have both a coincident coast and an internal contact', () => {
  const multi = (id, parts, rootId) => ({ type: 'Feature', id, properties: {}, boundaryRootId: rootId,
    geometry: { type: 'MultiPolygon', coordinates: parts.map(feature => feature.geometry.coordinates) } });
  const parent = multi('CHN', [rectangle('a', 0, 0, 1, 1), rectangle('b', 5, 0, 6, 1)], 'CHN');
  const child = multi('HKG', [rectangle('a', 0, 0, 1, 1), rectangle('b', 6, 0, 7, 1)], 'CHN');
  const packet = prepareCountrySharedBoundaryPacket(buildCountrySharedBoundarySegments([parent, child]), [parent, child]);
  assert.ok(packet.segments.length > 1);
  assert.ok(Math.abs(displayLength(packet.segments) - 1) < 1e-9);
  assert.deepEqual(packet.internalOwners['CHN|HKG'], ['HKG']);
  const coast = packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'CHN'
    && segment.start[0] <= 1 && segment.end[0] <= 1);
  assert.ok(Math.abs(displayLength(coast) - 4) < 1e-9);
  assert.ok(coast.every(segment => segment.ownerIds.includes('HKG')));
  assert.equal(packet.outlineOverrides.segments.filter(segment => segment.ownerIds[0] === 'HKG' && segment.start[0] <= 1 && segment.end[0] <= 1).length, 0);
});
});

// Original feature contract: country-contact-core.test.mjs
contractSuite("country-contact-core", () => {
const test = __boundary_dep2.default;
const assert = __boundary_dep3.default;
const { createPreparedBoundaryStore, buildCountrySharedBoundaryContact, buildCountrySharedBoundarySegments, attachBoundarySegmentReferences } = __boundary_dep4;
const { computeCountrySharedContacts } = __boundary_dep8;





const feature=(id,w,s,e,n)=>({id,geometry:{type:'Polygon',coordinates:[[
  [w,s],[e,s],[e,n],[w,n],[w,s],
]]}});
test('batched source contacts preserve source references and pair order',()=>{
  const prepared=createPreparedBoundaryStore();
  prepared.replace([feature('A',0,0,1,2),feature('B',1,0,2,2),
    feature('C',4,0,5,1),feature('D',5,0,6,1)]);
  const a=prepared.get('A'),b=prepared.get('B'),c=prepared.get('C'),d=prepared.get('D');
  const calculated=computeCountrySharedContacts([[a,b],[c,d]]);
  assert.equal(calculated.length,2);
  assert.equal(calculated[0].length,1);
  assert.equal(calculated[1].length,1);
  assert.deepEqual(calculated[0][0].ownerIds,['A','B']);
  assert.deepEqual(calculated[1][0].ownerIds,['C','D']);
  assert.deepEqual(calculated[0],buildCountrySharedBoundaryContact(a,b));
  for(const ref of calculated[0][0].refs){
    const original=prepared.get(ref.featureId).segments.find(row=>
      row.polygonIndex===ref.polygonIndex && row.ringIndex===ref.ringIndex
      && row.segmentIndex===ref.segmentIndex);
    assert.strictEqual(ref.a,original.a);
    assert.strictEqual(ref.b,original.b);
  }
});
test('the C++ batch retains split contacts and empty batch semantics',()=>{
  const prepared=createPreparedBoundaryStore();
  prepared.replace([feature('ROOT',0,0,1,4),feature('CHILD',1,1,2,3)]);
  const contacts=computeCountrySharedContacts([[prepared.get('ROOT'),prepared.get('CHILD')]]);
  assert.equal(contacts.length,1);
  assert.equal(contacts[0].length,1);
  assert.deepEqual(contacts[0][0].ownerIds,['CHILD','ROOT']);
  assert.deepEqual(computeCountrySharedContacts([]),[]);
});
test('prepared geographic lookup excludes Greenwich false contacts and finds shifted dateline contacts',()=>{
  const dateline=feature('DATE',179,0,-179,1),greenwich=feature('ZERO',0,1,1,2);
  const prepared=createPreparedBoundaryStore();prepared.replace([dateline,greenwich]);
  assert.deepEqual(buildCountrySharedBoundarySegments([dateline,greenwich],{preparedStore:prepared}),[]);
  const shifted=feature('SHIFT',539,1,541,2);
  prepared.replace([dateline,shifted]);
  const before=prepared.stats().preparationCount;
  const contacts=buildCountrySharedBoundarySegments([dateline,shifted],{preparedStore:prepared});
  assert.equal(contacts.length,2);
  for(const contact of contacts){
    assert.ok(Math.abs(contact.start[0])>=179&&Math.abs(contact.end[0])>=179);
    const restored=attachBoundarySegmentReferences({...contact,refs:undefined},prepared);
    assert.equal(restored.refs.length,2);
    assert.deepEqual(restored.refs.map(ref=>ref.featureId),['DATE','SHIFT']);
  }
  assert.equal(prepared.stats().preparationCount,before);
});

test('P6 sparse C++ source preserves full pair results and current source refs',()=>{
  const local=[[0,0],[1,0],[1,2],[0,2],[0,0]];
  const far=Array.from({length:1001},(_,index)=>{
    const theta=index/1000*Math.PI*2;
    return [110+Math.cos(theta),45+Math.sin(theta)];
  });
  const a={id:'A',geometry:{type:'MultiPolygon',coordinates:[[local],[far]]}};
  const b=feature('B',1,0,2,2);
  const prepared=createPreparedBoundaryStore();
  prepared.replace([a,b]);
  const left=prepared.get('A'),right=prepared.get('B'),profile=[];
  const sparse=computeCountrySharedContacts([[left,right]],(stage,ms,details)=>
    profile.push({stage,ms,...details}),{verifyParity:true});
  const full=computeCountrySharedContacts([[left,right]],null,{unpruned:true});
  assert.deepEqual(sparse,full);
  const pruned=profile.find(row=>row.stage==='contact-select-source');
  assert.ok(pruned.selectedEdges<pruned.sourceEdges/2,
    'irrelevant distant coastline must not enter the contact native index');
  assert.equal(profile.find(row=>row.stage==='contact-parity-full').matched,true);
  for(const ref of sparse[0][0].refs){
    const source=prepared.get(ref.featureId).segments.find(row=>
      row.polygonIndex===ref.polygonIndex&&row.ringIndex===ref.ringIndex
      &&row.segmentIndex===ref.segmentIndex);
    assert.strictEqual(ref.a,source.a);
    assert.strictEqual(ref.b,source.b);
  }
});
test('P6 sparse indexing matches full C++ native contacts at the shifted dateline',()=>{
  const prepared=createPreparedBoundaryStore();
  const a=feature('A',179,0,-179,1),b=feature('B',539,1,541,2);
  prepared.replace([a,b]);
  const pair=[[prepared.get('A'),prepared.get('B')]];
  const baseline=computeCountrySharedContacts(pair,null,{unpruned:true});
  const sparse=computeCountrySharedContacts(pair,null,{verifyParity:true});
  assert.deepEqual(sparse,baseline);
});
});
