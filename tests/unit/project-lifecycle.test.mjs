import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { createSaveStateController } from "../../apps/editor/frontend/js/modules/save-state-controller.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createCommandFixture } from '../helpers/current-command-fixture.mjs';

const seed=() => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
async function fixture(t,{ replaceSnapshot,recovery=null }={}) {
  const initial=seed(),events=[],decoded=Buffer.from(JSON.stringify(initial)),sourceBytes=gzipSync(decoded);
  const baseline={ kind: 'stored-asset',sourceBytes,encoding: 'gzip',compressedBytes: sourceBytes.byteLength,decodedBytes: decoded.byteLength,
    baseDataset: initial.baseDataset,sourceMonth: '2026-10',fingerprint: createHash('sha256').update(sourceBytes).digest('hex') };
  let owner;
  const saveState=createSaveStateController({ getDocumentState: () => owner?.client.state() ?? null });
  owner=await createNodeCoreProject(initial,{
    appVersion: 'fixture',saveState,
    prepareNewProject: async () => { events.push('prepare');const accepted=await owner.project.admitStorageBaseline(baseline);return { baselineId:accepted.storageBaselineId,builtinMeshReady: true }; },
    replaceSnapshot: async (...args) => { events.push('replace');return replaceSnapshot ? replaceSnapshot(...args):true; },
    restoreReplacement: () => events.push('rollback'),createProjectFile: value => value,
    persistence: { getRecovery:()=>recovery,cancelPending: () => events.push('cancel-pending'),clear: async () => events.push('clear-autosave'),
      queueProject: (_delay,options) => { assert.equal(options.markDirty,false);events.push('autosave'); } },
    onProjectReset: () => events.push('reset'),onProjectChanged: () => events.push('event'),
    invalidateProject: () => events.push('render'),invalidateHistory: () => events.push('render'),
  });
  t.after(() => owner.dispose());
  return { ...owner,domain: owner.project,saveState,events,initial };
}
const rename=(domain,name) => domain.executeCommand({ commandId: 'territorial.metadata',targets: [{ domain: 'territorial',id: 'A' }],
  payload: { id: 'A',field: 'name',valuePresent: true,value: name } });

test('load/new publish one event, render and autosave after Core replacement and remain clean',async t => {
  const { domain,client,saveState,events,initial }=await fixture(t);
  await rename(domain,'Before open');events.length=0;
  await domain.load(initial);
  assert.deepEqual(events,['cancel-pending','reset','replace','event','render','autosave']);
  assert.equal(client.state().canUndo,false);assert.equal(saveState.snapshot().hasUnsavedChanges,false);
  events.length=0;await domain.createProject({initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});
  assert.deepEqual(events,['prepare','cancel-pending','reset','replace','clear-autosave','event','render','autosave']);
  assert.deepEqual(domain.snapshot().timelineRecords,initial.timelineRecords);assert.equal(saveState.snapshot().file,'never-saved');
});

test('project preview cache operations pass through ProjectDomain',async () => {
  const project={ format: 'pandolab-autosave-delta' },calls=[];
  const domain=createProjectDomain({ productMode:'editor', persistence: {
    restorePreview: async value => { calls.push(['restore',value]);return { countryIds: ['DEU'] }; },
    ensurePreview: value => { calls.push(['ensure',value]);return true; },
  } });
  assert.deepEqual(await domain.restorePreview(project),{ countryIds: ['DEU'] });
  assert.equal(domain.ensurePreview(project),true);assert.deepEqual(calls,[['restore',project],['ensure',project]]);
});

test('failed platform replacement restores the canonical full project and history without success effects',async t => {
  const failure=new Error('replacement failed'),{ domain,client,events,initial }=await fixture(t,{ replaceSnapshot: () => { throw failure; } });
  const acceptedInitial=domain.snapshot();await rename(domain,'History before failure');const before=domain.snapshot();events.length=0;
  await assert.rejects(domain.load(initial),error => error===failure);
  assert.deepEqual(domain.snapshot(),before);assert.equal(client.state().canUndo,true);
  assert.equal(domain.getGeneration(),2);assert.equal(domain.isReplacing(),false);
  assert.deepEqual(events,['cancel-pending','reset','replace','reset','rollback']);
  assert.equal(await domain.undo(),true);assert.deepEqual(domain.snapshot(),acceptedInitial);
});

test('new project retains its replacement boundary until the prepared visual swap acknowledges',async t => {
  let releaseSwap,signalSwapStarted;
  const held=new Promise(resolve => { releaseSwap=resolve; }),started=new Promise(resolve => { signalSwapStarted=resolve; });
  const { domain }=await fixture(t,{ replaceSnapshot: async (_project,options) => {
    assert.equal(options.prepared.builtinMeshReady,true);signalSwapStarted();await held;return true;
  } });
  const pending=domain.createProject({initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});await started;
  assert.equal(domain.isReplacing(),true);assert.equal(domain.getGeneration(),1);
  releaseSwap();await pending;assert.equal(domain.isReplacing(),false);
});

test('whole Core undo/redo emit one lifecycle sequence and empty history has no effects',async t => {
  const { domain,events }=await fixture(t);
  assert.equal(await domain.undo(),false);assert.deepEqual(events,[]);
  await rename(domain,'Undo boundary');events.length=0;
  assert.equal(await domain.undo(),true);assert.deepEqual(events,['event','render','autosave']);
  events.length=0;assert.equal(await domain.redo(),true);assert.deepEqual(events,['event','render','autosave']);
});

