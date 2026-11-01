import {setTimeout as delay} from 'node:timers/promises';

const busyMessages=new Set([
 'Library preparation is already running; preserve its outputs and retry after it finishes.',
 'Library storage is already running in another worktree; retry after it finishes.',
]);

// A second frontend can start while the first owns library preparation. Wait for
// that owner, then use the same preparation path to validate and reuse its data.
export async function prepareLibraryWhenAvailable(prepare,{timeoutMs=60000,retryMs=100}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(retryMs)||retryMs<=0)throw new RangeError('Invalid library preparation wait');
 const deadline=performance.now()+timeoutMs;
 for(;;){
  try{return await prepare();}
  catch(error){
   if(error?.cause?.code!=='EEXIST'||!busyMessages.has(error.message))throw error;
   const remaining=deadline-performance.now();
   if(remaining<=0)throw Object.assign(new Error('Timed out waiting for the active library preparation owner.',{cause:error}),{code:'PL-LIBRARY-PREPARE-TIMEOUT'});
   await delay(Math.min(retryMs,remaining));
  }
 }
}
