import { createCommandFixture } from './command-history.mjs';
export function propertyTrace(corpus) {
  const {repository,service,domain}=createCommandFixture(corpus.initial);
  return corpus.operations.map(op=>{
    let result;
    if(op.op==='field')result=service.updateMetadata(op.target,op.field,op.value);
    else if(op.op==='lock')result=service.setLocked(op.target,op.value);
    else if(op.op==='undo'||op.op==='redo'){const changed=domain[op.op]();result={ok:changed,changed};}
    else throw new Error('Unknown property operation: '+op.op);
    const p=repository.get(corpus.initial.id).properties;
    return {ok:result.ok,changed:result.changed===true,name:p.name,notes:p.notes,locked:p.locked,undo:domain.canUndo(),redo:domain.canRedo()};
  });
}
