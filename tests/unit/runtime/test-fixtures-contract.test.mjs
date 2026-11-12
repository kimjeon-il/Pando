import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerTestPort} from '../../helpers/worker-test-port.mjs';
import {createRenderDeviceFixture} from '../../helpers/render-device-fixture.mjs';
import {createProjectStateFixture} from '../../helpers/project-state-fixture.mjs';
import {isRenderDevice} from '../../../src/rendering/render-device.js';
import {assertCurrentProjectSchema} from '../../../src/document/project-state.js';

test('RenderDevice fixture uses current production capabilities and owns one context revision',()=>{
 const a=createRenderDeviceFixture({version:2,contextRevision:7,stencil:true,maxTextureSize:2048});
 assert.equal(isRenderDevice(a.device),true);
 assert.equal(a.device.gl,a.gl);
 assert.equal(a.device.canvas,a.canvas);
 assert.equal(a.device.contextRevision,7);
 assert.equal(a.device.capabilities.maxTextureSize,2048);
 assert.equal(a.device.capabilities.uintIndices,true);
 assert.equal(a.device.capabilities.stencil,true);
 const b=createRenderDeviceFixture({version:1,extensions:['OES_element_index_uint']});
 assert.equal(b.device.version,1);
 assert.equal(b.device.capabilities.uintIndices,true);
 assert.equal(b.device.capabilities.instancing,false);
 assert.notEqual(a.device.gl,b.device.gl);
 assert.ok(Object.isFrozen(a.device.capabilities));
});

test('Worker test ports isolate transfers, late events and retirement',()=>{
 const requests=[],a=createWorkerTestPort({onPostMessage:(message)=>requests.push(message)});
 const b=createWorkerTestPort();
 const transferred=new ArrayBuffer(8),data={type:'request',requestId:3};
 a.postMessage(data,[transferred]);
 assert.deepEqual(requests,[data]);
 assert.deepEqual(a.messages,[data]);
 assert.deepEqual(a.transfers,[[transferred]]);
 assert.deepEqual(b.messages,[]);
 const received=[];
 a.onmessage=event=>received.push(event.data);
 a.emitMessage({type:'result'});
 assert.deepEqual(received,[{type:'result'}]);
 a.onerror=event=>event.preventDefault();
 assert.equal(a.emitError('closed').defaultPrevented,true);
 a.terminate();
 assert.equal(a.terminated,true);
 assert.equal(b.terminated,false);
});

test('project state fixture delegates current versions to the real document factory',()=>{
 const a=createProjectStateFixture({initialMonth:'1914-07',sourceMode:'empty'});
 const b=createProjectStateFixture({initialMonth:'1914-07',sourceMode:'empty'});
 assert.equal(a.format,'pandolab-project-state');
 assert.equal(a.projectSetup.initialMonth,'1914-07');
 assert.equal(a.projectSetup.sourceMode,'empty');
 assert.equal(assertCurrentProjectSchema(a),a);
 assert.notEqual(a.documentId,b.documentId);
 assert.notStrictEqual(a.labels,b.labels);
 a.labels.push({id:'test'});
 assert.deepEqual(b.labels,[]);
});
