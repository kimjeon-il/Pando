import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import { createTerritorialApplicationService } from "../../apps/editor/frontend/js/modules/territorial-service.js";

test('territorial service adapts actual C++ metadata, locks and retained parent candidates without Web model/history writes',async () => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed),store=createTerritorialEntityStore({ documentModel: owner.documentModel,commandOwner: owner.client }),
    repository=createTerritorialEntityRepository({ entityStore: store }),copyId='22000000-0000-4000-8000-000000000013';
  const service=createTerritorialApplicationService({ entityRepository: repository,commandOwner: owner.project,createId: () => copyId });
  try {
    const initial=repository.get('A');
    assert.deepEqual(await service.updateMetadata('A','name',initial.properties.name),{ ok: true,changed: false,unit: initial });
    const changed=await service.updateMetadata('A','name','Accepted service name');
    assert.equal(changed.ok,true);assert.equal(changed.changed,true);assert.equal(changed.unit,repository.get('A'));
    assert.equal(changed.unit.geometry,initial.geometry);assert.equal(owner.client.state().stateRevision,1);
    assert.deepEqual(await service.updateMetadata('missing','name','x'),{ ok: false,code: 'not-found' });
    assert.equal((await service.updateMetadata('A','unsupported','x')).code,'unsupported-field');
    assert.equal((await service.setLocked('A',true)).changed,true);
    assert.equal((await service.updateMetadata('A','notes','Rejected')).code,'locked');
    assert.equal((await service.setLocked('A',false)).changed,true);
    const before=owner.documentModel.snapshot(),state=owner.client.state(),current=repository.get('C');
    const rejected=await service.changeAdministrativeParent('C','A',{ validateCandidate: ({ candidateUnits,previousUnits }) => {
      assert.equal(previousUnits.find(row => row.id==='C'),current);
      assert.equal(candidateUnits.find(row => row.id==='C').properties.parentId,'A');
      assert.equal(repository.get('C').properties.parentId,'');
      return { ok: false,issues: ['Independent geometry port rejected the proposed relation.'] };
    } });
    assert.equal(rejected.code,'invalid-parent-geometry');assert.equal(owner.documentModel.snapshot(),before);
    assert.deepEqual(owner.client.state(),state);
    const accepted=await service.changeAdministrativeParent('C','A',{ validateCandidate: () => true });
    assert.equal(accepted.ok,true);assert.equal(accepted.unit.properties.parentId,'A');assert.equal(owner.client.state().stateRevision,state.stateRevision+1);
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
    const copy=await service.copyIndependentRegion('A',{ name: 'Copy',color: '#123456' });
    assert.equal(copy.ok,true);assert.equal(copy.unit.id,copyId);assert.equal(copy.unit.properties.entityKind,'regional');
    assert.deepEqual(copy.unit.geometry,initial.geometry);assert.deepEqual(copy.unit.properties.metadata,{});
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
    assert.equal(await owner.project.undo(),true);assert.equal(await owner.project.undo(),true);assert.equal(await owner.project.undo(),true);
    assert.deepEqual(owner.documentModel.snapshot(),seed);assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),seed);
  } finally { store.dispose();owner.dispose(); }
});
