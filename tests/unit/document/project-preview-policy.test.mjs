import { describe as contractSuite } from 'node:test';
import * as __project_dep0 from "node:assert/strict";
import * as __project_dep1 from "node:crypto";
import * as __project_dep2 from "node:zlib";
import * as __project_dep3 from "node:test";
import * as __project_dep4 from "../../../src/document/territorial-display-identity.js";
import * as __project_dep5 from "../../../src/document/territorial-units.js";
import * as __project_dep6 from "../../../src/document/territorial-entity-store.js";
import * as __project_dep7 from "../../../src/document/territorial-entity-repository.js";
import * as __project_dep8 from "../../../src/rendering/territorial-fill-style.js";
import * as __project_dep9 from "../../../src/document/project-preview-policy.js";
import * as __project_dep10 from "../../helpers/core-project.mjs";
import * as __project_dep11 from "../../helpers/timeline-project.mjs";
import * as __project_dep12 from "../../helpers/node-core-wasm-loader.mjs";
import * as __project_dep13 from "../../../src/geometry/geometry-validation.js";
import * as __project_dep14 from "../../../src/document/project-preview-topology.js";
contractSuite("project-preview-policy", () => {
const assert = __project_dep0.default;
const { createHash } = __project_dep1;
const { gzipSync } = __project_dep2;
const test = __project_dep3.default;
const { builtinSubunitId } = __project_dep4;
const { createTerritorialFeature } = __project_dep5;
const { createTerritorialEntityStore } = __project_dep6;
const { createTerritorialEntityRepository } = __project_dep7;
const { createTerritorialFillResolver } = __project_dep8;
const { geometryFingerprint, matchesDefaultPreview, previewSourceForProject, projectPreviewGeometryRows, PROJECT_PREVIEW_ALGORITHM_REVISION } = __project_dep9;
const { createNodeCoreProject } = __project_dep10;
const { staticAutosaveProject } = __project_dep11;

const subunit = { id: builtinSubunitId('HKG'), sourceCountryId: 'HKG', parentId: 'CHN', revision: 'synthetic-preview-v1' };
const dataset = 'tiny-preview-source';
const rectangle = (left, right) => ({ coordinates: [[[left,0],[right,0],[right,4],[left,4],[left,0]]], type: 'Polygon' });
const china = rectangle(0,4), britain = rectangle(10,14), hongKong = rectangle(3,4);
// Independent display-hash goldens over these exact, small JSON geometries.
const fingerprints = { CHN: '1u:x3yhqg', GBR: '1z:kchx67', HKG: '1u:a3qvrb' };
const feature = (id, geometry, properties = {}) => createTerritorialFeature({
  id, entityKind: 'general', name: id, geometry, coverageMode: 'explicit', ...properties,
});
const classified = () => [feature('CHN',china), feature(subunit.id,hongKong,{
  parentId: subunit.parentId, metadata: { builtinSubunit: {
    revision: subunit.revision, sourceCountryId: subunit.sourceCountryId,
  } },
})];

async function command(owner, commandId, payload, ids = []) {
  const result = await owner.project.executeCommand({ commandId, payload,
    targets: ids.map(id => ({ domain: 'territorial', id })) });
  assert.equal(result.ok,true,result.error?.message);
  assert.equal(result.changed,true,`${commandId} must exercise an accepted change.`);
  return result;
}

async function fixture(t) {
  // Detached current input only. Core owns allocation, classification admission,
  // removal, the dirty-ID ledger, export, import validation and resolved views.
  const sourceProject = staticAutosaveProject({},[
    feature('CHN',rectangle(0,3)), feature('GBR',britain), feature('HKG',hongKong),
  ]);
  sourceProject.baseDataset = dataset;
  sourceProject.savedAt = '2026-10-01T00:00:00.000Z';
  const decoded = Buffer.from(JSON.stringify(sourceProject)), sourceBytes = gzipSync(decoded);
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const owner = await createNodeCoreProject(sourceProject);
  t.after(() => owner.dispose());
  const { storageBaselineId } = await owner.project.admitStorageBaseline({
    kind: 'stored-asset', sourceBytes, encoding: 'gzip', compressedBytes: sourceBytes.length,
    decodedBytes: decoded.length, baseDataset: dataset, sourceMonth: '2026-10', fingerprint: sourceSha256,
  });
  // Admit the static source for the delta-preview policy without starting a
  // dated new project, which intentionally activates temporal edits.
  await owner.client.initialize({ baselineId: storageBaselineId, preserveCursor: false });
  await command(owner,'territorial.patch',{ features: classified(), removedIds: ['HKG'] },['CHN',subunit.id,'HKG']);
  const baseline = { sourceSha256, defaultClassification: {
    countries: { CHN: fingerprints.CHN, GBR: fingerprints.GBR }, changed: { CHN: fingerprints.CHN },
    removedIds: ['HKG'], units: { [subunit.id]: { parentId: subunit.parentId, geometry: fingerprints.HKG, revision: subunit.revision } },
  } };
  return { ...owner, baseline, storageBaselineId };
}

async function previewSource(owner, format = 'pandolab-autosave') {
  const receipt = await owner.client.exportSnapshot({ format, version: 'preview-fixture', savedAt: '2026-10-01T00:00:00.000Z' });
  const project = JSON.parse(receipt.storageJson), before = owner.documentModel.snapshot(), state = owner.client.state();
  const inspected = await owner.project.inspectImport(project,{ baselineId: owner.storageBaselineId });
  assert.equal(owner.documentModel.snapshot(),before,'Detached inspection must not publish a document.');
  assert.deepEqual(owner.client.state(),state,'Detached inspection must not change history, cursor or operation epoch.');
  assert.deepEqual(inspected.territorialViews,owner.documentModel.territorialViews());
  // Keep the original delta document: the expanded inspector project is not the
  // source of changed IDs used by the display cache policy.
  return { project, territorialViews: inspected.territorialViews };
}

test('tiny default classification uses exact Core geometry hashes and changed IDs only',async t => {
  const owner = await fixture(t), source = await previewSource(owner);
  assert.equal(source.project.format,'pandolab-autosave-delta');
  assert.deepEqual(source.project.entityDelta.removedIds,['HKG']);
  assert.deepEqual(new Set(source.project.entityDelta.changed.map(row => row.id)),new Set(['CHN',subunit.id]));
  assert.deepEqual(source.territorialViews.map(row => row.id),['CHN','GBR',subunit.id]);
  for (const [id,hash] of Object.entries(fingerprints)) {
    const row = source.territorialViews.find(row => row.id === (id === 'HKG' ? subunit.id : id));
    assert.equal(geometryFingerprint(row.geometry),hash);
    assert.ok(Object.isFrozen(row));
  }
  assert.deepEqual(projectPreviewGeometryRows(source),{
    countries: [['CHN',china]], removed: ['HKG'], units: [[subunit.id,'general',subunit.parentId,hongKong]],
  });
  assert.equal(matchesDefaultPreview(source,owner.baseline),true);
  const wrongRevision = structuredClone(owner.baseline);
  wrongRevision.defaultClassification.units[subunit.id].revision = 'another-policy';
  assert.equal(matchesDefaultPreview(source,wrongRevision),false);
});

test('Core-approved display-only changes keep the shipped preview, including another dirty root',async t => {
  const owner = await fixture(t), before = projectPreviewGeometryRows(await previewSource(owner));
  await command(owner,'territorial.metadata',{ id: 'CHN', field: 'color', valuePresent: true, value: '#123456' },['CHN']);
  await command(owner,'territorial.metadata',{ id: subunit.id, field: 'name', valuePresent: true, value: 'Renamed' },[subunit.id]);
  assert.deepEqual(projectPreviewGeometryRows(await previewSource(owner)),before);
  await command(owner,'territorial.metadata',{ id: 'GBR', field: 'color', valuePresent: true, value: '#345678' },['GBR']);
  const source = await previewSource(owner);
  assert.ok(source.project.entityDelta.changed.some(row => row.id === 'GBR'));
  assert.equal(matchesDefaultPreview(source,owner.baseline),true);
  assert.equal(previewSourceForProject(source,owner.baseline,null).kind,'default');
});

test('accepted border, parent, removal and creation edits cannot use shipped geometry and Undo restores it',async t => {
  const owner = await fixture(t);
  const edits = [
    ['territorial.geometry',{ id: 'CHN', geometry: rectangle(0,4.1) },['CHN']],
    ['territorial.parent',{ id: subunit.id, parentId: '' },[subunit.id]],
    ['territorial.remove',{ ids: ['GBR'] },['GBR']],
    ['territorial.create',{ feature: feature('NEW',rectangle(20,21)) },['NEW']],
  ];
  for (const [commandId,payload,ids] of edits) {
    await command(owner,commandId,payload,ids);
    assert.equal(matchesDefaultPreview(await previewSource(owner),owner.baseline),false,commandId);
    assert.equal(await owner.project.undo(),true);
    assert.equal(matchesDefaultPreview(await previewSource(owner),owner.baseline),true,`${commandId} Undo`);
  }
});

test('a parent outside the child geometry is rejected without changing preview, document or history',async t => {
  const owner = await fixture(t), before = owner.documentModel.snapshot(), state = owner.client.state();
  const source = await previewSource(owner);
  const result = await owner.project.executeCommand({ commandId: 'territorial.parent',
    targets: [{ domain: 'territorial', id: subunit.id }], payload: { id: subunit.id, parentId: 'GBR' } });
  assert.equal(result.ok,false);
  assert.equal(result.changed,false);
  assert.match(result.error.message,/GEOMETRY_OUTSIDE_PARENT/);
  assert.deepEqual(owner.documentModel.snapshot(),before);
  assert.deepEqual(owner.client.state(),state);
  assert.deepEqual(await previewSource(owner),source);
});

test('full saved geometry uses all Core views and requires the complete default classification',async t => {
  const owner = await fixture(t), source = await previewSource(owner,'pandolab-project-state');
  assert.equal(source.project.format,'pandolab-project-state');
  assert.equal(matchesDefaultPreview(source,owner.baseline),true);
  assert.deepEqual(projectPreviewGeometryRows(source),{ countries: [['CHN',china],['GBR',britain]],
    removed: [], units: [[subunit.id,'general',subunit.parentId,hongKong]] });
  await command(owner,'territorial.remove',{ ids: [subunit.id] },[subunit.id]);
  assert.equal(matchesDefaultPreview(await previewSource(owner,'pandolab-project-state'),owner.baseline),false);
  assert.equal(await owner.project.undo(),true);
  assert.equal(matchesDefaultPreview(await previewSource(owner,'pandolab-project-state'),owner.baseline),true);
});

test('custom geometry uses a cache for the current source and algorithm, otherwise requires restoration',async t => {
  const owner = await fixture(t);
  await command(owner,'territorial.geometry',{ id: 'CHN', geometry: rectangle(0,4.1) },['CHN']);
  const source = await previewSource(owner), cache = { algorithmRevision: PROJECT_PREVIEW_ALGORITHM_REVISION,
    baseSourceSha256: owner.baseline.sourceSha256, geometryKey: 'worker-validated-key',
    countries: { features: [] }, territorialUnits: [], mesh: { positions: new Int32Array() } };
  assert.equal(previewSourceForProject(source,owner.baseline,null).kind,'restore');
  assert.deepEqual(previewSourceForProject(source,owner.baseline,cache),{ kind: 'project', cache });
  assert.equal(previewSourceForProject(source,owner.baseline,{ ...cache,baseSourceSha256: 'old' }).kind,'restore');
  assert.equal(previewSourceForProject(source,owner.baseline,{ ...cache,algorithmRevision: 'old' }).kind,'restore');
  assert.equal(previewSourceForProject(source,owner.baseline,{ ...cache,geometryKey: '' }).kind,'restore');
});

test('display key rows ignore presentation and names but change with accepted geometry and ownership',async t => {
  const owner = await fixture(t), original = JSON.stringify(projectPreviewGeometryRows(await previewSource(owner)));
  await command(owner,'territorial.metadata',{ id: 'CHN', field: 'name', valuePresent: true, value: 'Display only' },['CHN']);
  await command(owner,'territorial.metadata',{ id: subunit.id, field: 'color', valuePresent: true, value: '#123456' },[subunit.id]);
  await command(owner,'presentation.apply',{ action: 'groupStyle', group: 'objects', patch: { opacity: 0.5 } });
  assert.equal(JSON.stringify(projectPreviewGeometryRows(await previewSource(owner))),original);
  await command(owner,'territorial.parent',{ id: subunit.id, parentId: '' },[subunit.id]);
  assert.notEqual(JSON.stringify(projectPreviewGeometryRows(await previewSource(owner))),original);
  assert.equal(await owner.project.undo(),true);
  assert.equal(JSON.stringify(projectPreviewGeometryRows(await previewSource(owner))),original);
  await command(owner,'territorial.geometry',{ id: 'CHN', geometry: rectangle(0,4.1) },['CHN']);
  assert.notEqual(JSON.stringify(projectPreviewGeometryRows(await previewSource(owner))),original);
});

test('the renderer reads accepted Core properties while retaining cached display geometry',async t => {
  const owner = await fixture(t), store = createTerritorialEntityStore({ documentModel: owner.documentModel, commandOwner: owner.client });
  t.after(() => store.dispose());
  const repository = createTerritorialEntityRepository({ entityStore: store });
  await command(owner,'territorial.metadata',{ id: 'CHN', field: 'color', valuePresent: true, value: '#123456' },['CHN']);
  const cached = feature('CHN',rectangle(0,3.9),{ color: '#abcdef' });
  const cachedGeometry = cached.geometry, cachedBefore = structuredClone(cached);
  const resolve = createTerritorialFillResolver({ state: owner.documentModel.snapshot(), entityRepository: repository });
  assert.equal(resolve(cached).color,'#123456');
  assert.equal(repository.get('CHN'),owner.documentModel.territorialViews().find(row => row.id === 'CHN'));
  assert.equal(cached.geometry,cachedGeometry);
  assert.deepEqual(cached,cachedBefore);
  assert.equal(cached.properties.style.color,'#abcdef');
  assert.deepEqual(repository.get('CHN').geometry,china);
});

test('missing explicit preview source fields fail visibly without a document resolver fallback',() => {
  const malformed = [null, {}, { project: {} }, { territorialViews: [] }, { project: [], territorialViews: [] },
    { project: { format: 'pandolab-autosave-delta' }, territorialViews: [] },
    { project: { format: 'pandolab-autosave-delta', entityDelta: { changed: [] } }, territorialViews: [] }];
  for (const source of malformed) {
    assert.throws(() => projectPreviewGeometryRows(source),{ code: 'PL-PREVIEW-SOURCE' });
    assert.throws(() => matchesDefaultPreview(source,null),{ code: 'PL-PREVIEW-SOURCE' });
    assert.throws(() => previewSourceForProject(source,null,null),{ code: 'PL-PREVIEW-SOURCE' });
  }
});
});
contractSuite("project-preview-topology", () => {
const assert = __project_dep0.default;
const test = __project_dep3.default;
const { loadVerifiedCore } = __project_dep12;
const { validateGeometry } = __project_dep13;
const { inspectTopologyPreviewFeatures } = __project_dep14;

const box=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const feature=(coordinates,type='Polygon',id='shape')=>({type:'Feature',id,properties:{},geometry:{type,coordinates}});
const engine=loadVerifiedCore();
async function inspect(features,options={}) {
  const core=await engine;
  return inspectTopologyPreviewFeatures(features,{validateGeometry,
    clipper:{intersection:(...inputs)=>core.polygonOperation('intersection',inputs,false)},...options});
}
function hasRepairPoint(issue) {
  const points=issue.points||[issue.point];
  assert.ok(points.length&&points.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)));
}

