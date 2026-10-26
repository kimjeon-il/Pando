import {contentHash} from '../../tools/library-content.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,statSync,linkSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previewGeneratedCleanup,applyGeneratedCleanup,cargoRetirementRequests} from '../../tools/worktree-generated.mjs';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-generated-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,path,text='generated'){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);}
function options(root){return {roots:[root],requests:[{root,path:'build-native/p9/retired/output.exe',reason:'retired reproducible native test',action:'delete'}],consumers:[],protectedPaths:[]};}

test('explicit retired Cargo and cache scopes reject escape and preserve Android keys',t=>{
 const root=fixture(t);put(root,'main-cargo-gnu/debug/deps/x.rlib');put(root,'android/user/debug.keystore','private key');
 const o={roots:[root],compilerScopes:[{root,kind:'retired-cargo'}],requests:[{root,path:'main-cargo-gnu',reason:'confirmed retired Cargo producer without consumers',action:'delete'}]};
 const manifest=previewGeneratedCleanup(o);assert.equal(manifest.entries.length,1);applyGeneratedCleanup({...o,manifest});assert.equal(existsSync(join(root,'main-cargo-gnu')),false);
 assert.throws(()=>previewGeneratedCleanup({...o,requests:[{root,path:'android/user',reason:'not a cache',action:'delete'}]}),/scope/);
 assert.equal(readFileSync(join(root,'android/user/debug.keystore'),'utf8'),'private key');
});
test('explicitly discarded moved work copies can be deleted while GIS originals and keys remain protected',t=>{
 const root=fixture(t);put(root,'Pandoeditor/old-source/x.cpp','retired copy');put(root,'Temp/original.zip','GIS');put(root,'Pandoeditor/signing.keystore','key');
 const o={roots:[root],compilerScopes:[{root,kind:'discarded-evidence'}],requests:[{root,path:'Pandoeditor/old-source',action:'delete',reason:'user explicitly discarded retired work copies'}]};
 const manifest=previewGeneratedCleanup(o);assert.equal(applyGeneratedCleanup({...o,manifest}).deletedBytes,12);
 for(const path of ['Temp/original.zip','Pandoeditor/signing.keystore'])assert.throws(()=>previewGeneratedCleanup({...o,requests:[{...o.requests[0],path}]}),/scope/);
});

