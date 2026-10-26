#!/usr/bin/env node
/**
 * Forensic comparison against the original 2026-10-24 approved publication,
 * the 2026-10-26 pinned sources, and the immutable approved founder ZIP.
 * Read-only. No data promotion or rollback is permitted in this command.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadApprovedUSSR,DISPLAY,FOUNDER_IDS,comparable,
  nativeHistoricalGeometryComparison} from './replay-ussr-1922-countries.mjs';
import {fetchPinnedSources,OBJECT_PATHS} from './stage-ussr-1922-library-originals.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const FIRST_PUBLISHED_REV='d790ac6f0e8fe55e1407cc7a5b29bc696f48384c';
const fail=(condition,message)=>{if(!condition)throw Error(message);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const lookup=(root,id)=>{
  const file=resolve(root, 'assets/data/territorial-entities/source/countries/'+
    id.replace(':','-')+'.json');
  const entity=JSON.parse(readFileSync(file,'utf8'));
  const matches=entity.geometryVersions?.filter(v=>v.versionId===
    id+':1922-12-30-reviewed-v2');
  fail(matches?.length===1,'Exactly one approved snapshot must exist in '+id);
  return {entity,version:matches[0]};
};
const unchangedVersions=e=>e.geometryVersions.filter(v=>
  !v.versionId.endsWith(':1922-12-30-reviewed-v2'));
export function diagnosePair({approved,first,current,compare=nativeHistoricalGeometryComparison}){
 const source=new Map(approved.features.map(f=>[f.id,f]));
 fail(source.size===5 &&FOUNDER_IDS.every(id=>source.has(id)),'ZIP founders changed');
 const items=[];
 for(const id of FOUNDER_IDS){
  const {entity:original,version:old}=first[id];
  const {entity:now,version:present}=current[id];
  fail(original.entityId===id&&now.entityId===id,
    'Historical source identities changed in '+id);
  const canonical=source.get(id);
  const earlier=comparable(canonical.geometry)===comparable(old.geometry)
    ?{passed:true,sameGeometryTopologically:true,
      symmetricDifferenceSquareDegrees:0,boundaryHausdorffDegrees:0}
    :compare(canonical.geometry,old.geometry,id+':first');
  const later=comparable(canonical.geometry)===comparable(present.geometry)
    ?{passed:true,sameGeometryTopologically:true,
      symmetricDifferenceSquareDegrees:0,boundaryHausdorffDegrees:0}
    :compare(canonical.geometry,present.geometry,id+':pinned');
  const fields={
    geometryVersionId:old.versionId===present.versionId,
    validity:old.validFrom===present.validFrom&&old.validTo===present.validTo,
    sourceProperties:comparable(old.sourceProperties)===comparable(present.sourceProperties),
    rights:old.sourceRights===present.sourceRights,
    lineage:old.parentEntityId===present.parentEntityId,
    otherGeometryVersions:hash(unchangedVersions(original))===hash(unchangedVersions(now)),
    lifetime:comparable(original.lifetime)===comparable(now.lifetime),
  };
  items.push({id,
    originalGeometryHash:hash(old.geometry),
    pinnedGeometryHash:hash(present.geometry),
    originalExact:comparable(canonical.geometry)===comparable(old.geometry),
    pinnedExact:comparable(canonical.geometry)===comparable(present.geometry),
    originalVersusZIP:earlier,
    pinnedVersusZIP:later,
    preservedMetadata:fields,
    oldGeometryType:old.geometry.type,newGeometryType:present.geometry.type,
  });
 }
 return {schema:'pando-1922-source-drift-forensic-v1',items,
   approvedOriginalCount:items.filter(x=>x.originalVersusZIP.passed).length,
   approvedPinnedCount:items.filter(x=>x.pinnedVersusZIP.passed).length};
}
export async function main(args=process.argv.slice(2),{
 fetchOriginals=fetchPinnedSources,
}={}){
 const flags=new Map();
 for(let i=0;i<args.length;i+=2){
   fail(args[i]?.startsWith('--')&&args[i+1]&&!flags.has(args[i]),
     'Malformed diagnostic command');flags.set(args[i],args[i+1]);
 }
 for(const f of ['--zip','--current-root','--old-pin','--output'])
   fail(flags.has(f),'Missing diagnostic input '+f);
 fail(flags.size===4,'Unsupported forensic input');
 const oldPin=flags.get('--old-pin');
 fail(oldPin===FIRST_PUBLISHED_REV,'Only the original approved 1922 publication is allowed');
 const root=resolve(flags.get('--output'));
 fail(!existsSync(root),'Forensic staging target already exists');
 mkdirSync(root,{recursive:true});
 const old=await fetchOriginals({
   pin:oldPin,paths:OBJECT_PATHS.slice(0,5),outputRoot:join(root,'first-published'),
 });
 const docs=await loadApprovedUSSR(flags.get('--zip'));
 const first={},current={};
 for(const id of FOUNDER_IDS){
   first[id]=lookup(old.outputRoot,id);
   current[id]=lookup(flags.get('--current-root'),id);
 }
 const comparison=diagnosePair({approved:docs.display,first,current});
 comparison.immutableZipSha256=docs.zipSha256;
 comparison.pins={first:oldPin,current:JSON.parse(
   readFileSync(join(ROOT,'config/library-data.json'),'utf8')).revision};
 comparison.evidenceOnly=true;
 comparison.sourceMutated=false;
 writeFileSync(join(root,'source-drift.json'),
   JSON.stringify(comparison,null,2)+'\n',{flag:'wx'});
 console.log('USSR_1922_SOURCE_DRIFT='+JSON.stringify(comparison));
 return comparison;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{console.error('ussr-drift: '+error.message);process.exitCode=1;});
