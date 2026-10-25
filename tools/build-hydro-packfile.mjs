/** Deterministically reproduce the pinned Hydro 0.13.1 -> 0.13.2 two-file container. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLibraryOutputs } from './library-data.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ROLES = Object.freeze(['index','metadata-core','metadata-detail','shard-0','shard-1','shard-2']);
const sha = value => createHash('sha256').update(value).digest('hex');
function sourcePath(folder, url) {
  if (typeof url !== 'string' || !url || isAbsolute(url) || url.startsWith('/') ||
    url.includes('://') || url.includes('\\')) throw Error('Untrusted hydro asset URL');
  const resolved = realpathSync(join(folder, url));
  // Historic v0.13.1 legitimately references fragments in sibling v0.13.0.
  const local = relative(dirname(folder), resolved);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local))
    throw Error('Source hydro asset escaped hydro root');
  return resolved;
}
export function buildHydroPackfile({ source, output, check = false }) {
  if (!source) throw Error('--source is required');
  if (!output) throw Error('--output is required; historic reproduction cannot overwrite current published Hydro assets');
  const input = realpathSync(resolve(source)), target = resolve(output);
  if (input === target) throw Error('Destination must differ from source');
  const old = JSON.parse(readFileSync(join(input,'manifest.json'),'utf8'));
  if (old.version !== '0.13.1' || old.schema !== 'pandolab-water-shards-v5')
    throw Error('Source manifest is not the pinned hydro v0.13.1');
  if (!Array.isArray(old.shards) || old.shards.length !== 3 || old.shards.some((v,i)=>v.id!==i))
    throw Error('Expected three stable hydro geometry shards');
  const original = [old.index, old.metadata?.core, old.metadata?.detail, ...old.shards];
  if (original.some(x=>!x || !Number.isSafeInteger(x.bytes) || x.bytes<=0 ||
      typeof x.sha256!=='string' || !/^[a-f0-9]{64}$/.test(x.sha256)))
    throw Error('Invalid hydro fragment descriptor');
  const manifest = structuredClone(old);
  manifest.version = '0.13.2';
  manifest.format.container = 1;
  const targets = [manifest.index, manifest.metadata.core, manifest.metadata.detail,...manifest.shards];
  let offset = 0;
  const fragments = original.map((part,i)=>{
    const data = readFileSync(sourcePath(input,part.url)), digest = sha(data);
    if (part.bytes!==data.length || part.sha256!==digest)
      throw Error('Source byte count/SHA-256 mismatch: '+part.url);
    Object.assign(targets[i],{url:'hydro.bin',offset,bytes:data.length,sha256:digest});
    offset+=data.length;
    return data;
  });
  const bundle = Buffer.concat(fragments), digest = sha(bundle);
  if (bundle.length!==offset) throw Error('Bundle offset arithmetic mismatch');
  manifest.container = {url:'hydro.bin',bytes:bundle.length,sha256:digest,
    format:'byte-concatenated-subresources-v1',roles:[...ROLES]};
  manifest.cache.name='pandolab-water-v0.13.2-'+digest.slice(0,12);
  manifest.stats.compressedBytes=bundle.length;
  const json = Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const binaryPath=join(target,'hydro.bin'), manifestPath=join(target,'manifest.json');
  function publish() {
    if (check) {
      if (!existsSync(binaryPath)||!existsSync(manifestPath)||
        !readFileSync(binaryPath).equals(bundle)||!readFileSync(manifestPath).equals(json))
        throw Error('Generated two-file bundle differs from committed bytes');
    } else {
      mkdirSync(target,{recursive:true});
      writeFileSync(binaryPath,bundle);
      writeFileSync(manifestPath,json);
    }
  }
  if (check) publish();
  else withLibraryOutputs({root:ROOT,paths:[binaryPath,manifestPath]},publish);
  const persisted=readFileSync(binaryPath);
  if (sha(persisted)!==digest)throw Error('Whole-container SHA mismatch');
  for(let i=0;i<original.length;i++){
    const {offset:start,bytes:length}=targets[i];
    if(start<0||start+length>persisted.length||
      sha(persisted.subarray(start,start+length))!==original[i].sha256)
      throw Error('Bundle part differs from original compressed data');
  }
  return {status:check?'checked':'generated',files:2,logicalAssets:ROLES.length,
    containerBytes:bundle.length,containerSha256:digest,manifestBytes:json.length,
    manifestSha256:sha(json),sourceVersion:old.version,targetVersion:manifest.version};
}
function parseArgs(args) {
  const options={};
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(flag==='--check')options.check=true;
    else if(flag==='--source'||flag==='--output'){
      if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+flag);
      options[flag.slice(2)]=args[++i];
    }else throw Error('Unknown argument: '+flag);
  }
  return options;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(buildHydroPackfile(parseArgs(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
