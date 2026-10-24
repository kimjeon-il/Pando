import { writeLibraryOutput } from './library-data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectTerritorialChunkBytes} from './territorial-chunk-compression.mjs';
import {readTerritorialSources,readTerritorialLineages,entityFileName,territorialDataRoot,territorialSourceRoot} from './territorial-entity-sources.mjs';
import {parseTemporal} from '../assets/js/modules/temporal.js';
import {territorialIndexEntry} from '../assets/js/modules/territorial-index-entry.js';
const output=path.join(territorialDataRoot,'generated/v2');
const check=process.argv.includes('--check');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const entities=readTerritorialSources();
const expectedFiles=new Set(['index.json']);
fs.mkdirSync(output,{recursive:true});
const index={schemaVersion:2,lineages:readTerritorialLineages(),entities:entities.map(entity=>{
 const bytes=Buffer.from(`${JSON.stringify(entity,null,2)}\n`);
 const file=`${entityFileName(entity.entityId)}.gz`;expectedFiles.add(file);
 const destination=path.join(output,file);
 const previous=fs.existsSync(destination)?fs.readFileSync(destination):null;
 const {stored,changed}=selectTerritorialChunkBytes(bytes,previous);
 if(check&&changed)throw new Error(`Stale territorial chunk: ${file}`);
 if(!check&&changed)writeLibraryOutput(destination,stored);
 return territorialIndexEntry(entity,{sha256:sha(stored),compressedBytes:stored.length,decodedBytes:bytes.length});
 }),snapshots:fs.readdirSync(path.join(territorialSourceRoot,'snapshots')).filter(f=>f.endsWith('.json')).sort().map(file=>{
 const snapshot=JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'snapshots',file),'utf8'));
 parseTemporal(snapshot.referenceDate,{nullable:false});
 if(snapshot.schemaVersion!==1 || new Set(snapshot.entityRefs).size!==snapshot.entityRefs.length || snapshot.entityRefs.some(id=>!entities.some(e=>e.entityId===id)))throw new Error(`Invalid territorial snapshot: ${file}`);
 return snapshot;
 }),views:fs.readdirSync(path.join(territorialSourceRoot,'views')).filter(f=>f.endsWith('.json')).sort()
   .map(file=>JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views',file),'utf8')))};
for(const file of fs.readdirSync(output)) if(!expectedFiles.has(file) && !process.env.PANDOLAB_LIBRARY_SOURCE_ROOT)throw new Error(`Obsolete territorial output must be explicitly removed: ${file}`);
// Regenerate the full index when a source geometry version changes. The index
// contains all entity metadata, including per-chunk hashes, and must be rebuilt
// with the corresponding chunk. Do not publish a source-only change.
const indexBytes=`${JSON.stringify(index,null,2)}\n`;
if(check){if(fs.readFileSync(path.join(output,'index.json'),'utf8').replaceAll('\r\n','\n')!==indexBytes)throw new Error('Stale territorial index');}
else writeLibraryOutput(path.join(output,'index.json'),indexBytes);
console.log(`${check?'Checked':'Built'} ${entities.length} territorial chunks and ${index.snapshots.length} reference snapshots`);
