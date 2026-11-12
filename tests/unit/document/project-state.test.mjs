import { readPortabilityProjectSeed } from "../../helpers/portability-project-seed.mjs";
import {createProjectStateFixture} from '../../helpers/project-state-fixture.mjs';
import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../../src/document/territorial-entity-store.js";
import * as __dep1 from "../../helpers/timeline-project.mjs";
import * as __dep2 from "../../../src/document/territorial-units.js";
import * as __dep3 from "node:assert/strict";
import * as __dep4 from "node:test";
import * as __dep5 from "../../../src/document/project-state.js";
import * as __dep6 from "../../../src/document/source-provenance.js";
import * as __dep7 from "node:child_process";
import * as __dep8 from "node:url";
import * as __dep9 from "../../../src/document/timeline-records.js";
import * as __dep10 from "../../../src/document/temporal.js";
import * as __dep11 from "../../../src/document/project-invariants.js";
import * as __dep13 from "../../../src/document/project-resource-overlay.js";
import * as __dep14 from "../../helpers/core-project.mjs";
import * as __dep15 from "../../../src/rendering/territorial-labels.js";
import * as __dep16 from "../../../src/document/place-contract.js";
import * as __dep17 from "../../../src/document/project-domain.js";
contractSuite("project-state", () => {
const { createEmptyTerritorialState }=__dep0;
const { staticTerritorialInput }=__dep1;
const { createTerritorialFeature }=__dep2;
const assert=__dep3.default;
const test=__dep4.default;
const { PROJECT_SCHEMA_VERSION, PROJECT_STATE_FIELDS, applyProjectFields, assertCurrentProjectSchema, createProjectObjectId, pickProjectFields }=__dep5;
const { normalizeSourceProvenance }=__dep6;
const { execFileSync }=__dep7;
const { fileURLToPath }=__dep8;
const { timelineObjectCatalog }=__dep9;

const state = {projectSetup:{initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'},
  sourceInfo: null, labels: [{ id: 'label-1' }], genericFeatures: [], hydroEdits: [{ id: 'river-1' }],
  ...createEmptyTerritorialState(),
  distributionLayers: [], distributionEntries: [], distributionSettings: { renderMode: 'overlap', activeLayerId: '' },
  labelSettings: { 'territorial:KOR': { pinned: true } }, layerPresentation: { styles: {} },
  physicalSettings: { terrainVisible: true }, projection: 'flat',
  layerVisibility: { objects: true }, itemVisibility: { A: false },
  view: { flatZoom: 2 },
  timelineCursor: '1914-07',
};

test('project serialization contains document and presentation fields only', () => {
  const project = pickProjectFields(state);
  assert.deepEqual(Object.keys(project), PROJECT_STATE_FIELDS.filter(field => ['document', 'presentation'].includes(field.scope)).map(field => field.name));
  assert.equal('removedLayerItems' in project, false);
  assert.equal('countriesLocked' in project, false);
  assert.equal('projection' in project, false);
  assert.equal('timelineCursor' in project, false);
  assert.equal('view' in project, false);
});

test('history snapshots preserve editable object state through the shared schema', () => {
  const history = pickProjectFields(state, { scope: 'history' });
  assert.deepEqual(history.hydroEdits, state.hydroEdits);
  assert.deepEqual(history.timelineRecords, state.timelineRecords);
  assert.deepEqual(history.geometries, state.geometries.snapshot());
  assert.equal('labelSettings' in history, false);
  assert.equal('layerVisibility' in history, false);
  assert.equal('projection' in history, false);
  assert.equal('timelineCursor' in history, false);
});

test('presentation and session scopes stay independent', () => {
  const presentation = pickProjectFields(state, { scope: 'presentation' });
  assert.deepEqual(presentation.labelSettings, state.labelSettings);
  assert.equal('layerVisibility' in presentation,false);
  assert.equal('countryOverrides' in presentation, false);
  assert.equal('projection' in presentation, false);

  const session = pickProjectFields(state, { scope: 'session' });
  assert.equal(session.projection, 'flat');
  assert.deepEqual(session.view, { flatZoom: 2 });
  assert.equal(session.timelineCursor, '1914-07');
  assert.deepEqual(session.layerVisibility,state.layerVisibility);
});

test('shared project fields receive current defaults without sharing mutable values', () => {
  const restored = applyProjectFields({ physicalSettings: { terrainVisible: false }, layerVisibility: { objects: true }, view: {} },
    { projectSetup:{initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'empty'},timelineRecords: createEmptyTerritorialState().timelineRecords, geometries: [] });
  assert.deepEqual(restored.labels, []);
  assert.deepEqual(restored.hydroEdits, []);
  assert.deepEqual(restored.timelineRecords.lifetimes, []);
  assert.throws(() => applyProjectFields({}, {projectSetup:{initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'empty'}}), /timelineRecords/);
  restored.labels.push({ id: 'new' });
  assert.deepEqual(applyProjectFields({}, { projectSetup:{initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'empty'},timelineRecords: createEmptyTerritorialState().timelineRecords, geometries: [] }).labels, []);
});

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const currentProject = () => { const project = {
  ...createProjectStateFixture({initialMonth:'2026-10',sourceMode:'builtin',documentId:uuid(99)}),
  distributionSettings:{renderMode:'overlap',activeLayerId:'',boundaryVisible:true},
  territorialModel: { schemaVersion: 6 },
  distributionModel: { schemaVersion: 3 },
  layerPresentation: { schemaVersion: 5, overlayOrder: [], styles: {} },
  territorialEntities: [createTerritorialFeature({id:'DEU',entityKind: 'general',name:'독일',geometry:{type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]}}),
    createTerritorialFeature({id:uuid(1),entityKind: 'general',parentId:'DEU',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}})],
  distributionLayers: [{ id: uuid(3), schemaVersion: 3, name: '분포', unit: '', valueScale: { mode: 'auto' } }],
  distributionEntries: [{ id: uuid(4), schemaVersion: 3, layerId: uuid(3), mode: 'geometry',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] }, value: 1 }],
  genericFeatures: [{
    type: 'Feature', id: uuid(5), geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { schemaVersion: 2, name: '기타', notes: '', color: '#123456', locked: false, source: normalizeSourceProvenance({ kind: 'unsupported' }) },
  }],
  hydroEdits: [{ type: 'Feature', id: uuid(6), geometry: { type:'LineString', coordinates:[[0,0],[1,1]] }, properties: { pandolab_schema_version: 1, category:'river' } }],
  labels: [{ id: uuid(7) }],
};
  const timeline = staticTerritorialInput(project.territorialEntities);
  const water = project.hydroEdits[0];
  const objectRef = { domain: 'hydro', id: water.id };
  const geometryRef = { id: `fixture-water:${water.id}`, version: 1 };
  timeline.timelineRecords.lifetimes.push({ id: `life:${water.id}`, objectRef, validFrom: null, validTo: null });
  timeline.timelineRecords.geometryBindings.push({ id: `binding:${water.id}`, objectRef, validFrom: null, validTo: null, geometryRef });
  timeline.geometries.push({ ...geometryRef, geojson: water.geometry });
  water.geometry = null;
  return { ...project, ...timeline };
};

