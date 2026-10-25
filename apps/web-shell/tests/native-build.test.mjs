import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBuildArguments,nativeCompilerInvocation} from '../packaged-artifacts.mjs';
test('CI builds select explicit execution modes and only the requested native target',()=>{
 const dev=nativeBuildArguments('windows','development');assert.ok(dev.includes('x86_64-pc-windows-msvc'));assert.ok(dev.includes('custom-protocol,development'));assert.ok(dev.includes('--no-bundle'));assert.ok(!dev.includes('--release'));
 const android=nativeBuildArguments('android','development');assert.deepEqual(android.slice(0,2),['android','build']);assert.ok(android.includes('aarch64'));assert.ok(android.includes('--apk'));
 const offline=nativeBuildArguments('windows','offline');assert.ok(offline.includes('custom-protocol'));assert.ok(!offline.includes('custom-protocol,development'));
 const verification=nativeBuildArguments('android-x86_64','verification');assert.ok(verification.includes('x86_64'));assert.ok(verification.includes('custom-protocol,verification'));
 assert.throws(()=>nativeBuildArguments('other','development'),/platform/i);
});
test('Android Gradle reentry receives the pnpm CLI identity instead of a bare node tauri path',()=>{assert.deepEqual(nativeCompilerInvocation('android',['android','init','--ci']),{command:'pnpm',args:['exec','tauri','android','init','--ci']});const windows=nativeCompilerInvocation('windows',['build']);assert.equal(windows.command,process.execPath);assert.ok(windows.args[0].endsWith('tauri.js'));});
