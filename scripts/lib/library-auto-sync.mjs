/** Pure reconciliation contract. No network, credentials, paths or executable payloads.
 * IMPORTANT: schema validation is NOT authentication. The owner must refresh both
 * fixed repository heads and verify event ancestry before constructing desired.
 * completed/run are adapter-validated durable receipt / actual live or preview
 * evidence, never event claims. Receipt identity binds current canonical inputs
 * and generator identity, not merely a notification commit (reports may change).
 * All objects have exact required keys; null is explicit for missing evidence.
 * Branches must be paired (main/main or work/gis/work/gis); zero-only SHA
 * and fingerprints are forbidden in every state field.
 * policy: {productionEnabled:boolean}; request: REQUEST_KEYS below.
 * desired: request + {inputFingerprint:hex64,generatorIdentity:hex64,supported:boolean}.
 * completed: null | {inputFingerprint:hex64,generatorIdentity:hex64,dataSha:sha40}.
 * available: {pinnedDataSha:null|sha40,run:null|{dataSha:sha40,appSha:sha40,
 * status:'pending'|'verified'|'failed',target:'production'|'preview'}}.
 * plan returns {action,reason,expected}; expected preserves desired tuple,
 * inputDataSha is canonical source revision; outputDataSha is null until a
 * matching complete receipt exists. dataSha always remains the desired source.
 * 'verify' for preview includes obtaining validated preview evidence, not deploy.
 * Invalid schemas throw TypeError. Valid but disabled/unsupported plans block.
 */
const REQUEST_KEYS=['dataRepository','dataBranch','dataSha','appRepository','appBranch','appSha','production'];
const SHA=/^(?!0{40}$)[a-f0-9]{40}$/; const HASH=/^(?!0{64}$)[a-f0-9]{64}$/;
function exact(value,keys,name){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw new TypeError(`Invalid ${name} keys`);}
function check(ok,name){if(!ok)throw new TypeError(`Invalid ${name}`);}
function validatePolicy(policy){exact(policy,['productionEnabled'],'policy');check(typeof policy.productionEnabled==='boolean','productionEnabled');}
function tuple(request){exact(request,REQUEST_KEYS,'request');check(request.dataRepository==='kimjeon-il/PandoLab-library-data','data repository');check(request.appRepository==='kimjeon-il/Pando','app repository');check(['main','work/gis'].includes(request.dataBranch),'data branch');check(['main','work/gis'].includes(request.appBranch),'app branch');check(request.dataBranch===request.appBranch,'paired branches');check(SHA.test(request.dataSha)&&typeof request.dataSha==='string','data SHA');check(SHA.test(request.appSha)&&typeof request.appSha==='string','app SHA');check(typeof request.production==='boolean','production');return {...request};}
function productionAllowed(r,p){return !r.production||(p.productionEnabled&&r.dataBranch==='main'&&r.appBranch==='main');}
export function validateSyncRequest(request,policy){validatePolicy(policy);const r=tuple(request);check(productionAllowed(r,policy),'production request');return r;}
export function planSync(state){
 exact(state,['desired','completed','available','policy'],'state'); const {desired,completed,available,policy}=state;validatePolicy(policy);
 exact(desired,[...REQUEST_KEYS,'inputFingerprint','generatorIdentity','supported'],'desired');
 const request=tuple(Object.fromEntries(REQUEST_KEYS.map(k=>[k,desired[k]])));
 for(const key of ['inputFingerprint','generatorIdentity'])check(typeof desired[key]==='string'&&HASH.test(desired[key]),key);
 check(typeof desired.supported==='boolean','supported');
 if(completed!==null){exact(completed,['inputFingerprint','generatorIdentity','dataSha'],'completed');for(const k of ['inputFingerprint','generatorIdentity'])check(typeof completed[k]==='string'&&HASH.test(completed[k]),`completed ${k}`);check(typeof completed.dataSha==='string'&&SHA.test(completed.dataSha),'completed data SHA');}
 exact(available,['pinnedDataSha','run'],'available');check(available.pinnedDataSha===null||(typeof available.pinnedDataSha==='string'&&SHA.test(available.pinnedDataSha)),'pin');
 const run=available.run;if(run!==null){exact(run,['dataSha','appSha','status','target'],'run');for(const k of ['dataSha','appSha'])check(typeof run[k]==='string'&&SHA.test(run[k]),`run ${k}`);check(['pending','verified','failed'].includes(run.status),'run status');check(['production','preview'].includes(run.target),'run target');}
 const matches=completed!==null&&completed.inputFingerprint===desired.inputFingerprint&&completed.generatorIdentity===desired.generatorIdentity;
 const expected={...request,inputFingerprint:desired.inputFingerprint,generatorIdentity:desired.generatorIdentity,inputDataSha:desired.dataSha,outputDataSha:matches?completed.dataSha:null};
 const result=(action,reason)=>({action,reason,expected});
 if(!productionAllowed(request,policy))return result('blocked','production-disabled-or-non-main');
 if(!desired.supported)return result('blocked','unsupported-inputs');
 if(!matches)return result('derive','complete-data-missing-or-stale');
 if(available.pinnedDataSha!==completed.dataSha)return result('connect','paired-pin-missing-or-stale');
 const target=request.production?'production':'preview';
 const currentRun=run!==null&&run.dataSha===completed.dataSha&&run.appSha===desired.appSha&&run.target===target;
 if(currentRun&&run.status==='verified')return result('noop','current-version-verified');
 if(currentRun&&run.status==='pending')return result('verify','current-run-pending');
 if(request.production)return result('deploy','current-live-version-unverified');
 return result('verify','preview-evidence-required');
}
