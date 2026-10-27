import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

test('disposal cancels persistence and rejects pending or late snapshot exports as cancellation',async()=>{
  let release,started,cancelled=0;
  const response=new Promise(resolve=>{release=resolve;}),exporting=new Promise(resolve=>{started=resolve;});
  const domain=createProjectDomain({ productMode:'editor',appVersion:'test',persistence:{cancelPending(){cancelled++;}},
    commandOwner:{exportSnapshot:()=>{started();return response;}}});
  const pending=domain.buildAutosave();await exporting;domain.dispose();domain.dispose();
  release({storageJson:'{}',state:{epoch:1,checkpoint:1,presentationCheckpoint:0}});
  await assert.rejects(pending,{name:'AbortError',code:'PL-CORE-CANCELLED',cancelled:true});
  assert.equal(cancelled,1);await assert.rejects(domain.buildAutosave(),{name:'AbortError',cancelled:true});
});

test('accepted command before/after references are captured at ordered dispatch and publication without whole-project packets', async () => {
  const initial=Object.freeze({ labels: Object.freeze([]) }),first=Object.freeze({ labels: Object.freeze([{ id: 'L' }]) }),
    second=Object.freeze({ labels: Object.freeze([]) });
  let current=initial,held,publicationStarted;
  const hold=new Promise(resolve => { held=resolve; }),published=new Promise(resolve => { publicationStarted=resolve; });
  const commands=[],events=[];
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current,territorialViews: () => [] },
    commandOwner: { execute: async envelope => { commands.push(envelope.commandId);return { ok: true,changed: true,commandId: envelope.commandId }; } },
    publishCommand: async result => {
      if (result.commandId==='label.create') { publicationStarted();await hold;current=first; } else current=second;
    },onProjectChanged: event => events.push(event) });
  const creation=project.executeCommand({ commandId: 'label.create' });
  const removal=project.executeCommand({ commandId: 'label.remove' });
  await published;
  assert.deepEqual(commands,['label.create']);assert.deepEqual(events,[]);
  held();
  const [created,removed]=await Promise.all([creation,removal]);
  assert.equal(created.before,initial);assert.equal(created.after,first);
  assert.equal(removed.before,first);assert.equal(removed.after,second);
  assert.equal(created.after.labels[0].id,'L');
  assert.ok(Object.isFrozen(created));
  assert.ok(events.every(event => !Object.hasOwn(event.detail,'before') && !Object.hasOwn(event.detail,'after')));
});

test('whole history and commands share the dispatch boundary before the next mutation preimage is read', async () => {
  const initial=Object.freeze({ labels: Object.freeze([{ id: 'L' }]) }),restored=Object.freeze({ labels: Object.freeze([]) });
  let current=initial,release,started;
  const pending=new Promise(resolve => { release=resolve; }),held=new Promise(resolve => { started=resolve; });
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current,territorialViews: () => [] },
    commandOwner: { undo: async () => { started();await pending;current=restored;return { ok: true,changed: true }; },
      execute: async () => ({ ok: true,changed: false }) },publishCommand() {} });
  const undo=project.undo(),command=project.executeCommand({ commandId: 'generic.metadata' });
  await held;release();await undo;
  const result=await command;
  assert.equal(result.before,restored);assert.equal(result.after,restored);
});

test('project replacement awaits the selection/draft reset acknowledgement before swapping or rendering the next project', async () => {
  let release,signalReset;
  const held=new Promise(resolve => { release=resolve; }),resetStarted=new Promise(resolve => { signalReset=resolve; }),effects=[];
  const project=createProjectDomain({ productMode:'editor', readBuiltinSelectionCatalogs: () => [],documentModel: { snapshot: () => ({ current: true }) },
    commandOwner: { validateImport: async bytes => JSON.parse(bytes),captureReplacement: async () => 7,load: async () => effects.push('core-load'),releaseReplacement: async () => true },
    onProjectReset: async () => { signalReset();await held;effects.push('selection-ack');effects.push('selection-ui'); },
    replaceSnapshot: () => { effects.push('swap');return true; },invalidateProject: () => effects.push('render') });
  const loading=project.load({ current: true });
  await resetStarted;
  assert.deepEqual(effects,[]);assert.equal(project.getGeneration(),1);
  release();await loading;
  assert.deepEqual(effects,['selection-ack','selection-ui','core-load','swap','render']);
});

test('project replacement admits presentation catalog inside its ordered Core transaction', async () => {
  const calls = [],catalog = { hydroLayers: {},builtinSubunitSources: {},countryLabelIds: [] };
  const project = createProjectDomain({ productMode:'editor', readBuiltinSelectionCatalogs: () => [],readPresentationCatalog: () => catalog,
    documentModel: { snapshot: () => ({ current: true }) },publishCommand: async () => calls.push('publish-catalog'),
    commandOwner: { validateImport: async bytes => JSON.parse(bytes),captureReplacement: async () => 7,
      load: async () => calls.push('load'),presentationCatalogLoad: async value => { assert.equal(value,catalog);calls.push('admit-catalog');return {}; },
      releaseReplacement: async () => calls.push('release') },
    replaceSnapshot: () => { calls.push('present');return true; } });
  await project.load({ current: true });
  assert.deepEqual(calls,['load','admit-catalog','publish-catalog','present','release']);
});

