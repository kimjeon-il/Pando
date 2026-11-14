import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import '../../assets/js-vendor/polygon-clipping.min.js';
import {readBuiltinCountry,encodeBuiltinCountries} from '../data/builtin-country-bytes.mjs';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {territorialIndexEntry} from './territorial-index-entry.js';
import {validateBuiltinDisplayPolicy} from './builtin-display-policy.mjs';
import {builtinSubunitId} from '../../src/document/territorial-display-identity.js';
import {compileBuiltinReadIndex,builtinGeometryAssets} from '../../src/data/builtin-country-files.js';

const base='assets/data/territorial-entities';
export const retirementDisplayPath='assets/data/builtin-world/display-policy-v1.json';
export const retirementWorldPath=base+'/generated/current-world.geojson';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('Territorial retirement: '+message);};
const equal=(a,b,message)=>{if(!isDeepStrictEqual(a,b))fail(message);};
const unique=(rows,key)=>{const map=new Map(rows.map(row=>[row[key],row]));if(map.size!==rows.length)fail('duplicate '+key);return map;};
export function readRetirementReceipt(receipt,readRecovery=readFileSync){
 if(!receipt||typeof receipt.path!=='string'||!receipt.path||!/^[a-f0-9]{64}$/.test(receipt.sha256))fail('exact recovery receipt required');
 const data=readRecovery(receipt.path);
 if(!Buffer.isBuffer(data)||sha(data)!==receipt.sha256)fail('recovery bytes mismatch: '+receipt.path);
 return data;
}
export function assertNoRetiredReferences(value,ids){
 if(typeof value==='string'){if(ids.has(value))fail('dangling reference: '+value);}
 else if(Array.isArray(value)){for(const row of value)assertNoRetiredReferences(row,ids);}
 else if(value&&typeof value==='object')for(const [key,row] of Object.entries(value)){
  if(ids.has(key))fail('dangling reference key: '+key);
  assertNoRetiredReferences(row,ids);
 }
}

const pairingBefore='KAZ is original NE KAZ+KAB union minus remade KAB; therefore also an OSM-derived paired geometry';
const pairingAfter='Kazakhstan display now includes the former separate Baikonur lease subdivision; the previous lease outline was OSM-derived. Kazakhstan sovereignty, lease facts and source attribution are retained.';
const referenceKey=r=>JSON.stringify([r.id,r.version]);
const polygonCoordinates=g=>g?.type==='MultiPolygon'?g.coordinates:g?.type==='Polygon'?[g.coordinates]:fail('polygon geometry required');
function metadataOnlyEdits(before,edits,entityId){
 if(!Array.isArray(edits)||new Set(edits.map(e=>e.pointer)).size!==edits.length)fail('unique exact metadata edits required');const next=structuredClone(before);
 for(const e of edits){if(typeof e.pointer!=='string'||!e.pointer.startsWith('/'))fail('metadata pointer required');const parts=e.pointer.slice(1).split('/');if(parts.some(k=>['__proto__','constructor','prototype'].includes(k)||k.includes('~')))fail('unsafe metadata pointer');let target=next;for(const k of parts.slice(0,-1)){if(!target||!Object.hasOwn(target,k))fail('metadata pointer absent');target=target[k];}const key=parts.at(-1);equal(target?.[key],e.before,'metadata preimage differs');let expected;
  if(entityId==='COL'&&e.pointer==='/identity/properties/metadata/historicalTimeline/sourceEntityIds'){equal(e.before,['state:BJN','state:COL','state:SER'],'COL prior composite identity differs');expected=['state:COL'];}
  else if(['KAZ','state:KAZ'].includes(entityId)&&/^\/(?:identity\/properties\/metadata\/historicalTimeline\/)?geometryVersions\/1\/modernBoundarySupplement\/pairing$/.test(e.pointer)){equal(e.before,pairingBefore,'KAZ pairing preimage differs');expected=pairingAfter;}
  else if(entityId==='state:KAZ'&&e.pointer==='/geometryVersions/1/historicalProvenance/displayDetailReview/counterpartVersions'){if(!Array.isArray(e.before)||e.before.filter(r=>r.entityId==='state:KAB').length!==1)fail('KAZ reviewed counterpart preimage differs');expected=e.before.filter(r=>r.entityId!=='state:KAB');}
  else if(entityId==='state:soviet-union-kazakh-ssr'&&['/sourceInfo/geometryRecipes/0/memberCountryIds','/identity/properties/metadata/historicalTimeline/sourceInfo/geometryRecipes/0/memberCountryIds'].includes(e.pointer)){equal(e.before,['KAZ','KAB'],'SSR recipe preimage differs');expected=['KAZ'];}
  else fail('metadata edit outside registered retirement pointers');equal(e.after,expected,'metadata replacement differs from approved correction');target[key]=structuredClone(expected);
 }return next;
}
/** Returns only candidates independently reconstructed from indexed old runtime
 * bytes. Manifest hashes alone never authorize geometry or metadata changes. */
