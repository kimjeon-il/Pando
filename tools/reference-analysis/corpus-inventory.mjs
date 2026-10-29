// Inventory source materials and report evidence without copying map masters.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link,mkdir,open,readFile,readdir,stat,unlink} from 'node:fs/promises';
import {basename,dirname,extname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';

const extensions=new Set(['.jpg','.jpeg','.png','.tif','.jp2','.pdf','.md']);

function comparePaths(left,right){
  const a=Array.from(process.platform==='win32'?left.toLowerCase():left,character=>character.codePointAt(0));
  const b=Array.from(process.platform==='win32'?right.toLowerCase():right,character=>character.codePointAt(0));
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];
  return a.length-b.length;
}

async function walk(root,signal){
  const files=[];
  async function visit(directory){
    signal?.throwIfAborted();
    let entries;
    try{entries=await readdir(directory,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT'&&directory===root)return;throw error;}
    for(const entry of entries){
      const path=join(directory,entry.name);
      if(entry.isDirectory())await visit(path);
      else if(entry.isFile())files.push(path);
      else if(entry.isSymbolicLink()){
        try{if((await stat(path)).isFile())files.push(path);}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
    }
  }
  await visit(root);
  return files.sort(comparePaths);
}

async function hashFile(path,signal){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path,{signal}))hash.update(chunk);
  return hash.digest('hex');
}

async function optionalJson(path){
  try{
    if(!(await stat(path)).isFile())return null;
    const value=JSON.parse(await readFile(path,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid source metadata: '+path);
    return value;
  }
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export async function inventory(reports,sources,{signal}={}){
  if(typeof reports!=='string'||typeof sources!=='string')throw Error('Report and source directories are required');
  const entries=[];
  for(const [root,isSourceRoot] of [[reports,false],[sources,true]]){
    for(const path of await walk(root,signal)){
      signal?.throwIfAborted();
      const suffix=extname(path).toLowerCase();if(!extensions.has(suffix))continue;
      if(suffix==='.md'){
        const text=await readFile(path,{encoding:'utf8',signal});
        const urls=[...new Set(text.match(/https?:\/\/[^\s<>\])]+/g)||[])].filter(url=>/wms|kartenforum|fotothek|\.pdf|\.jpg|\.tif|iiif|map|atlas/i.test(url)).sort();
        if(urls.length)entries.push({path,kind:'source-references',urls,annotationStatus:'unreviewed'});
        continue;
      }
      const parentParts=relative(root,dirname(path)).split(sep);
      let kind=isSourceRoot||parentParts.includes('sources')?'original-candidate':'report-evidence-candidate';
      const stem=path.slice(0,-extname(path).length);
      if((await optionalJson(stem+'.source.json'))?.materialKind==='official-downsample')kind='source-downsample-candidate';
      if((await optionalJson(stem+'.json'))?.purpose==='app-runtime-input-only')kind='analysis-derivative';
      entries.push({path,kind,sha256:await hashFile(path,signal),annotationStatus:'unlabelled'});
    }
  }
  return {schemaVersion:1,entries,trainingReady:false};
}

async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{reports:{type:'string'},sources:{type:'string'},output:{type:'string'}}});
  if(positionals.length||!values.reports||!values.sources||!values.output)throw Error('Usage: node tools/reference-analysis/corpus-inventory.mjs --reports DIR --sources DIR --output NEW_FILE');
  const reports=reportArgument(values.reports,{access:'read'}),sources=reportArgument(values.sources,{access:'read'});
  const output=reportArgument(values.output,{access:'write'});
  const controller=new globalThis.AbortController(),abort=()=>controller.abort(new Error('Corpus inventory cancelled'));
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const result=await inventory(reports,sources,{signal:controller.signal});
    const target=resolve(output),parent=dirname(target);
    await mkdir(parent,{recursive:true});
    const temporary=join(parent,'.'+basename(target)+'.'+randomUUID()+'.part');
    let handle,created=false;
    try{
      handle=await open(temporary,'wx');created=true;
      await handle.writeFile(JSON.stringify(result,null,2)+'\n',{encoding:'utf8',signal:controller.signal});
      await handle.close();handle=null;controller.signal.throwIfAborted();
      await link(temporary,target);
    }finally{
      if(handle)await handle.close();
      if(created)await unlink(temporary);
    }
  }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error('corpus-inventory: '+error.message);process.exitCode=1;}
}
