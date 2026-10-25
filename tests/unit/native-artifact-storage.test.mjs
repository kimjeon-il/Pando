import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeHash} from '../../apps/web-shell/native-contract.mjs';
import {installNativeArtifactView} from '../../tools/worktree-storage.mjs';
test('native artifact installation resumes and shares immutable bytes across worktrees',t=>{
 const base=mkdtempSync(join(tmpdir(),'pando-native-store-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const a=join(base,'a'),b=join(base,'b'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};for(const dir of [a,b,source])mkdirSync(dir);const bytes=Buffer.from('native executable'),manifest={schema:1,platform:'windows',mode:'development',nativeInputSha256:'a'.repeat(64),files:[{path:'pandolab-web-shell.exe',bytes:bytes.length,sha256:nativeHash(bytes)}]};writeFileSync(join(source,'pandolab-web-shell.exe'),bytes);writeFileSync(join(source,'native-artifact.json'),JSON.stringify(manifest));
 assert.throws(()=>installNativeArtifactView({root:a,source,manifest,settings,afterFile:()=>{throw Error('interrupted');}}),/interrupted/);
 const first=installNativeArtifactView({root:a,source,manifest,settings}),second=installNativeArtifactView({root:b,source,manifest,settings});assert.equal(first,second);assert.equal(readFileSync(join(first,'pandolab-web-shell.exe'),'utf8'),'native executable');assert.equal(statSync(join(first,'pandolab-web-shell.exe')).mode&0o200,0);const blob=join(settings.cacheRoot,'blobs',manifest.files[0].sha256);assert.equal(statSync(blob,{bigint:true}).ino,statSync(join(second,'pandolab-web-shell.exe'),{bigint:true}).ino);assert.equal(existsSync(join(settings.cacheRoot,'native-install.pending.json')),false);assert.equal(JSON.parse(readFileSync(join(b,'.library-data/native-artifacts.json')))['windows-development'].directory,second);
});