test('strict preview rejects hole containment, nesting and cross-ring defects with repair coordinates',async()=>{
  const cases=[
    feature([box(0,0,10,10),box(11,1,1,1)]),
    feature([box(0,0,10,10),box(1,1,7,7),box(2,2,1,1)]),
    feature([box(0,0,10,10),box(1,1,4,4),box(3,3,4,4)]),
    feature([box(0,0,10,10),box(0,2,3,3)]),
    // Two isolated shell contacts disconnect the polygon interior.
    feature([box(0,0,10,10),[[0,5],[5,2],[10,5],[5,8],[0,5]]]),
  ];
  for(const value of cases){
    assert.deepEqual(validateGeometry(value),[],'individual rings are valid in this fixture');
    const issues=await inspect([value]);assert.ok(issues.length);issues.forEach(hasRepairPoint);
    assert.deepEqual(issues[0].ids,['shape']);
  }
});

test('strict preview rejects overlapping or line-touching MultiPolygon components',async()=>{
  for(const coordinates of [
    [[box(0,0,4,4)],[box(1,1,1,1)]],
    [[box(0,0,4,4)],[box(3,3,4,4)]],
    [[box(0,0,4,4)],[box(4,1,2,2)]],
  ]){
    const issues=await inspect([feature(coordinates,'MultiPolygon')]);
    assert.ok(issues.length);issues.forEach(hasRepairPoint);
  }
});

