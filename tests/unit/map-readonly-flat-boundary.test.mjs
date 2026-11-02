import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapOverlayLayers} from '../../shared/frontend/js/modules/map-workspace-host.js';
import {createRenderingDomain} from '../../shared/frontend/js/modules/rendering-domain.js';
import {createCoreDocumentClient} from '../../shared/frontend/js/modules/core-document-client.js';

function fakeLayer(){
  const target={appendChild(){}};
  const layer={append:()=>fakeLayer(),attr:()=>layer,node:()=>target};
  return layer;
}

test('flat review renders map and selection layers but no drawing handles',()=>{
  const read=createMapOverlayLayers({map:fakeLayer(),svg:fakeLayer(),productMode:'editor',readOnly:true});
  for(const key of ['selectionLayer','hoverLayer','countryLayer','territorialBoundaryLayer','territorialLabelLayer'])assert.ok(read[key],key);
  for(const key of ['boundaryEditLayer','previewLayer','validationLayer','vertexLayer','draftLayer','snapLayer','territorialOperationLayer'])assert.equal(read[key],null,key);
  const writable=createMapOverlayLayers({map:fakeLayer(),svg:fakeLayer(),productMode:'editor'});
  assert.ok(writable.boundaryEditLayer);
  assert.ok(writable.vertexLayer);
  assert.ok(writable.draftLayer);
});

test('read-only renderer rejects injected editing overlays but keeps ordinary render service',()=>{
  assert.throws(()=>createRenderingDomain({readOnly:true,createEditingPresentation:()=>({})}),/Read-only rendering/);
  assert.throws(()=>createRenderingDomain({readOnly:true,getEditingRenderPacket:()=>({})}),/Read-only rendering/);
  const reader=createRenderingDomain({readOnly:true});
  assert.equal(typeof reader.invalidateSelection,'function');
  assert.equal(typeof reader.invalidateProject,'function');
  reader.dispose();
});

test('flat review Core blocks mutation before creating or dispatching a Worker',async()=>{
  let created=0;
  const client=createCoreDocumentClient({productMode:'editor',readOnly:true,createWorker(){created++;throw Error('Must not create a Worker');}});
  try {
    for(const [name,args] of [['execute',[{commandId:'territorial.field'}]],['undo',[]],['draftApply',[{action:'start'}]],['exportSnapshot',[{}]]]) {
      await assert.rejects(client[name](...args),{code:'PL-PRODUCT-READONLY',productMode:'editor'});
    }
    assert.equal(created,0);
  } finally {client.dispose();}
});