export function verifiedMixedRuntimeCountries(plan,{readRecovery=readFileSync}={}){
 if(!plan.mixed)fail('mixed runtime contract required');const manifest=plan.manifest,rows=manifest.runtimeUpdates;
 if(!Array.isArray(rows))fail('explicit mixed runtime updates required');equal(rows.map(r=>r.entityId).sort(),['CHN','COL','KAZ','PHL','TWN','VNM','state:soviet-union-kazakh-ssr'],'exact six runtime and one recipe metadata owners required');
 const recover=r=>readRetirementReceipt(r,readRecovery),oldIndex=plan.previousBuiltinIndex,builtin='assets/data/builtin-world/generated/v1/';
 function oldCountry(row){const entry=oldIndex.entities.find(e=>e.entityId===row.entityId);if(!entry||!Array.isArray(row.beforeFiles))fail('indexed runtime preimage required');const receipts=unique(row.beforeFiles,'file'),used=new Set();const c=readBuiltinCountry(entry,oldIndex,file=>{const r=receipts.get(file)?.receipt;if(!r)fail('missing runtime preimage file');used.add(file);plan.recoveryReceipts.set(builtin+file,r);return recover(r);});if(used.size!==receipts.size)fail('unselected runtime preimage file');return c;}
 const kab=manifest.kabAddition;if(kab?.entityId!==builtinSubunitId('KAB'))fail('indexed old KAB addition required');const kabCountry=oldCountry(kab),kabBinding=kabCountry.sourceBindings.filter(b=>b.validTo===null);if(kabBinding.length!==1)fail('ambiguous old KAB current');const kabGeometry=kabCountry.geometries.find(g=>referenceKey(g)===referenceKey(kabBinding[0].geometryRef))?.geojson;
 const fixed={VNM:[624,625,626,630],PHL:[4858,4859,4860,4861],CHN:[854],TWN:[319]},countries=new Map(),previous=new Map();
 for(const row of rows){const before=oldCountry(row),candidate=JSON.parse(recover(row.candidateCountry)),expected=metadataOnlyEdits(before,row.metadataEdits,row.entityId);if(candidate.schemaVersion!==2||candidate.entityId!==row.entityId)fail('runtime candidate identity differs');if(row.entityId==='state:soviet-union-kazakh-ssr'){if(row.mode!=='metadata-only-retired-recipe'||row.currentVersionId!==undefined||row.metadataEdits.length!==1)fail('historical recipe metadata-only row required');equal(candidate,expected,'historical runtime recipe changed geometry/period/other metadata');assertNoRetiredReferences(candidate,new Set([...plan.sourceIds,...plan.featureIds,...plan.lineageIds]));countries.set(row.entityId,candidate);previous.set(row.entityId,before);continue;}const bindings=before.sourceBindings.filter(b=>b.validTo===null);if(bindings.length!==1||bindings[0].sourceVersionId!==row.currentVersionId)fail('one exact selected current runtime version required');const binding=bindings[0],oldRef=binding.geometryRef,oldGeometry=before.geometries.find(g=>referenceKey(g)===referenceKey(oldRef))?.geojson;
  if(row.entityId==='COL'){if(row.mode!=='metadata-only')fail('COL only permits composite metadata cleanup');equal(candidate,expected,'COL geometry or unrelated metadata changed');}
  else {const newBinding=candidate.sourceBindings.find(b=>b.validTo===null),newGeometry=candidate.geometries.find(g=>referenceKey(g)===referenceKey(newBinding?.geometryRef||{}))?.geojson;if(!newGeometry)fail('new current geometry required');
   if(row.entityId==='KAZ'){if(row.mode!=='union-absorbed-source')fail('KAZ requires original indexed union');const oldPolys=polygonCoordinates(oldGeometry);if(oldGeometry.type!=='MultiPolygon'||oldPolys.length!==9||oldPolys[0].length!==2||oldPolys.slice(1).some(p=>p.length!==1))fail('registered KAZ preimage structure differs');equal(newGeometry,{type:'MultiPolygon',coordinates:[[oldPolys[0][0]],...oldPolys.slice(1,6)]},'KAZ nonselected exterior/rings/components must remain exact');const pc=globalThis.polygonClipping,joined=pc.union(polygonCoordinates(oldGeometry),polygonCoordinates(kabGeometry));if(pc.difference(polygonCoordinates(newGeometry),joined).length||pc.difference(joined,polygonCoordinates(newGeometry)).length||pc.difference(polygonCoordinates(oldGeometry),polygonCoordinates(newGeometry)).length)fail('KAZ is not exact old runtime plus KAB union');
    // Components outside the retired subdivision's envelope remain exact arrays.
    const bounds=p=>{const ps=p.flat();return [Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];},box=bounds(polygonCoordinates(kabGeometry).flat()),overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];const untouched=polygonCoordinates(oldGeometry).filter(p=>!overlaps(bounds(p),box));equal(polygonCoordinates(newGeometry).filter(p=>!overlaps(bounds(p),box)),untouched,'KAZ nonselected components changed');
   }else{if(row.mode!=='append-approved-components'||!row.addition)fail('registered source append required');equal(row.addition.componentIndices,fixed[row.entityId],'approved component inventory differs');const d=JSON.parse(recover(row.addition.sourceDescriptor)),path=base+'/source/countries/state-'+row.entityId+'.json';equal(row.addition.sourceDescriptor,plan.sourceCensusReceipts.get(path),'append descriptor is not exact census preimage');if(d.entityId!=='state:'+row.entityId)fail('append source ownership differs');const versions=d.geometryVersions.filter(v=>v.validTo===null);if(versions.length!==1||versions[0].versionId!==row.currentVersionId)fail('append source version differs');const resource=versions[0].geometryResource,raw=recover(row.addition.sourceGeometry);if(sha(raw)!==resource.sha256||raw.length!==resource.bytes)fail('append source actual geometry differs');plan.recoveryReceipts.set(base+'/source/'+resource.file,row.addition.sourceGeometry);const sourcePolys=polygonCoordinates(JSON.parse(raw));if(fixed[row.entityId].some(i=>!sourcePolys[i]))fail('approved source component absent');equal(newGeometry,{type:'MultiPolygon',coordinates:[...polygonCoordinates(oldGeometry),...fixed[row.entityId].map(i=>sourcePolys[i])]},'existing coordinates reordered or wrong approved append');}
   const newRef={id:'historical-world:'+sha(JSON.stringify(newGeometry)),version:1};for(const key of ['sourceBindings'])for(const b of expected[key])if(b.validTo===null&&referenceKey(b.geometryRef)===referenceKey(oldRef))b.geometryRef=structuredClone(newRef);for(const b of expected.timelineRecords.geometryBindings)if(b.validTo===null&&referenceKey(b.geometryRef)===referenceKey(oldRef))b.geometryRef=structuredClone(newRef);
   const used=new Set(expected.timelineRecords.geometryBindings.map(b=>referenceKey(b.geometryRef)));if(!used.has(referenceKey(oldRef)))expected.geometries=expected.geometries.map(g=>referenceKey(g)===referenceKey(oldRef)?{...newRef,geojson:newGeometry}:g);else if(!expected.geometries.some(g=>referenceKey(g)===referenceKey(newRef)))expected.geometries.push({...newRef,geojson:newGeometry});equal(candidate,expected,'runtime past/period/binding/metadata or unselected geometry changed');
  }assertNoRetiredReferences(candidate,new Set([...plan.sourceIds,...plan.featureIds,...plan.lineageIds]));countries.set(row.entityId,candidate);previous.set(row.entityId,before);
 }return {countries,previous};
}

