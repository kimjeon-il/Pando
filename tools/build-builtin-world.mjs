import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {withLibraryOutputs} from './library-data.mjs';
import {readTerritorialSources,territorialSourceRoot} from './territorial-entity-sources.mjs';
import {buildCurrentWorld} from './territorial-current-world.mjs';
import {compileBuiltinWorldCatalog} from './builtin-world-compiler.mjs';

const output=fileURLToPath(new URL('../assets/data/builtin-world/generated/v1/',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function packBuiltinWorldFiles(index, files) {
 let offset=0;
 const chunks=index.entities.map(entry=>{
  const bytes=files.get(entry.file);
  if(!bytes||bytes.length!==entry.compressedBytes||sha(bytes)!==entry.sha256)throw new Error(`Missing exact country bytes: ${entry.entityId}`);
  entry.offset=offset;offset+=bytes.length;return bytes;
 });
 const bytes=Buffer.concat(chunks),digest=sha(bytes),url=`transport/countries-sha256-${digest}.bin`;
 files.set(url,bytes);
 index.transport={schemaVersion:1,url,encoding:'identity',sha256:digest,compressedBytes:bytes.length,decodedBytes:bytes.length};
 files.set('index.json',Buffer.from(JSON.stringify(index)+'\n'));
 return files;
}
export function buildBuiltinWorldPublication({input=null,policyFile=new URL('../assets/data/historical-world/policy.json',import.meta.url)}={}){
 const entities=input?.entities||readTerritorialSources(),currentWorld=input?.currentWorld||buildCurrentWorld();
 const view=input?.view||JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json')));
 const policy=input?.policy||JSON.parse(fs.readFileSync(policyFile));
 const {index,countries,coverageReport}=compileBuiltinWorldCatalog({entities,view,currentWorld,policy});
 const files=new Map();
 for(const country of countries){
  const decoded=Buffer.from(JSON.stringify(country)+'\n'),stored=gzipSync(decoded,{level:9,mtime:0});stored[9]=3;
  const digest=sha(stored),file=`countries/${country.entityId.replaceAll(':','-')}-sha256-${digest}.json.gz`;
  files.set(file,stored);
  Object.assign(index.entities.find(row=>row.entityId===country.entityId),{file,encoding:'gzip',sha256:digest,
   compressedBytes:stored.length,decodedBytes:decoded.length});
 }
 index.inputHashes={entities:sha(JSON.stringify(entities)),view:sha(JSON.stringify(view)),policy:sha(JSON.stringify(policy))};
 packBuiltinWorldFiles(index,files);
 files.set('coverage-report.json',Buffer.from(JSON.stringify(coverageReport)+'\n'));
 return files;
}
export function writeBuiltinWorldPublication(files,directory=output,{check=false}={}){
 const publish=()=>{
 for(const [file,bytes] of files){
  const target=path.join(directory,file);
  if(check){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))throw new Error(`Stale builtin world data: ${file}`);}
  else if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes)){
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
 }
 };
 if(check)return publish();
 const paths=[...files].filter(([file,bytes])=>!fs.existsSync(path.join(directory,file))||!fs.readFileSync(path.join(directory,file)).equals(bytes)).map(([file])=>path.join(directory,file));
 return withLibraryOutputs({paths},publish);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const existing=process.argv.includes('--pack-existing');
 const index=existing?JSON.parse(fs.readFileSync(path.join(output,'index.json'))):null;
 const files=existing?packBuiltinWorldFiles(index,new Map(index.entities.map(entry=>[entry.file,fs.readFileSync(path.join(output,entry.file))]))):buildBuiltinWorldPublication();
 writeBuiltinWorldPublication(files,output,{check:process.argv.includes('--check')});
 console.log(`Builtin world: ${existing?index.entities.length:JSON.parse(files.get('index.json')).entities.length} country files retained; packed transport, ${[...files.values()].reduce((n,b)=>n+b.length,0)} bytes`);
}