test('cross-volume retired evidence is verified at its destination before the source is removed',{skip:process.platform!=='win32'||!existsSync('D:/build/cache/pandolab')},t=>{
 const root=fixture(t),destination=mkdtempSync('D:/build/cache/pandolab/evidence-test-');t.after(()=>rmSync(destination,{recursive:true,force:true}));
 put(root,'proof/original.map','unique original bytes');
 const o={roots:[root],compilerScopes:[{root,kind:'pc-evidence'}],relocationRoots:[destination],requests:[{root,path:'proof',action:'relocate',destination:join(destination,'proof'),reason:'ended unique evidence retained once in library storage'}]};
 const manifest=previewGeneratedCleanup(o),result=applyGeneratedCleanup({...o,manifest});
 assert.equal(result.relocatedBytes,21);assert.equal(existsSync(join(root,'proof/original.map')),false);assert.equal(readFileSync(join(destination,'proof/original.map'),'utf8'),'unique original bytes');
 assert.throws(()=>previewGeneratedCleanup({...o,requests:[{...o.requests[0],action:'delete'}]}),/scope/);
});
test('interrupted cross-volume prefix copies resume only with owned journal and intact source',{skip:process.platform!=='win32'||!existsSync('D:/build/cache/pandolab')},t=>{
 const root=fixture(t),destination=mkdtempSync('D:/build/cache/pandolab/evidence-test-');t.after(()=>rmSync(destination,{recursive:true,force:true}));put(root,'proof/map','original bytes');
 const o={roots:[root],compilerScopes:[{root,kind:'pc-evidence'}],relocationRoots:[destination],requests:[{root,path:'proof',action:'relocate',destination:join(destination,'proof'),reason:'keep exact original'}]},manifest=previewGeneratedCleanup(o),journal=join(root,'journal.json');
 assert.throws(()=>applyGeneratedCleanup({...o,manifest,journal,copyForRelocation:(source,pending)=>{writeFileSync(pending,readFileSync(source).subarray(0,4),{flag:'wx'});throw Error('copy interrupted');}}),/interrupted/);
 assert.ok(existsSync(join(root,'proof/map')));assert.equal(applyGeneratedCleanup({...o,manifest,journal}).relocatedBytes,14);assert.equal(readFileSync(join(destination,'proof/map'),'utf8'),'original bytes');
});
test('completed cleanup cursor survives interruption before caller persists its result',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);const manifest=previewGeneratedCleanup(o),journal=join(root,'journal.json');
 const first=applyGeneratedCleanup({...o,manifest,journal,retainCompletedJournal:true});assert.ok(existsSync(journal));
 const resumed=applyGeneratedCleanup({...o,manifest,journal,retainCompletedJournal:true});assert.equal(resumed.deletedBytes,first.deletedBytes);assert.equal(resumed.completedCount,manifest.entries.length);
});
test('closed validation evidence can only be relocated with exact bytes',t=>{
 const root=fixture(t),evidence=fixture(t);put(root,'build-native/resource-update-native.log','original proof');
 const request={root,path:'build-native/resource-update-native.log',reason:'completed validation provenance',action:'delete'};
 assert.throws(()=>previewGeneratedCleanup({roots:[root],requests:[request]}),/must be relocated/);
 const o={roots:[root],requests:[{...request,action:'relocate',destination:join(evidence,'native.log')}],relocationRoots:[evidence]};
 const manifest=previewGeneratedCleanup(o);assert.equal(applyGeneratedCleanup({...o,manifest}).relocatedBytes,14);
 assert.equal(readFileSync(join(evidence,'native.log'),'utf8'),'original proof');
});
test('retired dependency links are unlinked without traversing their shared store',t=>{
 const root=fixture(t),shared=fixture(t);put(shared,'keep.js','shared package');
 mkdirSync(join(root,'node_modules/.pnpm'),{recursive:true});symlinkSync(shared,join(root,'node_modules/.pnpm/shared-package'),'junction');
 put(root,'node_modules/.pnpm/lock.yaml','old install metadata');
 put(root,'node_modules/.pnpm/a-package/index.js','local');
 symlinkSync(join(root,'node_modules/.pnpm/a-package'),join(root,'node_modules/.pnpm/z-package-link'),'junction');
 symlinkSync(join(shared,'missing-package'),join(root,'node_modules/.pnpm/missing-package-link'),'junction');
 const o={roots:[root],requests:[{root,path:'node_modules/.pnpm',action:'delete',reason:'metadata points to the prepared global virtual store'}],consumers:[]};
 const manifest=previewGeneratedCleanup(o),result=applyGeneratedCleanup({...o,manifest});
 assert.equal(result.deletedBytes,25);assert.equal(readFileSync(join(shared,'keep.js'),'utf8'),'shared package');assert.equal(existsSync(join(root,'node_modules/.pnpm')),false);
});
test('preview is read-only; apply rejects stale hashes before deleting anything',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);const m=previewGeneratedCleanup(o);assert.ok(existsSync(join(root,o.requests[0].path)));writeFileSync(join(root,o.requests[0].path),'changed');assert.throws(()=>applyGeneratedCleanup({...o,manifest:m}),/changed|stale/i);assert.equal(readFileSync(join(root,o.requests[0].path),'utf8'),'changed');
});
test('safe apply resumes and is idempotent without deleting a shared peer',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);put(root,'build-native/p9/retired/second.exe');o.requests=[{...o.requests[0],path:'build-native/p9/retired'}];const peer=join(root,'peer');linkSync(join(root,'build-native/p9/retired/output.exe'),peer);const m=previewGeneratedCleanup(o),journal=join(root,'journal.json');assert.throws(()=>applyGeneratedCleanup({...o,manifest:m,journal,afterRemoved:()=>{throw Error('interrupted');}}),/interrupted/);const result=applyGeneratedCleanup({...o,manifest:m,journal});assert.equal(result.deletedBytes,18);assert.equal(readFileSync(peer,'utf8'),'generated');assert.equal(statSync(peer).nlink,1);assert.equal(existsSync(journal),false);assert.equal(applyGeneratedCleanup({...o,manifest:m,journal}).deletedBytes,0);
});
test('protected files, sources, unknown roots and junctions are rejected',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);assert.throws(()=>previewGeneratedCleanup({...o,protectedPaths:[join(root,o.requests[0].path)]}),/protected/i);assert.throws(()=>previewGeneratedCleanup({...o,requests:[{...o.requests[0],path:'tools/source.py'}]}),/scope/i);const outside=fixture(t);mkdirSync(join(root,'build-native/p9/linked'),{recursive:true});symlinkSync(outside,join(root,'build-native/p9/linked/escape'),'junction');assert.throws(()=>previewGeneratedCleanup({...o,requests:[{...o.requests[0],path:'build-native/p9/linked'}]}),/link/i);
});
test('an active consumer blocks apply and evidence relocation verifies bytes',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);const m=previewGeneratedCleanup(o);assert.throws(()=>applyGeneratedCleanup({...o,manifest:m,consumers:[{ExecutablePath:join(root,'tool.exe')}]}),/consumer/i);const destination=fixture(t);o.requests=[{...o.requests[0],action:'relocate',destination:join(destination,'evidence.exe')}];o.relocationRoots=[destination];const r=previewGeneratedCleanup(o);const done=applyGeneratedCleanup({...o,manifest:r});assert.equal(done.relocatedBytes,9);assert.equal(readFileSync(join(destination,'evidence.exe'),'utf8'),'generated');assert.equal(existsSync(join(root,o.requests[0].path)),false);
});
test('Cargo retirement follows exact dependency fingerprints across host and target',t=>{
 const root=fixture(t),base='apps/editor/src-tauri/target';
 function fp(platform,name,value,deps=[],features='[]'){
  const p=`${base}/${platform}/.fingerprint/${name}`;put(root,p+'/lib-app.json',JSON.stringify({features,deps:deps.map(x=>[0,'dependency',false,x])}));
  const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));put(root,p+'/lib-app',b.toString('hex'));
 }
 fp('debug','build-host-1111111111111111',11);fp('debug','build-host-2222222222222222',22);
 fp('x86_64-pc-windows-gnu/debug','pandolab-web-shell-aaaaaaaaaaaaaaaa',33,[11]);
 put(root,base+'/debug/build/build-host-1111111111111111/output.exe');put(root,base+'/debug/build/build-host-2222222222222222/output.exe');
 put(root,base+'/debug/build/orphan-3333333333333333/output.exe');
 put(root,base+'/debug/build/build-host-1111111111111111/out/build/generated/file.obj');
 put(root,base+'/release/build/orphan-4444444444444444/output.exe');
 put(root,base+'/x86_64-pc-windows-gnu/release/build/orphan-5555555555555555/output.exe');
 const result=cargoRetirementRequests({root,seeds:['x86_64-pc-windows-gnu/debug/.fingerprint/pandolab-web-shell-aaaaaaaaaaaaaaaa/lib-app.json']});
 assert.ok(result.requests.some(r=>r.path.endsWith('build/build-host-2222222222222222')));assert.ok(!result.requests.some(r=>r.path.endsWith('build/build-host-1111111111111111')));
 assert.ok(result.requests.some(r=>r.path.endsWith('build/orphan-3333333333333333')),'incomplete retired build without a fingerprint has no active dependency consumer');
 assert.ok(!result.requests.some(r=>r.path.includes('out/build/')),'nested build directories inside retained OUT_DIR are not Cargo partitions');
 for(const hash of ['4444444444444444','5555555555555555'])assert.ok(result.requests.some(r=>r.path.endsWith('build/orphan-'+hash)),'host and target release partitions are inspected');
 assert.throws(()=>cargoRetirementRequests({root,seeds:['missing.json']}),/seed/i);
 fp('aarch64-linux-android/debug','protected-arm-bbbbbbbbbbbbbbbb',44,[22]);
 const protectedResult=cargoRetirementRequests({root,seeds:['x86_64-pc-windows-gnu/debug/.fingerprint/pandolab-web-shell-aaaaaaaaaaaaaaaa/lib-app.json'],protectedPartitions:['aarch64-linux-android/debug']});
 assert.ok(!protectedResult.requests.some(r=>r.path.endsWith('build/build-host-2222222222222222')),'protected partition also protects its host dependencies');
});
test('relative Cargo and Gradle invocations outside the worktree still block deletion',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);const manifest=previewGeneratedCleanup(o);
 for(const Name of ['cargo.exe','java.exe'])assert.throws(()=>applyGeneratedCleanup({...o,manifest,consumers:[{Name,ExecutablePath:'C:/toolchain/'+Name,CommandLine:Name==='cargo.exe'?'cargo test':'java org.gradle.launcher.daemon.bootstrap.GradleDaemon'}]}),/consumer/i);
});
test('a crash after unlink but before completion journal update is accounted once on resume',t=>{
 const root=fixture(t),o=options(root);put(root,o.requests[0].path);const manifest=previewGeneratedCleanup(o),journal=join(root,'journal.json');
 assert.throws(()=>applyGeneratedCleanup({...o,manifest,journal,afterMutation:()=>{throw Error('crash after unlink');}}),/crash/);
 const result=applyGeneratedCleanup({...o,manifest,journal});assert.equal(result.deletedBytes,9);assert.equal(result.payloadBytesUnlinked,9);
});