/** A narrowly scoped correction, not a dated dissolution or general catalog edit.
 * Recovery receipts bind original bytes to the actual previous index. No source
 * payload other than the explicitly retired identities is read or traversed. */
export function planTerritorialRetirement(manifest,previousIndex,{readRecovery=readFileSync}={}){
 const mixed=manifest?.kind==='mixed-current-identity-retirement';
 if(manifest?.schemaVersion!==1||!['invalid-current-identity','mixed-current-identity-retirement'].includes(manifest.kind)||!Array.isArray(manifest.sources)||!manifest.sources.length)fail('explicit invalid-current-identity manifest required');
 if(mixed){equal(manifest.sources.map(r=>r.entityId).sort(),['state:BJN','state:KAB','state:PGA','state:SER'],'exact four-object retirement scope required');for(const r of manifest.sources){const recipient=r.entityId==='state:KAB'?'KAZ':'COL';if(r.entityId==='state:PGA'){if(r.mode!=='invalid-current-identity'||r.recipientEntityId!==undefined||r.recipientFeatureId!==undefined)fail('PGA invalid identity cannot transfer ownership');}else if(r.mode!=='absorbed-source'||r.recipientEntityId!=='state:'+recipient||r.recipientFeatureId!==recipient)fail('explicit absorbed-source recipient mismatch');}}

 const recover=receipt=>readRetirementReceipt(receipt,readRecovery);
 equal(JSON.parse(recover(manifest.previousIndex)),previousIndex,'stale previous index');
 const stagedIndex=JSON.parse(recover(manifest.stagedIndex));
 equal({...stagedIndex,entities:[]},{...previousIndex,entities:[]},'staged catalog metadata differs from pinned baseline');
 equal(stagedIndex.entities.map(row=>row.entityId),previousIndex.entities.map(row=>row.entityId),'staged catalog membership differs');
 const entities=unique(previousIndex.entities,'entityId'),lineages=unique(previousIndex.lineages,'lineageId');
 const world=JSON.parse(recover(manifest.worldView));
 if(previousIndex.views.length!==1||world.id!=='world:catalog')fail('one paired world view required');
 equal(previousIndex.views[0],world,'world source/index mismatch');
 const display=validateBuiltinDisplayPolicy(JSON.parse(recover(manifest.displayPolicy)));
 const sourceIds=new Set(),featureIds=new Set(),lineageIds=new Set(),removePaths=[],retiredSources=new Map();
 const recoveryReceipts=new Map([[`${base}/generated/v2/index.json`,manifest.previousIndex],[`${base}/source/views/world.json`,manifest.worldView],[retirementDisplayPath,manifest.displayPolicy],
  ['assets/data/builtin-world/generated/v1/index.json',manifest.previousBuiltinIndex],['assets/data/builtin-world/generated/v1/coverage-report.json',manifest.previousCoverage],
  [retirementWorldPath,manifest.previousCurrentWorld]]);
 recover(manifest.previousCurrentWorld);
 for(const row of manifest.sources){
  if(!/^[a-z]+:[A-Za-z0-9_-]+$/.test(row.entityId)||sourceIds.has(row.entityId))fail('unique explicit source IDs required');
  const entry=entities.get(row.entityId);if(!entry)fail('missing old source: '+row.entityId);
  equal(stagedIndex.entities.find(entry=>entry.entityId===row.entityId),entry,'retired source was modified after the pinned baseline');
  if(!Array.isArray(row.geometryResources)||row.geometryResources.some(resource=>!resource||typeof resource.file!=='string'))fail('explicit geometry recovery receipts required');
  const resources=unique(row.geometryResources,'file'),usedResources=new Set();
  const source=decodeTerritorialSource(JSON.parse(recover(row.source)),(file,resource)=>{
   const receipt=resources.get(file)?.receipt;
   if(!receipt||receipt.sha256!==resource.sha256)fail('missing or mismatched geometry recovery receipt: '+file);
   const data=recover(receipt);
   usedResources.add(file);recoveryReceipts.set(base+'/source/'+file,receipt);
   return data;
  });
  if(usedResources.size!==resources.size)fail('unreferenced geometry recovery receipt');
  retiredSources.set(row.entityId,source);
  const chunk=recover(row.chunk),decoded=gunzipSync(chunk);
  if(source.entityId!==row.entityId||sha(chunk)!==entry.sha256||chunk.length!==entry.compressedBytes||decoded.length!==entry.decodedBytes)fail('old source/chunk identity mismatch: '+row.entityId);
  equal(JSON.parse(decoded),source,'recovery source differs from indexed chunk');
  equal(territorialIndexEntry(source,entry),entry,'old source/index metadata mismatch');
  const selections=world.selections.filter(s=>s.entityId===row.entityId);
  if(source.geometryVersions.length!==1||selections.length!==1||selections[0].geometryVersionId!==source.geometryVersions[0].versionId)fail('retirement is limited to a single current selected version');
  const lineage=JSON.parse(recover(row.lineage));
  equal(lineage,lineages.get(source.lineageId),'old lineage source/index mismatch');
  if(lineageIds.has(lineage.lineageId)||!/^[\w-]+$/.test(lineage.lineageId))fail('unique safe lineage required');
  equal(lineage.entityRefs,[row.entityId],'retirement requires a sole-member lineage');
  equal(lineage.relations,[],'retirement cannot remove lineage relations');
  const featureId=source.sourceInfo?.featureId;
  if(typeof featureId!=='string'||!featureId||featureIds.has(featureId))fail('unique current feature identity required');
  if(mixed&&featureId!==row.entityId.slice(6))fail('registered retired feature identity differs');
  const subunits=display.subunits.filter(s=>s.sourceCountryId===featureId),merges=display.territoryMerges.filter(s=>s.sourceId===featureId);
  if(mixed&&row.mode==='absorbed-source'){if(!entities.has(row.recipientEntityId)||manifest.sources.some(r=>r.entityId===row.recipientEntityId)||subunits.length+merges.length!==1||(subunits[0]?.parentId??merges[0]?.controller)!==row.recipientFeatureId)fail('absorbed recipient must match actual existing display relationship');}else if(subunits.length!==1||merges.length)fail('one paired display subunit required');

  sourceIds.add(row.entityId);featureIds.add(featureId);lineageIds.add(lineage.lineageId);
  const paths=[`${base}/source/countries/${row.entityId.replace(':','-')}.json`,`${base}/generated/v2/${entry.file}`,`${base}/source/lineages/${lineage.lineageId}.json`];
  removePaths.push(...paths);[row.source,row.chunk,row.lineage].forEach((receipt,i)=>recoveryReceipts.set(paths[i],receipt));
 }
 const metadataUpdates=new Map(),sourceCensusReceipts=new Map();
 if(mixed){for(const row of manifest.sourceMetadataUpdates||[]){if(!['state:KAZ','state:soviet-union-kazakh-ssr'].includes(row.entityId)||metadataUpdates.has(row.entityId))fail('unregistered survivor metadata owner');const beforeDescriptor=JSON.parse(recover(row.beforeDescriptor)),afterDescriptor=JSON.parse(recover(row.afterDescriptor)),beforeChunkBytes=recover(row.beforeChunk),afterChunkBytes=recover(row.afterChunk),beforeChunk=JSON.parse(gunzipSync(beforeChunkBytes)),afterChunk=JSON.parse(gunzipSync(afterChunkBytes)),entry=entities.get(row.entityId);if(!entry||entry.sha256!==sha(beforeChunkBytes)||entry.compressedBytes!==beforeChunkBytes.length||beforeChunk.entityId!==row.entityId||beforeDescriptor.entityId!==row.entityId)fail('survivor metadata chunk/index preimage differs');
   if(beforeDescriptor.geometryVersions.some(v=>v.modernBoundarySupplement&&Object.hasOwn(v.modernBoundarySupplement,'wholeFeatureCompletion')))fail('completed source cannot use retirement metadata correction');equal(afterDescriptor,metadataOnlyEdits(beforeDescriptor,row.edits,row.entityId),'canonical survivor changes outside approved metadata');equal(afterChunk,metadataOnlyEdits(beforeChunk,row.chunkEdits,row.entityId),'generated survivor changes outside approved metadata');
   const nextEntry=territorialIndexEntry(afterChunk,{sha256:sha(afterChunkBytes),compressedBytes:afterChunkBytes.length,decodedBytes:gunzipSync(afterChunkBytes).length,...(entry.storageLayout?{storageLayout:entry.storageLayout}:{})});equal(stagedIndex.entities.find(e=>e.entityId===row.entityId),nextEntry,'staged survivor index not paired to metadata-only chunk');metadataUpdates.set(row.entityId,{...row,beforeDescriptorReceipt:row.beforeDescriptor,afterDescriptorReceipt:row.afterDescriptor,beforeChunkReceipt:row.beforeChunk,afterChunkReceipt:row.afterChunk,beforeDescriptor,afterDescriptor,beforeChunk,afterChunk,nextEntry});recoveryReceipts.set(`${base}/source/countries/${row.entityId.replace(':','-')}.json`,row.beforeDescriptor);recoveryReceipts.set(`${base}/generated/v2/${entry.file}`,row.beforeChunk);
  }for(const row of stagedIndex.entities)if(!metadataUpdates.has(row.entityId))equal(row,entities.get(row.entityId),'unselected staged survivor changed');
 }
 const index={...structuredClone(stagedIndex),entities:stagedIndex.entities.filter(row=>!sourceIds.has(row.entityId)),
  lineages:previousIndex.lineages.filter(row=>!lineageIds.has(row.lineageId)),
  views:[{...world,selections:world.selections.filter(row=>!sourceIds.has(row.entityId))}]};
 const displayPolicy={...display,subunits:display.subunits.filter(row=>!featureIds.has(row.sourceCountryId)),...(mixed?{territoryMerges:display.territoryMerges.filter(row=>!featureIds.has(row.sourceId))}:{})};
 let sourceCensusPaths=null;
 if(mixed){const census=JSON.parse(recover(manifest.sourceCensus));if(census.schemaVersion!==1||!Array.isArray(census.countries))fail('full source metadata census required');equal(census.countries.map(r=>r.entityId).sort(),[...entities.keys()].sort(),'source metadata census membership differs');sourceCensusPaths=[];for(const row of census.countries){const expected=`${base}/source/countries/${row.entityId.replace(':','-')}.json`;if(row.path!==expected)fail('source census path mismatch');const d=JSON.parse(recover(row.source));if(d.entityId!==row.entityId)fail('source census descriptor identity differs');recoveryReceipts.set(row.path,row.source);sourceCensusReceipts.set(row.path,row.source);sourceCensusPaths.push(row.path);const update=metadataUpdates.get(row.entityId);if(update)equal(row.source,update.beforeDescriptorReceipt||manifest.sourceMetadataUpdates.find(x=>x.entityId===row.entityId).beforeDescriptor,'metadata source census preimage differs');if(!sourceIds.has(row.entityId))assertNoRetiredReferences(update?update.afterDescriptor:d,new Set([...sourceIds,...featureIds,...lineageIds]));}}

 if(mixed&&metadataUpdates.has('state:soviet-union-kazakh-ssr')){
  const ssr=metadataUpdates.get('state:soviet-union-kazakh-ssr'),kaz=metadataUpdates.get('state:KAZ');if(!kaz||!ssr.recipeCoverage)fail('bound historical recipe coverage required');recover(ssr.recipeCoverage);
  const geometryReceipts=new Map();for(const row of metadataUpdates.values()){if(!Array.isArray(row.geometryResources))fail('metadata source geometry recovery required');for(const r of row.geometryResources){if(geometryReceipts.has(r.file)&&geometryReceipts.get(r.file).sha256!==r.receipt.sha256)fail('conflicting metadata geometry receipt');geometryReceipts.set(r.file,r.receipt);recoveryReceipts.set(base+'/source/'+r.file,r.receipt);}}
  const decode=d=>decodeTerritorialSource(d,(file,resource)=>{const receipt=geometryReceipts.get(file);if(!receipt||receipt.sha256!==resource.sha256)fail('metadata geometry resource binding differs');return recover(receipt);}),rawSSR=decode(ssr.beforeDescriptor),rawKAZ=decode(kaz.beforeDescriptor),current=rawKAZ.geometryVersions.filter(v=>v.validTo===null);if(rawSSR.geometryVersions.length!==1||current.length!==1)fail('historical recipe source version ambiguous');equal(rawSSR.geometryVersions[0].geometry,current[0].geometry,'historical recipe currently materialized source differs from fixed KAZ resource');const generatedSSR=ssr.beforeChunk.geometryVersions;if(generatedSSR.length!==1||!kaz.beforeChunk.geometryVersions.some(v=>isDeepStrictEqual(v.geometry,generatedSSR[0].geometry)))fail('historical generated recipe has no preserved KAZ binding');const kab=retiredSources.get('state:KAB').geometryVersions[0].geometry;for(const g of [rawSSR.geometryVersions[0].geometry,generatedSSR[0].geometry])if(globalThis.polygonClipping.difference(polygonCoordinates(kab),polygonCoordinates(g)).length)fail('historical KAZ does not already cover removed recipe member');
 }
 assertNoRetiredReferences(index,new Set([...sourceIds,...lineageIds]));assertNoRetiredReferences(displayPolicy,featureIds);
 return {index,stagedIndex,displayPolicy,previousDisplayPolicy:display,sourceIds,featureIds,lineageIds,removePaths,recoveryReceipts,mixed,sourceCensusPaths,sourceCensusReceipts,metadataUpdates,manifest,
  previousBuiltinIndex:JSON.parse(recover(manifest.previousBuiltinIndex)),previousCoverage:JSON.parse(recover(manifest.previousCoverage))};
}