test('current project schema accepts only explicit current versions and UUID object IDs', () => {
  const current = currentProject();
  assert.equal(current.landObjectModel.schemaVersion,createProjectStateFixture().landObjectModel.schemaVersion);
  assert.equal(assertCurrentProjectSchema(current).schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.match(createProjectObjectId(), /^[0-9a-f-]{36}$/i);
});

test('territorial model header rejects retired types and unknown entity kinds', () => {
  const retired = currentProject();
  retired.territorialModel.types = ['country', 'subunit', 'region'];
  assert.throws(() => assertCurrentProjectSchema(retired), /types/);
  const invalid = currentProject();
  invalid.territorialModel.kinds = ['general', 'country'];
  assert.throws(() => assertCurrentProjectSchema(invalid), /kinds/);
});



test('distribution boundary visibility is a shared optional presentation setting', () => {
  const current = currentProject();
  current.distributionSettings = { renderMode: 'single', activeLayerId: uuid(3), boundaryVisible: false };
  assert.deepEqual(assertCurrentProjectSchema(current).distributionSettings, current.distributionSettings);

  const prior = currentProject();
  prior.distributionSettings = { renderMode: 'overlap', activeLayerId: '' };
  assert.deepEqual(assertCurrentProjectSchema(prior).distributionSettings, prior.distributionSettings);
});

test('river and lake authored styles are retained while saved viewing visibility is rejected', () => {
  const legacyHydroInput = currentProject();
  legacyHydroInput.layerVisibility = { hydro:false };
  assert.throws(() => assertCurrentProjectSchema(legacyHydroInput), /지원하지 않는 필드 layerVisibility/);
  const canonical = currentProject();
  canonical.layerPresentation.styles = { rivers: { opacity: 0.7 }, lakes: { opacity: 0.8, boundaryVisible: true } };
  assert.equal(assertCurrentProjectSchema(canonical).schemaVersion, PROJECT_SCHEMA_VERSION);
});







test('missing duplicate and unsupported object fields are rejected', () => {
  const missing = currentProject();
  missing.labels[0].id = '';
  assert.throws(() => assertCurrentProjectSchema(missing), /ID가 비어/);
  const duplicate = currentProject();
  duplicate.labels.push({ id: uuid(7) });
  assert.throws(() => assertCurrentProjectSchema(duplicate), /중복/);
  const unsupported = currentProject();
  unsupported.territorialEntities[1].properties.unknownField = 'PL';
  assert.throws(() => assertCurrentProjectSchema(unsupported), /지원하지 않는 필드 unknownField/);
  const badGeneric = currentProject();
  badGeneric.genericFeatures[0].properties.role = 'subunit';
  assert.throws(() => assertCurrentProjectSchema(badGeneric), /지원하지 않는 필드 role/);
});

test('session state and unsupported model fields are rejected from project files', () => {
  for (const field of ['projection', 'view', 'selectedDistributionLayerId']) {
    const project = currentProject();
    project[field] = field === 'projection' ? 'flat' : {};
    assert.throws(() => assertCurrentProjectSchema(project), new RegExp(`지원하지 않는 필드 ${field}`));
  }
  const unsupportedLayer = currentProject();
  unsupportedLayer.distributionLayers[0].unknownField = true;
  assert.throws(() => assertCurrentProjectSchema(unsupportedLayer), /지원하지 않는 필드 unknownField/);
  const unsupportedSettings = currentProject();
  unsupportedSettings.distributionSettings = { renderMode: 'overlap', unknownField: uuid(3) };
  assert.throws(() => assertCurrentProjectSchema(unsupportedSettings), /지원하지 않는 필드 unknownField/);
});

test('schema 14 keeps authored project fields separate from presentation and device session state', () => {
  const namesFor = scope => PROJECT_STATE_FIELDS.filter(field => field.scope === scope).map(field => field.name);
  assert.deepEqual(namesFor('document'), [
    'projectSetup', 'sourceInfo', 'labels', 'genericFeatures', 'hydroEdits',
    'timelineRecords', 'geometries', 'distributionLayers', 'distributionEntries',
  ]);
  assert.deepEqual(namesFor('presentation'), [
    'labelSettings', 'distributionSettings', 'layerPresentation',
  ]);
  assert.deepEqual(namesFor('session'), [
    'physicalSettings', 'layerVisibility', 'itemVisibility', 'projection', 'view', 'timelineCursor',
  ]);
});

test('a project timeline owns territorial and authored hydro references, not builtin places or labels', () => {
  const project = currentProject();
  project.referencePlaces = [{ id: 'builtin:place:synthetic:1' }];
  const catalog = timelineObjectCatalog(project);
  assert.deepEqual(catalog.map(row => row.objectRef), [
    ...project.territorialEntities.map(row => ({ domain: 'territorial', id: row.id })),
    ...project.hydroEdits.map(row => ({ domain: 'hydro', id: row.id })),
  ]);
  assert.equal(catalog.some(row => project.labels.some(label => label.id === row.objectRef.id)), false);
  assert.equal(catalog.some(row => row.objectRef.domain === 'place'), false);
});

test('detached project copies do not share mutable labels, water records or historical bindings', () => {
  const first = pickProjectFields(state), second = pickProjectFields(state);
  first.labels[0].id = 'edited-label';
  first.hydroEdits[0].id = 'edited-river';
  first.timelineRecords.lifetimes.push({ id: 'extra' });
  assert.equal(second.labels[0].id, 'label-1');
  assert.equal(second.hydroEdits[0].id, 'river-1');
  assert.equal(second.timelineRecords.lifetimes.length, 0);
});

test('project storage rejects session cursor and reference-library runtime caches', () => {
  for (const field of ['timelineCursor', 'hydroFeatureCache', 'referencePlaces', 'projectBaseline']) {
    const candidate = currentProject();
    candidate[field] = field === 'timelineCursor' ? '1914-07' : {};
    assert.throws(() => assertCurrentProjectSchema(candidate), new RegExp('지원하지 않는 필드 ' + field));
  }
});

test('P0 reproducible static baseline reports checked-out Git files without inventing runtime timings',()=>{
 const output=execFileSync(process.execPath,['scripts/check-runtime-boundaries.mjs','--baseline-json'],{
  cwd:fileURLToPath(new URL("../../../",import.meta.url)),encoding:'utf8',maxBuffer:4*1024*1024,
 });
 const data=JSON.parse(output);
 assert.equal(data.schema,'pando-static-runtime-baseline-v1');
 assert.match(data.sourceCommit,/^[a-f0-9]{40}$/);
 assert.match(data.externalDataRevision,/^[a-f0-9]{40}$/);
 assert.equal(data.runtimeMetricsMeasured,false);
 assert.ok(data.trackedFiles>0);
 assert.ok(data.indexedFrontendAssets>0&&data.boundaryCheckedModules>0);
 assert.equal(Object.values(data.areas).reduce((sum,row)=>sum+row.files,0),data.trackedFiles);
 assert.ok(data.areas['src'].files>0);
});
});
contractSuite("project-invariants", () => {
const { createTerritorialFeature }=__dep2;
const assert=__dep3.default;
const test=__dep4.default;
const { sharedCalculationCore }=__dep10;
const { assertProjectReferenceIntegrity, validateProjectReferenceIntegrity }=__dep11;


const polygon = () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });
const country = id => createTerritorialFeature({id,entityKind:'general',name:id,geometry:polygon()});
const unit=(id,parentId='')=>createTerritorialFeature({id,entityKind:'general',parentId,geometry:polygon()});

