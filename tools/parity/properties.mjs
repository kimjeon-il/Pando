import { createCommandFixture } from './command-history.mjs';
export async function propertyTrace(corpus) {
  const fixture=await createCommandFixture(corpus.initial),{ repository,service,domain }=fixture;
  try {
    const trace=[];
    for(const op of corpus.operations) {
      let result;
      if(op.op==='field')result=await service.updateMetadata(op.target,op.field,op.value);
      else if(op.op==='lock')result=await service.setLocked(op.target,op.value);
      else if(op.op==='undo'||op.op==='redo') { const changed=await domain[op.op]();result={ ok: changed,changed }; }
      else throw new Error('Unknown property operation: '+op.op);
      const p=repository.get(corpus.initial.id).properties;
      trace.push({ ok: result.ok,changed: result.changed===true,name: p.name,notes: p.notes,locked: p.locked,undo: domain.canUndo(),redo: domain.canRedo() });
    }
    return trace;
  } finally { fixture.dispose(); }
}
