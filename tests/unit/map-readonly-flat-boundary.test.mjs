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

test('flat review renders map and selection layers without drawing handles',()=>{
  const read=createMapOverlayLayers({map:fakeLayer(),svg:fakeLayer()});
  for(const key of ['selectionLayer','hoverLayer','countryLayer','territorialBoundaryLayer','territorialLabelLayer'])assert.ok(read[key],key);
  for(const key of ['boundaryEditLayer','previewLayer','validationLayer','vertexLayer','draftLayer','snapLayer','territorialOperationLayer'])assert.equal(key in read,false,key);
});

test('read-only renderer exposes selection and project invalidation without editing APIs',()=>{
  const reader=createRenderingDomain();
  assert.equal(typeof reader.invalidateSelection,'function');
  assert.equal(typeof reader.invalidateProject,'function');
  for(const key of ['createEditingPresentation','getEditingRenderPacket','editPreviewController'])assert.equal(key in reader,false,key);
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
