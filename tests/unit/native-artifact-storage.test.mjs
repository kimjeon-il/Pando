import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync,existsSync,unlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from "node:crypto";
const nativeHash=bytes=>createHash("sha256").update(bytes).digest("hex");
import {installNativeArtifactView,retireNativeSnapshots,finishArtifactMaintenance} from '../../tools/worktree-storage.mjs';

test('native retirement preserves other worktree references and resumes after interruption',t=>{
 const base=mkdtempSync(join(tmpdir(),'pando-native-retire-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const a=join(base,'a'),b=join(base,'b'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};for(const dir of [a,b,source])mkdirSync(dir);
 const install=(root,key,text)=>{const bytes=Buffer.from(text);writeFileSync(join(source,'pandolab-web-shell.exe'),bytes);return installNativeArtifactView({root,source,settings,manifest:{schema:1,platform:'windows',mode:'development',nativeInputSha256:key.repeat(64),files:[{path:'pandolab-web-shell.exe',bytes:bytes.length,sha256:nativeHash(bytes)}]}});};
 const old=install(a,'a','first'),other=install(b,'a','first');install(a,'b','current');
 assert.equal(old,other);assert.equal(retireNativeSnapshots({root:a,roots:[a,b],settings,processes:[],apply:true}).entries.find(x=>x.directory===old).status,'referenced');
 install(b,'b','current');
 const options={root:a,roots:[a,b],settings,processes:[]};
 assert.equal(retireNativeSnapshots({...options,processes:[{Name:'pandolab.exe',ExecutablePath:join(old,'pandolab-web-shell.exe')}]}).entries.find(x=>x.directory===old).status,'referenced');
 const leases=join(settings.cacheRoot,'native-leases');mkdirSync(leases);const lease=join(leases,'verification.json');writeFileSync(lease,JSON.stringify({pid:process.pid,directory:old}));
 assert.equal(retireNativeSnapshots(options).entries.find(x=>x.directory===old).status,'referenced');unlinkSync(lease);
 assert.throws(()=>retireNativeSnapshots({...options,apply:true,afterFile:()=>{throw Error('interrupted')}}),/interrupted/);
 retireNativeSnapshots({root:a,roots:[a,b],settings,processes:[],apply:true});assert.equal(existsSync(old),false);
 assert.equal(readFileSync(join(settings.cacheRoot,'native','b'.repeat(64),'pandolab-web-shell.exe'),'utf8'),'current');
 const current=join(settings.cacheRoot,'native','b'.repeat(64));install(a,'c','latest');install(b,'c','latest');
 chmodSync(join(current,'pandolab-web-shell.exe'),0o600);writeFileSync(join(current,'pandolab-web-shell.exe'),'tampered');
 assert.throws(()=>retireNativeSnapshots({...options,apply:true}),/Modified artifact/);
 assert.equal(finishArtifactMaintenance(options).status,'blocked');assert.equal(existsSync(join(settings.cacheRoot,'native','c'.repeat(64),'pandolab-web-shell.exe')),true);
});
test('native artifact installation resumes and shares immutable bytes across worktrees',t=>{
 const base=mkdtempSync(join(tmpdir(),'pando-native-store-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const a=join(base,'a'),b=join(base,'b'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};for(const dir of [a,b,source])mkdirSync(dir);const bytes=Buffer.from('native executable'),manifest={schema:1,platform:'windows',mode:'development',nativeInputSha256:'a'.repeat(64),files:[{path:'pandolab-web-shell.exe',bytes:bytes.length,sha256:nativeHash(bytes)}]};writeFileSync(join(source,'pandolab-web-shell.exe'),bytes);writeFileSync(join(source,'native-artifact.json'),JSON.stringify(manifest));
 assert.throws(()=>installNativeArtifactView({root:a,source,manifest,settings,afterFile:()=>{throw Error('interrupted');}}),/interrupted/);
 const first=installNativeArtifactView({root:a,source,manifest,settings}),second=installNativeArtifactView({root:b,source,manifest,settings});assert.equal(first,second);assert.equal(readFileSync(join(first,'pandolab-web-shell.exe'),'utf8'),'native executable');assert.equal(statSync(join(first,'pandolab-web-shell.exe')).mode&0o200,0);const blob=join(settings.cacheRoot,'blobs',manifest.files[0].sha256);assert.equal(statSync(blob,{bigint:true}).ino,statSync(join(second,'pandolab-web-shell.exe'),{bigint:true}).ino);assert.equal(existsSync(join(settings.cacheRoot,'native-install.pending.json')),false);assert.equal(JSON.parse(readFileSync(join(b,'.library-data/native-artifacts.json')))['windows-development'].directory,second);
});

test('retired Android platforms and APK payloads are blocked before storage changes',t=>{
 const base=mkdtempSync(join(tmpdir(),'pando-retired-android-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const root=join(base,'worktree'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};
 mkdirSync(root);mkdirSync(source);
 const bytes=Buffer.from('retired native bytes'),entry=path=>({path,bytes:bytes.length,sha256:nativeHash(bytes)});
 const common={schema:1,mode:'development',nativeInputSha256:'b'.repeat(64)};
 for(const platform of ['android','android-x86_64'])
   assert.throws(()=>installNativeArtifactView({root,source,settings,manifest:{...common,platform,files:[entry('app.apk')]}}),/Invalid Windows native artifact identity/);
 assert.throws(()=>installNativeArtifactView({root,source,settings,manifest:{...common,platform:'windows',files:[entry('app.apk')]}}),/Unexpected Windows native artifact/);
 assert.throws(()=>installNativeArtifactView({root,source,settings,manifest:{...common,platform:'windows',
   files:[entry('pandolab-web-shell.exe'),entry('pandolab-web-shell.exe')]}}),/duplicate/);
 assert.equal(existsSync(settings.cacheRoot),false);
 assert.equal(existsSync(join(root,'.library-data/native-artifacts.json')),false);
});

test('Windows NSIS installer is accepted immutably and required in offline mode',t=>{
 const base=mkdtempSync(join(tmpdir(),'pando-offline-native-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const root=join(base,'worktree'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};
 mkdirSync(root);mkdirSync(source);
 const exe=Buffer.from('windows executable'),setup=Buffer.from('windows installer');
 const item=(path,bytes)=>({path,bytes:bytes.length,sha256:nativeHash(bytes)});
 const manifest={schema:1,platform:'windows',mode:'offline',nativeInputSha256:'c'.repeat(64),
   files:[item('pandolab-web-shell.exe',exe),item('PandoLab-setup.exe',setup)]};
 assert.throws(()=>installNativeArtifactView({root,source,settings,manifest:{...manifest,files:manifest.files.slice(0,1)}}),/Required Windows executable or offline installer/);
 assert.equal(existsSync(settings.cacheRoot),false);
 writeFileSync(join(source,'pandolab-web-shell.exe'),exe);
 writeFileSync(join(source,'PandoLab-setup.exe'),setup);
 const installed=installNativeArtifactView({root,source,settings,manifest});
 assert.equal(readFileSync(join(installed,'PandoLab-setup.exe'),'utf8'),'windows installer');
 assert.equal(statSync(join(installed,'PandoLab-setup.exe')).mode&0o200,0);
 assert.equal(JSON.parse(readFileSync(join(root,'.library-data/native-artifacts.json')))['windows-offline'].directory,installed);
});