export function assertTerritorialRetirement({manifest,previousIndex,index,displayPolicy,readRecovery}){
 const plan=planTerritorialRetirement(manifest,previousIndex,{readRecovery});
 if(plan.mixed)equal(index.entities,plan.index.entities,'mixed source catalog metadata must equal verified plan');
 const before=new Set(previousIndex.entities.map(row=>row.entityId)),next=unique(index.entities,'entityId');
 equal(new Set([...before].filter(id=>!next.has(id))),plan.sourceIds,'extra or incomplete source removal');
 equal(new Set(next.keys()),new Set([...before].filter(id=>!plan.sourceIds.has(id))),'unrelated source membership changed');
 equal({...index,entities:[]},{...plan.index,entities:[]},'unrelated source index metadata changed');
 for(const row of index.entities){const prior=previousIndex.entities.find(old=>old.entityId===row.entityId);if(prior.sha256===row.sha256)equal(row,prior,'unchanged source hash has changed metadata');}
 equal(index.lineages,plan.index.lineages,'extra or incomplete lineage removal');
 equal(index.views,plan.index.views,'extra or incomplete view removal');
 equal(index.snapshots,plan.index.snapshots,'reference snapshots changed');
 equal(displayPolicy,plan.displayPolicy,'extra or incomplete display-policy change');
 assertNoRetiredReferences(index,new Set([...plan.sourceIds,...plan.lineageIds]));
 return plan;
}

