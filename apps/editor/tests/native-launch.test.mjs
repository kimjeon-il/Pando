import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('a reused-server development session stays alive until its stop signal and then releases its timer',async()=>{
 const url=new URL('../dev.mjs',import.meta.url).href;
 const script=`import {waitForDevelopmentStop} from ${JSON.stringify(url)};setTimeout(()=>{console.log('alive');process.emit('SIGINT');},40).unref();await waitForDevelopmentStop();console.log('stopped');`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:10000,windowsHide:true});
 assert.equal(stdout.trim(),'alive\nstopped');
});
