import test from 'node:test';
import assert from 'node:assert/strict';
import {markEditedLibrarySource} from "../../apps/editor/frontend/js/modules/territorial-library-provenance.js";

const polygon=right=>({type:'Polygon',coordinates:[[[0,0],[right,0],[right,1],[0,1],[0,0]]]});
const entity=()=>({entityId:'state:Test',metadata:{geometrySha256:'metadata-old'},
  sourceInfo:{geometrySha256:'source-old',archive:'survey'},geometryVersions:[{
    versionId:'v1',validFrom:'1900-01-01',validTo:'1900-12-31',geometry:polygon(1),
    historicalProvenance:{evidenceStatus:'verified',verifiedHistoricalGeometry:true,
      independentPeriodScreenDeltaChecked:true,archive:'period-map'},
  }]});

test('unchanged library source keeps its verification and hashes',()=>{
  const previous=entity();
  assert.deepEqual(markEditedLibrarySource(structuredClone(previous),previous),previous);
});

test('changed geometry downgrades verification and retains original source evidence',()=>{
  const previous=entity(),draft=structuredClone(previous);
  draft.geometryVersions[0].geometry=polygon(1.1);
  const edited=markEditedLibrarySource(draft,previous,'user-map-editor');
  assert.equal(edited.geometryVersions[0].historicalProvenance.evidenceStatus,'provisional');
  assert.equal(edited.geometryVersions[0].historicalProvenance.verifiedHistoricalGeometry,false);
  assert.equal(edited.geometryVersions[0].historicalProvenance.independentPeriodScreenDeltaChecked,false);
  assert.equal(edited.geometryVersions[0].historicalProvenance.editMethod,'user-map-editor');
  assert.equal(edited.geometryVersions[0].historicalProvenance.archive,'period-map');
  assert.equal(edited.sourceInfo.archive,'survey');
  assert.equal(edited.sourceInfo.geometrySha256,undefined);
  assert.equal(edited.sourceInfo.originalSourceGeometrySha256,'source-old');
  assert.equal(edited.metadata.geometrySha256,undefined);
  assert.equal(edited.metadata.originalSourceGeometrySha256,'metadata-old');
  assert.equal(previous.geometryVersions[0].historicalProvenance.evidenceStatus,'verified');
});

test('period edits and new versions are provisional while unchanged versions stay verified',()=>{
  const previous=entity();
  previous.geometryVersions.push({...structuredClone(previous.geometryVersions[0]),versionId:'v3',
    validFrom:'1901-01-01',validTo:'1901-12-31'});
  const draft=structuredClone(previous);
  draft.geometryVersions[0].validTo='1900-06-30';
  draft.geometryVersions.push({...structuredClone(previous.geometryVersions[0]),versionId:'v2',
    validFrom:'1900-07-01',validTo:'1900-12-31'});
  const edited=markEditedLibrarySource(draft,previous);
  assert.ok(edited.geometryVersions.filter(row=>row.versionId!=='v3')
    .every(row=>row.historicalProvenance.evidenceStatus==='provisional'
      && row.historicalProvenance.editMethod==='user-library-editor'));
  assert.equal(edited.geometryVersions.find(row=>row.versionId==='v3').historicalProvenance.evidenceStatus,'verified');
});
