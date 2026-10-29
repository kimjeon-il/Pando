/** Read-only, bounded availability probe; never publishes government geometry. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,URLSearchParams} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';

const root='https://avoin-paikkatieto.maanmittauslaitos.fi/inspire-hydrography/features/v1/collections/watercourse/items';
export async function probeFinnishHydro({fetcher=fetch,signal}={}){
  const receipt={provider:'National Land Survey of Finland',url:root,status:'unavailable',downloadedRawLinesIntoRuntime:false};
  const url=new URL(root);url.search=new URLSearchParams({bbox:'24.70,64.75,24.95,64.9',limit:'4',f:'json'}).toString();
  try{
    const value=await fetchBoundedJson(url,{fetcher,signal,timeoutMs:18000,limit:1_000_000,
      headers:{Accept:'application/geo+json, application/json','User-Agent':'PandoLab-GIS-name-audit/1.0'}});
    if(!Array.isArray(value?.features)||(value.type!=null&&value.type!=='FeatureCollection'))throw Error('Unexpected service response');
    receipt.status='sample-retrieved';receipt.featureCount=value.features.length;
    receipt.sampleProperties=value.features.length?Object.keys(value.features[0].properties||{}):[];
  }catch(error){
    if(signal?.aborted)throw error;
    receipt.failureClass=error.name;receipt.note='The endpoint could not be tested in this action. It is not evidence of missing national data.';
  }
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--output')throw Error('Usage: --output NEW_RECEIPT_JSON');
    const receipt=await probeFinnishHydro();writeFileSync(resolve(process.argv[3]),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    console.log('FINNISH_API_PROBE='+JSON.stringify(receipt));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
