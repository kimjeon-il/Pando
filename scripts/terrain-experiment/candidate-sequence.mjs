export function candidateSequence({smoke=false,cog=false,screen=false,batch=false,tilePair=false,only=null}={}){
  if(tilePair&&(!batch||only))throw Error('Tile pair requires batch and no single candidate');
  const candidates=tilePair?['b512','batch']:['a0','a1','b512',...(batch?['batch']:[]),...(cog?['cog']:[]),...(screen?['screen']:[])];
  if(only!==null){
    if(!candidates.includes(only))throw Error('Requested terrain candidate is unavailable');
    return smoke?[only]:[only,only,only];
  }
  if(smoke)return candidates;
  // Alternate ordering and rotate the last pass to reduce systematic drift.
  return [...candidates,...candidates.toReversed(),...candidates.slice(2),...candidates.slice(0,2)];
}
