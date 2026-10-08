import {createCommandFixture} from './command-history.mjs';
export function structureTrace(corpus) {
  const {repository,service,domain}=createCommandFixture(corpus.initial);
  return corpus.operations.map(op=>{
    let result;
    if(op.op==='parent')result=service.changeAdministrativeParent(op.target,op.parent);
    else if(op.op==='canDelete')result=service.canDelete(op.target);
    else if(op.op==='lock')result=service.setLocked(op.target,op.value);
    else if(op.op==='lockBatch')result=service.setLockedBatch(op.targets.map(id=>({type:'general',id})),op.value);
    else if(op.op==='undo'||op.op==='redo'){const changed=domain[op.op]();result={ok:changed,changed};}
    else throw new Error('Unknown structural operation');
    return {ok:result.ok,changed:result.changed===true,entities:corpus.initial.entities.map(({id})=>{
      const p=repository.get(id).properties;return {id,parent:p.parentId,locked:p.locked};
    }),undo:domain.canUndo(),redo:domain.canRedo()};
  });
}
