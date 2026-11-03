import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as release from '../../tools/reference-analysis/release-private-plugin.mjs';
import {privatePluginFingerprint} from '../../tools/reference-analysis/package-private-plugin.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const skill='skills/pando-map-analysis/',seed=skill+'runtime/workspace/',runtime=skill+'runtime.json';
const missing=['tools/cpp/map-image/macro-mask.h','tools/cpp/map-image/training-scan.h','tools/cpp/map-image/training-tile.h',
  'tools/cpp/reference-analysis/condition-sampling.h','tools/cpp/reference-analysis/training-photometry.h','tools/cpp/reference-analysis/CPYTHON-LICENSE'];
const old='1'.repeat(40),next='2'.repeat(40),data='3'.repeat(40),model='4'.repeat(64);
const protectedPaths=['core.wasm','build-native/image','pnpm-lock.yaml','package.json','assets/data/pinned.json'];
export function fixture(){
  const root={name:'map-toolkit',version:'0.6.9',extensions:{'com.openai':{interface:{displayName:'Map Toolkit'}}}};
  const legacy={name:'map-toolkit',version:'0.6.9',interface:{defaultPrompt:['literal \\uc73c']},mcpServers:{existing:{url:'https://example.invalid'}}};
  const entries=[{path:'plugin.json',data:json(root)},...protectedPaths.map(path=>({path:seed+path,data:Buffer.from('original '+path)})),
    {path:skill+'plugin.json',data:json({name:'internal',version:'0.6.0'})},{path:skill+'model/boundary.bin',data:Buffer.from('model')}];
  const rows=entries.filter(row=>row.path.startsWith(seed)).map(row=>({path:row.path.slice(seed.length),bytes:row.data.length,sha256:hash(row.data)}));
  entries.push({path:runtime,data:json({schemaVersion:2,codeRevision:old,dataRevision:data,files:rows,model:{path:'model/boundary.manifest.json',bytes:2,sha256:model}})});
  const receipt={schema:'map-toolkit-release',version:'0.6.9',codeRevision:old,dataRevision:data,modelSha256:model,
    contentSha256:privatePluginFingerprint(entries),verificationSha256:'5'.repeat(64)};
  const archiveFiles=new Map([...entries.map(r=>[r.path,r.data]),['.codex-plugin/plugin.json',json(legacy)],['release.json',json(receipt)],['retained-extra.txt',Buffer.from('extra')]]);
  const repaired=entries.map(row=>({...row}));
  for(const path of missing)repaired.push({path:seed+path,data:Buffer.from('native '+path)});
  const catalog=JSON.parse(repaired.find(row=>row.path===runtime).data);
  catalog.files.push(...missing.map(path=>{const b=repaired.find(row=>row.path===seed+path).data;return {path,bytes:b.length,sha256:hash(b)};}));
  repaired.find(row=>row.path===runtime).data=json(catalog);
  const previousCandidate={entries:repaired,codeRevision:old,dataRevision:data,modelSha256:model};
  const candidate=structuredClone(previousCandidate);candidate.entries=candidate.entries.map(r=>({...r,data:Buffer.from(r.data)}));candidate.codeRevision=next;
  candidate.entries.find(row=>row.path===runtime).data=json({...catalog,codeRevision:next});
  const remote={plugin:{plugin_id:'plugins_fixture',name:'map-toolkit',scope:'USER',discoverability:'PRIVATE',version:'0.6.9',current_release_id:'release_before'},
    complete:true,files:[...archiveFiles].map(([path,b])=>({path,size_bytes:b.length})),contents:Object.fromEntries(['plugin.json','.codex-plugin/plugin.json','release.json'].map(p=>[p,archiveFiles.get(p).toString()]))};
  return {remote,archiveFiles,previousCandidate,candidate,branch:'work/gis',producerSha256:'6'.repeat(64),archiveReleaseId:'release_before',target:{pluginId:'plugins_fixture'}};
}
const verify=f=>{assert.equal(typeof release.verifyNativeSourceBaseline,'function','explicit baseline validator must exist');return release.verifyNativeSourceBaseline(f);};
const mutateJSON=(candidate,path,change)=>{const row=candidate.entries.find(r=>r.path===path),v=JSON.parse(row.data);change(v);row.data=json(v);};

test('exact six-file omission transition derives complete inventory and immutable source bindings',()=>{
  const f=fixture(),proof=verify(f);
  assert.equal(proof.schema,'map-toolkit-native-source-baseline');assert.equal(proof.previousRevision,old);assert.equal(proof.codeRevision,next);
  assert.equal(proof.expectedReleaseId,'release_before');assert.equal(proof.pluginId,'plugins_fixture');assert.equal(proof.branch,'work/gis');
  assert.deepEqual(proof.addedPaths,missing.map(p=>seed+p).sort());
  assert.deepEqual(proof.retainedFiles,[{path:'retained-extra.txt',bytes:5,sha256:hash('extra')}]);
  for(const key of ['inventorySha256','candidateSha256','previousReceiptSha256','producerSha256'])assert.match(proof[key],/^[a-f0-9]{64}$/);
});

