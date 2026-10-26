#!/usr/bin/env node
/** Fetch ONLY explicitly scoped originals from a pinned PandoLab-library-data
 * Git commit. Verify archive index SHA and original bytes before using them.
 * Materialize in a fresh private staging root, never in the real library mount.
 */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const digest=b=>createHash('sha256').update(b).digest('hex');
const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
export const USSR_IDS=[
 'state:soviet-union',
 'state:soviet-union-russian-sfsr',
 'state:soviet-union-ukrainian-ssr',
 'state:soviet-union-byelorussian-ssr',
 'state:soviet-union-transcaucasian-sfsr',
];
const source='assets/data/territorial-entities/source';
export const OBJECT_PATHS=Object.freeze([
 ...USSR_IDS.map(id=>source+'/countries/'+id.replace(':','-')+'.json'),
 source+'/snapshots/ussr-1922-12-30.json',
 source+'/lineages/transcaucasian-sfsr.json',
]);
export const PHYSICAL_PATHS=Object.freeze([
 'assets/data/physical-land/v1/geometry.json.gz',
 'assets/data/physical-land/v1/caspian-1922-land.json.gz',
 'assets/data/physical-land/v1/caspian-1922-water.json.gz',
 'assets/data/physical-land/v1/manifest.json',
]);
export const HYDRO_PATHS=Object.freeze([
 'assets/data/hydro/lakes_base.geojson',
 'assets/data/hydro/hydronym-ko-overrides.json',
 'assets/data/hydro/v0.13.2/manifest.json',
 'assets/data/hydro/v0.13.2/hydro.bin',
]);
export const SOURCES=Object.freeze({
 countries:OBJECT_PATHS,physical:PHYSICAL_PATHS,
 hydro:HYDRO_PATHS,
});
export const restrictedOriginal=(path,entry)=>{
 ensure(!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').includes('..'),
   'Unsafe archived original path');
 ensure(entry && /^[a-f0-9]{64}$/.test(entry.sha256)
   &&Number.isSafeInteger(entry.bytes) &&entry.bytes>0
   &&entry.bytes<=128*1024*1024
   &&typeof entry.stored==='string','Invalid source archive receipt: '+path);
 const archived=/^archive\/blobs\/[a-f0-9]{64}\.(?:gz|bin)$/.test(entry.stored);
 const identity=entry.encoding==='identity'&&entry.stored===path;
 ensure(archived||identity,'Unsafe historical source storage mapping: '+path);
 ensure(['gzip','identity','none','raw'].includes(entry.encoding),
   'Unsupported pinned source compression: '+path);
 return entry;
};
export function decodePinnedOriginal(index,path,stored){
 const entry=restrictedOriginal(path,index?.files?.[path]);
 const data=Buffer.from(stored);
 const original=entry.encoding==='gzip'?gunzipSync(data):data;
 ensure(original.length===entry.bytes&&digest(original)===entry.sha256,
   'Historical source SHA-256 or byte count differs: '+path);
 return {original,sha256:entry.sha256,bytes:entry.bytes};
}
async function defaultRead(url){
 const res=await fetch(url,{signal:AbortSignal.timeout(120000)});
 ensure(res.ok,'Pinned archive fetch HTTP '+res.status);
 const length=Number(res.headers.get('content-length')||0);
 ensure(!length||length<=128*1024*1024,
   'Pinned original exceeds response length limit');
 const bytes=Buffer.from(await res.arrayBuffer());
 ensure(bytes.length<=128*1024*1024,'Pinned source download oversized');
 return bytes;
}
export async function fetchPinnedSources({
 pin,paths=OBJECT_PATHS,outputRoot,get=defaultRead,
}){
 ensure(/^[a-f0-9]{40}$/.test(pin||''),'Expected immutable 40-digit archive commit SHA');
 ensure(outputRoot && typeof outputRoot==='string','Explicit output staging root required');
 const destination=resolve(outputRoot);
 ensure(!existsSync(destination),'Staging root must not pre-exist: '+destination);
 const allow=new Set(Object.values(SOURCES).flat());
 ensure(paths.length>=1&&new Set(paths).size===paths.length
   &&paths.every(p=>allow.has(p)),'Unapproved historical archive fetch path');
 const base='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/'+pin+'/';
 const index=JSON.parse((await get(base+'archive/index.json')).toString('utf8'));
 const receipt=[];
 // Validate all receipt fields before fetching or materializing any input.
 for(const name of paths)restrictedOriginal(name,index?.files?.[name]);
 const originals=[];
 for(const name of paths){
   const entry=index.files[name],bytes=await get(base+entry.stored);
   const evidence=decodePinnedOriginal(index,name,bytes);
   originals.push([name,evidence.original]);
   receipt.push({logicalPath:name,sha256:evidence.sha256,bytes:evidence.bytes});
 }
 mkdirSync(destination,{recursive:true});
 for(const [name,bytes] of originals){
   const filename=resolve(destination,name);
   ensure(relative(destination,filename).split('/')[0]!=='..'
     &&filename!==destination,'Source output escapes staging scope');
   mkdirSync(dirname(filename),{recursive:true});
   writeFileSync(filename,bytes,{flag:'wx'});
 }
 writeFileSync(join(destination,'pinned-source-receipt.json'),JSON.stringify({
   schema:'pando-ussr-1922-pinned-source-staging-v1',
   libraryPin:pin,records:receipt,sourceModified:false,
 },null,2)+'\n',{flag:'wx'});
 return {libraryPin:pin,sourceCount:receipt.length,records:receipt,outputRoot:destination};
}
export function parseArguments(argv){
 let scope='countries',outputRoot;
 for(let i=0;i<argv.length;i++){
   if(argv[i]==='--scope'&&argv[i+1]&&!argv[i+1].startsWith('--'))
     scope=argv[++i];
   else if(argv[i]==='--output-root'&&argv[i+1]&&!outputRoot)
     outputRoot=argv[++i];
   else throw Error('Usage: --scope countries|physical|hydro --output-root NEW_DIR');
 }
 ensure(Object.hasOwn(SOURCES,scope),'Unexpected original source scope');
 return {scope,outputRoot};
}
export async function main(argv=process.argv.slice(2)){
 const args=parseArguments(argv);
 const pin=JSON.parse(readFileSync(new URL('../../config/library-data.json',import.meta.url))).revision;
 const report=await fetchPinnedSources({
   pin,paths:SOURCES[args.scope],outputRoot:args.outputRoot,
 });
 console.log('USSR_1922_PINNED_SOURCE_STAGE='+JSON.stringify({
   scope:args.scope,libraryPin:pin,
   files:report.records.map(({logicalPath,sha256})=>({path:logicalPath,sha256})),
   originalLibraryModified:false,
 }));
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{console.error('ussr-originals: '+error.message);process.exitCode=1;});
