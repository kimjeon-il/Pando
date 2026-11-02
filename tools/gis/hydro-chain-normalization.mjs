// Resolve exact chain ports, preserving shared-border and triple-point ownership.
import {normalizeHydroChainCoordinates} from './hydro-connectivity-native.mjs';
import {findHydroBorderJunctions} from './hydro-point-screen-native.mjs';

export async function normalizeHydroChains({chains,borders}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||!Array.isArray(borders)||chains.some(chain=>!Array.isArray(chain)))
    throw Error('Explicit Hydro chains and borders required');
  const pointScreen={...options.pointScreen},connectivity={...options.connectivity};
  if(options.signal){pointScreen.signal=options.signal;connectivity.signal=options.signal;}
  const output=[];let changed=0;
  for(let at=0;at<chains.length;at+=1000){const batch=chains.slice(at,at+1000),junctions=[],queries=[],owners=[];
    const input=batch.map(chain=>chain.map(reach=>({...structuredClone(reach),borderPair:reach.borderPair??null})));
    for(let i=0;i<input.length;i++){const parts=[];for(const reach of input[i]){
      if(!Array.isArray(reach.parts))throw Error('Invalid Hydro chain reach');
      for(const points of reach.parts)if(Array.isArray(points)&&points.length>=2)parts.push({points,pair:reach.borderPair});}
      const row=Array(Math.max(0,parts.length-1)).fill(null);junctions.push(row);
      for(let j=0;j+1<parts.length;j++){const left=parts[j],right=parts[j+1];
        if(left.pair&&right.pair&&(left.pair[0]!==right.pair[0]||left.pair[1]!==right.pair[1])){
          queries.push({leftPair:left.pair,rightPair:right.pair,leftPoint:left.points.at(-1),rightPoint:right.points[0]});owners.push([i,j]);}}}
    for(let offset=0;offset<queries.length;offset+=1000){const values=await findHydroBorderJunctions({borders,requests:queries.slice(offset,offset+1000)},pointScreen);
      for(let i=0;i<values.length;i++){const [chain,index]=owners[offset+i];junctions[chain][index]=values[i];}}
    const result=await normalizeHydroChainCoordinates({chains:input,junctions},connectivity);output.push(...result.chains);changed+=result.changed;
  }
  return {chains:output,changed};
}