test('shared reference graph reports duplicate IDs, missing parents and cycles in input order', () => {
  const core = sharedCalculationCore;
  assert.deepEqual(core.referenceGraphDiagnostics(['A', 'B', 'C'], ['B', 'A', 'missing']), [
    { idStatus: 'ok', cycle: true, missing: false },
    { idStatus: 'ok', cycle: true, missing: false },
    { idStatus: 'ok', cycle: false, missing: true },
  ]);
  assert.deepEqual(core.referenceGraphDiagnostics(['A', 'A', '', ''], ['', '', '', '']).map(row => row.idStatus),
    ['ok', 'duplicate', 'empty', 'empty']);
});

test('shared distribution reference diagnostics preserve invalid fields independently', () => {
  const rows = sharedCalculationCore.distributionReferenceDiagnostics(
    ['L'], ['A'],
    ['L', 'missing', 'L', 'L'], ['territorial', 'territorial', 'bad', 'geometry'],
    ['A', 'missing', '', ''], [1, 0, Infinity, '1'],
  );
  assert.deepEqual(rows, [
    { missingLayer: false, invalidMode: false, invalidValue: false, missingTerritory: false },
    { missingLayer: true, invalidMode: false, invalidValue: false, missingTerritory: true },
    { missingLayer: false, invalidMode: true, invalidValue: true, missingTerritory: false },
    { missingLayer: false, invalidMode: false, invalidValue: true, missingTerritory: false },
  ]);
});

