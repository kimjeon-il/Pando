import {lstatSync,mkdtempSync,rmdirSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {normalizeFile} from './normalize.mjs';
import {requestNativeQgis} from './native-client.mjs';

function assertNew(path){
  try{lstatSync(path);throw Error('QGIS output already exists; preserve it');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
export async function exportNativeQgis(config,{layerId,output},{signal,timeoutMs}={}){
  signal?.throwIfAborted();
  if(typeof layerId!=='string'||!layerId||typeof output!=='string'||!output)throw Error('A QGIS layer and a new output path are required');
  const target=resolve(output);assertNew(target);
  const directory=mkdtempSync(join(dirname(target),'.pando-qgis-')),temporary=join(directory,'export.geojson');
  let failure,result,cleanupFailure;
  try{
    const receipt=await requestNativeQgis(config,{command:'export',layer:layerId,output:temporary},{signal,timeoutMs});
    if(typeof receipt.output!=='string'||resolve(receipt.output)!==temporary||receipt.crs!=='EPSG:4326'||!Number.isSafeInteger(receipt.features)||receipt.features<0)
      throw Error('Native QGIS returned an invalid export receipt');
    signal?.throwIfAborted();normalizeFile(temporary,target);
    result={output:target,qgis:receipt};
  }catch(error){failure=error;}
  try{
    try{
      const item=lstatSync(temporary);
      if(!item.isFile()||item.isSymbolicLink())throw Error('QGIS scratch output is not a regular file; preserve it');
      unlinkSync(temporary);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    // Nonempty or unexpected scratch contents are preserved, never recursively removed.
    rmdirSync(directory);
  }catch(error){cleanupFailure=error;}
  if(failure&&cleanupFailure)throw new globalThis.AggregateError([failure,cleanupFailure],'QGIS export failed and its scratch could not be removed',{cause:failure});
  if(failure)throw failure;
  if(cleanupFailure)throw cleanupFailure;
  return result;
}
