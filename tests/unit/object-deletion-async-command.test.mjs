import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectDeletion } from "../../apps/editor/frontend/js/modules/app-object-deletion.js";

function setup() {
  let resolve, reject, generation = 1;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  const state = { selected: { domain: 'generic', type: 'feature', id: 'G' } }, events = [];
  const feature = { id: 'G', properties: { name: 'Generic' } };
  const owner = createObjectDeletion();
  owner.connect({ projectState: { state }, readinessUi: { requireCanonicalData: () => true },
    objectModelA: { genericFeatureService: { get: () => feature, remove: () => promise } },
    domains: { projectDomain: { getGeneration: () => generation },
      selectionUiController: { presentPrimary: () => events.push('clear') } },
    objectDisplay: { invalidateObjectPresentation: () => events.push('tree') },
    feedback: { setActionStatus: (...args) => events.push(['status',...args]) } });
  return { owner, state, events, resolve, reject, replace: () => { generation += 1; } };
}

test('generic delete publishes only after command completion and preserves a later selection', async () => {
  const f = setup(), pending = f.owner.deleteSelected();
  assert.deepEqual(f.events, []);
  f.state.selected = { domain: 'generic', type: 'feature', id: 'Other' };
  f.resolve({ ok: true }); assert.equal(await pending, true);
  assert.equal(f.events.includes('clear'), false);
  assert.equal(f.events.includes('tree'), true);
});

test('generic delete from a replaced project cannot update the new project UI', async () => {
  const f = setup(), pending = f.owner.deleteSelected();
  f.replace(); f.resolve({ ok: true });
  assert.equal(await pending, false); assert.deepEqual(f.events, []);
});

test('generic delete keeps a Worker technical error for the keyboard/modal operation boundary', async () => {
  const f = setup(), pending = f.owner.deleteSelected();
  const error = Object.assign(new Error('Document worker failed'), { code: 'PL-CORE-LOAD' });
  f.reject(error); await assert.rejects(pending, value => value === error);
  assert.deepEqual(f.events, []);
});

for (const domain of ['label','hydro']) test(`${domain} deletion waits for one canonical command and presents the accepted cleared selection without a second mutation`,async () => {
  let releaseCommand;
  const command=new Promise(resolve => { releaseCommand=resolve; }),events=[],envelopes=[];
  const feature=domain==='label' ? Object.freeze({ id: 'L',name: 'Label' }) : Object.freeze({ id: 'H',properties: Object.freeze({ category: 'river',name: 'Hydro' }) });
  const state={ selected: { domain,type: domain==='label' ? 'city' : 'river',id: feature.id },labels: domain==='label' ? [feature] : [] };
  const owner=createObjectDeletion();owner.connect({ projectState: { state },readinessUi: { requireCanonicalData: () => true },
    hydroModel: { hydroFeatureById: () => feature },hydroPresentation: { hydroEditById: () => feature,hydroCategoryLabel: () => '강',
      hydroFallbackName: () => 'river',hydroEditorName: name => name },objectModelA: { hydroAccusativeLabel: () => '강을' },
    domains: { projectDomain: { getGeneration: () => 1,executeCommand: envelope => { envelopes.push(envelope);return command; } },
      selectionUiController: { presentPrimary: () => events.push('selection') },
      renderingDomain: { invalidateLabels: () => events.push('render'),invalidateHydroPatch: () => events.push('render') } },
    objectDisplay: { invalidateObjectPresentation: () => events.push('tree') },feedback: { setActionStatus: () => events.push('status') } });
  const pending=owner.deleteSelected();assert.deepEqual(events,[]);
  assert.deepEqual(envelopes,[{ commandId: `${domain}.edit`,targets: [{ domain,id: feature.id }],
    payload: { domain,id: feature.id,value: null,create: false } }]);
  const physicalSettings=Object.freeze({});
  state.selected=null;releaseCommand({ ok: true,changed: true,before: { labels: [feature],hydroEdits: [feature],physicalSettings },after: { physicalSettings } });
  assert.equal(await pending,true);
  assert.deepEqual(events,['tree','selection','render','status']);
});
