import test from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {nativeInputIdentity,verifyNativeBundle,nativeBuildSelection} from '../native-contract.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(p,text)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),typeof text==='string'?text:JSON.stringify(text));};
 put('apps/editor/src-tauri/Cargo.toml','[package]\nname="app"\n');put('apps/editor/src-tauri/Cargo.lock','locked\n');put('apps/editor/src-tauri/src/lib.rs','fn main() {}\n');put('apps/editor/src-tauri/build.rs','fn main() {}\n');put('apps/editor/src-tauri/tauri.conf.json',{});put('apps/editor/src-tauri/tauri.dev.json',{});put('apps/editor/package.json',{devDependencies:{'@tauri-apps/cli':'2.12.3'}});put('config/toolchain-versions.json',{rust:'1.99.1'});put('config/library-data.json',{repository:'owner/data',revision:'a'.repeat(40)});put('config/native-artifacts.json',{schema:1});execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','fixture'],{cwd:root});return{root,put};}
test('development identity follows native inputs while allowing frontend and runtime pin changes',t=>{const {root,put}=fixture(t),identity=()=>nativeInputIdentity(root,{platform:'windows',mode:'development'}).sha256,initial=identity();put('assets/js/change.js','frontend');put('config/library-data.json',{repository:'owner/data',revision:'b'.repeat(40)});assert.equal(identity(),initial);put('apps/editor/src-tauri/src/lib.rs','fn main() { }\n');assert.notEqual(identity(),initial);put('apps/editor/src-tauri/src/lib.rs','fn main() {}\r\n');assert.equal(identity(),initial);assert.throws(()=>nativeInputIdentity(root,{platform:'android',mode:'development'}),/platform/i);});
test('changing artifact download orchestration does not recompile an unchanged native backend',t=>{const {root,put}=fixture(t),initial=nativeInputIdentity(root,{platform:'windows',mode:'development'}).sha256;put('apps/editor/packaged-artifacts.mjs','consumer update');assert.equal(nativeInputIdentity(root,{platform:'windows',mode:'development'}).sha256,initial);});
test('verification identity normalizes line endings in extensionless notices and licenses',t=>{const {root,put}=fixture(t),files=['shared/frontend/static/vendor/a/NOTICE','shared/frontend/static/vendor/b/LICENSE'];for(const p of files)put(p,'line one\nline two\n');const initial=nativeInputIdentity(root,{platform:'windows',mode:'verification'}).sha256;for(const p of files)put(p,'line one\r\nline two\r\n');assert.equal(nativeInputIdentity(root,{platform:'windows',mode:'verification'}).sha256,initial);});
test('native modes reject unsupported targets while offline tracks live Viewer and data pin',t=>{const {root,put}=fixture(t);assert.throws(()=>nativeInputIdentity(root,{platform:'other',mode:'development'}),/platform/i);assert.throws(()=>nativeInputIdentity(root,{platform:'windows',mode:'other'}),/mode/i);put('apps/viewer/js/viewer.js','first');const initial=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;put('apps/viewer/js/viewer.js','second');const viewerChanged=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;assert.notEqual(viewerChanged,initial);put('config/library-data.json',{repository:'owner/data',revision:'b'.repeat(40)});assert.notEqual(nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256,viewerChanged);});
test('Windows offline bundles require their verified installer',t=>{const {root}=fixture(t),identity=nativeInputIdentity(root,{platform:'windows',mode:'offline'}),dir=join(root,'bundle');mkdirSync(dir);const exe=Buffer.from('fixture executable'),setup=Buffer.from('fixture installer');writeFileSync(join(dir,'pandolab-web-shell.exe'),exe);const manifest={schema:1,sourceCommit:'1'.repeat(40),nativeInputSha256:identity.sha256,platform:'windows',target:identity.target,mode:'offline',toolchainVersion:identity.toolchainVersion,files:[{path:'pandolab-web-shell.exe',bytes:exe.length,sha256:hash(exe)}]};const write=()=>writeFileSync(join(dir,'native-artifact.json'),JSON.stringify(manifest));write();assert.throws(()=>verifyNativeBundle(dir,identity),/installer/i);writeFileSync(join(dir,'PandoLab-setup.exe'),setup);manifest.files.push({path:'PandoLab-setup.exe',bytes:setup.length,sha256:hash(setup)});write();assert.equal(verifyNativeBundle(dir,identity).mode,'offline');writeFileSync(join(dir,'PandoLab-setup.exe'),'changed');assert.throws(()=>verifyNativeBundle(dir,identity),/hash|bytes/i);});
test('offline binary inputs retain exact bytes rather than lossy UTF8 text',t=>{const {root}=fixture(t);mkdirSync(join(root,'shared/frontend/static/wasm'),{recursive:true});writeFileSync(join(root,'shared/frontend/static/wasm/core.wasm'),Buffer.from([255]));const first=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;writeFileSync(join(root,'shared/frontend/static/wasm/core.wasm'),Buffer.from([254]));assert.notEqual(nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256,first);});
test('bundle verification checks every byte before accepting platform, mode and input identity',t=>{const {root}=fixture(t),identity=nativeInputIdentity(root,{platform:'windows',mode:'development'}),bytes=Buffer.from('native exe'),directory=join(root,'bundle');mkdirSync(directory);writeFileSync(join(directory,'pandolab-web-shell.exe'),bytes);const manifest={schema:1,sourceCommit:'1'.repeat(40),nativeInputSha256:identity.sha256,platform:'windows',target:'x86_64-pc-windows-msvc',mode:'development',toolchainVersion:'1.99.1',files:[{path:'pandolab-web-shell.exe',bytes:bytes.length,sha256:hash(bytes)}]};writeFileSync(join(directory,'native-artifact.json'),JSON.stringify(manifest));assert.equal(verifyNativeBundle(directory,identity).nativeInputSha256,identity.sha256);writeFileSync(join(directory,'pandolab-web-shell.exe'),'changed');assert.throws(()=>verifyNativeBundle(directory,identity),/hash|bytes|size/i);writeFileSync(join(directory,'pandolab-web-shell.exe'),bytes);manifest.mode='verification';writeFileSync(join(directory,'native-artifact.json'),JSON.stringify(manifest));assert.throws(()=>verifyNativeBundle(directory,identity),/mode|identity/i);manifest.mode='development';manifest.files[0].path='../escape.exe';writeFileSync(join(directory,'native-artifact.json'),JSON.stringify(manifest));assert.throws(()=>verifyNativeBundle(directory,identity),/path|scope/i);});
test('native CI selects only affected platforms and frontend edits do not compile native shells',()=>{assert.deepEqual(nativeBuildSelection(['assets/js/change.js','assets/css/change.css','config/library-data.json']),[]);assert.deepEqual(nativeBuildSelection(['apps/editor/src-tauri/src/lib.rs']),['windows']);assert.deepEqual(nativeBuildSelection(['apps/editor/src-tauri/android/app/build.gradle.kts']),[]);assert.deepEqual(nativeBuildSelection([],{platform:'windows'}),['windows']);assert.deepEqual(nativeBuildSelection([],{platform:'all'}),['windows']);assert.throws(()=>nativeBuildSelection([],{platform:'android'}),/platform/i);assert.throws(()=>nativeBuildSelection([],{platform:'other'}),/platform/i);});

