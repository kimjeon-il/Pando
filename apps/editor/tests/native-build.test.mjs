import test from 'node:test';
import assert from 'node:assert/strict';
import {win32} from 'node:path';
import {nativeBuildArguments,nativeCompilerInvocation} from '../native-producer.mjs';
test('CI builds select explicit execution modes and only the requested native target',()=>{
 const dev=nativeBuildArguments('windows','development');assert.ok(dev.includes('x86_64-pc-windows-msvc'));assert.ok(dev.includes('custom-protocol,development'));assert.ok(dev.includes('--no-bundle'));assert.ok(!dev.includes('--release'));
 const offline=nativeBuildArguments('windows','offline');assert.ok(offline.includes('custom-protocol'));assert.ok(!offline.includes('custom-protocol,development'));assert.equal(offline[offline.indexOf('--bundles')+1],'nsis');assert.ok(!offline.includes('--no-bundle'));
 const verification=nativeBuildArguments('windows','verification');assert.ok(verification.includes('x86_64-pc-windows-msvc'));assert.ok(verification.includes('custom-protocol,verification'));
 assert.throws(()=>nativeBuildArguments('android','development'),/platform/i);
 assert.throws(()=>nativeBuildArguments('other','development'),/platform/i);
});
test('Windows reviewer builds use the pinned Tauri JavaScript CLI only',()=>{assert.throws(()=>nativeCompilerInvocation('android',['build']),/platform/i);const windows=nativeCompilerInvocation('windows',['build']);assert.equal(windows.command,process.execPath);assert.ok(windows.args[0].endsWith('tauri.js'));});

test('CI native tests exercise the exact executable feature combination',async()=>{const owner=await import('../native-producer.mjs');for(const mode of ['development','offline','verification']){const build=nativeBuildArguments('windows',mode),test=owner.nativeTestArguments('windows',mode);assert.equal(test[test.indexOf('--features')+1],build[build.indexOf('--features')+1]);}});

test('Windows staged frontend is a relative directory, never a drive-letter URL',async()=>{
 const {nativeFrontendDist}=await import('../native-producer.mjs');
 const config='D:\\a\\Pando\\Pando\\apps\\editor\\src-tauri',dist='D:\\a\\Pando\\build\\editor\\dist';
 const value=nativeFrontendDist(config,dist,win32);
 assert.equal(win32.resolve(config,value),dist);
 assert.throws(()=>new URL(value));
});
