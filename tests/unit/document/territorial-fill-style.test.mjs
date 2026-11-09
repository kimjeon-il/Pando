import "../../../assets/js-vendor/polygon-clipping.min.js";
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../helpers/timeline-project.mjs";
import * as __dep1 from "../../../src/document/territorial-units.js";
import * as __dep2 from "../../../src/document/territorial-entity-store.js";
import * as __dep3 from "node:assert/strict";
import * as __dep4 from "node:test";
import * as __dep5 from "../../../src/rendering/territorial-fill-style.js";
import * as __dep6 from "../../../src/ui/layer-presentation.js";
import * as __dep7 from "../../../src/document/territorial-entity-repository.js";
import * as __dep8 from "../../../src/map/object-picking.js";
import * as __dep9 from "../../../src/document/object-ref-identity.js";
import * as __dep10 from "../../../src/document/territorial-scope.js";
import * as __dep11 from "../../../src/rendering/territorial-highlight-boundary.js";
import * as __dep12 from "../../../src/rendering/map-display-preparation.js";
import * as __dep13 from "../../helpers/core-gis-compat/land-relations.mjs";
import * as __dep14 from "../../../tools/gis/country-geometry-calculator.js";
import * as __dep15 from "../../../src/document/distribution-model.js";
contractSuite("territorial-fill-style", () => {
const { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } = __dep0;
const { createTerritorialFeature } = __dep1;
const { createTerritorialEntityStore } = __dep2;
const assert = __dep3.default;
const test = __dep4.default;
const { createTerritorialFillResolver } = __dep5;
const { normalizeLayerPresentation, resolveLayerDisplayColor } = __dep6;
const { createTerritorialEntityRepository } = __dep7;

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
const country = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry });
const subunit = createTerritorialFeature({ id: 'S', entityKind: 'general', parentId: 'A', color: '#cc5500', geometry });
const region = createTerritorialFeature({ id: 'R', entityKind: 'regional', color: '#0055cc', geometry });

test('disabled territorial paint reveals the map substrate without changing stored colors', async () => {
  const state = {
    territorialEntities: [country, subunit, region],
    layerPresentation: normalizeLayerPresentation({ styles: {
      objects: { colorVisible: false },
    }, objectStyles: {} }),
  };
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const resolve = createTerritorialFillResolver({ state, entityRepository, });
  assert.equal(resolve(country).fillAlpha, 0);
  assert.equal(resolve(subunit).color, '');
  assert.equal(resolve(subunit).fillAlpha,0);
  assert.equal(subunit.properties.style.color,'#cc5500');
  assert.equal(resolve(region).color, '');
  assert.equal(resolve(region).fillAlpha, 0);
  assert.equal(region.properties.style.color, '#0055cc');
});

test('country palette and territorial fills can resolve an absent color channel', () => {
  const presentation = { styles: { objects: { colorVisible: false } },objectStyles:{'territorial:entity:S':{colorVisible:true}} };
  assert.equal(resolveLayerDisplayColor(presentation, 'objects', {
    explicitColor: '#aa0000', fallbackColor: '',
  }), '');
  assert.equal(resolveLayerDisplayColor(presentation, 'objects', {
    objectKey: 'territorial:entity:S', explicitColor: '#cc5500', fallbackColor: '#f1f2f3',
  }), '#cc5500');
});

test('map modes own unpainted land; explicit gray is still object paint', async () => {
  const state = { territorialEntities: [country] };
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  for (const terrainAlpha of [1, 0.68, 0.22]) {
    await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'A',field:'color',value:'' ,valuePresent:true});
    let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '');
    assert.equal(resolve(country).fillAlpha, 0);
    await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'A',field:'color',value:'#cccccc' ,valuePresent:true});
    resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '#cccccc');
    assert.equal(resolve(country).fillAlpha, terrainAlpha);
  }
});

test('children inherit only assigned colors and retain their opacity and blend', async () => {
  const parent = { ...subunit, properties: { ...subunit.properties, style: {} } };
  const child = createTerritorialFeature({ id: 'C', entityKind: 'general', parentId: 'S', geometry });
  const state = { territorialEntities: [country, parent, child],
    layerPresentation: normalizeLayerPresentation({ styles: { objects: { opacity: 0.5, blendMode: 'multiply' } },
      objectStyles: { 'territorial:entity:A': { colorVisible: true } } }) };
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
  await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'A',field:'color',value:'#aa0000' ,valuePresent:true});
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).color, '#aa0000');
  assert.equal(resolve(child).fillAlpha, 0.11);
  assert.equal(resolve(child).blendMode, 'multiply');
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'groupStyle',group:'objects',patch:{ colorVisible:false } } });
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
});

