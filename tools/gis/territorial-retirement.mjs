import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
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

/** A narrowly scoped correction, not a dated dissolution or general catalog edit.
 * Recovery receipts bind original bytes to the actual previous index. No source
 * payload other than the explicitly retired identities is read or traversed. */
export function planTerritorialRetirement(manifest,previousIndex,{readRecovery=readFileSync}={}){
 if(manifest?.schemaVersion!==1||manifest.kind!=='invalid-current-identity'||!Array.isArray(manifest.sources)||!manifest.sources.length)fail('explicit invalid-current-identity manifest required');
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
 const sourceIds=new Set(),featureIds=new Set(),lineageIds=new Set(),removePaths=[];
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
  if(display.subunits.filter(s=>s.sourceCountryId===featureId).length!==1)fail('one paired display subunit required');
  sourceIds.add(row.entityId);featureIds.add(featureId);lineageIds.add(lineage.lineageId);
  const paths=[`${base}/source/countries/${row.entityId.replace(':','-')}.json`,`${base}/generated/v2/${entry.file}`,`${base}/source/lineages/${lineage.lineageId}.json`];
  removePaths.push(...paths);[row.source,row.chunk,row.lineage].forEach((receipt,i)=>recoveryReceipts.set(paths[i],receipt));
 }
 const index={...structuredClone(stagedIndex),entities:stagedIndex.entities.filter(row=>!sourceIds.has(row.entityId)),
  lineages:previousIndex.lineages.filter(row=>!lineageIds.has(row.lineageId)),
  views:[{...world,selections:world.selections.filter(row=>!sourceIds.has(row.entityId))}]};
 const displayPolicy={...display,subunits:display.subunits.filter(row=>!featureIds.has(row.sourceCountryId))};
 assertNoRetiredReferences(index,new Set([...sourceIds,...lineageIds]));assertNoRetiredReferences(displayPolicy,featureIds);
 return {index,stagedIndex,displayPolicy,previousDisplayPolicy:display,sourceIds,featureIds,lineageIds,removePaths,recoveryReceipts,
  previousBuiltinIndex:JSON.parse(recover(manifest.previousBuiltinIndex)),previousCoverage:JSON.parse(recover(manifest.previousCoverage))};
}

export function assertTerritorialRetirement({manifest,previousIndex,index,displayPolicy,readRecovery}){
 const plan=planTerritorialRetirement(manifest,previousIndex,{readRecovery});
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

/** Both the metadata producer and archive owner enforce the same paired cleanup.
 * Surviving countries may have separately reviewed updates; no extra identity
 * removal or retirement of uncompiled source changes is admitted here. */
export function assertBuiltinRetirement({plan,previousSourceIndex,sourceIndex,previousIndex,index,previousCoverage,coverage,policy,readDescriptor}){
 equal(previousIndex,plan.previousBuiltinIndex,'stale previous compiled index');
 equal(previousCoverage,plan.previousCoverage,'stale previous coverage');
 if(previousIndex.inputHashes.view!==sha(JSON.stringify(previousSourceIndex.views[0]))
  ||previousIndex.inputHashes.policy!==sha(JSON.stringify(policy)))fail('stale compiled view or policy');
 const retired=new Set();
 for(const id of plan.sourceIds){
  const rows=previousIndex.sourceIdentities.filter(row=>row.sourceEntityIds.includes(id));
  if(rows.length!==1||rows[0].sourceEntityIds.length!==1||rows[0].sourceFeatureIds.length!==1||!plan.featureIds.has(rows[0].sourceFeatureIds[0])
   ||rows[0].projectEntityId!==builtinSubunitId(rows[0].sourceFeatureIds[0])
   ||previousIndex.inputHashes.sourceRevisions[id]!==previousSourceIndex.entities.find(row=>row.entityId===id).sha256)fail('stale or shared compiled source identity');
  retired.add(rows[0].projectEntityId);
 }
 for(const id of retired)if(previousIndex.entities.filter(row=>row.entityId===id).length!==1||previousCoverage.entities.filter(row=>row.entityId===id).length!==1)fail('missing or duplicate compiled identity/coverage');
 const next=unique(index.entities,'entityId');unique(index.sourceIdentities,'projectEntityId');unique(coverage.entities,'entityId');
 equal(new Set(next.keys()),new Set(previousIndex.entities.filter(row=>!retired.has(row.entityId)).map(row=>row.entityId)),'extra or incomplete compiled identity membership');
 equal(index.sourceIdentities,previousIndex.sourceIdentities.filter(row=>!retired.has(row.projectEntityId)),'unrelated compiled source identities changed');
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
  if(hash!==sources.get(id)?.sha256||!index.sourceIdentities.some(row=>row.sourceEntityIds.includes(id)&&next.get(row.projectEntityId)?.sha256!==prior.get(row.projectEntityId)?.sha256))fail('changed source revision lacks its regenerated country: '+id);
 }
 const references=new Set([...plan.sourceIds,...plan.featureIds,...retired]);
 assertNoRetiredReferences(policy,references);assertNoRetiredReferences(previousCoverage.adjustments,references);
 const changed=index.entities.filter(row=>prior.get(row.entityId)?.sha256!==row.sha256);
 if(changed.length&&typeof readDescriptor!=='function')fail('changed country descriptors are required for temporal-index verification');
 equal(index.readIndex,compileBuiltinReadIndex(index,changed.map(row=>readDescriptor(row)),previousIndex),'unpaired compiled temporal read index');
 assertNoRetiredReferences(index,references);assertNoRetiredReferences(coverage,references);
 if(index.inputHashes.view!==sha(JSON.stringify(plan.index.views[0]))||index.inputHashes.policy!==previousIndex.inputHashes.policy
  ||index.inputHashes.entities!==sha(JSON.stringify(index.inputHashes.sourceRevisions)))fail('unpaired compiled input hashes');
}
