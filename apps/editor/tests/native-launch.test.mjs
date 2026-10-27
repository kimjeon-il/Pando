import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAndroidDevice} from '../dev.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('device launch selects only an authorized physical device and requires an explicit serial when ambiguous',()=>{
 const output='List of devices attached\nphoneA device product:test\nemulator-5554 device product:test\nphoneB unauthorized\n';assert.equal(selectAndroidDevice(output),'phoneA');assert.throws(()=>selectAndroidDevice('List of devices attached\nemulator-5554 device\n'),/physical|authorized/i);assert.throws(()=>selectAndroidDevice(output+'phoneC device\n'),/serial|multiple/i);assert.equal(selectAndroidDevice(output+'phoneC device\n','phoneC'),'phoneC');assert.throws(()=>selectAndroidDevice(output,'phoneB'),/authorized|connected/i);
});
test('a reused-server development session stays alive until its stop signal and then releases its timer',async()=>{
 const url=new URL('../dev.mjs',import.meta.url).href;
 const script=`import {waitForDevelopmentStop} from ${JSON.stringify(url)};setTimeout(()=>{console.log('alive');process.emit('SIGINT');},40).unref();await waitForDevelopmentStop();console.log('stopped');`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:10000,windowsHide:true});
 assert.equal(stdout.trim(),'alive\nstopped');
});