test('pending no-terrain country patches use the map substrate without assigning a color', async () => {
  const state = { territorialEntities: [country] };
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const resolve = createTerritorialFillResolver({ state, entityRepository,
    mapSubstrate: { color: '#cccccc', fillAlpha: 1 } });
  assert.equal(resolve(country).color, '#cccccc');
  assert.equal(resolve(country).fillAlpha, 1);
  assert.deepEqual(country.properties.style, {});
});


test('an independent region uses common object settings without inheriting its parent overrides', async () => {
  const state = { territorialEntities: [country, region], layerPresentation: normalizeLayerPresentation({ styles: {
    objects: { opacity: 0.8, blendMode: 'normal' },
  },objectStyles:{'territorial:entity:A':{opacity:0.25,blendMode:'multiply'}} }) };
  await initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client }) });
  const material = createTerritorialFillResolver({ state, entityRepository })(region);
  assert.equal(material.opacity, 0.8);
  assert.equal(material.blendMode, 'normal');
  assert.equal(material.ownerId, '');
  assert.equal(material.depth, 0);
});

test('a direct child inherits the actual parent material, including per-object opacity and blend', async () => {
  const state = { territorialEntities: [country, subunit], layerPresentation: normalizeLayerPresentation({ objectStyles: {
    'territorial:entity:A': { opacity: 0.4, blendMode: 'multiply' },
  } }) };
  await initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client }) });
  const material = createTerritorialFillResolver({ state, entityRepository })(subunit);
  assert.equal(material.opacity, 0.4);
  assert.equal(material.blendMode, 'multiply');
  assert.equal(material.depth, 1);
  assert.equal(material.ownerId, 'A');
});

test('intrinsic country paint is inherited, explicit edits override it, and clearing restores it', async () => {
  const korea = createTerritorialFeature({ id: 'KOR', entityKind: 'general', geometry });
  const child = createTerritorialFeature({ id: 'KOR-child', entityKind: 'general', parentId: 'KOR', geometry });
  const state = { territorialEntities: [korea, child] };
  await initializeTestTerritorialState(state);
  const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const material = feature => createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 })(feature);
  assert.equal(material(korea).color, '#003478');
  assert.equal(material(child).color, '#003478');
  assert.equal(material(korea).fillAlpha, 0.22);
  assert.deepEqual(korea.properties.style, {});
  await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'KOR',field:'color',value:'#ef4444' ,valuePresent:true});
  assert.equal(material(child).color, '#ef4444');
  await executeTerritorialTestCommand(state,'territorial.metadata',{ id:'KOR',field:'color',value:'' ,valuePresent:true});
  assert.equal(material(child).color, '#003478');
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'groupStyle',group:'objects',patch:{ colorVisible:false } } });
  assert.equal(material(korea).fillAlpha, 0);
  assert.equal(material(child).fillAlpha, 0);
});

