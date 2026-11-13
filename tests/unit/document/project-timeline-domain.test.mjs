import { describe as contractSuite } from 'node:test';
import { fingerprintProjectBaseline } from '../../../src/document/project-baseline-fingerprint.js';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "node:fs";
import * as __contract_dep3 from "../../../src/document/project-domain.js";
import * as __contract_dep4 from "../../helpers/core-project.mjs";
import * as __contract_dep5 from "../../../src/document/project-state.js";
import * as __contract_dep6 from "../../../tools/gis/project-template-compiler.js";
import * as __contract_dep7 from "../../fixtures/timeline-storage-cases.mjs";
import * as __contract_dep8 from "../../helpers/timeline-project.mjs";
contractSuite('project-timeline-domain',async()=>{
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { readFileSync } = __contract_dep2;
const { createProjectDomain } = __contract_dep3;
const { createNodeCoreProject } = __contract_dep4;
const { prepareProjectForStorage, prepareProjectForActivation } = __contract_dep5;

test('project domain resolves a month without changing stored project', async () => {
  const project = JSON.parse(readFileSync(new URL("../../fixtures/timeline-exchange/complex.json", import.meta.url), 'utf8'));
  const before = structuredClone(project);
  const core=await createNodeCoreProject(project);
  const admitted=core.project.snapshot();
  try {
    const july = await core.project.resolveWorld('1914-07');
    assert.equal(july.byId.get('A').geometryRef.version, 2);
    assert.equal(july.byId.get('B').parentId, 'A');
    assert.deepEqual(project, before);assert.deepEqual(core.project.snapshot(),admitted);
    assert.equal(core.client.state().dirty,false);assert.equal(core.client.state().canUndo,false);
  } finally { core.dispose(); }
});

test('project timeline requires its canonical core query dependency', async () => {
  await assert.rejects(createProjectDomain({ productMode:'editor' }).resolveWorld('1914-07'), /C\+\+ document query/);
});

test('P3 activation reuses the validated timeline storage without changing schema or resolved history',()=>{
 const project=JSON.parse(readFileSync(new URL("../../fixtures/timeline-exchange/complex.json",import.meta.url),'utf8'));
 const original=structuredClone(project);
 const storage=prepareProjectForStorage(project);
 const active=prepareProjectForActivation(project);
 assert.deepEqual(active,storage);
 assert.equal(active.schemaVersion,14);
 assert.equal(active.timelineRecords.schemaVersion,3);
 assert.deepEqual(project,original,'detached preparation must never mutate the opened project');
 const second=prepareProjectForActivation(project);
 assert.deepEqual(second,storage,'repeated activation must preserve every record and geometry byte');
 const invalid=structuredClone(project);
 invalid.schemaVersion=13;
 assert.throws(()=>prepareProjectForActivation(invalid),{code:'PL-SCHEMA-OLD'});
});
});
contractSuite("timeline-project", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createProjectTemplateCompiler } = __contract_dep6;
const { assertCurrentProjectSchema } = __contract_dep5;
const { timelineStorageCases } = __contract_dep7;
const { projectForStorage } = __contract_dep8;

const serializer = source => createProjectTemplateCompiler({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial', 'geometry'], terrainDataset: 'terrain', hydroDataset: 'hydro',
  readSnapshot: () => source, now: () => new Date('2026-10-04T00:00:00Z') });

test('production serializer stores records and every version instead of a current Feature shape', () => {
  const source = projectForStorage();
  const before = structuredClone(source);
  const project = serializer(source).buildProject();
  assert.equal(project.schemaVersion, 14);
  assert.equal(project.territorialEntities[0].geometry, null);
  assert.deepEqual(project.timelineRecords, source.projectFields.timelineRecords);
  const versions = entries => new Map(entries.map(entry => [JSON.stringify([entry.id, entry.version]), entry.geojson]));
  assert.deepEqual(versions(project.geometries), versions(source.projectFields.geometries));
  for (const key of ['parentId', 'coverageMode', 'validFrom', 'validTo'])
    assert.equal(Object.hasOwn(project.territorialEntities[0].properties, key), false);
  assertCurrentProjectSchema(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(source, before);
});

for (const row of timelineStorageCases()) test(`production project codec: ${row.name === 'unknown snapshot schema' ? 'old project schema rejected' : row.name}`, () => {
  const service = serializer(projectForStorage(row));
  if (row.expected === 'OK') {
    const project = service.buildProject();
    assertCurrentProjectSchema(JSON.parse(JSON.stringify(project)));
    assert.equal(project.geometries.length, row.input.geometries.length);
  } else {
    // Storage-envelope faults belong to the checkpoint boundary, not project fields.
    if (row.name === 'unknown snapshot schema') {
      assert.throws(() => assertCurrentProjectSchema({ ...service.buildProject(), schemaVersion: row.input.schemaVersion }));
    } else if (!row.input.geometries) {
      assert.throws(() => service.buildProject());
    } else if (row.name !== 'unknown snapshot field') {
      assert.throws(() => service.buildProject());
    } else {
      assert.throws(() => assertCurrentProjectSchema({ ...service.buildProject(), cursor: '1914-07' }));
    }
  }
});
});
contractSuite("timeline-project-activation", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createProjectTemplateCompiler } = __contract_dep6;
const { projectForStorage, staticProjectDocument } = __contract_dep8;
const { createNodeCoreProject } = __contract_dep4;