test('strict preview preserves valid holes, isolated touches and an island inside a hole',async()=>{
  const cases=[
    feature([box(0,0,10,10),box(2,2,2,2)]),
    feature([box(0,0,10,10),[[0,5],[2,4],[2,6],[0,5]]]),
    feature([box(0,0,10,10),box(1,1,2,2),box(3,3,2,2)]),
    feature([[box(0,0,10,10),box(2,2,6,6)],[box(3,3,2,2)]],'MultiPolygon'),
    feature([[box(0,0,2,2)],[box(2,2,2,2)]],'MultiPolygon'),
    // Three rings meeting at one contact point must not look like a cycle.
    feature([box(0,0,10,10),[[0,5],[2,3],[2,4],[0,5]],[[0,5],[2,6],[2,7],[0,5]]]),
  ];
  for(const value of cases)assert.deepEqual(await inspect([value]),[]);
});

test('inter-feature overlap keeps the 1e-14 area threshold and ancestor exemption',async()=>{
  const left=feature([box(0,0,1,1)],'Polygon','a');
  const tiny=feature([box(1-1e-8,1-1e-8,1,1)],'Polygon','b');
  assert.deepEqual(await inspect([left,tiny]),[]);
  const overlap=feature([box(1-1e-6,1-1e-6,1,1)],'Polygon','b');
  const issues=await inspect([left,overlap]);assert.equal(issues[0].reason,'overlap');hasRepairPoint(issues[0]);
  assert.deepEqual(await inspect([left,overlap],{unitParents:new Map([['b','a']])}),[]);
});

test('empty multipolygon is rejected even when there are no rings to validate',async()=>{
  const issues=await inspect([feature([],'MultiPolygon')]);
  assert.equal(issues[0].reason,'empty-geometry');
});
});
