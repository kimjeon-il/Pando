import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource,encodeTerritorialSource} from '../data/territorial-source-codec.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),base='assets/data/territorial-entities/source/';
export const scopeCorrectionReport='reports/borders/validation/modern-raw-source-20261110/three-scope-correction-20261113/';
export const scopeCorrectionBindings=Object.freeze({"ESP":{"before":"963c4b8af79b7a11c69a2b43d93326ed10bdbb80e3197c3e937867b8b39fd010","after":"740a65f46ba0cc837b4eda6df933d548a2f525f6130f6e0e3c1bf38b8c61bf88","resource":"ca3c81904cd8615c2ab32a7bb34e19d17717195005e289163d16a9747a588882"},"FRA":{"before":"44652652a16b8ae8cef3b9145c0f88d9bbfa285b0dfefe2109f913a454747643","after":"a8b405ef526af3ad6f03650f1ca13f69dd0bde02c00d87f98916267923b14fa9","resource":"9de6295b1b410891858f04badff2c617d6013b3637956aa8fe0b737369d38cbf"},"NLD":{"before":"cc4f033f2ac75adb9872275c63678192c70b9b9701575d1a96180737e1fd553c","after":"d90e6b8a351fcbd9ceb0b678f25e2c53e7ac7bd51d97b390c8347530cdb5d289","resource":"050d015c488a40f2cc69b7864d71a7c2d8eddb0372609a4c57ab0088da50644c"}});
export const hasFixedScopeCorrection=(next,previous)=>!!scopeCorrectionBindings[next?.entityId?.slice(6)]&&next?.entityId===previous?.entityId&&!eq(next,previous)&&hash(Buffer.from(JSON.stringify(encodeTerritorialSource(next).descriptor,null,2)+'\n'))===scopeCorrectionBindings[next.entityId.slice(6)].after;
/** One byte-exact rollback of an incorrect whole-primary ESP/FRA/NLD scopes. No general repair,
 * new geometry, policy change or runtime approval is authorized here. */
export function assertFixedScopeCorrection(next,previous,{prefixes,readEvidence,getSourceSnapshot}={}){
 const fail=m=>{throw Error('Fixed scope correction: '+m);},code=next?.entityId?.slice(6),scopeCorrectionHashes=scopeCorrectionBindings[code],target=base+'countries/state-'+code+'.json';
 if(!scopeCorrectionHashes||!Array.isArray(prefixes)||!eq([...prefixes].sort(),Object.keys(scopeCorrectionBindings).map(c=>base+'countries/state-'+c+'.json').sort())||next?.entityId!=='state:'+code||previous?.entityId!==next.entityId)fail('only exact ESP/FRA/NLD descriptor batch allowed');
 if(typeof readEvidence!=='function'||typeof getSourceSnapshot!=='function')fail('archive evidence and authoritative snapshot required');
 const current=readEvidence(target),prior=readEvidence(scopeCorrectionReport+'prior-'+code+'-descriptor.json');
 if(!Buffer.isBuffer(current)||hash(current)!==scopeCorrectionHashes.before||!Buffer.isBuffer(prior)||hash(prior)!==scopeCorrectionHashes.after)fail('fixed current/restore descriptor bytes differ');
 const descriptor=JSON.parse(prior),r=descriptor.geometryVersions?.[0]?.geometryResource;
 if(r?.sha256!==scopeCorrectionHashes.resource||r.file!=='geometries/sha256-'+scopeCorrectionHashes.resource+'.json')fail('fixed existing geometry reference required');
 const resource=readEvidence(base+r.file);if(!Buffer.isBuffer(resource)||hash(resource)!==scopeCorrectionHashes.resource)fail('existing CAS must already contain exact prior geometry');
 const restored=decodeTerritorialSource(descriptor,p=>readEvidence(base+p)),actual=decodeTerritorialSource(JSON.parse(current),p=>readEvidence(base+p));
 if(!eq(restored,next)||!eq(actual,previous)||hash(Buffer.from(JSON.stringify(encodeTerritorialSource(next).descriptor,null,2)+'\n'))!==scopeCorrectionHashes.after)fail('full exact restored/current entity required');
 const snapshot=getSourceSnapshot(),receipt=JSON.parse(readEvidence(scopeCorrectionReport+code+'-correction-review.json'));
 if(!snapshot||!Array.isArray(snapshot.countryDescriptorPaths)||!snapshot.countryDescriptorPaths.includes(target)||!/^([a-f0-9]{40})$/.test(snapshot.sourcePin||'')||receipt.sourcePin!==snapshot.sourcePin)fail('authoritative ESP census and source pin required');
 if(receipt.schemaVersion!==1||receipt.method!=='restore-fixed-prewhole-existing-complete-scope'||receipt.entityId!==next.entityId||receipt.previousDescriptorSha256!==scopeCorrectionHashes.before||receipt.restoredDescriptorSha256!==scopeCorrectionHashes.after||receipt.restoredGeometrySha256!==scopeCorrectionHashes.resource||receipt.priorRevision!=='bedccc6c4d891f1a4c25be06faa402145643ca78'||receipt.sourceOnly!==true||receipt.equalsSingleOriginal!==false||receipt.geometryWrites!==0||receipt.runtime!==false)fail('fixed source-only corrective receipt required');
 return 1;
}