function project(staticOnly=false) {
  const source=projectForStorage();
  if(staticOnly)source.projectFields.timelineRecords.geometryBindings=[{id:'shape-static',objectRef:{domain:"territorial",id:'A'},validFrom:null,validTo:null,geometryRef:{id:'shape',version:2}}];
  return {...structuredClone(createProjectTemplateCompiler({appVersion:'0.34.0',baseDataset:'base',distributionModes:['territorial','geometry'],
    terrainDataset:'terrain',hydroDataset:'hydro',readSnapshot:()=>source}).buildProject()),mapProjectIdentity:null};
}
async function session(t,input=staticProjectDocument()) {
  const effects=[],presentation={render:'current-render',session:'current-session',target:'original.pando'};let owner;
  owner=await createNodeCoreProject(input,{
    replaceSnapshot:source=>{effects.push('replace');assert.equal(source,owner.documentModel.snapshot());return true;},
    onReplacementState:()=>{effects.push('ui');presentation.render='replaced';},
    onProjectReset:()=>{effects.push('reset');presentation.session='replaced';},
    persistence:{cancelPending:()=>effects.push('cancel'),queueProject:()=>effects.push('autosave')},
  });t.after(()=>owner.dispose());effects.length=0;
  return {...owner,domain:owner.project,effects,presentation,current:owner.project.snapshot};
}

test('valid dated project activates through the actual Core with its full records intact',async t=>{
  const s=await session(t),source=project();await s.domain.load(source);
  assert.deepEqual(s.current().timelineRecords,source.timelineRecords);assert.deepEqual(s.current().geometries,source.geometries);
  assert.ok(s.effects.includes('replace'));assert.equal(s.client.state().canUndo,false);
});
test('a bad geometry archive fails before any document, device or presentation publication',async t=>{
  const s=await session(t),broken=project(true),before=s.current(),clock=s.client.state();broken.geometries=[];
  await assert.rejects(()=>s.domain.load(broken),{code:'TIMELINE_GEOMETRY'});
  assert.equal(s.current(),before);assert.deepEqual(s.client.state(),clock);assert.deepEqual(s.effects,[]);
});
test('static activation retains every unbound historical geometry version',async t=>{
  const s=await session(t),source=project(true);await s.domain.load(source);
  assert.deepEqual(s.current().timelineRecords,source.timelineRecords);assert.deepEqual(s.current().geometries,source.geometries);
  assert.equal(s.current().territorialEntities[0].geometry,null);
});
test('delta recovery requires the matching immutable baseline and retains complete records and archive',async t=>{
  const source=project(true);source.baseDataset='base';
  const baseOwner=await createNodeCoreProject(source);let features;
  try{features=structuredClone(baseOwner.documentModel.territorialViews());}finally{baseOwner.dispose();}
  const fingerprint=await fingerprintProjectBaseline(features),delta={...source,format:'pandolab-autosave-delta',baseDatasetFingerprint:fingerprint,
    entityDelta:{changed:[],removedIds:[]}};delete delta.territorialEntities;
  const mismatch=await session(t);await mismatch.client.storageBaselineLoad({kind:'static-features',baseDataset:'different-base',fingerprint,features});
  const before=mismatch.current();await assert.rejects(()=>mismatch.domain.load(delta),{code:'PL-SCHEMA-BASE'});
  assert.equal(mismatch.current(),before);assert.deepEqual(mismatch.effects,[]);
  const good=await session(t);await good.client.storageBaselineLoad({kind:'static-features',baseDataset:'base',fingerprint,features});
  await good.domain.load(delta);assert.deepEqual(good.current().territorialEntities,source.territorialEntities);
  assert.deepEqual(good.current().timelineRecords,source.timelineRecords);assert.deepEqual(good.current().geometries,source.geometries);
});
test('malformed candidates preserve the real Core content, selection, history, dirty checkpoints and device target',async t=>{
  const original=project(true),s=await session(t,original);
  await s.domain.executeCommand({commandId:'territorial.metadata',targets:[{domain:'territorial',id:'A'}],
    payload:{id:'A',field:'name',valuePresent:true,value:'edited'}});
  await s.client.selectionApply({action:'replace',ref:{domain:'territorial',type:'entity',id:'A'}});
  const before=s.current(),clock=s.client.state(),selection=await s.client.selectionSnapshot(),display=structuredClone(s.presentation);
  s.effects.length=0;
  const mutations=[row=>row.geometries.push(structuredClone(row.geometries[0])),
    row=>{row.timelineRecords.geometryBindings[0].geometryRef.version=99;},
    row=>row.timelineRecords.lifetimes.push(structuredClone(row.timelineRecords.lifetimes[0])),
    row=>{row.timelineRecords.parentRelations[0].parentId='missing';},row=>{row.territorialEntities[0].properties.sovereignty='A';},
    row=>{row.genericFeatures=[{type:'Feature',id:'00000000-0000-4000-8000-000000000001',geometry:null,properties:{schemaVersion:2}}];},
    row=>{row.timelineRecords.lifetimes[0].validFrom='0000';},row=>{row.timelineRecords.lifetimes[0].validTo='1900-02-29';}];
  for(const mutate of mutations) {
    const bad=structuredClone(original);mutate(bad);await assert.rejects(()=>s.domain.load(bad));
    assert.equal(s.current(),before);assert.deepEqual(s.client.state(),clock);assert.deepEqual(await s.client.selectionSnapshot(),selection);
    assert.deepEqual(s.effects,[]);assert.deepEqual(s.presentation,display);
    assert.equal(s.domain.getGeneration(),0);assert.equal(s.domain.isReplacing(),false);
  }
  assert.equal(await s.domain.undo(),true);assert.deepEqual(s.current(),original);
});
});
