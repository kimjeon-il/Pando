// Ancestral training and selection exposure is never independent test truth.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const KEYS=Object.freeze(['id','sha256','familyId','editionId','duplicateGroup']);
const SHA=/^[a-f0-9]{64}$/;
export function validateTrainingLineage(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.complete!==true||
    !Array.isArray(value.sheets)||!Array.isArray(value.parents)||value.parents.some(hash=>typeof hash!=='string'||!SHA.test(hash)))
    throw Error('Complete verified ancestral lineage required');
  for(const row of value.sheets){
    if(!row||KEYS.some(key=>typeof row[key]!=='string'||!row[key])||!SHA.test(row.sha256)||!['train','selection'].includes(row.usage))
      throw Error('Complete ancestral source identity required');
  }
  return value;
}
export function buildTrainingLineage(sheets,{parent=null,parentSha256=null}={}){
  const result={schemaVersion:1,complete:true,parents:[],sheets:[]};
  if(parent!==null){validateTrainingLineage(parent);if(typeof parentSha256!=='string'||!SHA.test(parentSha256))throw Error('Complete verified ancestral lineage required');
    result.parents=[...parent.parents,parentSha256];result.sheets=parent.sheets.map(row=>({...row}));}
  for(const sheet of sheets){if(sheet.split==='test')continue;
    const row=Object.fromEntries(KEYS.map(key=>[key,sheet[key]]));row.usage=sheet.split==='validation'?'selection':'train';
    if(KEYS.some(key=>typeof row[key]!=='string'||!row[key])||!SHA.test(row.sha256))throw Error('Complete source/family identity required for lineage');
    if(!result.sheets.some(previous=>Object.keys(previous).length===KEYS.length+1&&KEYS.every(key=>previous[key]===row[key])&&previous.usage===row.usage))result.sheets.push(row);
  }
  return validateTrainingLineage(result);
}
export function assertEvaluationIndependence(lineage,sheets,{split='test'}={}){
  validateTrainingLineage(lineage);
  for(const sheet of sheets){if(!['test','validation'].includes(split)||sheet.split!==split)throw Error('Independent final-test split required');
    for(const key of KEYS)if(typeof sheet[key]!=='string'||!sheet[key]||(key==='sha256'&&!SHA.test(sheet[key])))
      throw Error('Not independent: ancestral '+key+' overlap or missing identity');
    for(const previous of lineage.sheets)for(const key of KEYS)if(!sheet[key]||sheet[key]===previous[key])throw Error('Not independent: ancestral '+key+' overlap or missing identity');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;
      if(length>16*1024*1024)throw Error('Training lineage input exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));let result;
    if(request?.action==='build')result=buildTrainingLineage(request.sheets,{parent:request.parent??null,parentSha256:request.parentSha256??null});
    else if(request?.action==='independent'){assertEvaluationIndependence(request.lineage,request.sheets,{split:request.split??'test'});result=null;}
    else throw Error('Expected a lineage build or independence action');
    process.stdout.write(JSON.stringify({result})+'\n');
  }catch(error){console.error('training-lineage: '+error.message);process.exitCode=1;}
}
