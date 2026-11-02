import {alignHydroWholeBorderChains} from './hydro-border-whole.mjs';
import {alignHydroPartialBorderChains} from './hydro-border-partial.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export async function alignHydroBorderChains(input,options={}){
  const whole=await alignHydroWholeBorderChains(input,options),partial=await alignHydroPartialBorderChains({chains:whole.chains,borders:input.borders},options);
  const pairs={};for(const stats of [whole.stats,partial.stats])for(const [key,value] of Object.entries(stats.pairLengths))pairs[key]=(pairs[key]||0)+value;
  const pairLengths=Object.fromEntries(Object.entries(pairs).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>[key,pythonRound(value,1)]));
  return {chains:partial.chains,stats:{borderAlignedReachCount:whole.stats.alignedReaches+partial.stats.alignedReaches,
    borderAlignedRiverCount:new Set([...whole.alignedChainIndexes,...partial.alignedChainIndexes]).size,
    borderAlignedLengthKm:pythonRound(whole.stats.alignedLength+partial.stats.alignedLength,1),
    borderChangedCoordinateCount:whole.stats.changedCoordinates+partial.stats.changedCoordinates,borderPairLengthsKm:pairLengths}};
}