test('explicit compiler retirement permits SDK components but protects ADB and GPU Python',t=>{const root=fixture(t);put(root,'ndk/version/tool.exe');put(root,'platform-tools/adb.exe');const o={roots:[root],compilerScopes:[{root,kind:'android-sdk'}],requests:[{root,path:'ndk',action:'delete',reason:'CI owns native compilation; verified exclusive SDK'}]};const manifest=previewGeneratedCleanup(o);assert.equal(manifest.entries.length,1);assert.equal(applyGeneratedCleanup({...o,manifest}).deletedBytes,9);assert.ok(!existsSync(join(root,'ndk')));assert.equal(readFileSync(join(root,'platform-tools/adb.exe'),'utf8'),'generated');assert.throws(()=>previewGeneratedCleanup({...o,requests:[{...o.requests[0],path:'platform-tools'}]}),/scope/i);put(root,'build-native/python/tool');assert.throws(()=>previewGeneratedCleanup({...o,compilerScopes:[{root,kind:'worktree'}],requests:[{...o.requests[0],path:'build-native/python'}]}),/scope/i);});

test('running emulator and QEMU protect SDK and AVD retirement across executable locations',t=>{const root=fixture(t);put(root,'medium_phone.avd/config.ini');const o={roots:[root],compilerScopes:[{root,kind:'avd'}],requests:[{root,path:'medium_phone.avd',action:'delete',reason:'ended emulator with unique autosave exported'}]},manifest=previewGeneratedCleanup(o);for(const Name of ['emulator.exe','qemu-system-x86_64.exe'])assert.throws(()=>applyGeneratedCleanup({...o,manifest,consumers:[{Name,ExecutablePath:'C:/other-sdk/'+Name,CommandLine:Name+' -avd Medium_Phone'}]}),/consumer/i);assert.ok(existsSync(join(root,'medium_phone.avd/config.ini')));});

