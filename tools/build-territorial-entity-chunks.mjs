import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readTerritorialSources,entityFileName,territorialDataRoot} from './territorial-entity-sources.mjs';
import {parseTemporal} from '../assets/js/modules/temporal.js';
const output=path.join(territorialDataRoot,'generated/v1');
const check=process.argv.includes('--check');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function bounds(geometry){
 const bbox=[Infinity,Infinity,-Infinity,-Infinity];
 function visit(value){if(typeof value[0]==='number'){if(!Number.isFinite(value[0])||!Number.isFinite(value[1]))throw new Error('Non-finite coordinate');bbox[0]=Math.min(bbox[0],value[0]);bbox[1]=Math.min(bbox[1],value[1]);bbox[2]=Math.max(bbox[2],value[0]);bbox[3]=Math.max(bbox[3],value[1]);}else for(const child of value)visit(child);}
 visit(geometry.coordinates);return bbox;
}
const entities=readTerritorialSources();
const expectedFiles=new Set(['index.json']);
fs.mkdirSync(output,{recursive:true});
const index={schemaVersion:1,entities:entities.map(entity=>{
 const bytes=Buffer.from(`${JSON.stringify(entity,null,2)}\n`);
 const file=`${entityFileName(entity.entityId)}.gz`;expectedFiles.add(file);
 const destination=path.join(output,file);
 let stored;
 if(check){stored=fs.readFileSync(destination);if(!gunzipSync(stored).equals(bytes))throw new Error(`Stale territorial chunk: ${file}`);}
 else{stored=gzipSync(bytes,{level:9,mtime:0});fs.writeFileSync(destination,stored);}
 const allBounds=entity.geometryVersions.map(v=>bounds(v.geometry));
 return {...entity,geometryVersions:entity.geometryVersions.map(({geometry,...version})=>version),sourceInfo:{title:entity.sourceInfo.title||'',license:entity.sourceInfo.license||'',sourceId:entity.sourceInfo.sourceId||''},
   file,validFrom:entity.lifetime.validFrom,validTo:entity.lifetime.validTo,compressedBytes:stored.length,decodedBytes:bytes.length,sha256:sha(stored),
   bbox:[Math.min(...allBounds.map(b=>b[0])),Math.min(...allBounds.map(b=>b[1])),Math.max(...allBounds.map(b=>b[2])),Math.max(...allBounds.map(b=>b[3]))],geometryVersionCount:entity.geometryVersions.length};
 }),snapshots:fs.readdirSync(path.join(territorialDataRoot,'source/snapshots')).filter(f=>f.endsWith('.json')).sort().map(file=>{
 const snapshot=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots',file),'utf8'));
 parseTemporal(snapshot.referenceDate,{nullable:false});
 if(snapshot.schemaVersion!==1 || new Set(snapshot.entityRefs).size!==snapshot.entityRefs.length || snapshot.entityRefs.some(id=>!entities.some(e=>e.entityId===id)))throw new Error(`Invalid territorial snapshot: ${file}`);
 return snapshot;
 })};
for(const file of fs.readdirSync(output)) if(!expectedFiles.has(file))throw new Error(`Obsolete territorial output must be explicitly removed: ${file}`);
const indexBytes=`${JSON.stringify(index,null,2)}\n`;
if(check){if(fs.readFileSync(path.join(output,'index.json'),'utf8').replaceAll('\r\n','\n')!==indexBytes)throw new Error('Stale territorial index');}
else fs.writeFileSync(path.join(output,'index.json'),indexBytes);
console.log(`${check?'Checked':'Built'} ${entities.length} territorial chunks and ${index.snapshots.length} reference snapshots`);