test('unbound, stale, replayed, wrong identity and invalid source evidence fail closed',()=>{
  for(const change of [f=>{f.archiveReleaseId=undefined;},f=>{f.archiveReleaseId='stale';},f=>{f.remote.plugin.current_release_id='new';},
    f=>{f.remote.plugin.plugin_id='other';},f=>{f.remote.plugin.scope='WORKSPACE';},f=>{f.remote.complete=false;},f=>{f.branch='main';},
    f=>{f.producerSha256='bad';},f=>{f.candidate.codeRevision='bad';},f=>{f.previousCandidate.codeRevision=next;},
    f=>{f.candidate.dataRevision=old;},f=>{f.candidate.modelSha256='9'.repeat(64);},f=>{f.archiveFiles.delete('release.json');},
    f=>{f.remote.contents['release.json']=JSON.stringify({...JSON.parse(f.remote.contents['release.json']),baselineTransition:{}});},
    f=>{f.remote.contents['plugin.json']='{}';},f=>{f.remote.contents['.codex-plugin/plugin.json']='{}';}]){
    const f=fixture();change(f);assert.throws(()=>verify(f));
  }
});

test('all payload bytes including nested versions, generated dependencies and lock remain protected',()=>{
  for(const path of [...protectedPaths.map(p=>seed+p),skill+'plugin.json',skill+'model/boundary.bin']){
    const f=fixture();f.candidate.entries.find(r=>r.path===path).data=Buffer.from('changed');assert.throws(()=>verify(f),/candidate|payload/i,path);
  }
  const f=fixture();mutateJSON(f.candidate,runtime,v=>{v.model.sha256='9'.repeat(64);});assert.throws(()=>verify(f),/candidate|payload/i);
  const root=fixture();mutateJSON(root.candidate,'plugin.json',v=>{v.extensions['com.openai'].interface.displayName='other';});assert.throws(()=>verify(root),/candidate|manifest/i);
});

test('missing, seventh, deleted and duplicate source or catalogue rows reject',()=>{
  for(const change of [f=>{f.previousCandidate.entries=f.previousCandidate.entries.filter(r=>r.path!==seed+missing[0]);},
    f=>{f.previousCandidate.entries.push({path:seed+'seventh.h',data:Buffer.from('extra')});},
    f=>{f.previousCandidate.entries=f.previousCandidate.entries.filter(r=>r.path!==seed+'core.wasm');},
    f=>{f.previousCandidate.entries.push(f.previousCandidate.entries[0]);},
    f=>mutateJSON(f.previousCandidate,runtime,v=>{v.files.push(v.files[0]);}),
    f=>mutateJSON(f.previousCandidate,runtime,v=>{v.files.find(r=>r.path===missing[0]).sha256='9'.repeat(64);}),
    f=>mutateJSON(f.previousCandidate,runtime,v=>{v.files[0].bytes++;}),
    f=>mutateJSON(f.previousCandidate,runtime,v=>{v.files.pop();})]){
    const f=fixture();change(f);assert.throws(()=>verify(f));
  }
});

test('archive and full authenticated inventory cannot omit, add, duplicate or replace extras',()=>{
  for(const change of [f=>f.archiveFiles.set('unexpected',Buffer.from('x')),f=>f.archiveFiles.delete('retained-extra.txt'),
    f=>f.archiveFiles.set('retained-extra.txt',Buffer.from('changed')),f=>f.remote.files.push({...f.remote.files[0]}),
    f=>{f.archiveFiles.set(seed+'core.wasm',Buffer.from('modified'));}]){
    const f=fixture();change(f);assert.throws(()=>verify(f));
  }
});