test('unassigned territories and new objects remain unpainted, while historical identities keep their own defaults', async () => {
  const rows = [
    ['ATA', ''], ['BRT', ''], ['KAS', ''], ['SPI', ''], ['new-country', ''],
    ['RUS', '#3a9915'], ['state:soviet-union', '#a3101f'],
    ['CZE', '#6e63a2'], ['state:czechoslovakia', '#46d8cb'],
    ['state:east-prussia', '#003153'],
    ['state:deutsche-demokratische-republik', '#8b1a1a'],
    ['CNM', '#009edb'], ['COK', '#496a9c'], ['NIU', '#e2c65a'],
  ];
  const entities = rows.map(([id]) => createTerritorialFeature({ id, entityKind: 'general', geometry }));
  const state = { territorialEntities: entities };
  await initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client }) });
  const resolve = createTerritorialFillResolver({ state, entityRepository });
  rows.forEach(([, color], index) => {
    assert.equal(resolve(entities[index]).color, color);
    assert.equal(resolve(entities[index]).fillAlpha, color ? 1 : 0);
    assert.deepEqual(entities[index].properties.style, {});
  });
});
});
contractSuite("territorial-display-picking", () => {
const { normalizeLayerPresentation } = __dep6;
const { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } = __dep0;
const assert = __dep3.default;
const test = __dep4.default;
const { createObjectPicking } = __dep8;
const { normalizeObjectRef } = __dep9;
const { createTerritorialFeature } = __dep1;
const { createTerritorialEntityStore } = __dep2;
const { createTerritorialEntityRepository } = __dep7;
const { createTerritorialScopeResolver } = __dep10;

const square = (x, size) => ({ type: 'Polygon', coordinates: [[[x, 0], [x, size], [x + size, size], [x + size, 0], [x, 0]]] });
test('territorial hits use the displayed geometry and withhold pending surfaces', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(0, 10) });
  const B = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', coverageMode: 'explicit', geometry: square(0, 10) });
  const R = createTerritorialFeature({ id: 'R', entityKind: 'regional', geometry: square(0, 10) });
  const state = { territorialEntities: [A, B, R], layerVisibility: {}, countryVisualPhase: 'preview', layerPresentation: normalizeLayerPresentation({ overlayOrder: ['objects'] }) };
  await initializeTestTerritorialState(state);
const store = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  const entityRepository = createTerritorialEntityRepository({ entityStore: store });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state, clipper: () => null });
  const picking = createObjectPicking();
  picking.connect({
    projectState: { state }, territorialModel: { entityRepository }, objectModelB: { territorialScope },
    selectionServices: { normalizeObjectRef }, objectLookup: { isObjectAvailable:()=>true,objectRefExists: ref => !!entityRepository.get(ref.id) },
    objectOperationsA: { objectRefVisible: () => state.layerVisibility.objects !== false,
      objectDisplayInfo: ref => ({name:ref.id}) },
    layerPresentation: { isLayerItemVisible: () => true }, surfaces: { isMobile: () => false },
    renderScene: { OVERLAY_GROUPS: [] }, rendering: { selectionPerformanceMetrics: {} },
    spatialRecords: { geometryBoundsCache: new WeakMap() },
    cutGeometry: { coordinateBounds: coordinates => {
      const points = coordinates.flat(); return [Math.min(...points.map(p => p[0])), 0, Math.max(...points.map(p => p[0])), 10];
    } }, labelPresentation: { currentMapZoom: () => 100 }, mapView: { activeProjection: () => point => point },
    landRelations: { pointInCountryFeature: (point, feature) => {
      const xs = feature.geometry.coordinates[0].map(p => p[0]);
      return point[0] > Math.min(...xs) && point[0] < Math.max(...xs) && point[1] > 0 && point[1] < 10;
    } }, platform: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
  });
  const records = ['A', 'B', 'R'].map(id => ({ domain: 'territorial', id }));
  const hits = () => picking.territorialObjectsAt([5, 5], [5, 5], records);
  assert.deepEqual(hits().map(item => item.ref.key), ['territorial:entity:R', 'territorial:entity:B', 'territorial:entity:A']);
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'visibility',key:'objects',visible:false } });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await testCoreProject(state).project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'objects',visible:true}});
  assert.deepEqual(picking.territorialObjectsAt([25, 5], [25, 5], records).map(item=>item.ref.id), []);
  state.countryVisualPhase = 'pending';
  assert.deepEqual(hits(), []);
  state.countryVisualPhase = 'canonical';
  assert.deepEqual(hits().map(item => item.ref.id), ['R', 'B', 'A']);
  await testCoreProject(state).project.executeCommand({ commandId:'presentation.apply',targets:[],
    payload:{ action:'visibility',key:'objects',visible:false } });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await executeTerritorialTestCommand(state,'territorial.parent',{ id:'B',parentId:'' });
  assert.deepEqual(hits().map(item => item.ref.id), []);
  await testCoreProject(state).project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'objects',visible:true}});
  assert.deepEqual(new Set(hits().map(item => item.ref.id)), new Set(['R','A','B']));
  assert.deepEqual(A.geometry, square(0, 10));
});
});
contractSuite("territorial-display-projection", () => {
const { executeTerritorialTestCommand, testCoreProject, initializeTestTerritorialState } = __dep0;
const test = __dep4.default;
const assert = __dep3.default;
const { createTerritorialFeature } = __dep1;
const { createTerritorialEntityStore } = __dep2;
const { createTerritorialEntityRepository } = __dep7;
const { createTerritorialScopeResolver } = __dep10;

const square = size => ({ type: 'Polygon', coordinates: [[[0,0],[0,size],[size,size],[size,0],[0,0]]] });
test('display projection follows canonical identity, metadata and geometry without mutation', async () => {
  const A = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry: square(10) });
  const B = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', geometry: square(3) });
  const state = { territorialEntities: [A, B], countryVisualPhase: 'preview' };
  const before = structuredClone([A, B]);
  await initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ documentModel: testCoreProject(state).documentModel, commandOwner: testCoreProject(state).client });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  const display = createTerritorialScopeResolver({ entityRepository: repo, clipper: () => null });
  const first = display.displayEntities();
  assert.strictEqual(display.displayEntities(), first);
  assert.strictEqual(display.displayFeature('A'), repo.get('A'));
  state.countryVisualPhase = 'canonical';
  assert.strictEqual(display.displayEntities(), first);
  await executeTerritorialTestCommand(state, 'territorial.metadata', { id: 'B', field: 'color', value: '#123456', valuePresent: true });
  assert.equal(display.displayFeature('B').properties.style.color, '#123456');
  await executeTerritorialTestCommand(state, 'territorial.patch', { features: [{ ...repo.get('A'), geometry: square(7) }] });
  assert.deepEqual(display.displayFeature('A').geometry, square(7));
  await executeTerritorialTestCommand(state, 'territorial.remove', { ids: ['B'] });
  assert.equal(display.displayFeature('B'), null);
  assert.deepEqual([A, B], before);
});
});
contractSuite("territorial-highlight-boundary", () => {
const test = __dep4.default;
const assert = __dep3.default;
const { excludeAncestorHighlightBoundary } = __dep11;
const { createMapDisplayPreparation } = __dep12;

const polygon = coordinates => ({ type: 'Polygon', coordinates: [coordinates] });
const length = feature => feature.geometry.coordinates.reduce((total, line) => total + line.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0), 0);
const parent = polygon([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
const child = polygon([[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]);

test('child keeps its internal edge while its highlighted country supplies the outer edge', () => {
  const result = excludeAncestorHighlightBoundary(child, [parent]);
  assert.equal(length(result), 4);
  assert.ok(result.geometry.coordinates.every(line => line.every(point => point[0] === 2)));
  assert.equal(length(excludeAncestorHighlightBoundary(child, [])), 12);
});
test('partial reversed and subdivided overlaps are removed without losing unrelated edges', () => {
  const line = { type: 'LineString', coordinates: [[0, 0], [4, 0]] };
  const ancestor = { type: 'MultiLineString', coordinates: [[[2, 0], [1, 0]], [[3, 0], [2, 0]]] };
  const result = excludeAncestorHighlightBoundary(line, [ancestor]);
  assert.equal(length(result), 2);
  assert.equal(result.geometry.coordinates.length, 2);
});
test('near-coincident shared lines are suppressed but nearby distinct boundaries remain', () => {
  const line = { type: 'LineString', coordinates: [[0, 0], [2, 0]] };
  assert.equal(length(excludeAncestorHighlightBoundary(line, [{ type: 'LineString', coordinates: [[0, 0.00001], [2, 0.00001]] }])), 0);
  assert.equal(length(excludeAncestorHighlightBoundary(line, [{ type: 'LineString', coordinates: [[0, 0.01], [2, 0.01]] }])), 2);
});

test('highlight preparation removes the same parent perimeter for wrapped and continuous dateline coordinates', async () => {
  const child = polygon([[179, 0], [179, 1], [179.5, 1], [179.5, 0], [179, 0]]);
  for (const east of [-179, 181]) {
    const parent = { type: 'Feature', properties: {}, geometry: polygon([[179, 0], [179, 1], [east, 1], [east, 0], [179, 0]]) };
    const before = structuredClone([child, parent]);
    const { feature: result } = await createMapDisplayPreparation().prepare({
      kind: 'highlight', feature: child, occluders: [{feature:parent}],
    }, [], []);
    assert.equal(length(result), 1, `parent east ${east}`);
    assert.ok(result.geometry.coordinates.every(line => line.every(point => point[0] === 179.5)));
    assert.deepEqual([child, parent], before);
  }
});

test('partial overlaps across the dateline leave only two short non-overlapping segments', () => {
  const line = { type: 'LineString', coordinates: [[179, 0], [-179, 0]] };
  const ancestor = { type: 'MultiLineString', coordinates: [
    [[-179.5, 0], [-180, 0]], [[180, 0], [179.5, 0]],
  ] };
  const result = excludeAncestorHighlightBoundary(line, [ancestor]);
  assert.equal(length(result), 1);
  assert.equal(result.geometry.coordinates.length, 2);
  assert.deepEqual(result.geometry.coordinates.map(line => [line[0], line.at(-1)]),
    [[[179, 0], [179.5, 0]], [[-179.5, 0], [-179, 0]]]);
  assert.ok(result.geometry.coordinates.every(line => line.length > 2),
    'the selected coastline must use refined fill-compatible intervals');
});

test('polar and seam closure edges never become selection highlight strokes', () => {
  const cap = polygon([[-180, 80], [-90, 80], [0, 80], [90, 80], [180, 80], [180, 90], [-180, 90], [-180, 80]]);
  const result = excludeAncestorHighlightBoundary(cap, []);
  assert.equal(length(result), 360);
  assert.ok(result.geometry.coordinates.every(line => line.every(point => point[1] === 80)));
  assert.equal(length(excludeAncestorHighlightBoundary(cap, [cap])), 0);
});
});
contractSuite("land-relations-presentation", () => {
const { normalizeLayerPresentation } = __dep6;
const test = __dep4.default;
const assert = __dep3.default;
const { createLandRelations } = __dep13;
const { createCountryCommandCalculator } = __dep14;
const { createTerritorialFeature, territorialRootId, TERRITORIAL_COVERAGE_MODES } = __dep1;
const { DISTRIBUTION_MODES } = __dep15;
const { testCoreProject, initializeTestTerritorialState } = __dep0;

const square=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]]});
const feature=(id,geometry,parentId='')=>createTerritorialFeature({id,name:id,entityKind:'general',parentId,geometry});
function landPlans() {
  const owner=createLandRelations();
  owner.connect({territorialModel:{territorialRootId,TERRITORIAL_COVERAGE_MODES,DISTRIBUTION_MODES}});
  return owner;
}
async function fixture() {
  const entities=[feature('source',square(0,0,10,10)),feature('other',square(20,0,30,10)),
    feature('kept',square(1,1,2,2),'source'),feature('moved',square(1,7,2,8),'source'),
    feature('moved-child',square(1.1,7.1,1.9,7.9),'moved'),feature('crossed',square(3,3,4,7),'source'),
    feature('unrelated',square(21,1,22,2),'other')];
  const state={territorialEntities:entities,
    itemVisibility:{objects:{source:false,kept:false,moved:false,'moved-child':false,crossed:false,unrelated:false}},
    layerPresentation:normalizeLayerPresentation({objectStyles:Object.fromEntries(['source','kept','moved','moved-child','crossed','unrelated']
      .map((id,index)=>[`territorial:entity:${id}`,{opacity:(index+1)/10}]))})};
  await initializeTestTerritorialState(state);
  return {state,...testCoreProject(state)};
}
function splitPlan(views) {
  const selected=square(0,5,10,10),next=feature('new',selected);
  const {result}=createCountryCommandCalculator().calculate({operation:'new-country',sourceIds:['source'],
    transferredGeometry:selected,newFeature:next},new Map(views.filter(row=>!row.properties.parentId).map(row=>[row.id,row])));
  const updates=new Map(result.features.map(row=>[row.id,row]));
  const proposed=[...views.map(row=>updates.get(row.id)||row),updates.get('new')];
  const dependents=landPlans().planTransferLandDependents({territorialViews:proposed,transferredGeometry:selected,
    sourceOwnerIds:['source'],targetOwnerId:'new'});
  return {features:[...result.features,...dependents.features],removedIds:[...result.removedIds,...dependents.removedIds]};
}

