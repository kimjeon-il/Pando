import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAndroidDevice} from '../dev.mjs';
test('device launch selects only an authorized physical device and requires an explicit serial when ambiguous',()=>{
 const output='List of devices attached\nphoneA device product:test\nemulator-5554 device product:test\nphoneB unauthorized\n';assert.equal(selectAndroidDevice(output),'phoneA');assert.throws(()=>selectAndroidDevice('List of devices attached\nemulator-5554 device\n'),/physical|authorized/i);assert.throws(()=>selectAndroidDevice(output+'phoneC device\n'),/serial|multiple/i);assert.equal(selectAndroidDevice(output+'phoneC device\n','phoneC'),'phoneC');assert.throws(()=>selectAndroidDevice(output,'phoneB'),/authorized|connected/i);
});