test('temporal builtin opening carries its presentation boundary through rollback and retry',async()=>{
  const resets=[],effects=[],failure=new Error('candidate frame failed');let failed=true,presented=0,current=true;
  const domain=createProjectDomain({productMode:'viewer',readBuiltinSelectionCatalogs:()=>[],
    documentModel:{snapshot:()=>({current:true})},
    commandOwner:{captureReplacement:async()=>7,loadBaseline:async()=>effects.push('load'),
      rollbackReplacement:async()=>effects.push('rollback'),releaseReplacement:async()=>effects.push('release')},
    onProjectReset:event=>resets.push(event),replaceSnapshot:()=>{if(failed)throw failure;resets.at(-1).onPresented();},
    restoreReplacement:()=>effects.push('restore')});
  const options={source:'builtin',presentation:'temporal',isCurrent:()=>current,onPresented:()=>presented++};
  const read=async()=>({baselineId:3,setup:{}});
  await assert.rejects(domain.open(read,options),error=>error===failure);
  assert.deepEqual(resets.map(event=>[event.reason,event.presentation]),[['project-builtin','temporal'],['project-rollback','temporal']]);
  assert.deepEqual(effects,['load','rollback','restore','release']);assert.equal(presented,0);
  failed=false;assert.equal(await domain.open(read,options),true);assert.equal(presented,1);
  current=false;assert.equal(await domain.open(()=>assert.fail('Stale source must not be read.'),options),false);
});

test('same-generation territorial source admission delegates its exact scope and cursor intent to C++',async () => {
  const current=Object.freeze({ header: 'current',labels: Object.freeze([{ id: 'L' }]) }),source=Object.freeze({ territorialEntities: [] }),calls=[];
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current },publishCommand() {},readBuiltinSelectionCatalogs: () => [],
    commandOwner: { load: async value => { calls.push(['load',value]);return {}; },
      initialize: async value => { calls.push(['initialize',value]);return {}; } } });
  assert.equal(await project.admit(current,{ territorialSource: source,preserveCursor: true }),current);
  assert.deepEqual(calls,[['initialize',{ project: current,preserveCursor: true,territorialSource: source }]]);
  assert.equal(calls[0][1].project.labels,current.labels);assert.equal(calls[0][1].territorialSource,source);
  assert.equal(project.getGeneration(),0);
});

test('a presentation acknowledgement queues one presentation save and preserves the platform targeted render boundary',async () => {
  const body=Object.freeze({ labels: Object.freeze([]) }),events=[];
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => body,territorialViews: () => [] },
    commandOwner: { execute: async () => ({ ok: true,changed: true,delta: { objects: [],geometries: [] } }) },publishCommand() {},
    invalidateProject: () => assert.fail('View commands must not reset document geometry/topology.'),
    persistence: { queueProject: () => assert.fail('View commands use the presentation lane.'),queuePresentation: options => events.push(['save',options]) },
    onProjectChanged: event => events.push(['event',event.reason]) });
  await project.executeCommand({ commandId: 'presentation.apply',targets: [],payload: { action: 'visibility',key: 'countries',value: false } });
  assert.deepEqual(events,[['event','presentation.apply'],['save',{ markDirty: false }]]);
});

test('accepted metadata and geometry commands deliver canonical impact after publication without whole-project invalidation',async () => {
  const effects=[],outcomes=[
    { ok: true,changed: true,delta: { impact: { geometryDomains: [],identityDomains: ['territorial'],timelineChanged: false } } },
    { ok: true,changed: true,delta: { impact: { geometryDomains: ['hydro'],identityDomains: ['hydro'],timelineChanged: false } } },
  ];
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => ({}),territorialViews: () => [] },
    commandOwner: { execute: async () => outcomes.shift() },publishCommand: () => effects.push('publish'),
    invalidateProject: () => assert.fail('A command does not replace the entire rendered project.'),
    invalidateCommand: (reason,outcome) => effects.push([reason,outcome.delta.impact]) });
  await project.executeCommand({ commandId: 'territorial.metadata' });await project.executeCommand({ commandId: 'hydro.geometry' });
  assert.deepEqual(effects,['publish',['territorial.metadata',{ geometryDomains: [],identityDomains: ['territorial'],timelineChanged: false }],
    'publish',['hydro.geometry',{ geometryDomains: ['hydro'],identityDomains: ['hydro'],timelineChanged: false }]]);
});

