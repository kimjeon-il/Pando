import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,statSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previewGeneratedCleanup,applyGeneratedCleanup,cargoRetirementRequests} from '../../tools/worktree-generated.mjs';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-generated-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,path,text='generated'){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);}
function options(root){return {roots:[root],requests:[{root,path:'build-native/p9/retired/output.exe',reason:'retired reproducible native test',action:'delete'}],consumers:[],protectedPaths:[]};}
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
 const root=fixture(t),base='apps/web-shell/src-tauri/target';
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
