import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObjectCommands } from "../../apps/editor/frontend/js/modules/app-object-commands.js";
import { createSelectionDomain } from "../../shared/frontend/js/modules/selection-domain.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { coreSelectionRefToWeb,webSelectionRefToCore } from "../../shared/frontend/js/modules/core-object-ref.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { FOUNDATION_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports.js";
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { startupDocument } from '../helpers/core-startup.mjs';
import { createTestViewingSession } from '../helpers/viewing-project.mjs';

async function harness(t,refs,{ builtin=false }={}) {
  const input=startupDocument();
  const effects={ saved: 0,palette: 0,hydro: 0,base: 0,labels: 0,selection: 0 };
  let viewing;
  const owner=await createNodeCoreProject(input,{
    viewingPresentation: payload => viewing.session.applyViewingPresentation(payload),
    persistence: { queueView() { effects.saved++; },queueProject() {},queuePresentation() {},cancelPending() {} },
    invalidateProject: () => assert.fail('Visibility cannot invalidate the full project.'),
  });
  viewing=createTestViewingSession(owner);
  viewing.session.setViewingPresentation({
    layerVisibility: Object.fromEntries(Object.keys(viewing.session.state.layerVisibility).map(key => [key,true])),
    itemVisibility: Object.fromEntries(Object.keys(viewing.session.state.itemVisibility).map(key => [key,{}])),
    physicalSettings: { ...viewing.session.state.physicalSettings,hiddenHydroIds:{},
      hydroLayers:{ rivers_hydro:true,lakes_natural_earth:true } },
  });
  const store=createTerritorialEntityStore({ documentModel: owner.documentModel,commandOwner: owner.client }),repository=createTerritorialEntityRepository({ entityStore: store });
  let selection;
  t.after(() => { selection?.dispose();store.dispose();viewing.dispose();owner.dispose(); });
  await owner.project.admit(owner.project.snapshot(),{ features: ['a','b'].map(id => createTerritorialFeature({ id,entityKind: 'general',name: id,locked: true,
    geometry: { type: 'Polygon',coordinates: [[[0,0],[8,0],[8,8],[0,8],[0,0]]] } })),preserveCursor: true });
  for(const command of [
    { commandId: 'generic.create',targets: [{ domain: 'generic',id: 'a' }],payload: { feature: { type: 'Feature',id: 'a',geometry: { type: 'Point',coordinates: [1,2] },
      properties: { schemaVersion: 2,name: 'Generic',notes: '',color: '#8c68d8',locked: true,source: { kind: 'drawn',license: '',details: {} } } } } },
    { commandId: 'label.edit',targets: [{ domain: 'label',id: 'a' }],payload: { domain: 'label',id: 'a',create: true,value: { id: 'a',kind: 'city',name: 'Label',notes: '',coordinates: [1,2] } } },
    { commandId: 'distribution.layer.create',targets: [{ domain: 'distributionLayer',id: 'a' }],payload: { options: { id: 'a',name: 'Distribution',locked: true } } },
    { commandId: 'hydro.edit',targets: [{ domain: 'hydro',id: 'a' }],payload: { domain: 'hydro',id: 'a',create: true,value: { type: 'Feature',id: 'a',
      geometry: refs.some(ref => ref.domain==='hydro' && ref.type==='lake')
        ? { type: 'Polygon',coordinates: [[[0,0],[1,0],[1,1],[0,0]]] }
        : { type: 'LineString',coordinates: [[0,0],[1,1]] },properties: { pandolab_domain: 'hydro',pandolab_id: 'a',pandolab_schema_version: 1,
          editorColor: '#49798a',category: refs.find(ref => ref.domain==='hydro')?.type || 'river',name: '',notes: '',locked: true } } } },
  ]) { const result=await owner.project.executeCommand(command);assert.equal(result.ok,true,result.error?.message); }
  const builtinFeature={ id: refs[0]?.id,properties: { pandolab_id: refs[0]?.id,category: refs[0]?.type } };
  if(builtin)await owner.client.selectionCatalogLoad('hydroBuiltin',refs.map(ref => ({ domain: 'hydroBuiltin',type: ref.type,id: ref.id,logicalId: ref.id,sourceIds:[] })));
  selection=createSelectionDomain({ commandOwner: owner.client,projectDomain: owner.project,
    refAdapter: { fromCore: coreSelectionRefToWeb,toCore: ref => webSelectionRefToCore(ref,{ isStoredHydro: id => !!owner.documentModel.get({ domain: 'hydro',id }) }) } });
  await selection.setMany(refs);await owner.client.markSaved(owner.client.state().epoch);
  // Live object visibility consults the accepted timeline month.
  const state={ projectReplacing: false, timelineCursor: '2026-10' };
  for(const field of ['layerVisibility','itemVisibility','physicalSettings','territorialEntities','genericFeatures','labels','distributionEntries'])
    Object.defineProperty(state,field,{ get: () => ['layerVisibility','itemVisibility','physicalSettings'].includes(field)
      ? viewing.session.state[field] : owner.documentModel.snapshot()[field] });
  const nodes=new Map(['objectVisibilityBtn','objectVisibilityIcon','editorObjectStatus'].map(id => [id,{
    attrs: {},dataset: {},classList: { toggle() {} },setAttribute(key,value) { this.attrs[key]=value; },
  }]));
  nodes.set('objectDeleteBtn', {
    attrs: {},dataset: {},help: { textContent: '' },
    setAttribute(key,value) { this.attrs[key]=value; },
    querySelector(selector) { return selector === 'small' ? this.help : null; },
  });
  const commands=createObjectCommands();
  const ports={ state,$: id => nodes.get(id),normalizeObjectRef,selectionDomain: selection,entityRepository: repository,
    territorialApplicationService: { canDelete: () => ({ ok: false,code: 'locked' }) },
    distributionVisibilityRevision: 0,bumpVisibilityRevision: () => { ports.distributionVisibilityRevision++; },
    distributionLayerById: id => owner.documentModel.get({ domain: 'distributionLayer',id }),
    hydroFeatureById: id => builtin ? builtinFeature:owner.documentModel.get({ domain: 'hydro',id }),
    hydroEditById: id => owner.documentModel.get({ domain: 'hydro',id }),labelById: id => owner.documentModel.get({ domain: 'label',id }),
    syncTerritorialEditorInteraction() {},hydroCategoryKey: value => value==='lake' ? 'lake':'river',
    hydroCategoryLabel: value => value==='lake' ? '호수':'강',hydroFallbackName: value => `이름 없는 ${value==='lake' ? '호수':'강'}`,
    hydroEditorName: (value,fallback) => String(value || '').trim() || fallback,
    isLayerItemVisible: (group,id) => state.itemVisibility[group]?.[id]!==false,invalidateObjectPresentation() {},
    gpuMapRenderer: { invalidateCountryPalette() { effects.palette++; },invalidateHydroVisibility() { effects.hydro++; } },
    renderingDomain: { invalidateBaseScene() { effects.base++; },invalidateLabels() { effects.labels++; },invalidateSelection() { effects.selection++; } },
    projectDomain: owner.project,
  };
  commands.connect(capabilityPortsForFixture(FOUNDATION_OWNER_PORTS.objectCommands,ports));
  return { ...owner,commands,state,effects,nodes,ports };
}

test('river and lake display info uses only the object kind without built-in source text',async t => {
  for(const type of ['river','lake']) {
    const { commands }=await harness(t,[{ domain: 'hydro',type,id: `builtin-${type}` }],{ builtin: true });
    assert.deepEqual(commands.objectDisplayInfo({ domain: 'hydro',type,id: `builtin-${type}` }),{ name: `이름 없는 ${type==='lake' ? '호수':'강'}`,type: type==='lake' ? '호수':'강',detail: '' });
  }
});

test('per-object visibility preserves every master, selection, document checkpoint and whole-project history',async t => {
  for(const [domain,type,group] of [['territorial','entity','objects'],['hydro','river','hydro'],['hydro','lake','hydro'],
    ['distribution','distribution','distributions'],['label','label','labels'],['generic','feature','genericFeatures']]) {
    const refs=[{ domain,type,id: 'a' }],f=await harness(t,refs),masters=structuredClone(f.state.layerVisibility),checkpoint=f.client.state().checkpoint;
    await f.commands.batchSetVisibility();
    assert.equal(f.state.itemVisibility[group].a,false);assert.equal(f.state.itemVisibility[group].b,undefined);
    assert.equal(f.nodes.get('objectVisibilityIcon').attrs.href,'#icon-eye-off');
    assert.equal(f.nodes.get('objectVisibilityBtn').attrs['aria-label'],'객체 표시');assert.match(f.nodes.get('editorObjectStatus').textContent,/숨김/);
    await f.commands.batchSetVisibility();assert.equal(f.state.itemVisibility[group].a,undefined);
    assert.equal(f.nodes.get('objectVisibilityBtn').attrs['aria-label'],'객체 숨기기');assert.deepEqual(f.state.layerVisibility,masters);
    assert.equal(f.ports.selectionDomain.size(),1);assert.equal(f.effects.saved,2);assert.equal(f.effects.labels,2);assert.equal(f.effects.selection,2);
    assert.equal(f.client.state().checkpoint,checkpoint);assert.equal(f.client.state().documentDirty,false);
    assert.equal(f.client.state().presentationDirty,false,'viewing-only visibility must not alter Core history');
  }
});

test('built-in hydro visibility uses admitted logical IDs and preserves source switches',async t => {
  for(const type of ['river','lake']) {
    const f=await harness(t,[{ domain: 'hydro',type,id: 'builtin-a' }],{ builtin: true });
    const sources=structuredClone(f.state.physicalSettings.hydroLayers),items=structuredClone(f.state.itemVisibility);
    await f.commands.batchSetVisibility(false);assert.equal(f.state.itemVisibility.hydro['builtin-a'],false);
    assert.equal(f.nodes.get('objectVisibilityBtn').disabled,false);await f.commands.batchSetVisibility(true);
    assert.deepEqual(f.state.itemVisibility,items);
    assert.deepEqual(f.state.physicalSettings.hiddenHydroIds,{});
    assert.deepEqual(f.state.physicalSettings.hydroLayers,sources);assert.equal(f.effects.hydro,2);
  }
});

test('mixed visibility, no-op and replacement guards use the same canonical command',async t => {
  const refs=[{ domain: 'generic',type: 'feature',id: 'a' },{ domain: 'label',type: 'label',id: 'a' }],f=await harness(t,refs);
  await f.project.executeCommand({ commandId: 'presentation.apply',targets: [],payload: { action: 'objectVisibility',refs: [{ domain: 'label',type: 'label',id: 'a' }],visible: false } });
  f.effects.saved=0;f.commands.syncObjectActionsMenu();assert.equal(f.nodes.get('objectVisibilityBtn').attrs['aria-pressed'],'mixed');
  await f.commands.batchSetVisibility();assert.equal(f.state.itemVisibility.labels.a,undefined);assert.equal(f.effects.saved,1);
  await f.commands.batchSetVisibility(true);assert.equal(f.effects.saved,1);f.state.projectReplacing=true;
  await f.commands.batchSetVisibility(false);assert.equal(f.effects.saved,1);
});

test('locked delete action shows a compact, accessible disabled reason', async t => {
  const f=await harness(t,[{ domain: 'territorial',type: 'entity',id: 'a' }]);
  f.commands.syncObjectActionsMenu();
  const button=f.nodes.get('objectDeleteBtn');
  assert.equal(button.disabled,true);
  assert.equal(button.help.textContent,'잠금 해제 후 삭제');
  assert.equal(button.dataset.actionReason,'true');
  assert.equal(button.dataset.tooltip,'잠금 해제 후 삭제');
  assert.equal(button.attrs['aria-label'],'잠금 해제 후 삭제');
  assert.equal(f.commands.objectRefLocked({ domain: 'territorial',type: 'entity',id: 'a' }),true);
});