test('source admission reuses a Core baseline handle and pure import waits for its ordered admission without replacing the projection',async () => {
  const current=Object.freeze({ territorialEntities: Object.freeze([]) }),calls=[],baseline={ sourceBytes: new Uint8Array([31,139,8]) },
    validated=Object.freeze({ format: 'pandolab-project-state',territorialEntities: Object.freeze([]) });
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current },publishCommand: (_result,context) => calls.push(context.reason),
    readBuiltinSelectionCatalogs: () => [],commandOwner: {
      storageBaselineLoad: async input => { assert.equal(input,baseline);calls.push('admit');return { state: { storageBaselineId: 7 } }; },
      validateImport: async bytes => { calls.push(['validate',bytes]);return validated; },
      load: () => assert.fail('Scoped source admission uses its admitted Core handle.'),
      initialize: async input => { calls.push(['initialize',input]);return {}; },
    } });
  const receipt=project.admitStorageBaseline(baseline),validation=project.prepareImport({ original: true });
  assert.equal((await receipt).storageBaselineId,7);assert.equal(await validation,validated);assert.equal(project.snapshot(),current);
  await project.admit(current,{ baselineId: 7,preserveCursor: true });
  assert.deepEqual(calls,['admit','storage-baseline',['validate','{"original":true}'],
    ['initialize',{ project: current,preserveCursor: true,baselineId: 7 }],'project-admission']);
  assert.equal(project.getGeneration(),0);
});

test('a source sequence retains its captured project generation across the baseline and scoped install boundary',async () => {
  const calls=[],project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => ({}) },publishCommand() {},readBuiltinSelectionCatalogs: () => [],
    commandOwner: { storageBaselineLoad: async () => ({ state: { storageBaselineId: 7 } }),
      initialize: async () => { calls.push('initialize');return {}; },load: async () => calls.push('load') } });
  const expectedGeneration=project.getGeneration();
  await project.admitStorageBaseline({ kind: 'stored-asset' },{ expectedGeneration });
  await project.resetRenderGeneration('replacement');
  await assert.rejects(project.admit(project.snapshot(),{ baselineId: 7,preserveCursor: true,expectedGeneration }),{ code: 'PL-CORE-STALE' });
  await assert.rejects(project.admitStorageBaseline({ kind: 'stored-asset' },{ expectedGeneration }),{ code: 'PL-CORE-STALE' });
  assert.deepEqual(calls,[]);
});

test('a failed accepted platform effect restores the Core capsule before propagating the original error and schedules no success effects',async () => {
  const before=Object.freeze({ labels: [{ id: 'L' }] }),after=Object.freeze({ labels: [] }),failure=new Error('Render adoption failed'),effects=[];
  let current=before;
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current,territorialViews: () => [] },
    commandOwner: {
      captureReplacement: async () => { effects.push('capture');return 7; },
      execute: async () => { current=after;effects.push('execute');return { ok: true,changed: true }; },
      rollbackReplacement: async id => { assert.equal(id,7);current=before;effects.push('rollback');return { project: before }; },
      releaseReplacement: async id => { assert.equal(id,7);effects.push('release');return true; },
    },publishCommand: (_result,{ reason }={}) => effects.push(reason || 'publish'),
    invalidateCommand: () => assert.fail('Failed adoption has no successful invalidation.'),
    onProjectChanged: () => assert.fail('Failed adoption has no change event.'),persistence: { queueProject: () => assert.fail('Failed adoption has no autosave.') } });
  await assert.rejects(project.executeCommand({ commandId: 'objects.remove' },{ applyAccepted: ack => {
    assert.equal(ack.before,before);assert.equal(ack.after,after);assert.equal(project.snapshot(),after);effects.push('effect');throw failure;
  } }),error => error===failure);
  assert.equal(project.snapshot(),before);assert.deepEqual(effects,['capture','execute','publish','effect','rollback','command-rollback','release']);
});

test('replacement cannot overwrite the bounded Core capsule while an earlier accepted platform effect is held',async () => {
  let releaseEffect,signalEffect,signalValidation;
  const held=new Promise(resolve => { releaseEffect=resolve; }),effectStarted=new Promise(resolve => { signalEffect=resolve; }),
    validated=new Promise(resolve => { signalValidation=resolve; }),effects=[];
  let current=Object.freeze({ complete: 'before' });
  const project=createProjectDomain({ productMode:'editor', documentModel: { snapshot: () => current,territorialViews: () => [] },readBuiltinSelectionCatalogs: () => [],
    commandOwner: {
      captureReplacement: async () => { effects.push('capture');return 7; },releaseReplacement: async () => { effects.push('release');return true; },
      execute: async () => { current=Object.freeze({ complete: 'accepted' });effects.push('execute');return { ok: true,changed: true }; },
      validateImport: async bytes => { signalValidation();return JSON.parse(bytes); },
      load: async bytes => { current=Object.freeze(JSON.parse(bytes));effects.push('load'); },
    },publishCommand() {},replaceSnapshot: () => true });
  const command=project.executeCommand({ commandId: 'objects.remove' },{ applyAccepted: async () => { signalEffect();await held;effects.push('effect'); } });
  await effectStarted;const replacement=project.load({ complete: 'new' });await validated;
  assert.deepEqual(effects,['capture','execute']);
  await assert.rejects(project.executeCommand({ commandId: 'generic.create' }),{ code: 'PL-CORE-STALE' });
  releaseEffect();await command;await replacement;
  assert.deepEqual(effects,['capture','execute','effect','release','capture','load','release']);assert.equal(project.snapshot().complete,'new');
});
