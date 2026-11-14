import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource,encodeTerritorialSource} from '../data/territorial-source-codec.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),base='assets/data/territorial-entities/source/';
export const finCorrectionReport='reports/borders/validation/modern-raw-source-20261110/fin-ald-scope-correction-20261113/';
export const finCorrectionHashes={before:'dbb5e798ca8fda8444b8a7663e64d73b48de8311a50259bf00a11d44388d80cc',after:'9ac1403929cd1b079597b24da0fea1c80d5660907c3c32863c0ca8101ef401a0',resource:'7245719b9e1fa5c412e624cce32a91a57a89a1567d6ad0dd75b1846cc4e7fba2'};
export const hasFinScopeCorrection=(next,previous)=>next?.entityId==='state:FIN'&&previous?.entityId==='state:FIN'&&previous?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode==='exact-original-current-batch')&&!eq(next,previous)&&hash(Buffer.from(JSON.stringify(encodeTerritorialSource(next).descriptor,null,2)+'\n'))===finCorrectionHashes.after;
/** One byte-exact rollback of an incorrect whole FIN scope. No general repair,
 * new geometry, policy change or runtime approval is authorized here. */
export function assertFinScopeCorrection(next,previous,{prefixes,readEvidence,getSourceSnapshot}={}){
 const fail=m=>{throw Error('FIN scope correction: '+m);},target=base+'countries/state-FIN.json';
 if(!eq(prefixes,[target])||next?.entityId!=='state:FIN'||previous?.entityId!=='state:FIN')fail('only fixed FIN descriptor allowed');
 if(typeof readEvidence!=='function'||typeof getSourceSnapshot!=='function')fail('archive evidence and authoritative snapshot required');
 const current=readEvidence(target),prior=readEvidence(finCorrectionReport+'prior-FIN-descriptor.json');
 if(!Buffer.isBuffer(current)||hash(current)!==finCorrectionHashes.before||!Buffer.isBuffer(prior)||hash(prior)!==finCorrectionHashes.after)fail('fixed current/restore descriptor bytes differ');
 const descriptor=JSON.parse(prior),r=descriptor.geometryVersions?.[0]?.geometryResource;
 if(r?.sha256!==finCorrectionHashes.resource||r.file!=='geometries/sha256-'+finCorrectionHashes.resource+'.json')fail('fixed existing geometry reference required');
 const resource=readEvidence(base+r.file);if(!Buffer.isBuffer(resource)||hash(resource)!==finCorrectionHashes.resource)fail('existing CAS must already contain exact prior geometry');
 const restored=decodeTerritorialSource(descriptor,p=>readEvidence(base+p)),actual=decodeTerritorialSource(JSON.parse(current),p=>readEvidence(base+p));
 if(!eq(restored,next)||!eq(actual,previous)||hash(Buffer.from(JSON.stringify(encodeTerritorialSource(next).descriptor,null,2)+'\n'))!==finCorrectionHashes.after)fail('full exact restored/current entity required');
 const snapshot=getSourceSnapshot(),receipt=JSON.parse(readEvidence(finCorrectionReport+'FIN-correction-review.json'));
 if(!snapshot||!Array.isArray(snapshot.countryDescriptorPaths)||!snapshot.countryDescriptorPaths.includes(target)||!snapshot.countryDescriptorPaths.includes(base+'countries/state-ALD.json')||!/^([a-f0-9]{40})$/.test(snapshot.sourcePin||'')||receipt.sourcePin!==snapshot.sourcePin)fail('authoritative FIN/ALD census and source pin required');
 if(receipt.schemaVersion!==1||receipt.method!=='restore-fixed-prewhole-FIN-excluding-existing-ALD'||receipt.previousDescriptorSha256!==finCorrectionHashes.before||receipt.restoredDescriptorSha256!==finCorrectionHashes.after||receipt.restoredGeometrySha256!==finCorrectionHashes.resource||receipt.priorRevision!=='bedccc6c4d891f1a4c25be06faa402145643ca78'||receipt.sourceOnly!==true||receipt.equalsSingleOriginal!==false||receipt.geometryWrites!==0||receipt.runtime!==false)fail('fixed source-only corrective receipt required');
 const aldBytes=readEvidence(base+'countries/state-ALD.json');if(hash(aldBytes)!=='003e674c1be2a584319bb81cd25bcff00b9fb4d96223d77b191e5e1203862ff1'||receipt.currentALDDescriptorSha256!=='003e674c1be2a584319bb81cd25bcff00b9fb4d96223d77b191e5e1203862ff1'||receipt.currentALDGeometrySha256!=='1dbee074e40b7bd95a7f0ccde0884138ea0eb051498c1cdeb3c2a0a3d63f1394')fail('fixed ALD descriptor and receipt required');
 const ald=JSON.parse(aldBytes),ar=ald.geometryVersions?.[0]?.geometryResource,aldHash='1dbee074e40b7bd95a7f0ccde0884138ea0eb051498c1cdeb3c2a0a3d63f1394';
 if(ar?.sha256!==aldHash||ar.file!=='geometries/sha256-'+aldHash+'.json'||hash(readEvidence(base+ar.file))!==aldHash)fail('existing ALD geometry must remain fixed');
 const separation=JSON.parse(readEvidence(finCorrectionReport+'restoration-separation-check.json'));
 if(separation.method!=='exact-prewhole-restoration-preserves-existing-ALD-separation'||separation.priorFINGeometrySha256!==finCorrectionHashes.resource||separation.currentALDGeometrySha256!==aldHash||separation.intersectionArea!==0||separation.canonicalWrites!==0)fail('hash-bound restored FIN/ALD separation check required');
 return 1;
}