test('undo and redo retain the Core saved checkpoint of the complete document',async t => {
  const owner=await createCommandFixture();t.after(() => owner.dispose());
  const { service,domain,saveState }=owner;
  await service.updateMetadata('A','name','Beta');await owner.markSaved();
  await service.updateMetadata('A','name','Gamma');assert.equal(saveState.snapshot().documentDirty,true);
  assert.equal(await domain.undo(),true);assert.equal(saveState.snapshot().documentDirty,false);
  assert.equal(await domain.undo(),true);assert.equal(saveState.snapshot().documentDirty,true);
  assert.equal(await domain.redo(),true);assert.equal(saveState.snapshot().documentDirty,false);
  assert.equal(await domain.redo(),true);assert.equal(saveState.snapshot().documentDirty,true);
});

test('invalid file preparation changes no live model, history, generation or platform effects',async t => {
  const { domain,client,events }=await fixture(t);
  await rename(domain,'Retained history');const before=domain.snapshot(),state=client.state();events.length=0;
  await assert.rejects(domain.load({ format: 'pandolab-project-state',schemaVersion: 999 }));
  assert.equal(domain.snapshot(),before);assert.deepEqual(client.state(),state);
  assert.equal(domain.getGeneration(),0);assert.equal(domain.isReplacing(),false);assert.deepEqual(events,[]);
});

test('file save owns I/O status and detached Core output without history/render/autosave effects',async t => {
  const { domain,saveState,events }=await fixture(t);await rename(domain,'Saved name');events.length=0;
  const before=saveState.checkpoint(),project=domain.snapshot();
  await assert.rejects(domain.save(() => { throw Object.assign(new Error('cancel'),{ name: 'AbortError' }); }));
  assert.deepEqual(saveState.checkpoint(),before);
  assert.equal(await domain.save(body => { body.territorialEntities[0].properties.name='Detached file';return { downloaded: true }; }),true);
  assert.equal(domain.snapshot(),project);assert.equal(saveState.snapshot().file,'download-created');
  assert.equal(domain.canUndo(),true);assert.deepEqual(events,[]);
});

test('new edits during a held device write stay dirty and duplicate saves do not dispatch',async t => {
  const { domain,saveState }=await fixture(t);let finish,signalWriting;
  const held=new Promise(resolve => { finish=resolve; }),writing=new Promise(resolve => { signalWriting=resolve; });
  const pending=domain.save(async () => { signalWriting();await held;return { downloaded: false }; });await writing;
  assert.equal(await domain.save(() => assert.fail('duplicate writer')),false);
  await rename(domain,'Changed during export');finish();await pending;
  assert.equal(saveState.snapshot().hasUnsavedChanges,true);assert.equal(saveState.snapshot().file,'dirty');
});

const setup=(overrides={})=>({ initialMonth:'1914-07',timelineRange:{start:'1900-01',end:'1920-12'},initialMapBounds:null,sourceMode:'builtin',...overrides });

test('unsupported autosaves allow creation without clearing the protected slots; conflicts block creation',async t=>{
 for(const kind of ['unsupported','read-error','conflict']){
  const recovery={kind},owner=await fixture(t,{recovery}),before=owner.domain.snapshot();
  if(kind==='conflict')await assert.rejects(owner.domain.createProject(setup()),/저장본 선택/);
  else {await owner.domain.createProject(setup());assert.notEqual(owner.domain.snapshot().documentId,before.documentId);}
  assert.equal(owner.events.includes('clear-autosave'),false);
  assert.deepEqual(recovery,{kind});
 }
});
test('createProject exposes selected month first and persists canonical setup without slicing records',async t=>{
 const {domain,client,initial}=await fixture(t); await domain.createProject(setup());
 assert.equal(client.state().timelineCursor,'1914-07');assert.deepEqual(domain.snapshot().projectSetup,setup());
 assert.deepEqual(domain.snapshot().timelineRecords,initial.timelineRecords);
 const stored=await client.storageSnapshot();await domain.load(JSON.parse(stored));assert.equal(client.state().timelineCursor,'1914-07');assert.deepEqual(domain.snapshot().projectSetup,setup());
});
test('creation rejects invalid settings without replacing the project; empty source has no content',async t=>{
 const {domain}=await fixture(t);const before=domain.snapshot();
 for(const options of [setup({initialMonth:'0000-01'}),setup({initialMonth:'1914-13'}),setup({timelineRange:{start:'1920-01',end:'1900-01'}}),setup({initialMonth:'2026-10'}),setup({initialMapBounds:{west:0,east:20,south:50,north:40}})])await assert.rejects(domain.createProject(options));
 assert.equal(domain.snapshot(),before);await domain.createProject(setup({initialMonth:'-0044-03',timelineRange:null,sourceMode:'empty'}));
 assert.equal(domain.snapshot().territorialEntities.length,0);assert.equal(domain.snapshot().geometries.length,0);
});

test('creation period rejects out-of-range navigation and keeps project records intact',async t=>{
 const {domain,client,initial}=await fixture(t);await domain.createProject(setup());
 await assert.rejects(client.setTimelineCursor('2026-10'),/PROJECT_RANGE/);
 assert.equal(client.state().timelineCursor,'1914-07');assert.deepEqual(domain.snapshot().timelineRecords,initial.timelineRecords);
 assert.equal('configureProject' in domain,false);
});
