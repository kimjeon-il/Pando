// Only the existing reviewed LSIB exceptions are accepted; inputs stay read-only.
import {createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareLSIBReviewed} from './lsib-screen-native.mjs';

const inScope=(base,path)=>{const value=relative(base,path);return !!value&&value!=='..'&&!value.startsWith('..'+sep)&&!isAbsolute(value);};
async function readSource(root,path){
  const base=resolve(root,'tools/historical-library/sources'),logical=resolve(root,path);
  if(!inScope(base,logical))throw Error('Reviewed LSIB source path escaped library scope');
  const [physicalBase,physical]=await Promise.all([realpath(base),realpath(logical)]);
  if(!inScope(physicalBase,physical))throw Error('Reviewed LSIB source link escaped library scope');
  const info=await stat(physical);if(!info.isFile()||info.size>16*1024*1024)throw Error('Reviewed LSIB source exceeds byte budget');
  const bytes=await readFile(physical);if(bytes.length>16*1024*1024)throw Error('Reviewed LSIB source exceeds byte budget');
  return {bytes,logical};
}
export async function loadLSIBReviewedSource({root,manifestPath,binary},{signal}={}){
  signal?.throwIfAborted();if(typeof root!=='string'||typeof manifestPath!=='string'||!manifestPath)throw Error('Explicit reviewed LSIB source path required');
  root=resolve(root);const manifestFile=await readSource(root,manifestPath),metadata=JSON.parse(manifestFile.bytes.toString('utf8'));
  const referenceManifest=relative(root,manifestFile.logical).split(sep).join('/');
  const kind=metadata.sourceId==='igm-dbsn-2025-06-27'?'igm':metadata.sourceId==='ign-bdtopo-v3-monaco-coast'?'coast':null;
  if(metadata.schemaVersion!==1||!kind||JSON.stringify(metadata.countries)!==JSON.stringify(kind==='igm'?['ITA','SMR']:['FRA','MCO'])||
    metadata.sourceCrs!==(kind==='igm'?'EPSG:4258':'EPSG:4326')||typeof metadata.sourceFile!=='string'||isAbsolute(metadata.sourceFile)||
    !/^[a-f0-9]{64}$/.test(metadata.sourceFileSha256||''))throw Error('Not an explicitly reviewed LSIB source manifest');
  const source=await readSource(root,metadata.sourceFile);
  if(createHash('sha256').update(source.bytes).digest('hex')!==metadata.sourceFileSha256)throw Error('Reviewed LSIB source differs from pinned evidence');
  const data=JSON.parse(source.bytes.toString('utf8'));if(!Array.isArray(data.features))throw Error('Reviewed LSIB source features required');
  const lines={};
  if(kind==='igm'){
    const matches=data.features.filter(feature=>feature?.properties?.globalid===metadata.featureGlobalId);
    if(matches.length!==1||matches[0].properties.comune_ist!=='san_mar_com')throw Error('Reviewed reference must identify the San Marino feature');
    lines.igm=await prepareLSIBReviewed('igm',matches[0].geometry,{binary,signal});
  }else{
    if(!metadata.features||JSON.stringify(Object.keys(metadata.features).sort())!==JSON.stringify(['east','monaco','west']))
      throw Error('Reviewed coast must identify its three roles');
    for(const role of ['monaco','west','east']){
      const matches=data.features.filter(feature=>feature?.properties?.cleabs===metadata.features[role]);
      if(matches.length!==1||matches[0].properties.niveau!=='Plus hautes eaux')throw Error('Reviewed coast must identify one high-water feature per role');
      lines[role]=await prepareLSIBReviewed('coast',matches[0].geometry,{binary,signal});
    }
  }
  return {...metadata,referenceManifest,lines};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw Error('Reviewed LSIB request exceeds byte budget');chunks.push(chunk);}
    process.stdout.write(JSON.stringify(await loadLSIBReviewedSource(JSON.parse(Buffer.concat(chunks,size).toString('utf8'))))+'\n');
  }catch(error){process.stderr.write('lsib-reviewed-source: '+String(error.message)+'\n');process.exitCode=1;}
}
