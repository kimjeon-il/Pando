import {createCommandFixture} from './command-history.mjs';
import {createLatestWorkerJobScheduler} from '../../assets/js/modules/worker-job-scheduler.js';
const deferred = () => {
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

export async function asyncTrace(cases) {
  const observations=[];
  for(const row of cases) {
    const fixture=await createCommandFixture(),started=deferred(),gate=deferred(),drained=deferred();
    let outcome='pending';
    const snapshot=()=>({outcome,name:fixture.repository.get('A').properties.name,undo:fixture.domain.canUndo()});
    const scheduler=createLatestWorkerJobScheduler({now:()=>0,
      execute:()=>{started.resolve();return gate.promise;},
      isCurrent:entry=>entry.targetRevision===fixture.state.stateRevision && entry.metadata.generation===fixture.domain.getGeneration(),
      discardResult:()=>drained.resolve()});
    const ticket=scheduler.enqueue({jobKey:'rename',targetRevision:fixture.state.stateRevision,metadata:{generation:fixture.domain.getGeneration()}});
    const completion=ticket.promise.then(async value=>{
      const result=await fixture.service.updateMetadata('A','name',value);
      outcome=result.ok?'accepted':'failed';drained.resolve();
    },error=>{
      outcome=error.cancelled?error.reason:'failed';
      if(!error.cancelled)drained.resolve();
    });
    try {
    await started.promise;
    const steps=[snapshot()];
    if(row.interruption==='cancel')scheduler.cancel(ticket.requestId);
    else if(row.interruption==='revision')await fixture.service.updateMetadata('A','notes','new revision');
    else if(row.interruption==='replace') {
      const replacement=await createCommandFixture({ id: 'A',name: 'Replacement' });
      try { await fixture.domain.load(replacement.snapshot()); } finally { replacement.dispose(); }
    }
    else if(!['none','failure'].includes(row.interruption))throw new Error('Unknown async interruption');
    if(row.interruption==='failure')gate.reject(new Error('fixture worker failure'));
    else gate.resolve('Beta');
    await drained.promise;await completion;
    steps.push(snapshot());observations.push({id:row.id,steps});
    } finally { scheduler.close();fixture.dispose(); }
  }
  return observations;
}