test('dependent geometry planning reads immutable proposal views and preserves the existing split calculation',async()=>{
  globalThis.window=globalThis;
  const f=await fixture(),before=f.project.snapshot(),clock=f.client.state(),plan=splitPlan(f.entityStore.snapshot());
  assert.deepEqual(plan.removedIds,['moved','moved-child']);
  assert.equal(plan.features.some(row=>row.id==='kept'),true);assert.equal(plan.features.some(row=>row.id==='crossed'),true);
  assert.equal(plan.features.some(row=>row.id==='unrelated'),true);
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock,'geometry planning never publishes or owns history');
  const original=globalThis.polygonClipping;
  try {
    globalThis.polygonClipping={...original,difference(){throw new Error('dependent apply failed');}};
    assert.throws(()=>splitPlan(f.entityStore.snapshot()),/dependent apply failed/);
  } finally {globalThis.polygonClipping=original;}
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
});

test('one split candidate cleans authored child appearance and preserves independent viewing through Undo',async()=>{
  globalThis.window=globalThis;
  const f=await fixture(),before=f.project.snapshot(),clock=f.client.state(),plan=splitPlan(f.entityStore.snapshot());
  const operation={commandId:'territorial.patch',targets:[...plan.features.map(row=>row.id),...plan.removedIds]
    .map(id=>({domain:'territorial',id})),payload:plan};
  const envelope={commandId:'territorial.new-country',targets:[],payload:{operations:[operation]}};
  const cancelled=await f.project.prepareCommand(envelope);
  assert.equal(cancelled.ok,true);assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
  assert.equal(cancelled.preview.territorialViews.some(row=>row.id==='moved'),false);
  assert.equal(await f.project.cancelCandidate(cancelled.candidateId),true);
  assert.equal(f.project.snapshot(),before);assert.deepEqual(f.client.state(),clock);
  const prepared=await f.project.prepareCommand(envelope);
  const committed=await f.project.confirmCandidate(prepared.candidateId,prepared.state.epoch);
  assert.equal(committed.ok,true);assert.equal(f.client.state().stateRevision,clock.stateRevision+1);
  const after=f.project.snapshot();
  for(const id of ['moved','moved-child']) {
    assert.equal(f.entityRepository.get(id),null);assert.equal(f.state.itemVisibility.objects[id],false);
    assert.equal(Object.hasOwn(f.state.layerPresentation.objectStyles,`territorial:entity:${id}`),false);
  }
  for(const id of ['kept','crossed','unrelated']) {
    assert.equal(f.state.itemVisibility.objects[id],false);
    assert.deepEqual(f.state.layerPresentation.objectStyles[`territorial:entity:${id}`],before.layerPresentation.objectStyles[`territorial:entity:${id}`]);
  }
  assert.equal(f.state.itemVisibility.objects.source,false);
  assert.deepEqual(f.state.layerPresentation.objectStyles['territorial:entity:source'],before.layerPresentation.objectStyles['territorial:entity:source']);
  assert.equal(await f.project.undo(),true);assert.equal(f.client.state().canUndo,false);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(await f.project.redo(),true);assert.deepEqual(f.project.snapshot(),after);
});

test('reassignment calculates changed distribution references without mutating accepted rows or unrelated entries',()=>{
  globalThis.window=globalThis;
  const views=[feature('target',square(0,0,10,10)),feature('donor',square(0,0,10,10)),
    feature('child',square(1,1,2,2),'donor'),feature('grandchild',square(1.1,1.1,1.9,1.9),'child')];
  const entries=[{id:'moved-entry',mode:'territorial',territorialUnitId:'donor'},
    {id:'kept-entry',mode:'territorial',territorialUnitId:'child'},{id:'geometry-entry',mode:'geometry',territorialUnitId:''}];
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const before=structuredClone({views,entries});freeze(views);freeze(entries);
  const plan=landPlans().planReassignLandDependents({territorialViews:views,distributionEntries:entries,removedOwnerIds:['donor'],targetOwnerId:'target'});
  assert.equal(plan.features.find(row=>row.id==='child').properties.parentId,'target');
  assert.equal(plan.features.find(row=>row.id==='grandchild').properties.parentId,'child');
  assert.deepEqual(plan.distributionEntries,[{...entries[0],territorialUnitId:'target'}]);
  assert.deepEqual({views,entries},before);assert.deepEqual(plan.removedIds,[]);
});
});
