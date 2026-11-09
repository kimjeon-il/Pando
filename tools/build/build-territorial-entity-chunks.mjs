import {writeLibraryOutput} from "../data/library-runtime.mjs";
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectTerritorialChunkBytes} from '../data/territorial-chunk-compression.mjs';
import {encodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {territorialSourceLayout} from '../../src/data/territorial-source-format.js';
import {readTerritorialSources,readTerritorialSource,readTerritorialLineages,entityFileName,territorialDataRoot,territorialSourceRoot} from '../data/territorial-entity-sources.mjs';
import {parseTemporal} from "../../src/document/temporal.js";
import {territorialIndexEntry} from "../gis/territorial-index-entry.js";
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {planTerritorialRetirement,readRetirementReceipt} from '../gis/territorial-retirement.mjs';

export function buildTerritorialRetirementIndex({previousIndex,retirement,view,displayPolicy,readRecovery,pathExists}){
 const pinned=JSON.parse(readRetirementReceipt(retirement.previousIndex,readRecovery));
 const plan=planTerritorialRetirement(retirement,pinned,{readRecovery});
 if(!isDeepStrictEqual(previousIndex,plan.stagedIndex))throw Error('Territorial retirement: stale staged source index');
 if(!isDeepStrictEqual(view,plan.index.views[0])||!isDeepStrictEqual(displayPolicy,plan.displayPolicy))throw Error('Territorial retirement: unpaired active view or display policy');
 if(typeof pathExists!=='function'||plan.removePaths.some(path=>pathExists(path)))throw Error('Territorial retirement: remove only the preserved source, lineage and chunk before index publication');
 return plan.index;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const output=path.join(territorialDataRoot,'generated/v2');
const check=process.argv.includes('--check');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const scope=process.argv.find(arg=>arg.startsWith('--entities='));
const retirementFile=process.argv.find(arg=>arg.startsWith('--retirement-manifest='));
if(retirementFile){
 if(scope)throw Error('Publish the explicit retirement baseline before ordinary entity chunk updates');
 const retirement=JSON.parse(fs.readFileSync(retirementFile.slice('--retirement-manifest='.length)));
 const previousIndex=JSON.parse(check?readRetirementReceipt(retirement.stagedIndex):fs.readFileSync(path.join(output,'index.json')));
 const index=buildTerritorialRetirementIndex({previousIndex,retirement,
  view:JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'))),displayPolicy:planTerritorialRetirement(retirement,JSON.parse(readRetirementReceipt(retirement.previousIndex))).displayPolicy,
  pathExists:logical=>fs.existsSync(fileURLToPath(new URL('../'+logical,import.meta.url)))});
 const bytes=`${JSON.stringify(index,null,2)}\n`;
 if(check){if(fs.readFileSync(path.join(output,'index.json'),'utf8')!==bytes)throw Error('Stale territorial retirement index');}
 else writeLibraryOutput(path.join(output,'index.json'),bytes);
 console.log('Published explicit territorial retirement index; surviving chunks reused unchanged');
}else{
const selected=scope?scope.slice('--entities='.length).split(','):null;
if(selected&&(!selected.length||new Set(selected).size!==selected.length))throw new Error('Unique entity IDs required');
const previous=selected?JSON.parse(fs.readFileSync(path.join(output,'index.json'),'utf8')):null;
const entities=selected?selected.map(id=>readTerritorialSource(id)):readTerritorialSources();
if(selected&&selected.some(id=>!previous.entities.some(row=>row.entityId===id)))throw new Error('Scoped publication cannot add catalog identities');
const expectedFiles=new Set(['index.json']);
fs.mkdirSync(output,{recursive:true});
const index={schemaVersion:2,lineages:previous?.lineages||readTerritorialLineages(),entities:entities.map(entity=>{
 // The intermediate catalog stores metadata only. Immutable coordinates are
 // referenced by verified content digest and never repacked for name edits.
 const {descriptor}=encodeTerritorialSource(entity);
 const bytes=Buffer.from(`${JSON.stringify(descriptor,null,2)}\n`);
 const file=`${entityFileName(entity.entityId)}.gz`;expectedFiles.add(file);
 const destination=path.join(output,file);
 const previous=fs.existsSync(destination)?fs.readFileSync(destination):null;
 const {stored,changed}=selectTerritorialChunkBytes(bytes,previous);
 if(check&&changed)throw new Error(`Stale territorial chunk: ${file}`);
 if(!check&&changed)writeLibraryOutput(destination,stored);
 return territorialIndexEntry(entity,{sha256:sha(stored),compressedBytes:stored.length,decodedBytes:bytes.length,storageLayout:territorialSourceLayout});
 }),snapshots:previous?.snapshots||fs.readdirSync(path.join(territorialSourceRoot,'snapshots')).filter(f=>f.endsWith('.json')).sort().map(file=>{
 const snapshot=JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'snapshots',file),'utf8'));
 parseTemporal(snapshot.referenceDate,{nullable:false});
 if(snapshot.schemaVersion!==1 || new Set(snapshot.entityRefs).size!==snapshot.entityRefs.length || snapshot.entityRefs.some(id=>!entities.some(e=>e.entityId===id)))throw new Error(`Invalid territorial snapshot: ${file}`);
 return snapshot;
 }),views:previous?.views||fs.readdirSync(path.join(territorialSourceRoot,'views')).filter(f=>f.endsWith('.json')).sort()
   .map(file=>JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views',file),'utf8')))};
if(previous){const updates=new Map(index.entities.map(row=>[row.entityId,row]));index.entities=previous.entities.map(row=>updates.get(row.entityId)||row);}
if(!selected)for(const file of fs.readdirSync(output)) if(!expectedFiles.has(file) && !process.env.PANDOLAB_LIBRARY_SOURCE_ROOT)throw new Error(`Obsolete territorial output must be explicitly removed: ${file}`);
// Regenerate the full index when a source geometry version changes. The index
// contains all entity metadata, including per-chunk hashes, and must be rebuilt
// with the corresponding chunk. Do not publish a source-only change.
const indexBytes=`${JSON.stringify(index,null,2)}\n`;
if(check){if(fs.readFileSync(path.join(output,'index.json'),'utf8').replaceAll('\r\n','\n')!==indexBytes)throw new Error('Stale territorial index');}
else writeLibraryOutput(path.join(output,'index.json'),indexBytes);
console.log(`${check?'Checked':'Built'} ${entities.length} territorial chunks and ${index.snapshots.length} reference snapshots`);
}
}