test('rebuilt package and exact readback cannot diverge from the preproved candidate',()=>{
  const f=fixture(),proof=verify(f),version='0.6.10',legacyManifest=JSON.parse(f.remote.contents['.codex-plugin/plugin.json']);
  const receipt={schema:'map-toolkit-release',version,codeRevision:next,dataRevision:data,modelSha256:model,contentSha256:proof.contentSha256,verificationSha256:'7'.repeat(64),baselineTransition:proof};
  const actualFiles=new Map(f.candidate.entries.map(r=>[r.path,Buffer.from(r.data)]));
  actualFiles.set('plugin.json',json({...JSON.parse(actualFiles.get('plugin.json')),version}));
  actualFiles.set('.codex-plugin/plugin.json',json({...legacyManifest,version}));actualFiles.set('release.json',json(receipt));
  const options={candidate:f.candidate,actualFiles,proof,version,legacyManifest,receipt};
  assert.equal(typeof release.verifyBaselinePackage,'function','final package byte gate must exist');
  assert.equal(release.verifyBaselinePackage(options).checkedFiles,actualFiles.size);
  for(const path of [seed+'core.wasm',seed+'build-native/image',seed+'package.json',seed+'pnpm-lock.yaml',runtime]){
    const files=new Map(actualFiles);files.set(path,Buffer.from('changed after proof'));assert.throws(()=>release.verifyBaselinePackage({...options,actualFiles:files}),/payload|fingerprint/i,path);
  }
  const config=new Map(actualFiles);config.set('.codex-plugin/plugin.json',json({...legacyManifest,version,interface:{defaultPrompt:['corrected']}}));
  assert.throws(()=>release.verifyBaselinePackage({...options,actualFiles:config}),/manifest/i);
  const finalFiles=new Map([...actualFiles,['retained-extra.txt',Buffer.from('extra')]]);
  assert.equal(release.verifyBaselinePackage({...options,actualFiles:finalFiles,includeRetained:true}).checkedFiles,finalFiles.size);
  finalFiles.set('retained-extra.txt',Buffer.from('other'));
  assert.throws(()=>release.verifyBaselinePackage({...options,actualFiles:finalFiles,includeRetained:true}),/retained/i);
  assert.throws(()=>release.verifyBaselinePackage({...options,actualFiles:new Map([...actualFiles,['unexpected',Buffer.from('x')]])}),/inventory/i);
  assert.throws(()=>release.verifyBaselinePackage({...options,proof:{...proof,candidateSha256:'0'.repeat(64)}}),/candidate/i);
});

test('complete transition readback rejects stale release, extra paths and forged transition receipt',()=>{
  assert.equal(typeof release.verifyBaselineReadback,'function','full readback gate must exist');
  const f=fixture(),proof=verify(f),version='0.6.10';
  const files=new Map(f.candidate.entries.map(r=>[r.path,r.data]));
  const manifests={'plugin.json':{...JSON.parse(files.get('plugin.json')),version},'.codex-plugin/plugin.json':{...JSON.parse(f.remote.contents['.codex-plugin/plugin.json']),version}};
  for(const [p,m]of Object.entries(manifests))files.set(p,json(m));
  const receipt={schema:'map-toolkit-release',codeRevision:next,dataRevision:data,modelSha256:model,version,contentSha256:proof.contentSha256,verificationSha256:'7'.repeat(64),baselineTransition:proof};
  files.set('release.json',json(receipt));files.set('retained-extra.txt',Buffer.from('extra'));
  const plan={pluginId:'plugins_fixture',expectedReleaseId:'release_before',uploadedReleaseId:'release_after',version,codeRevision:next,dataRevision:data,modelSha256:model,
    contentSha256:proof.contentSha256,verificationSha256:receipt.verificationSha256,baselineTransition:proof,baselineReceipt:receipt,manifests,deletePaths:[],
    files:[...files].filter(([p])=>p!=='retained-extra.txt').map(([path,b])=>({path,bytes:b.length,sha256:hash(b)}))};
  const remote={...f.remote,plugin:{...f.remote.plugin,current_release_id:'release_after',version},files:[...files].map(([path,b])=>({path,size_bytes:b.length})),contents:{...Object.fromEntries(Object.entries(manifests).map(([p,v])=>[p,JSON.stringify(v)])),'release.json':JSON.stringify(receipt)}};
  assert.equal(release.verifyPrivateRelease({plan,remote}).status,'verified');
  assert.equal(release.verifyBaselineReadback(plan,files).checkedFiles,files.size);
  assert.throws(()=>release.verifyPrivateRelease({plan,remote:{...remote,files:[...remote.files,{path:'unexpected',size_bytes:1}]}}),/inventory/i);
  assert.throws(()=>release.verifyPrivateRelease({plan,remote:{...remote,contents:{...remote.contents,'release.json':JSON.stringify({...receipt,baselineTransition:{...proof,expectedReleaseId:'other'}})}}}),/receipt/i);
  const wrongRevision=new Map(files);wrongRevision.set(runtime,json({...JSON.parse(files.get(runtime)),codeRevision:'9'.repeat(40)}));
  assert.throws(()=>release.verifyBaselineReadback(plan,wrongRevision),/revision/i);
  const changed=new Map(files);changed.set(seed+'core.wasm',Buffer.from('changed'));
  assert.throws(()=>release.verifyBaselineReadback(plan,changed),/candidate|payload/i);
});