export function verifiedMixedCurrentWorld(plan,{readRecovery=readFileSync}={}){
 if(!plan.mixed||!plan.verifiedRuntimeCountries)fail('verified runtime required before current-world correction');const recover=r=>readRetirementReceipt(r,readRecovery),before=JSON.parse(recover(plan.manifest.previousCurrentWorld)),next=JSON.parse(recover(plan.manifest.currentWorld)),features=unique(before.features,'id'),expected={...structuredClone(before),features:before.features.filter(f=>!plan.featureIds.has(f.id)).map(f=>structuredClone(f))},pc=globalThis.polygonClipping;
 for(const row of plan.manifest.runtimeUpdates.filter(r=>r.entityId!=='state:soviet-union-kazakh-ssr')){const feature=expected.features.find(f=>f.id===row.entityId),prior=features.get(row.entityId);if(!feature||!prior)fail('missing current-world recipient');let addition=[];
  if(row.entityId==='KAZ'){const old=polygonCoordinates(prior.geometry),kab=features.get('KAB');if(!kab||prior.geometry.type!=='MultiPolygon'||old.length!==9||old[0].length!==2)fail('current-world KAZ preimage recipe differs');feature.geometry={type:'MultiPolygon',coordinates:[[old[0][0]],...old.slice(1,6)]};const union=pc.union(old,polygonCoordinates(kab.geometry));if(pc.difference(union,feature.geometry.coordinates).length||pc.difference(feature.geometry.coordinates,union).length)fail('current-world KAZ exact recipe not equivalent to own layer union');continue;}
  if(row.entityId==='COL'){const codes=row.entityId==='KAZ'?['KAB']:['BJN','SER'];for(const code of codes){const source=features.get(code);if(!source)fail('missing layer-specific absorbed source');const polys=polygonCoordinates(source.geometry);if(!pc.difference(polys,polygonCoordinates(prior.geometry)).length)continue;if(pc.intersection(polys,polygonCoordinates(prior.geometry)).length)fail('partially overlapping layer union requires an explicit narrower recipe');addition.push(...polys);}}
  else {const n={VNM:4,PHL:4,CHN:1,TWN:1}[row.entityId];addition=polygonCoordinates(plan.verifiedRuntimeCountries.get(row.entityId).geometries.find(g=>referenceKey(g)===referenceKey(plan.verifiedRuntimeCountries.get(row.entityId).sourceBindings.find(b=>b.validTo===null).geometryRef)).geojson).slice(-n);}
  if(addition.length)feature.geometry={type:'MultiPolygon',coordinates:[...polygonCoordinates(prior.geometry),...addition]};
 }
 equal(next,expected,'current-world differs from its own exact baseline and approved scoped additions');assertNoRetiredReferences(next,new Set([...plan.sourceIds,...plan.featureIds,...plan.lineageIds]));return next;
}

