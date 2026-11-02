// Align complete consecutive Hydro reaches to an existing shared border.
// Partial entry/exit handling is a separate step and is not implied here.
import {acceptHydroBorderGroups,extractHydroBorderSubstrings} from './hydro-connectivity-native.mjs';
import {selectHydroBorderCandidates} from './hydro-point-screen-native.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export async function alignHydroWholeBorderChains({chains,borders}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(chains)||!Array.isArray(borders)||chains.some(chain=>!Array.isArray(chain)))
    throw Error('Explicit Hydro chains and shared borders required');
  const output=structuredClone(chains),pointScreen={...options.pointScreen},connectivity={...options.connectivity};
  if(options.signal){pointScreen.signal=options.signal;connectivity.signal=options.signal;}
  const stats={alignedReaches:0,alignedChains:0,alignedLength:0,changedCoordinates:0,pairLengths:{}};
  const quantize=point=>{let lon=((point[0]+180)%360+360)%360-180;if(lon===-180)lon=180;
    return [pythonRound(lon*1000000,0),pythonRound(Math.max(-90,Math.min(90,point[1]))*1000000,0)];};
  for(let start=0;start<output.length;start+=1000){options.signal?.throwIfAborted();const batch=output.slice(start,start+1000),positions=[],requests=[];
    for(let i=0;i<batch.length;i++)for(let j=0;j<batch[i].length;j++){
      const reach=batch[i][j];if(!Array.isArray(reach?.parts))throw Error('Invalid Hydro border reach');
      positions.push([i,j]);requests.push(reach.parts.length===1?reach.parts[0]:[]);}
    const candidates=batch.map(chain=>chain.map(()=>null));
    for(let at=0;at<requests.length;at+=1000){const rows=await selectHydroBorderCandidates({borders,requests:requests.slice(at,at+1000)},pointScreen);
      for(let i=0;i<rows.length;i++){const [chain,index]=positions[at+i];candidates[chain][index]=rows[i];}}
    const accepted=await acceptHydroBorderGroups(candidates,connectivity),cuts=[],owners=[];
    for(let i=0;i<batch.length;i++)for(let j=0;j<batch[i].length;j++)if(accepted[i][j]){
      const candidate=candidates[i][j],border=borders[candidate.lineIndex];
      cuts.push({source:border.coordinates,metric:candidate.metricBorder,start:candidate.start,end:candidate.end});owners.push([i,j]);}
    const lines=[];for(let at=0;at<cuts.length;at+=10000)lines.push(...await extractHydroBorderSubstrings(cuts.slice(at,at+10000),connectivity));
    const changedChains=new Set();for(let at=0;at<lines.length;at++){const aligned=lines[at];if(aligned.length<2)continue;
      const [i,j]=owners[at],reach=batch[i][j],candidate=candidates[i][j],original=reach.parts[0];let changed=Math.abs(original.length-aligned.length);
      for(let k=0;k<Math.min(original.length,aligned.length);k++){const a=quantize(original[k]),b=quantize(aligned[k]);if(a[0]!==b[0]||a[1]!==b[1])changed++;}
      reach.parts=[aligned];reach.borderPair=candidate.pair;reach.renderSnap=null;changedChains.add(i);stats.alignedReaches++;
      stats.alignedLength+=candidate.length;stats.changedCoordinates+=changed;const key=candidate.pair.join('/');
      stats.pairLengths[key]=(stats.pairLengths[key]||0)+candidate.length;}
    stats.alignedChains+=changedChains.size;
  }
  return {chains:output,stats};
}
