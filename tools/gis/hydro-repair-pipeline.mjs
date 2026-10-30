// Produce and verify a private staged repair; callers decide whether to persist it.
import {planHydroSourceRepairs,verifyHydroStaged} from './hydro-connectivity-native.mjs';
import {encodeHydroRepairPlan} from './hydro-encoding-native.mjs';
import {buildHydroPack} from './hydro-pack-layout.mjs';
import {decodeHydroGeneratedPack} from './hydro-pack-decoder.mjs';

export async function buildVerifiedHydroRepair({baseline,archives},{root,connectivityDirectory,encodingDirectory,signal}={}){
  signal?.throwIfAborted();if(!Array.isArray(baseline?.features)||!Array.isArray(baseline.manifest?.stages)||
    baseline.manifest.stages.length!==4||!Array.isArray(archives)||!archives.length)throw Error('Hydro baseline, stages and source archives required');
  const connectivity={...(root?{root}:{}),...(connectivityDirectory?{directory:connectivityDirectory}:{}),signal};
  const encoding={...(root?{root}:{}),...(encodingDirectory?{directory:encodingDirectory}:{}),signal};
  const plan=await planHydroSourceRepairs({features:baseline.features,archives},connectivity);
  const encoded=await encodeHydroRepairPlan(plan,encoding);
  const pack=await buildHydroPack({features:plan.features,encoded,changedFeatureIds:plan.changedFeatureIds},encoding);
  const decoded=decodeHydroGeneratedPack({...pack,stages:baseline.manifest.stages},root?{root}:{});
  const verification=await verifyHydroStaged({baseline,staged:{features:decoded},report:plan,archives},connectivity);
  return {plan,pack,verification};
}
