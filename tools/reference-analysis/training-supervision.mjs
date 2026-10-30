// Materialize private source-bound class weights; not evaluation or model approval.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {REFERENCE_BOUNDARY_CHANNELS} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {readTrainingBounded} from './training-evidence.mjs';
import {verifiedMacroTrainingSource,recheckMacroTrainingSource} from './macro-training-source.mjs';
import {macroTrainingSupervision} from './training-tiles.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function encodedWeights(counts){
  if(!Array.isArray(counts)||counts.length!==7||counts.some(pair=>!Array.isArray(pair)||pair.length!==2||
    pair.some(n=>!Number.isSafeInteger(n)||n<0)||pair[1]>pair[0]))throw Error('Invalid training supervision counts');
  const bytes=Buffer.alloc(28);let unobservedMask=0;
  counts.forEach(([known,positive],i)=>{bytes.writeFloatLE(Math.max(1,Math.min(64,(known-positive)/Math.max(positive,1))),i*4);
    if(!positive||positive===known)unobservedMask|=1<<i;});return {bytes,unobservedMask};
}
export async function writeMacroTrainingSupervision({corpus,output,signal}){
  signal?.throwIfAborted();if(!corpus||!output)throw Error('Explicit macro corpus and supervision output required');
  if(existsSync(output))throw Error('Training supervision output exists; preserve it');
  const result=await macroTrainingSupervision(corpus,{signal}),{bytes,unobservedMask}=encodedWeights(result.counts);
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,corpusSha256:result.corpusSha256,
    classes:REFERENCE_BOUNDARY_CHANNELS,counts:result.counts,unobservedMask,weightsSha256:sha(bytes),sources:result.sources};
  signal?.throwIfAborted();mkdirSync(resolve(output));writeFileSync(join(output,'weights.f32'),bytes,{flag:'wx'});
  writeFileSync(join(output,'supervision.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
export async function verifyMacroTrainingSupervision({corpus,directory,signal}){
  signal?.throwIfAborted();if(!corpus||!directory)throw Error('Explicit macro corpus and supervision directory required');
  const corpusPath=resolve(corpus),root=dirname(corpusPath),corpusBytes=readTrainingBounded(corpusPath,32*1024*1024),corpusSha256=sha(corpusBytes);
  const manifest=JSON.parse(corpusBytes),receipt=JSON.parse(readTrainingBounded(join(directory,'supervision.json'),8*1024*1024));
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.corpusSha256!==corpusSha256||
    JSON.stringify(receipt.classes)!==JSON.stringify(REFERENCE_BOUNDARY_CHANNELS)||manifest.schemaVersion!==1||manifest.trainingOnly!==true||
    !Array.isArray(manifest.sheets)||!manifest.sheets.length||!Array.isArray(receipt.sources)||receipt.sources.length!==manifest.sheets.length)
    throw Error('Matching private macro training supervision required');
  const {bytes,unobservedMask}=encodedWeights(receipt.counts),weightsPath=resolve(directory,'weights.f32'),weights=readTrainingBounded(weightsPath,28);
  if(weights.length!==28||!weights.equals(bytes)||receipt.weightsSha256!==sha(weights)||receipt.unobservedMask!==unobservedMask)
    throw Error('Training supervision weights or channel mask changed');
  const seen=new Set();
  for(let i=0;i<manifest.sheets.length;i++){signal?.throwIfAborted();const sheet=manifest.sheets[i],source=receipt.sources[i];
    if(!sheet?.id||seen.has(sheet.id)||sheet.split!=='train'||source?.id!==sheet.id)throw Error('Training supervision source identity differs');seen.add(sheet.id);
    const {checks}=await verifiedMacroTrainingSource(root,manifest,sheet.id);
    if(JSON.stringify(source.hashes)!==JSON.stringify(checks.map(([,expected])=>expected)))throw Error('Training supervision source evidence differs');
    recheckMacroTrainingSource(checks);
  }
  if(sha(readTrainingBounded(corpusPath,32*1024*1024))!==corpusSha256)throw Error('Training corpus changed during supervision verification');
  return {weightsPath,unobservedMask,corpusSha256,weightsSha256:receipt.weightsSha256,sourcesSha256:sha(JSON.stringify(receipt.sources))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'},output:{type:'string'}}});
    if(positionals.length||!values.corpus||!values.output)throw Error('Explicit --corpus and --output required');
    console.log(JSON.stringify(await writeMacroTrainingSupervision(values)));
  }catch(error){console.error('training-supervision: '+error.message);process.exitCode=1;}
}
