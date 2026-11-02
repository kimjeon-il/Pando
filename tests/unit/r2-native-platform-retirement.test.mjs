import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {nativeTargets,nativeBuildSelection,nativeInputIdentity} from '../../apps/editor/native-contract.mjs';
import {nativeBuildArguments,nativeCompilerInvocation} from '../../apps/editor/native-producer.mjs';
import {runNativeApplication} from '../../apps/editor/dev.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('R2 CLI and native targets allow only Windows reviewer',async()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.equal(Object.hasOwn(scripts,'dev:android'),false);
 assert.equal(Object.hasOwn(scripts,'build:android'),false);
 assert.ok(scripts['dev:windows']&&scripts['build:windows']&&scripts['dev:web']);
 assert.deepEqual(Object.keys(nativeTargets),['windows']);
 assert.deepEqual(nativeBuildSelection([],{platform:'all'}),['windows']);
 for(const platform of ['android','android-x86_64']){
   assert.throws(()=>nativeBuildSelection([],{platform}),/Unsupported native platform/);
   assert.throws(()=>nativeBuildArguments(platform,'offline'),/Unsupported native platform/);
   assert.throws(()=>nativeInputIdentity(root,{platform,mode:'development'}),/Unsupported native platform/);
   assert.throws(()=>nativeCompilerInvocation(platform,['build']),/Unsupported native platform/);
   await assert.rejects(runNativeApplication({platform}),/Only the Windows read-only reviewer/);
 }
});
test('R2 NDK and Android scaffolding are retired',()=>{
 const rust=read('apps/editor/src-tauri/build.rs');
 const cargo=read('apps/editor/src-tauri/Cargo.toml');
 assert.match(rust,/Android native application is retired/);
 assert.doesNotMatch(rust,/max-page-size=16384|cargo:rustc-link-arg=-Wl,-z/);
 assert.match(cargo,/Windows read-only historical map reviewer/);
 assert.match(read('.gitignore'),/\/apps\/editor\/src-tauri\/gen\//);
 for(const p of ['apps/editor/src-tauri/android','apps/editor/src-tauri/gen/android'])
   assert.equal(existsSync(resolve(root,p)),false,p);
});
test('R2 preserves Windows app identity and correction capability',()=>{
 const config=JSON.parse(read('apps/editor/src-tauri/tauri.conf.json'));
 const capability=JSON.parse(read('apps/editor/src-tauri/capabilities/prototype-review.json'));
 assert.equal(config.identifier,'com.pandolab.webshell.prototype');
 assert.deepEqual(config.app.security.capabilities,['prototype-review']);
 assert.deepEqual([...capability.permissions].sort(),
   ['allow-save-review-correction','allow-write-diagnostic-report'].sort());
 assert.ok(existsSync(resolve(root,'apps/editor/src-tauri/icons/icon.ico')));
});
