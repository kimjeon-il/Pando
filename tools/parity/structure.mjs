import { createCommandFixture } from './command-history.mjs';
export async function structureTrace(corpus) {
  const fixture=await createCommandFixture(corpus.initial),{ repository,service,domain }=fixture;
  try {
    const trace=[];
    for(const op of corpus.operations) {
      let result;
      if(op.op==='parent')result=await service.changeAdministrativeParent(op.target,op.parent);
      else if(op.op==='canDelete')result=service.canDelete(op.target);
      else if(op.op==='lock')result=await service.setLocked(op.target,op.value);
      else if(op.op==='lockBatch')result=await service.setLockedBatch(op.targets.map(id => ({ type: 'general',id })),op.value);
      else if(op.op==='undo'||op.op==='redo') { const changed=await domain[op.op]();result={ ok: changed,changed }; }
      else throw new Error('Unknown structural operation');
      trace.push({ ok: result.ok,changed: result.changed===true,entities: corpus.initial.entities.map(({ id }) => {
        const p=repository.get(id).properties;return { id,parent: p.parentId,locked: p.locked };
      }),undo: domain.canUndo(),redo: domain.canRedo() });
    }
    return trace;
  } finally { fixture.dispose(); }
}