test('bundle rejects unlisted payloads before they reach the immutable store',t=>{const {root}=fixture(t),identity=nativeInputIdentity(root,{platform:'windows',mode:'development'}),directory=join(root,'bundle');mkdirSync(directory);const bytes=Buffer.from('exe');writeFileSync(join(directory,'pandolab-web-shell.exe'),bytes);writeFileSync(join(directory,'native-artifact.json'),JSON.stringify({schema:1,sourceCommit:'1'.repeat(40),nativeInputSha256:identity.sha256,platform:'windows',target:identity.target,mode:'development',toolchainVersion:'1.99.1',files:[{path:'pandolab-web-shell.exe',bytes:3,sha256:hash(bytes)}]}));writeFileSync(join(directory,'unknown.dll'),'untracked');assert.throws(()=>verifyNativeBundle(directory,identity),/unlisted|unexpected/i);});

test('producer changes invalidate native identity and staging changes invalidate offline identity',t=>{const {root,put}=fixture(t);put('apps/editor/native-producer.mjs','first producer');const dev=nativeInputIdentity(root,{platform:'windows',mode:'development'}).sha256;put('apps/editor/native-producer.mjs','changed producer');assert.notEqual(nativeInputIdentity(root,{platform:'windows',mode:'development'}).sha256,dev);put('apps/editor/stage.mjs','first staging');const offline=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;put('apps/editor/stage.mjs','changed staging');assert.notEqual(nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256,offline);});


