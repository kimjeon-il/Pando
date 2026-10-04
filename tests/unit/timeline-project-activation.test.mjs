import test from 'node:test';
import { createEmptyTerritorialState, createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import assert from 'node:assert/strict';
import * as projectState from '../../assets/js/modules/project-state.js';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { projectForStorage } from '../helpers/timeline-project.mjs';

function project(staticOnly = false) {
  const source = projectForStorage();
  if (staticOnly) source.projectFields.timelineRecords.geometryBindings = [{
    id: 'shape-static', entityId: 'A', validFrom: null, validTo: null, geometryRef: { id: 'shape', version: 2 },
  }];
  return createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base', baseDatasetFingerprint: '1'.repeat(64), distributionModes: ['territorial','geometry'],
    terrainDataset: 'terrain', hydroDataset: 'hydro', readSnapshot: () => source }).buildProject();
}

function session(baseEntities = null, baseDataset = null) {
  const effects = [];
  let current = { selected: 'keep-selection', history: [1], future: [2], dirty: true, saveTarget: 'original.pando' };
  const before = current;
  const domain = createProjectDomain({
    prepareRestore: source => projectState.prepareProjectForActivation(source, { baseEntities, baseDataset, baseDatasetFingerprint: '1'.repeat(64) }),
    replaceSnapshot: source => { effects.push('replace'); current = source; return true; },
    onReplacementState: () => effects.push('ui'), onProjectReset: () => effects.push('reset'),
    persistence: { cancelPending: () => effects.push('cancel'), queueProject: () => effects.push('autosave') },
    history: { reset: () => effects.push('history-reset') },
  });
  return { domain, effects, before, current: () => current };
}

test('nonstatic activation fails before replacement, selection/reset/history or save effects', async () => {
  const s = session();
  await assert.rejects(s.domain.load(project()), { code: 'TIMELINE_ACTIVATION' });
  assert.equal(s.current(), s.before);
  assert.deepEqual(s.effects, []);
});

test('a bad geometry archive fails before any project-domain publication', async () => {
  const s = session(); const broken = project(true); broken.geometries = [];
  await assert.rejects(s.domain.load(broken), { code: 'TIMELINE_GEOMETRY' });
  assert.equal(s.current(), s.before); assert.deepEqual(s.effects, []);
});

test('static activation retains unbound historical geometry versions', async () => {
  const s = session(); const source = project(true);
  await s.domain.load(source);
  assert.deepEqual(s.current().timelineRecords, source.timelineRecords);
  assert.deepEqual(s.current().geometries, source.geometries);
  assert.equal(s.current().territorialEntities[0].geometry, null);
});

test('delta recovery requires matching base and validates unchanged identities against complete records', async () => {
  const source = project(true), base = source.territorialEntities;
  const delta = { ...source, format: 'pandolab-autosave-delta', baseDataset: 'base', baseDatasetFingerprint: '1'.repeat(64),
    entityDelta: { changed: [], removedIds: [] } };
  delete delta.territorialEntities;
  const mismatch = session(base, 'different-base');
  await assert.rejects(mismatch.domain.load(delta), { code: 'PL-SCHEMA-BASE' });
  assert.deepEqual(mismatch.effects, []);
  const good = session(base, 'base'); await good.domain.load(delta);
  assert.deepEqual(good.current().territorialEntities, base);
  assert.deepEqual(good.current().geometries, source.geometries);
});


test('actual project domain and entity owner preserve content, selection, history, dirty and target on malformed candidates', async () => {
  const original = project(true);
  const state = { ...createEmptyTerritorialState(), selected:{domain:'territorial',id:'A'}, history:[{id:'undo'}],
    future:[{id:'redo'}], dirty:true, saveTarget:'current.gpkg' };
  const store = createTerritorialEntityStore({ getState:()=>state });
  store.restoreProject(original);
  const snapshot = () => ({ identities:store.identities(), records:state.timelineRecords, geometries:state.geometries.snapshot(),
    selected:state.selected, history:state.history, future:state.future, dirty:state.dirty, target:state.saveTarget });
  const effects = [];
  const domain = createProjectDomain({ prepareRestore:projectState.prepareProjectForActivation,
    replaceSnapshot: candidate => store.restoreProject(candidate),
    onReplacementState:()=>effects.push('render'), persistence:{cancelPending:()=>effects.push('cancel')},
    history:{reset:()=>effects.push('reset')}, saveState:{markOpenedFile:()=>effects.push('target')} });
  const before = structuredClone(snapshot());
  const mutations = [
    candidate=>candidate.geometries.push(structuredClone(candidate.geometries[0])),
    candidate=>candidate.timelineRecords.geometryBindings[0].geometryRef.version=99,
    candidate=>candidate.timelineRecords.lifetimes.push(structuredClone(candidate.timelineRecords.lifetimes[0])),
    candidate=>candidate.timelineRecords.parentRelations[0].parentId='missing',
    candidate=>candidate.territorialEntities[0].properties.sovereignty='A',
    candidate=>candidate.genericFeatures=[{type:'Feature',id:'00000000-0000-4000-8000-000000000001',geometry:null,properties:{schemaVersion:2}}],
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(original); mutate(bad);
    await assert.rejects(domain.load(bad));
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(effects, []);
  }
});
