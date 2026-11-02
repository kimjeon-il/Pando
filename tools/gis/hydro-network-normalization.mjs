// Reuse the native source-proven connector for the producer's split chains.
import {auditHydroParts,repairHydroParts} from './hydro-connectivity-native.mjs';

export async function normalizeHydroNetwork({chains,raw,sourceOrder,region}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||chains.some(chain=>!Array.isArray(chain))||!raw||
    !Array.isArray(sourceOrder)||typeof region!=='string')throw Error('Explicit Hydro network and source order required');
  const output=structuredClone(chains),parts=Object.create(null),owners=Object.create(null);
  for(const chain of output)for(const reach of chain){
    if(!Number.isSafeInteger(reach?.id)||reach.id<=0||!Number.isSafeInteger(reach.mainRiver)||!Array.isArray(reach.parts))
      throw Error('Invalid Hydro network reach');
    for(let index=0;index<reach.parts.length;index++){const key=String(reach.id);
      (parts[key]??=[]).push({fid:reach.id,part:index,points:reach.parts[index],aligned:Boolean(reach.borderPair),system:String(reach.mainRiver)});
      (owners[key]??=[]).push({reach,index});}}
  const repaired=await repairHydroParts({parts,raw,region},options);
  for(const [id,rows] of Object.entries(repaired.parts))for(let index=0;index<rows.length;index++){
    const owner=owners[id][index];owner.reach.parts[owner.index]=rows[index].points;}
  const audit=await auditHydroParts({parts:repaired.parts,raw,sourceOrder},options);
  return {chains:output,changedPorts:repaired.changes.length,changes:repaired.changes,remaining:audit.issues};
}
