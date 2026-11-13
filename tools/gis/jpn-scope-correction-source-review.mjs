import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource,encodeTerritorialSource} from '../data/territorial-source-codec.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),base='assets/data/territorial-entities/source/';
export const jpnCorrectionReport='reports/borders/validation/modern-raw-source-20261110/inherited-three-scope-recovery-20261113/';
export const jpnCorrectionHashes={before:'276c23d4ac7c92aba37e3222d72fc4acb0353521721ea72d6066f61c87492741',after:'4c281466af2269ab94646fccefadc1dbfcf6882992430a682e5f238e3c578003',resource:'b3ab41475cb3bdad96a8f8a314477ad544390c1144ce3b88cd830e8ec95865fe'};
const encodedHash=e=>hash(Buffer.from(JSON.stringify(encodeTerritorialSource(e).descriptor,null,2)+'\n'));
export const hasJpnScopeCorrection=(next,previous)=>next?.entityId==='state:JPN'&&previous?.entityId==='state:JPN'&&!eq(next,previous)&&next.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode==='fixed-existing-approved-JPN-scope-restoration');
/** A fixed existing-CAS scope repair only. Current user-approved lifetime and all
 * unrelated metadata remain bound by the exact before/after descriptor hashes. */
export function assertJpnScopeCorrection(next,previous,{prefixes,readEvidence,getSourceSnapshot}={}){
 const fail=m=>{throw Error('JPN scope correction: '+m)},target=base+'countries/state-JPN.json';
 if(!eq(prefixes,[target])||!hasJpnScopeCorrection(next,previous))fail('only fixed JPN descriptor correction allowed');
 if(typeof readEvidence!=='function'||typeof getSourceSnapshot!=='function')fail('archive evidence and authoritative source snapshot required');
 const current=readEvidence(target),restoredBytes=readEvidence(jpnCorrectionReport+'restored-JPN-descriptor.json');
 if(!Buffer.isBuffer(current)||hash(current)!==jpnCorrectionHashes.before||!Buffer.isBuffer(restoredBytes)||hash(restoredBytes)!==jpnCorrectionHashes.after)fail('fixed descriptor preimage/candidate mismatch');
 const descriptor=JSON.parse(restoredBytes),resource=readEvidence(base+'geometries/sha256-'+jpnCorrectionHashes.resource+'.json');if(!Buffer.isBuffer(resource)||hash(resource)!==jpnCorrectionHashes.resource)fail('approved geometry must exist already as exact CAS');
 const actual=decodeTerritorialSource(JSON.parse(current),p=>readEvidence(base+p)),restored=decodeTerritorialSource(descriptor,p=>readEvidence(base+p));
 if(!eq(actual,previous)||!eq(restored,next)||encodedHash(next)!==jpnCorrectionHashes.after)fail('exact current/restored entities required');
 const s=getSourceSnapshot();if(!s?.countryDescriptorPaths?.includes(target)||!/^[a-f0-9]{40}$/.test(s.sourcePin||''))fail('authoritative source snapshot required');
 const receipt=JSON.parse(readEvidence(jpnCorrectionReport+'JPN-correction-binding.json'));
 if(!eq(receipt,{schemaVersion:1,method:'restore-existing-approved-JPN-scope-preserve-current-metadata',previousDescriptorSha256:jpnCorrectionHashes.before,restoredDescriptorSha256:jpnCorrectionHashes.after,restoredGeometrySha256:jpnCorrectionHashes.resource,approvedDonorSha256:'da1fbbf46e7a1e4cf41ec891133cf150f59e8a5f36c0fd990d1ed7c29d51956e',sourceOnly:true,equalsSingleOriginal:false,geometryWrites:0,runtime:false}))fail('fixed corrective source-only receipt required');
 return 1;
}
