export function candidateSequence({smoke=false,cog=false,screen=false,only=null}={}){
  const candidates=['a0','a1','b512',...(cog?['cog']:[]),...(screen?['screen']:[])];
  if(only!==null){
    if(!candidates.includes(only))throw Error('Requested terrain candidate is unavailable');
    return smoke?[only]:[only,only,only];
  }
  if(smoke)return candidates;
  // Alternate ordering and rotate the last pass to reduce systematic drift.
  return [...candidates,...candidates.toReversed(),...candidates.slice(2),...candidates.slice(0,2)];
}
