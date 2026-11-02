// Split unaligned reaches at shared-border entry and exit points.
import {extractHydroBorderSubstrings} from './hydro-connectivity-native.mjs';
import {findHydroNearbyBorders,findHydroPartialBorderRuns,scoreHydroBorderCandidates} from './hydro-point-screen-native.mjs';
import {changedHydroCoordinates} from './hydro-numeric.mjs';

export async function alignHydroPartialBorderChains({chains,borders}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||!Array.isArray(borders)||chains.some(chain=>!Array.isArray(chain)))
    throw Error('Explicit Hydro chains and shared borders required');
  const output=structuredClone(chains),pointScreen={...options.pointScreen},connectivity={...options.connectivity};
  if(options.signal){pointScreen.signal=options.signal;connectivity.signal=options.signal;}
  const stats={alignedReaches:0,alignedChains:0,alignedLength:0,changedCoordinates:0,pairLengths:{}};
  const alignedChainIndexes=new Set();
  const extract=async requests=>{const result=[];for(let at=0;at<requests.length;at+=10000)
    result.push(...await extractHydroBorderSubstrings(requests.slice(at,at+10000),connectivity));return result;};
  for(let start=0;start<output.length;start+=1000){options.signal?.throwIfAborted();const batch=output.slice(start,start+1000),positions=[],queries=[];
    for(let i=0;i<batch.length;i++)for(let j=0;j<batch[i].length;j++){const reach=batch[i][j];
      if(!Array.isArray(reach?.parts))throw Error('Invalid Hydro border reach');
      if(reach.parts.length===1&&reach.parts[0].length>=3&&!reach.borderPair){positions.push([i,j]);queries.push(reach.parts[0]);}}
    const nearby=[];for(let at=0;at<queries.length;at+=1000)nearby.push(...await findHydroNearbyBorders({borders,requests:queries.slice(at,at+1000)},pointScreen));
    const pairs=[],owners=[];for(let i=0;i<queries.length;i++)for(const borderIndex of nearby[i]){
      pairs.push({source:queries[i],border:borders[borderIndex].coordinates});owners.push({query:i,borderIndex});}
    const found=[];for(let at=0;at<pairs.length;at+=1000)found.push(...await findHydroPartialBorderRuns(pairs.slice(at,at+1000),pointScreen));
    const runs=[];for(let i=0;i<found.length;i++)for(const run of found[i])runs.push({...owners[i],...run});
    const sourceSlices=await extract(runs.map(run=>({source:queries[run.query],metric:run.metricSource,start:run.sourceStart,end:run.sourceEnd})));
    const scoreRequests=[],scoreOwners=[];for(let i=0;i<runs.length;i++)if(sourceSlices[i].length>=2){const run=runs[i];
      scoreRequests.push({source:sourceSlices[i],border:borders[run.borderIndex].coordinates,latitude:run.latitude});scoreOwners.push(i);}
    const scores=[];for(let at=0;at<scoreRequests.length;at+=1000)scores.push(...await scoreHydroBorderCandidates(scoreRequests.slice(at,at+1000),pointScreen));
    const perQuery=queries.map(()=>[]);for(let i=0;i<scores.length;i++){const score=scores[i];if(!score)continue;
      if(score.distances.filter(value=>value<=5).length/score.distances.length<.70)continue;
      const index=scoreOwners[i],run=runs[index];perQuery[run.query].push({...run,...score,sourceSlice:sourceSlices[index],pair:borders[run.borderIndex].pair});}
    const cutRequests=[],plans=[];
    for(let i=0;i<perQuery.length;i++){const sorted=perQuery[i].sort((a,b)=>a.score-b.score||b.length-a.length||
        (a.pair.join('/')<b.pair.join('/')?-1:a.pair.join('/')>b.pair.join('/')?1:0)),accepted=[];
      for(const candidate of sorted)if(!accepted.some(row=>Math.min(candidate.sourceEnd,row.sourceEnd)-Math.max(candidate.sourceStart,row.sourceStart)>.5))
        accepted.push(candidate);
      accepted.sort((a,b)=>a.sourceStart-b.sourceStart);if(!accepted.length)continue;
      let cursor=0;const segments=[];for(const candidate of accepted){
        if(candidate.sourceStart>cursor+1e-6){segments.push({kind:'plain',cut:cutRequests.length});cutRequests.push({source:queries[i],
          metric:candidate.metricSource,start:cursor,end:candidate.sourceStart});}
        segments.push({kind:'aligned',cut:cutRequests.length,candidate});cutRequests.push({source:borders[candidate.borderIndex].coordinates,
          metric:candidate.metricBorder,start:candidate.start,end:candidate.end});cursor=candidate.sourceEnd;}
      const last=accepted.at(-1);if(cursor<last.sourceLength-1e-6){segments.push({kind:'plain',cut:cutRequests.length});
        cutRequests.push({source:queries[i],metric:last.metricSource,start:cursor,end:last.sourceLength});}
      plans.push({position:positions[i],segments});}
    const cuts=await extract(cutRequests),replacements=new Map(),changedChains=new Set();
    for(const plan of plans){const [i,j]=plan.position,reach=batch[i][j],pieces=[];
      for(const segment of plan.segments){const coordinates=cuts[segment.cut];if(coordinates.length<2)continue;
        const row={...reach,parts:[coordinates],borderPair:null,renderSnap:null,terminalClass:''};
        if(segment.kind==='aligned'){const candidate=segment.candidate;row.borderPair=candidate.pair;stats.alignedReaches++;
          stats.alignedLength+=candidate.length;stats.changedCoordinates+=changedHydroCoordinates(candidate.sourceSlice,coordinates);
          const key=candidate.pair.join('/');stats.pairLengths[key]=(stats.pairLengths[key]||0)+candidate.length;changedChains.add(i);}
        pieces.push(row);}
      if(pieces.length){pieces.at(-1).renderSnap=reach.renderSnap;pieces.at(-1).terminalClass=reach.terminalClass;
        pieces.at(-1).originalEndpoint=reach.originalEndpoint;replacements.set(i+':'+j,pieces);}}
    for(let i=0;i<batch.length;i++)output[start+i]=batch[i].flatMap((row,j)=>replacements.get(i+':'+j)??[row]);
    for(const index of changedChains)alignedChainIndexes.add(start+index);
  }
  stats.alignedChains=alignedChainIndexes.size;return {chains:output,stats,alignedChainIndexes:[...alignedChainIndexes]};
}