test('shared territorial root distinguishes missing, cyclic and regional parents', () => {
  const rows=new Map([
    ['A', {id:'A',properties:{entityKind:'general',parentId:''}}],
    ['B', {id:'B',properties:{entityKind:'general',parentId:'A'}}],
  ]);
  const resolve = row => sharedCalculationCore.resolveTerritorialRoot(row, id => rows.get(id) || null);
  assert.deepEqual(resolve(rows.get('B')), { status:'valid', rootId:'A' });
  assert.deepEqual(resolve({id:'C',properties:{entityKind:'general',parentId:'missing'}}), { status:'invalid-parent', rootId:'' });
  assert.deepEqual(resolve({id:'C',properties:{entityKind:'general',parentId:'C'}}), { status:'cycle', rootId:'' });
  assert.deepEqual(resolve({id:'R',properties:{entityKind:'regional',parentId:'A'}}), { status:'regional-parent', rootId:'' });
  const unusual='지도\ud800';
  rows.set(unusual,{id:unusual,properties:{entityKind:'general',parentId:''}});
  assert.deepEqual(resolve({id:'child',properties:{entityKind:'general',parentId:unusual}}), { status:'valid',rootId:unusual });
  const longId='가'.repeat(9000);
  rows.set(longId,{id:longId,properties:{entityKind:'general',parentId:''}});
  assert.deepEqual(resolve({id:'long-child',properties:{entityKind:'general',parentId:longId}}), { status:'valid',rootId:longId });
});