export function mixedRetirementIdentityPlan(plan){
 if(!plan.mixed)fail('mixed identity plan required');const identities=[],retired=new Set(),seen=new Set();
 for(const row of plan.previousBuiltinIndex.sourceIdentities){const removed=row.sourceEntityIds.filter(id=>plan.sourceIds.has(id));if(!removed.length){identities.push(row);continue;}
  for(const id of removed){if(seen.has(id))fail('retired source has multiple runtime owners');seen.add(id);if(plan.previousBuiltinIndex.inputHashes.sourceRevisions[id]!==plan.stagedIndex.entities.find(e=>e.entityId===id)?.sha256)fail('retired runtime source revision differs from indexed source preimage');const source=plan.manifest.sources.find(r=>r.entityId===id);if(source.mode==='absorbed-source'&&row.sourceEntityIds.length>1){if(row.projectEntityId!==source.recipientFeatureId||!row.sourceEntityIds.includes(source.recipientEntityId))fail('composite runtime recipient mismatch');}else if(row.sourceEntityIds.length!==1||row.projectEntityId!==builtinSubunitId(id.slice(6)))fail('invalid standalone runtime retirement');}
  const next={...row,sourceEntityIds:row.sourceEntityIds.filter(id=>!plan.sourceIds.has(id)),sourceFeatureIds:row.sourceFeatureIds.filter(id=>!plan.featureIds.has(id))};if(!next.sourceEntityIds.length){if(next.sourceFeatureIds.length)fail('unpaired retired feature identity');retired.add(row.projectEntityId);}else{if(next.sourceEntityIds.length!==1||next.sourceEntityIds[0]!=='state:COL'||next.sourceFeatureIds.length!==1||next.sourceFeatureIds[0]!=='COL')fail('unexpected absorbed composite survivor');identities.push(next);}
 }equal(seen,plan.sourceIds,'retired source runtime coverage differs');return {identities,retired};
}
export function mixedRetirementPublicationPlan(plan,{readRecovery=readFileSync}={}){
 const {identities,retired}=mixedRetirementIdentityPlan(plan),{countries,previous}=verifiedMixedRuntimeCountries(plan,{readRecovery}),index=structuredClone(plan.previousBuiltinIndex),coverage=structuredClone(plan.previousCoverage),files=new Map();index.entities=index.entities.filter(e=>!retired.has(e.entityId));index.sourceIdentities=identities;coverage.entities=coverage.entities.filter(e=>!retired.has(e.entityId));encodeBuiltinCountries(index,[...countries.values()],files);plan.verifiedRuntimeCountries=countries;plan.previousRuntimeCountries=previous;plan.verifiedRuntimeFiles=new Map(files);return {index,coverage,files,retired};
}

