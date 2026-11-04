/** Metadata inventory across every compiled interval; never validates world coordinates. */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {libraryCheckout} from '../library-data.mjs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {readBuiltinCountryStoredBytes} from '../builtin-country-bytes.mjs';
export function buildHistoricalDetailInventory({sourceEntities,countries,sourceIdentities,currentSelections=[],nativeObjects={}}){
 const current=new Map(currentSelections.map(r=>[r.entityId,r.geometryVersionId])),rows=[];
 for(const entity of sourceEntities)for(const version of entity.geometryVersions){
  const consumers=countries.filter(c=>sourceIdentities.find(s=>s.projectEntityId===c.entityId)?.sourceEntityIds.includes(entity.entityId));
  const bindings=consumers.flatMap(c=>c.sourceBindings.filter(b=>b.sourceVersionId===version.versionId).map(b=>({country:c.entityId,...b})));
  const kind=entity.entityId==='state:MCO'?'excluded-monaco':!bindings.length?(['river','lake'].includes(entity.entityKind)?'hydro-separate-runtime':consumers.length?'merged-contributor':'unapplied-source'):version.sourceId==='korean-38th-parallel'?'straight-partition':/approved-ussr|lki-east|histogis|north-schleswig/.test(version.sourceId)?'historical-linework-review':/successor-union|admin1-papua|late-soviet-adjustment|temporal-proxy|breakaway-disputed/.test(version.sourceId)?'modern-derived-partition-or-union':entity.geometryVersions.length>1||version.historicalProvenance||version.validFrom!=null||version.validTo!=null?'period-or-local-adjustment-review':'modern-baseline';
  rows.push({entityId:entity.entityId,versionId:version.versionId,sourceId:version.sourceId,validFrom:version.validFrom,validTo:version.validTo,lifetime:entity.lifetime,currentView:current.get(entity.entityId)===version.versionId,kind,nativeObject:nativeObjects[entity.entityId]??null,contributorCountries:consumers.map(c=>c.entityId),bindings,provenance:version,sourceInfo:entity.sourceInfo,metadata:Object.fromEntries(Object.entries(entity.metadata||{}).filter(([k])=>!k.toLowerCase().includes('flag')))});
 }
 const unmapped=countries.flatMap(c=>c.sourceBindings.filter(b=>!rows.some(r=>r.versionId===b.sourceVersionId&&r.contributorCountries.includes(c.entityId))).map(b=>({country:c.entityId,...b}))),counts={};for(const row of rows)counts[row.kind]=(counts[row.kind]||0)+1;
 const groups=new Map();for(const country of countries)for(const binding of country.sourceBindings){const key=binding.geometryRef.id+':'+binding.geometryRef.version;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({country:country.entityId,...binding});}
 return {schema:'pando-historical-detail-inventory-v1',sourceEntities:sourceEntities.length,sourceVersions:rows.length,compiledCountries:countries.length,compiledSourceBindings:countries.reduce((n,c)=>n+c.sourceBindings.length,0),uniqueCompiledGeometryRefs:groups.size,nativeOnlyEntities:Object.keys(nativeObjects).filter(id=>!sourceEntities.some(e=>e.entityId===id)),counts,unmapped,rows,geometryGroups:[...groups].map(([geometryRef,coverage])=>({geometryRef,coverage})),countries};
}
export function readInventoryCountries(index,readFile){
 return index.entities.map(entry=>{const country=JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,readFile)));return {entityId:entry.entityId,storedSha256:entry.sha256,sourceBindings:country.sourceBindings,geometryBindings:country.timelineRecords.geometryBindings,lifetimes:country.timelineRecords.lifetimes,sourceVersionMetadata:country.identity.properties.metadata.historicalTimeline.geometryVersions,geometryRefs:country.geometries.map(g=>({id:g.id,version:g.version}))};});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3)throw Error('Usage: node tools/gis/historical-detail-inventory.mjs OUTPUT.json');
 const source=JSON.parse(fs.readFileSync('assets/data/territorial-entities/generated/v2/index.json')),index=JSON.parse(fs.readFileSync('assets/data/builtin-world/generated/v1/index.json')),view=JSON.parse(fs.readFileSync('assets/data/territorial-entities/source/views/world.json'));
 const pin=JSON.parse(fs.readFileSync('config/library-data.json')).revision,native=JSON.parse(execFileSync('git',['show',pin+':library.json'],{cwd:libraryCheckout(),maxBuffer:4*1024*1024}));
 const result=buildHistoricalDetailInventory({nativeObjects:native.entities,sourceEntities:source.entities,countries:readInventoryCountries(index,f=>fs.readFileSync('assets/data/builtin-world/generated/v1/'+f)),sourceIdentities:index.sourceIdentities,currentSelections:view.selections});result.dataRevision=JSON.parse(fs.readFileSync('config/library-data.json')).revision;
 fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...Object.fromEntries(Object.entries(result).filter(([k])=>!['rows','geometryGroups','countries','unmapped'].includes(k))),unmapped:result.unmapped.length}));
}
