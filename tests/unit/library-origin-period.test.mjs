import test from 'node:test';
import assert from 'node:assert/strict';
import {loadNodeCore} from '../../tools/load-node-core.mjs';
import {createTerritorialFeature} from "../../shared/frontend/js/modules/territorial-units.js";
import {startupDocument} from '../helpers/core-startup.mjs';

test('typed library provenance round-trips dates and source identity without a precision flag',async()=>{
 const core=await loadNodeCore();
 const origin={libraryId:'state:soviet-union-russian-sfsr',geometryVersionId:'1991-r1',referenceDate:'1991-12-24',
  sourceId:'existing-shape',sourceVersion:'2',certainty:'medium',partial:false,missingLibraryRefs:[]};
 const feature=createTerritorialFeature({id:'phase',entityKind:'general',name:'Phase',
  geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]},metadata:{libraryOrigin:origin}});
 const session=new core.DocumentSession({validateFlagDataUrl(){}});
 try{
  session.documentLoad(JSON.stringify(startupDocument([feature])),'1991-12');
  const saved=JSON.parse(session.storageSnapshot());
  assert.deepEqual(saved.territorialEntities[0].properties.metadata.libraryOrigin,origin);
 }finally{session.delete();}
});
