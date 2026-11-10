import {createHash} from 'node:crypto';
import {planSync} from './library-auto-sync.mjs';
const FAMILIES=['territorial','current-world','world-mesh','world-country-packet','world-bundle','shared-boundaries','builtin-world','prepared-mesh'];
const KEYS=['schema','schemaVersion','inputDataSha','inputFingerprint','generatingAppSha','generatorIdentity','families','outputs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(code){throw Object.assign(new TypeError(code),{code});}
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
function exact(v,keys){if(!plain(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('INVALID_RECEIPT_SCHEMA');}
function hash(v,n=64){if(typeof v!=='string'||!new RegExp(`^(?!0{${n}}$)[a-f0-9]{${n}}$`).test(v))fail('INVALID_HASH');}
// Fixed generated output roles from config/generated-artifacts.json and its P2
// world resolvers. Do not accept caller-controlled paths from a manifest here.
function outputFamily(p){
 if(typeof p!=='string'||!p||p.split('/').some(s=>!s||s==='.'||s==='..'||['source','private','reports'].includes(s))||!/^[a-zA-Z0-9_./-]+$/.test(p))fail('INVALID_OUTPUT_PATH');
 for(const [prefix,family] of [['territorial-entities/generated/v2/','territorial'],['builtin-world/generated/v1/','builtin-world'],['prepared-polygons/generated/v2/','prepared-mesh']])if(p.startsWith('assets/data/'+prefix)&&/\.(?:json|geojson|bin)(?:\.gz)?$/.test(p))return family;
 const fixed={
 'territorial-entities/generated/current-world.geojson':'current-world','world/current.json':'world-bundle',
 'world-mesh-v0.36.1.bin.gz':'world-mesh','world-preview-v0.36.1.json':'world-country-packet',
 'countries-canonical-v0.36.1.pcg.gz':'world-country-packet',
 'countries-canonical-shared-v0.36.1.json.gz':'shared-boundaries'};
 if(p.startsWith('assets/data/')&&Object.hasOwn(fixed,p.slice(12)))return fixed[p.slice(12)];
 if(/^assets\/data\/world\/objects\/(?:countries-canonical-sha256-[a-f0-9]{64}\.pcg\.gz|world-mesh-sha256-[a-f0-9]{64}\.bin\.gz|country-label-anchors-sha256-[a-f0-9]{64}\.json)$/.test(p))return 'world-bundle';
 fail('INVALID_OUTPUT_PATH');
}
function checkedReceipt(receipt){
 exact(receipt,KEYS);if(receipt.schema!=='pandolab-auto-data-publication'||receipt.schemaVersion!==1)fail('INVALID_RECEIPT_SCHEMA');
 hash(receipt.inputDataSha,40);hash(receipt.generatingAppSha,40);hash(receipt.inputFingerprint);hash(receipt.generatorIdentity);
 if(!Array.isArray(receipt.families)||!receipt.families.length||new Set(receipt.families).size!==receipt.families.length||receipt.families.some(f=>!FAMILIES.includes(f)))fail('INVALID_FAMILIES');
 if(!plain(receipt.outputs)||!Object.keys(receipt.outputs).length)fail('INVALID_OUTPUTS');
 for(const [p,h] of Object.entries(receipt.outputs)){if(!receipt.families.includes(outputFamily(p)))fail('OUTPUT_FAMILY_MISMATCH');hash(h);}
 return structuredClone(receipt);
}
/** Metadata extension for an existing P2 receipt; never contains its own/result commit hash. */
export function createAutoPublicationReceipt(input){
 exact(input,KEYS.filter(k=>!['schema','schemaVersion'].includes(k)));
 return checkedReceipt({schema:'pandolab-auto-data-publication',schemaVersion:1,...input});
}
/** readOutput(path) -> Buffer|string|Uint8Array, sync or async, from a fixed local
 * owner. It must enforce filesystem/symlink confinement; this helper performs no I/O.
 * Returns validated identity, not a caller-supplied success flag. */
export async function validateAutoPublicationReceipt(receipt,{inputFingerprint,generatorIdentity,readOutput}){
 const r=checkedReceipt(receipt);hash(inputFingerprint);hash(generatorIdentity);
 if(r.inputFingerprint!==inputFingerprint||r.generatorIdentity!==generatorIdentity)fail('RECEIPT_IDENTITY_MISMATCH');
 if(typeof readOutput!=='function')fail('INVALID_OUTPUT_READER');
 for(const [p,h] of Object.entries(r.outputs)){const bytes=await readOutput(p);if(!(typeof bytes==='string'||bytes instanceof Uint8Array)||sha(bytes)!==h)fail('OUTPUT_HASH_MISMATCH');}
 return {valid:true,inputDataSha:r.inputDataSha,inputFingerprint:r.inputFingerprint,generatingAppSha:r.generatingAppSha,generatorIdentity:r.generatorIdentity,families:r.families,outputs:r.outputs};
}
/** Bounded, injected orchestration only; no real executor or generic commands.
 * request is an exact planSync request. inspect(request) authenticates request,
 * checks ancestry/current heads, and returns {desired,completed,available,token}
 * with planSync shapes and an opaque nonempty exact app/data-head token.
 * assertCurrent(token) rejects HEAD_MOVED before every write. deriveAndStore(plan,
 * token) stores full validated data; connect(plan,token) updates guarded paired
 * pin; deploy(plan,token) performs approved production Pages dispatch;
 * verify(plan,token) checks live/preview evidence (must not deploy). Each returns
 * no authoritative state: inspect is always reread. Adapters are trusted owners;
 * durable state survives failures; no rollback. All six functions required.
 * policy defaults disabled. Work/gis never deploys; main writes require enable.
 */
export async function reconcileLibraryData({request,policy={productionEnabled:false},adapters,maxSteps=8}){
 if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>16)fail('INVALID_MAX_STEPS');
 for(const name of ['inspect','assertCurrent','deriveAndStore','connect','deploy','verify'])if(typeof adapters?.[name]!=='function')fail('INVALID_ADAPTER_'+name);
 const steps=[];const seen=new Set();let last;
 const observe=async()=>{const state=await adapters.inspect(request);if(typeof state?.token!=='string'||!state.token)fail('INVALID_HEAD_TOKEN');const plan=planSync({desired:state.desired,completed:state.completed,available:state.available,policy});return {state,plan};};
 // One recovery observation only: persistent movement must not recurse or wait.
 const headMoved=async action=>{
  try{last=(await observe()).state.desired;}catch{/* Preserve only previously observed desired state. */}
  return {status:'retry-needed',action,errorCode:'HEAD_MOVED',desired:last,steps};
 };
 for(let i=0;i<maxSteps;i++){
  let observation;
  try{observation=await observe();}catch(error){if(error.code==='HEAD_MOVED')return headMoved('inspect');return {status:'incomplete',action:'inspect',errorCode:error.code||'INSPECT_FAILED',steps};}
  const {state,plan}=observation;last=state.desired;
  if(plan.action==='blocked')return {status:'blocked',reason:plan.reason,steps};
  if(plan.action==='noop')return {status:'complete',expected:plan.expected,steps};
  if(state.desired.appBranch==='main'&&!policy.productionEnabled&&['derive','connect','deploy'].includes(plan.action))return {status:'blocked',reason:'main-mutations-disabled',steps};
  if(plan.action==='deploy'&&(state.desired.appBranch!=='main'||!state.desired.production||!policy.productionEnabled))return {status:'blocked',reason:'production-disabled-or-non-main',steps};
  const key=plan.action+JSON.stringify(plan.expected);
  if(seen.has(key))return {status:plan.action==='verify'?'pending':'retry-needed',reason:'no-progress',desired:state.desired,steps};
  seen.add(key);const action=plan.action==='derive'?'deriveAndStore':plan.action;
  try{
   if(action!=='verify')await adapters.assertCurrent(state.token);
   await adapters[action](plan,state.token);steps.push({action,expected:plan.expected});
  }catch(error){
   if(error.code==='HEAD_MOVED')return headMoved(action);
   return {status:'incomplete',action,errorCode:error.code||'ACTION_FAILED',steps};
  }
 }
 return {status:'retry-needed',reason:'step-limit',desired:last,steps};
}
