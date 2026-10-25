import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {createTerritorialFeature} from "../../shared/frontend/js/modules/territorial-units.js";
import {createTerritorialEntityRepository} from "../../shared/frontend/js/modules/territorial-entity-repository.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
import {effectiveTerritorialFlagUrl} from "../../shared/frontend/js/modules/country-flags.js";

test('the shared territorial display view resolves default, custom and absent flags for hover',()=>{
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
 const features=[createTerritorialFeature({id:'FRA',name:'프랑스',entityKind:'general',geometry}),
  createTerritorialFeature({id:'child',name:'하위 객체',entityKind:'general',geometry,parentId:'FRA',metadata:{flagDataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}}),
  createTerritorialFeature({id:'regional',name:'독립 권역',entityKind:'regional',geometry})];
 const repository=createTerritorialEntityRepository({getEntities:()=>features});
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},territorialModel:{entityRepository:repository},
  objectPresentation:{territorialEntityName:feature=>feature.properties.name},layerPresentation:{ASSET_REVISION:'parity-test'}});
 for(const feature of features){
  const info=query.objectDisplayInfo({domain:'territorial',type:'entity',id:feature.id});
  assert.equal(info.name,feature.properties.name);
  assert.equal(info.flagUrl,effectiveTerritorialFlagUrl(feature,{assetRevision:'parity-test'}));
 }
});

test('the common visibility query honors hidden object items for selection and hover output',()=>{
 const feature=createTerritorialFeature({id:'A',name:'A',entityKind:'general',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}});
 let visible=true;
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},territorialModel:{entityRepository:createTerritorialEntityRepository({getEntities:()=>[feature]})},
  layerPresentation:{isLayerItemVisible:()=>visible},hydroPresentation:{hydroEditById:()=>null}});
 const ref={domain:'territorial',type:'entity',id:'A'};
 assert.equal(query.objectRefVisible(ref),true);
 visible=false;assert.equal(query.objectRefVisible(ref),false);
});