test('R3 excludes dormant editor frontend, HTML and retired shell JavaScript from packaged identity',t=>{
 const {root,put}=fixture(t),get=mode=>nativeInputIdentity(root,{platform:'windows',mode});
 for(const mode of ['offline','verification']){
   const before=get(mode);
   for(const p of [
     'apps/editor/frontend/js/app.js',
     'apps/editor/frontend/js/modules/editing-domain.js',
     'apps/editor/frontend/js/modules/editor-workspace-presentation.js',
     'apps/editor/templates/index.html',
     'apps/editor/startup.js',
     'apps/editor/native-storage.js',
     'apps/editor/native-platform-adapter.js',
     'apps/editor/verification.js',
     'apps/editor/tests/obsolete.test.mjs',
   ])put(p,'archived '+mode+' revision');
   const after=get(mode);
   assert.equal(after.sha256,before.sha256,'unshipped editor edits must not alter '+mode+' input content hash');
   assert.deepEqual(after.inputs,before.inputs);
   const archived=Object.keys(after.inputs).filter(p=>p.startsWith('apps/editor/frontend/'));
   assert.deepEqual(archived,['apps/editor/frontend/js/modules/project-serializer.js'].filter(p=>Object.hasOwn(after.inputs,p)));
   assert.equal(Object.keys(after.inputs).some(p=>p.startsWith('apps/editor/templates/')),false);
 }
});

test('R3 includes live Viewer, Windows staging tools, WASM bytes and exact source commit',t=>{
 const {root,put}=fixture(t),get=()=>nativeInputIdentity(root,{platform:'windows',mode:'offline'});
 const initial=get();
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(initial.inputs['source-commit'],sourceCommit,'offline bundle remains provenance-bound');
 assert.equal(initial.inputs['library-revision'],'a'.repeat(40));
 for(const p of [
   'apps/viewer/js/viewer.js',
   'shared/frontend/js/modules/temporal.js',
   'shared/frontend/static/wasm/pandoeditor-core.wasm',
   'apps/editor/stage.mjs',
   'apps/editor/network-guard.js',
   'apps/editor/document-transfer-contract.js',
   'apps/editor/world-data-plan.mjs',
   'apps/editor/fixture.mjs',
   'apps/editor/frontend/js/modules/project-serializer.js',
   'tests/helpers/core-startup.mjs',
   'scripts/lib/frontend-build.mjs',
   'scripts/build-ui-bundle.mjs',
   'tools/builtin-country-bytes.mjs',
   'tools/library-data.mjs',
   'tools/worktree-storage.mjs',
   'pnpm-lock.yaml',
 ]){
   put(p,'first '+p);
   const before=get().sha256;
   put(p,'second '+p);
   assert.notEqual(get().sha256,before,'packaged input must track '+p);
 }
});

test('R3 hashes the native verification probe only in verification mode',t=>{
 const {root,put}=fixture(t);
 put('apps/editor/review-probe.js','first');
 const offline=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;
 const verification=nativeInputIdentity(root,{platform:'windows',mode:'verification'}).sha256;
 put('apps/editor/review-probe.js','second');
 const offNext=nativeInputIdentity(root,{platform:'windows',mode:'offline'});
 const verifyNext=nativeInputIdentity(root,{platform:'windows',mode:'verification'});
 assert.equal(offNext.sha256,offline,'ordinary map-data package must not hash verification probe');
 assert.notEqual(verifyNext.sha256,verification,'verification binary must hash its executable probe');
 assert.equal(Object.hasOwn(offNext.inputs,'apps/editor/review-probe.js'),false);
 assert.equal(Object.hasOwn(verifyNext.inputs,'apps/editor/review-probe.js'),true);
});

test('R3 CRLF in YAML dependency lock does not cause platform-specific native fingerprints',t=>{
 const {root,put}=fixture(t);
 put('pnpm-lock.yaml','lockfileVersion: 9.0\npackages:\n  a: {}\n');
 const before=nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256;
 put('pnpm-lock.yaml','lockfileVersion: 9.0\r\npackages:\r\n  a: {}\r\n');
 assert.equal(nativeInputIdentity(root,{platform:'windows',mode:'offline'}).sha256,before);
});