test('valid project references pass', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'A')]],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'R', value: 100 }],
  });
  assert.equal(result.ok, true);
});

test('dangling references are reported instead of silently ignored', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING')]],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [{ id: 'E', layerId: 'L', mode: 'territorial', territorialUnitId: 'NOPE', value: 100 }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-PARENT'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-MISSING-DIST-TERRITORIAL'));
  assert.throws(() => assertProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R', 'MISSING', 'A')]],
  }), /부모/);
});

test('territorial and distribution parent cycles are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [...[country('A')],...[unit('R1', 'R2'), unit('R2', 'R1')]],
    distributionLayers: [
      { id: 'L1', parentId: 'L2' },
      { id: 'L2', parentId: 'L1' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-PARENT-CYCLE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-PARENT-CYCLE'));
});

test('invalid distribution value and free geometry are rejected', () => {
  const result = validateProjectReferenceIntegrity({
    territorialEntities: [country('A')],
    distributionLayers: [{ id: 'L', parentId: '' }],
    distributionEntries: [
      { id: 'E1', layerId: 'L', mode: 'geometry', geometry: null, value: Number.NaN },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-VALUE'));
  assert.ok(result.issues.some(row => row.code === 'PL-INV-DIST-GEOMETRY'));
});
});
contractSuite("project-resource-overlay", () => {
const test=__dep4.default;
const assert=__dep3.default;
const { projectResourceOverlay }=__dep13;
const { createNodeCoreProject }=__dep14;
const { createTerritorialLabels }=__dep15;
const { normalizePlace }=__dep16;

const id='22000000-0000-4000-8000-000000000001';
const placeId='builtin:place:synthetic:seoul';
const place=()=>normalizePlace({source:'synthetic',sourceId:'seoul',name:'서울',kind:'capital',coordinates:[127,37]});
const label=()=>({id,sourcePlaceId:placeId,name:'작성 서울',kind:'capital',coordinates:[127,37]});
const sourceRiver={id:'fragment:1',properties:{pandolab_id:'river:logical',category:'river',layer_id:'rivers'},
 geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}};
const sourceLake={id:'lake:source',properties:{pandolab_id:'lake:source',category:'lake',layer_id:'lakes'},
 geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}};
const riverCopy=()=>({type:'Feature',id:'copy:river',geometry:null,
 properties:{pandolab_domain:'hydro',category:'river',sourceFeatureId:'river:logical'}});
const lakeCopy=()=>({type:'Feature',id:'copy:lake',geometry:null,
 properties:{pandolab_domain:'hydro',category:'lake',sourceFeatureId:'lake:source'}});

test('P4 C++ territorial identities are one project-owned catalog, not a second builtin writer',()=>{
 const root={id:'A',properties:{name:'Accepted'}};
 const resources=projectResourceOverlay('territorial',[root]);
 assert.deepEqual(resources.records,[root]);
 assert.equal(resources.findById('A'),root);
 assert.equal(resources.ownerOf('A'),'project');
 assert.equal(resources.ownerOf('missing'),null);
 assert.deepEqual(resources.replacedSourceIds,[]);
 assert.throws(()=>projectResourceOverlay('territorial',[root],[{id:'source'}]),/C\+\+ project/);
});

test('P4 project labels replace only referenced builtin places and keep unmodified names independent',()=>{
 const authored=label(),builtin=place();
 const independent=normalizePlace({source:'synthetic',sourceId:'busan',name:'부산',kind:'city',coordinates:[129,35]});
 const reference=Object.freeze([builtin,independent,builtin]);
 const view=projectResourceOverlay('label',[authored],reference);
 assert.deepEqual(view.project,[authored]);
 assert.deepEqual(view.library,[independent]);
 assert.deepEqual(view.records,[authored,independent]);
 assert.equal(view.sourceReplacement(placeId),authored);
 assert.equal(view.isSourceReplaced(placeId),true);
 assert.equal(view.findById(authored.id),authored);
 assert.equal(view.findById(placeId),null);
 assert.equal(view.ownerOf(authored.id),'project');
 assert.equal(view.ownerOf(independent.id),'library');
 assert.equal(view.ownerOf(placeId),null);
 assert.equal(reference.length,3);
 assert.equal(builtin.name,'서울');
 assert.equal(authored.name,'작성 서울');
});

test('P4 hydro source refs unify rivers and lakes without copying source geometries',()=>{
 const river=riverCopy(),lake=lakeCopy(),references=[sourceRiver,sourceLake];
 const source=structuredClone(references);
 const edited=projectResourceOverlay('hydro',[river,lake],references);
 assert.deepEqual(edited.records,[river,lake]);
 assert.deepEqual(edited.replacedSourceIds,['river:logical','lake:source']);
 assert.equal(edited.sourceReplacement('river:logical'),river);
 assert.equal(edited.sourceReplacement('lake:source'),lake);
 assert.equal(edited.findById('river:logical'),null);
 assert.deepEqual(references,source,'reference bytes remain untouched');
 const original=projectResourceOverlay('hydro',[],references);
 assert.equal(original.records.length,2);
 assert.equal(original.findById('river:logical'),sourceRiver);
 assert.equal(original.findById('lake:source'),sourceLake);
 assert.equal(original.ownerOf('river:logical'),'library');
});

test('P4 different project revisions never share replacement state or mutable catalogs',()=>{
 const empty=projectResourceOverlay('label',[],[place()]);
 const altered=projectResourceOverlay('label',[label()],[place()]);
 assert.equal(empty.records.length,1);
 assert.equal(altered.records.length,1);
 assert.equal(empty.isSourceReplaced(placeId),false);
 assert.equal(altered.isSourceReplaced(placeId),true);
 assert.ok(Object.isFrozen(empty.records));
 assert.ok(Object.isFrozen(altered.project));
 assert.ok(Object.isFrozen(altered.replacedSourceIds));
 assert.throws(()=>{altered.project.push({id:'new'});},TypeError);
});

test('P4 original source identity and project ID must never merge across domains',()=>{
 const shared='same:literal-id';
 const placeView=projectResourceOverlay('label',[{id:'project:place',sourcePlaceId:shared}],[{id:shared}]);
 const waterView=projectResourceOverlay('hydro',[],[{id:shared,properties:{category:'river'}}]);
 assert.equal(placeView.isSourceReplaced(shared),true);
 assert.equal(waterView.isSourceReplaced(shared),false);
 assert.equal(waterView.ownerOf(shared),'library');
 assert.equal(placeView.ownerOf('project:place'),'project');
});

test('P4 duplicate authored IDs and unsupported pseudo-domains fail before indexing',()=>{
 assert.throws(()=>projectResourceOverlay('label',[{id:'A'},{id:'A'}]),/Duplicate authored/);
 assert.throws(()=>projectResourceOverlay('hydro',[{id:''}]),/literal object ID/);
 assert.throws(()=>projectResourceOverlay('placeBuiltin',[]),/Unknown/);
 assert.throws(()=>projectResourceOverlay('hydro',{},[]),/explicit arrays/);
 assert.throws(()=>projectResourceOverlay('label',[],[{}]),/literal object ID/);
});

test('P4 multiple authored variants preserve all user records and the original first-replacement rule',()=>{
 const first=riverCopy(),second={...riverCopy(),id:'copy:river2'};
 const view=projectResourceOverlay('hydro',[first,second],[sourceRiver]);
 assert.deepEqual(view.records,[first,second]);
 assert.equal(view.sourceReplacement('river:logical'),first);
 assert.equal(view.isSourceReplaced('river:logical'),true);
 assert.equal(view.findById(second.id),second);
});

test('P4 selected but copied builtin places cannot reappear through the label lookup owner',t=>{
 const source=place(),authored=label(),state={labels:[authored],timelineCursor:'2026-10'};
 const owner=createTerritorialLabels();
 owner.connect({projectState:{state},
  platform:{runtimeAssetUrl:()=>new URL('https://example.invalid/data/places/manifest.json')},
  preferences:{userPreferences:{labels:{place:{languages:{ko:true,en:false,native:false}}}}},
  domains:{projectDomain:{admitSelectionCatalog:async()=>true},selectionDomain:{snapshot:()=>({selection:{items:[],primaryKey:null}})},
   objectSearchController:{render(){}},renderingDomain:{invalidateLabels(){}}},
  feedback:{reportOperationError(){}},
 });
 owner.initializeLabelLayoutMetrics();
 owner.setProjectSource('builtin');
 t.after(()=>owner.builtinPlaces.dispose());
 owner.builtinPlaces.retain(source);
 assert.equal(owner.labelById(authored.id),authored);
 assert.equal(owner.labelById(source.id),null);
 state.labels=[];
 assert.equal(owner.labelById(source.id),source);
 assert.equal(owner.labelById(authored.id),null);
});

test('P4 accepted C++ world snapshots remain the sole territorial and water project source',async t=>{
 const seed=readPortabilityProjectSeed();
 const owner=await createNodeCoreProject(seed,{productMode:'viewer'});
 t.after(()=>owner.dispose());
 const original=owner.documentModel.snapshot(),territory=owner.documentModel.territorialViews();
 const hydro=owner.documentModel.list('hydro');
 const projectRegions=projectResourceOverlay('territorial',territory);
 const projectWater=projectResourceOverlay('hydro',hydro);
 assert.strictEqual(projectRegions.findById(territory[0].id),territory[0]);
 assert.strictEqual(projectWater.findById(hydro[0].id),hydro[0]);
 assert.equal(projectWater.records[0].properties.category,'river');
 assert.equal(original.hydroEdits[0].geometry,null);
 assert.deepEqual(owner.documentModel.snapshot(),original,'pure overlays do not modify C++ storage');
 await owner.client.setTimelineCursor('2025-12');
 assert.deepEqual(owner.documentModel.snapshot(),original,'session month is not part of the stored project');
});

test('time-scoped source selection composes with immutable project resources without storing external lifetimes',()=>{
 const river=sourceRiver,lake=sourceLake;
 const allowed=new Set([river.properties.pandolab_id,lake.properties.pandolab_id]);
 const view=()=>projectResourceOverlay('hydro',[],[river,lake],{
   isReferenceActive:row=>allowed.has(row.properties.pandolab_id)
 });
 const first=view();assert.deepEqual(first.records,[river,lake]);
 allowed.delete(river.properties.pandolab_id);
 const later=view();assert.deepEqual(later.records,[lake]);
 assert.equal(later.ownerOf(river.properties.pandolab_id),null);
 assert.strictEqual(later.findById(lake.properties.pandolab_id),lake);
 assert.deepEqual(first.records,[river,lake],'earlier projection is immutable');
 assert.throws(()=>projectResourceOverlay('hydro',[],[river],{isReferenceActive:true}),/activity/);
});
});
contractSuite("project-domain-async-history", () => {
const assert=__dep3.default;
const test=__dep4.default;
const { createProjectDomain }=__dep17;

test('project history publishes lifecycle effects after the canonical Worker history acknowledgement', async () => {
  let resolve;
  const acknowledgement = new Promise(accept => { resolve = accept; });
  const effects = [];
  const project = createProjectDomain({ productMode:'editor', commandOwner: { undo: () => acknowledgement },publishCommand() {},
    onProjectChanged: event => effects.push(event.reason),
    invalidateHistory: reason => effects.push(reason),
    persistence: { queueProject: () => effects.push('autosave') } });
  const pending = project.undo();
  assert.deepEqual(effects, []);
  resolve({ ok: true,changed: true }); assert.equal(await pending, true);
  assert.deepEqual(effects, ['project-undo','project-undo','autosave']);
});

test('rejected and no-op canonical Worker history responses have no success effects', async () => {
  const effects = [], error = Object.assign(new Error('History worker failed'), { code: 'PL-CORE-LOAD' });
  const project = createProjectDomain({ productMode:'editor', commandOwner: { undo: async () => ({ ok: true,changed: false }), redo: async () => { throw error; } },publishCommand() {},
    onProjectChanged: () => effects.push('event'), invalidateHistory: () => effects.push('render'),
    persistence: { queueProject: () => effects.push('autosave') } });
  assert.equal(await project.undo(), false);
  await assert.rejects(project.redo(), failure => failure === error);
  assert.deepEqual(effects, []);
});
});