/** Both the metadata producer and archive owner enforce the same paired cleanup.
 * Surviving countries may have separately reviewed updates; no extra identity
 * removal or retirement of uncompiled source changes is admitted here. */
export function assertBuiltinRetirement({plan,previousSourceIndex,sourceIndex,previousIndex,index,previousCoverage,coverage,policy,readDescriptor,readRecovery=readFileSync}){
 if(plan.mixed)equal(sourceIndex.entities,plan.index.entities,'mixed builtin input source catalog differs from verified plan');
 equal(previousIndex,plan.previousBuiltinIndex,'stale previous compiled index');
 equal(previousCoverage,plan.previousCoverage,'stale previous coverage');
 if(previousIndex.inputHashes.view!==sha(JSON.stringify(previousSourceIndex.views[0]))
  ||previousIndex.inputHashes.policy!==sha(JSON.stringify(policy)))fail('stale compiled view or policy');
 const mixedPlan=plan.mixed?mixedRetirementPublicationPlan(plan,{readRecovery}):null;
 const retired=mixedPlan?mixedPlan.retired:new Set();
 if(!mixedPlan)for(const id of plan.sourceIds){
  const rows=previousIndex.sourceIdentities.filter(row=>row.sourceEntityIds.includes(id));
  if(rows.length!==1||rows[0].sourceEntityIds.length!==1||rows[0].sourceFeatureIds.length!==1||!plan.featureIds.has(rows[0].sourceFeatureIds[0])
   ||rows[0].projectEntityId!==builtinSubunitId(rows[0].sourceFeatureIds[0])
   ||previousIndex.inputHashes.sourceRevisions[id]!==previousSourceIndex.entities.find(row=>row.entityId===id).sha256)fail('stale or shared compiled source identity');
  retired.add(rows[0].projectEntityId);
 }
 for(const id of retired)if(previousIndex.entities.filter(row=>row.entityId===id).length!==1||previousCoverage.entities.filter(row=>row.entityId===id).length!==1)fail('missing or duplicate compiled identity/coverage');
 const next=unique(index.entities,'entityId');unique(index.sourceIdentities,'projectEntityId');unique(coverage.entities,'entityId');
 equal(new Set(next.keys()),new Set(previousIndex.entities.filter(row=>!retired.has(row.entityId)).map(row=>row.entityId)),'extra or incomplete compiled identity membership');
 equal(index.sourceIdentities,mixedPlan?mixedPlan.index.sourceIdentities:previousIndex.sourceIdentities.filter(row=>!retired.has(row.projectEntityId)),'unrelated compiled source identities changed');
 if(mixedPlan){equal(index.entities,mixedPlan.index.entities,'runtime output differs from verified minimal candidates');equal(index.geometryAssets,mixedPlan.index.geometryAssets,'runtime geometry assets differ from verified candidates');equal(coverage,mixedPlan.coverage,'mixed retirement coverage changed beyond removal');}
 equal(new Set(coverage.entities.map(row=>row.entityId)),new Set(next.keys()),'unpaired coverage membership');
 const prior=new Map(previousIndex.entities.map(row=>[row.entityId,row])),sources=new Map(sourceIndex.entities.map(row=>[row.entityId,row]));
 equal({...index,entities:[],sourceIdentities:[],inputHashes:{},readIndex:null,geometryAssets:null},{...previousIndex,entities:[],sourceIdentities:[],inputHashes:{},readIndex:null,geometryAssets:null},'unrelated compiled index metadata changed');
 const key=ref=>JSON.stringify([ref.id,ref.version]),requiredGeometry=new Set(index.entities.flatMap(row=>row.geometryRefs.map(key)));
 const priorGeometry=new Map(builtinGeometryAssets(previousIndex).map(asset=>[key(asset),asset]));
 const nextGeometry=builtinGeometryAssets(index);
 equal(new Set(nextGeometry.map(key)),requiredGeometry,'unpaired geometry asset membership');
 for(const asset of nextGeometry)if(priorGeometry.has(key(asset)))equal(asset,priorGeometry.get(key(asset)),'immutable geometry asset changed');
 for(const row of index.entities)if(prior.get(row.entityId)?.sha256===row.sha256){
  equal(row,prior.get(row.entityId),'unchanged country hash has changed metadata');
  equal(coverage.entities.find(e=>e.entityId===row.entityId),previousCoverage.entities.find(e=>e.entityId===row.entityId),'unchanged country has changed coverage');
 }
 equal(new Set(Object.keys(index.inputHashes.sourceRevisions)),new Set(Object.keys(previousIndex.inputHashes.sourceRevisions).filter(id=>!plan.sourceIds.has(id))),'extra or missing compiled input revision');
 for(const [id,hash] of Object.entries(index.inputHashes.sourceRevisions))if(hash!==previousIndex.inputHashes.sourceRevisions[id]){
  if(plan.mixed){if(!plan.metadataUpdates.has(id)||hash!==plan.metadataUpdates.get(id).nextEntry.sha256)fail('unreviewed mixed source revision advancement');}
  else if(hash!==sources.get(id)?.sha256||!index.sourceIdentities.some(row=>row.sourceEntityIds.includes(id)&&next.get(row.projectEntityId)?.sha256!==prior.get(row.projectEntityId)?.sha256))fail('changed source revision lacks its regenerated country: '+id);
 }
 if(plan.mixed)for(const [id,row]of plan.metadataUpdates)if(index.inputHashes.sourceRevisions[id]!==row.nextEntry.sha256)fail('metadata-only chunk revision not paired');
 const references=new Set([...plan.sourceIds,...plan.featureIds,...retired]);
 assertNoRetiredReferences(policy,references);assertNoRetiredReferences(previousCoverage.adjustments,references);
 const changed=index.entities.filter(row=>prior.get(row.entityId)?.sha256!==row.sha256);
 if(changed.length&&typeof readDescriptor!=='function')fail('changed country descriptors are required for temporal-index verification');
 equal(index.readIndex,compileBuiltinReadIndex(index,changed.map(row=>readDescriptor(row)),previousIndex),'unpaired compiled temporal read index');
 assertNoRetiredReferences(index,references);assertNoRetiredReferences(coverage,references);
 if(index.inputHashes.view!==sha(JSON.stringify(plan.index.views[0]))||index.inputHashes.policy!==previousIndex.inputHashes.policy
  ||index.inputHashes.entities!==sha(JSON.stringify(index.inputHashes.sourceRevisions)))fail('unpaired compiled input hashes');
}
