// The two source readers intentionally retain their own decoding and
// admission mechanisms. Their output shares one replacement contract.
const stale = () => Object.assign(new Error('Project reader was superseded'),{
  code:'PL-CORE-STALE',name:'AbortError',cancelled:true,
});
export function createProjectOpenAdapter({source='project',read}={}){
  if(!['project','builtin'].includes(source))throw new TypeError('Unknown project source.');
  if(typeof read!=='function')throw new TypeError('Project opening requires its asynchronous source reader.');
  const builtin=source==='builtin';
  return Object.freeze({
    source,
    // A builtin reader prepares a C++ source/candidate and must wait for
    // earlier rollback. GeoPackage decoding can happen before that queue.
    requiresSettledReplacement:builtin,
    async prepare({isCurrent=()=>true}={}){
      if(!isCurrent())throw stale();
      const value=await read();
      if(!value||typeof value!=='object'||Array.isArray(value))
        throw new TypeError('Project reader must return a project document or accepted source candidate.');
      if(builtin){
        if(value.kind!=='temporal-candidate'&&(!Number.isSafeInteger(value.baselineId)||value.baselineId<=0))
          throw new TypeError('Builtin reader requires an admitted C++ source candidate or baseline.');
        return Object.freeze({source,reason:'builtin',value,releaseCandidate:value.kind==='temporal-candidate'?value:null});
      }
      if(value.kind==='temporal-candidate'||value.baselineId!==undefined)
        throw new TypeError('A file project cannot impersonate an admitted builtin source.');
      return Object.freeze({source,reason:'load',value,releaseCandidate:null});
    },
  });
}
