import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLibrarySourceFields} from "../../apps/editor/frontend/js/modules/territorial-library-editing-ui.js";
test('source form updates exact dates and selected version without replacing identity or other versions',()=>{
 const source={entityId:'state:KOR',names:{ko:'한국',en:'Korea',ja:'韓国'},lifetime:{validFrom:null,validTo:null},sourceInfo:{sourceId:'original'},metadata:{},
  geometryVersions:[{versionId:'early',validFrom:'1948-08-15',validTo:'1953-07-26',geometry:{type:'Polygon',coordinates:[]}},
   {versionId:'late',validFrom:'1953-07-27',validTo:null}]};
 const result=applyLibrarySourceFields(source,{nameKo:'대한민국',nameEn:'Korea',validFrom:'1948-08-15',validTo:'',sourceTitle:'사료',sourceUrl:'https://example.org/map',sourceLicense:'Public domain',
  versionId:'early',versionFrom:'1948-08-15',versionTo:'1953-07-26',certainty:'medium',representativeGeometryVersionId:'late'});
 assert.equal(result.entityId,source.entityId);assert.equal(result.names.ja,'韓国');assert.equal(result.lifetime.validFrom,'1948-08-15');
 assert.equal(result.lifetime.validTo,null);assert.deepEqual(result.geometryVersions[1],source.geometryVersions[1]);
 assert.equal(result.sourceInfo.sourceId,'original');assert.equal(result.sourceInfo.title,'사료');
 assert.equal(source.names.ko,'한국');
 assert.equal(result.metadata.representativeGeometryVersionId,'late');
 assert.throws(()=>applyLibrarySourceFields(source,{versionId:'early',representativeGeometryVersionId:'missing'}),/대표 형상/);
});
