export function candidateSequence({smoke=false,cog=false,screen=false}={}){
  const candidates=['a0','a1','b512',...(cog?['cog']:[]),...(screen?['screen']:[])];
  if(smoke)return candidates;
  // Alternate ordering and rotate the last pass to reduce systematic drift.
  return [...candidates,...candidates.toReversed(),...candidates.slice(2),...candidates.slice(0,2)];
}