test('compiler retirement permits immutable app consumers but protects the exact retiring target',t=>{const root=fixture(t);put(root,'apps/editor/src-tauri/target/debug/app.exe');const o={roots:[root],compilerScopes:[{root,kind:'worktree'}],requests:[{root,path:'apps/editor/src-tauri/target',action:'delete',reason:'CI application consumes immutable view, local target retired'}],consumers:[{Name:'node.exe',CommandLine:'node '+root+'/apps/editor/dev.mjs'}]};const manifest=previewGeneratedCleanup(o);assert.throws(()=>applyGeneratedCleanup({...o,manifest,consumers:[{Name:'app.exe',ExecutablePath:root+'/apps/editor/src-tauri/target/debug/app.exe'}]}),/consumer/i);assert.equal(applyGeneratedCleanup({...o,manifest}).deletedBytes,9);});

test('changes after full preflight cannot use its verified-byte stamp',t=>{const root=fixture(t),o=options(root);put(root,o.requests[0].path,'original!');const manifest=previewGeneratedCleanup(o),file=join(root,o.requests[0].path),before=statSync(file);let changed=false;assert.throws(()=>applyGeneratedCleanup({...o,manifest,refreshConsumers:()=>{if(!changed){changed=true;writeFileSync(file,'modified!');utimesSync(file,before.atime,before.mtime);}return[];}}),/changed|stale/i);assert.equal(readFileSync(file,'utf8'),'modified!');});

test('compiler preview receipts bind exact manifests and recheck any later file change',t=>{const root=fixture(t);put(root,'ndk/file','original!');const o={roots:[root],compilerScopes:[{root,kind:'android-sdk'}],requests:[{root,path:'ndk',action:'delete',reason:'verified compiler installation retired'}]},start=BigInt(Date.now())*1000000n,manifest=previewGeneratedCleanup(o),proof={schema:'pando-compiler-preview-proof-v1',startedAtNs:String(start),manifestSha256:contentHash(Buffer.from(JSON.stringify(manifest)))};const changed=structuredClone(manifest);changed.entries[0].sha256='0'.repeat(64);assert.throws(()=>applyGeneratedCleanup({...o,manifest:changed,verifiedPreview:proof}),/receipt/i);writeFileSync(join(root,'ndk/file'),'modified!');assert.throws(()=>applyGeneratedCleanup({...o,manifest,verifiedPreview:proof}),/stale|changed/i);assert.equal(readFileSync(join(root,'ndk/file'),'utf8'),'modified!');});

test('write-ahead batches resume across a checkpoint without double accounting',t=>{const root=fixture(t),o=options(root);o.requests[0].path='build-native/p9/retired';for(let i=0;i<270;i++)put(root,o.requests[0].path+'/'+i+'.bin','x');const manifest=previewGeneratedCleanup(o),journal=join(root,'journal.json');let count=0;assert.throws(()=>applyGeneratedCleanup({...o,manifest,journal,afterRemoved:()=>{if(++count===260)throw Error('batch interruption');}}),/batch interruption/);const resumed=applyGeneratedCleanup({...o,manifest,journal});assert.equal(resumed.deletedBytes,270);assert.equal(resumed.payloadBytesUnlinked,270);assert.equal(existsSync(journal),false);});
