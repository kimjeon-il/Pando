import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {buildLSIBTargetedCandidate,writeLSIBTargetedCandidate} from '../../tools/gis/lsib-targeted.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const fixture=JSON.parse(await readFile(new URL('../fixtures/lsib-coast-oracle.json',import.meta.url),'utf8'))[0];
const enclave=JSON.parse(await readFile(new URL('../fixtures/lsib-enclave-oracle.json',import.meta.url),'utf8')).cases[0];
const tripoint=JSON.parse(await readFile(new URL('../fixtures/lsib-tripoint-oracle.json',import.meta.url),'utf8'))[0];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function file(path,value){
  await mkdir(dirname(path),{recursive:true});
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  await writeFile(path,bytes,{flag:'wx'});return bytes;
}
test('targeted coast preserves identities, evidence, ownership and originals',{skip:!binary},async()=>{
  const base=resolve(tmpdir()),root=await mkdtemp(join(base,'pando-lsib-target-'));
  assert.ok(root.startsWith(base+sep+'pando-lsib-target-'));
  try {
    const source=join(root,'assets/data/territorial-entities/source'), evidence=join(root,'tools/historical-library/sources/lsib-11.4');
    const originals={},selections=[];
    for(const [code,geometry] of Object.entries(fixture.geometries)){
      const current={versionId:code,validFrom:null,validTo:null,sourceId:'natural-earth-5.1.1',geometry};
      if(code==='FRA')current.modernBoundarySupplement={boundaries:[{countries:['AND','FRA'],sourceId:'dos-lsib-11.4'}]};
      const entity={entityId:`state:${code}`,sourceInfo:{featureId:code},geometryVersions:[current,{versionId:code+':past',validFrom:'1900',validTo:'1910',geometry}]};
      originals[code]=await file(join(source,'countries',`state-${code}.json`),entity);
      selections.push({entityId:entity.entityId,geometryVersionId:code});
    }
    await file(join(source,'views/world.json'),{selections});
    const raw=gzipSync(Buffer.from(JSON.stringify({features:[{properties:{CC1_GENC3:'FRA',CC2_GENC3:'MCO',RANK:'1',STATUS:'International Boundary',ID:'land'},geometry:{type:'LineString',coordinates:fixture.reference}}]})));
    await file(join(evidence,'boundaries.geojson.gz'),raw);
    await file(join(evidence,'provenance.json'),{published:'2025-02-24',masterSha256:sha(raw)});
    await file(join(root,'config/library-data.json'),{revision:'fixture-revision'});
    const coastBytes=await file(join(evidence,'coast.json'),{features:Object.entries(fixture.coasts).map(([role,coordinates])=>({properties:{cleabs:role,niveau:'Plus hautes eaux'},geometry:{type:'LineString',coordinates}}))});
    const manifest={schemaVersion:1,countries:['FRA','MCO'],sourceId:'ign-bdtopo-v3-monaco-coast',sourceCrs:'EPSG:4326',
      sourceFile:'tools/historical-library/sources/lsib-11.4/coast.json',sourceFileSha256:sha(coastBytes),
      features:{monaco:'monaco',west:'west',east:'east'},title:'Reviewed coast',published:null,url:'https://example.invalid/coast',
      license:'Open Licence 2.0',licenseUrl:'https://example.invalid/license',attribution:'IGN',retrieved:'2026-10-22',lastModified:'2024-09-23',confirmed:'2021-11-01'};
    await file(join(evidence,'coast-manifest.json'),manifest);
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],binary}),/pinned reviewed coast/i);
    const candidate=await buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),binary});
    assert.equal(candidate.sourceRevision,'fixture-revision');assert.equal(candidate.changes.length,2);assert.equal(candidate.boundaries.length,4);
    for(const change of candidate.changes){
      const code=change.entityId.split(':')[1];assert.equal(change.geometryVersionId,code);
      assert.equal(change.inputFileSha256,sha(originals[code]));assert.equal(change.supplement.coastline,'reviewed-ign-replacement');
      assert.match(change.sourceId,/dos-lsib-11\.4\+ign-bdtopo-v3-monaco-coast/);
      assert.equal(change.sourceAttributions[0].published,null);
      assert.deepEqual(await readFile(join(source,'countries',`state-${code}.json`)),originals[code]);
    }
    assert.deepEqual(candidate.changes.find(change=>change.entityId==='state:FRA').supplement.boundaries[0].countries,['AND','FRA']);
    const output=join(root,'candidate.json'),request={root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),binary,output};
    const receipt=await writeLSIBTargetedCandidate(request);
    assert.equal(receipt.changedCountries,2);assert.equal(receipt.sections,4);
    assert.deepEqual(JSON.parse(await readFile(output,'utf8')),candidate);
    const originalOutput=await readFile(output);
    await assert.rejects(writeLSIBTargetedCandidate(request),/EEXIST/);
    assert.deepEqual(await readFile(output),originalOutput);
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),
      binary:join(root,'missing-native-tool')}),/Native LSIB screen operation failed/);
    await writeFile(join(evidence,'coast.json'),Buffer.concat([coastBytes,Buffer.from('x')]));
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),binary}),/pinned evidence/i);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('targeted batch accumulates host changes and preserves reviewed provenance',{skip:!binary},async()=>{
  const base=resolve(tmpdir()),root=await mkdtemp(join(base,'pando-lsib-target-'));
  assert.ok(root.startsWith(base+sep+'pando-lsib-target-'));
  try{
    const source=join(root,'assets/data/territorial-entities/source'),evidence=join(root,'tools/historical-library/sources/lsib-11.4');
    const rename={AUT:'FRA',LIE:'AND',CHE:'ESP'};
    const geometries={...structuredClone(enclave.geometries),
      VAT:{type:'Polygon',coordinates:[[[4,4],[5,4],[5,5],[4,5],[4,4]]]},
      ...Object.fromEntries(Object.entries(tripoint.geometries).map(([code,geometry])=>[rename[code],geometry])),
      LSO:structuredClone(enclave.geometries.SMR),ZAF:structuredClone(enclave.geometries.ITA)};
    const references=tripoint.references.map(row=>({countries:row.countries.map(code=>rename[code]).sort(),geometry:row.geometry}));
    references.push({countries:['ITA','SMR'],geometry:{type:'LineString',coordinates:enclave.reference}},
      {countries:['ITA','VAT'],geometry:{type:'LineString',coordinates:[[4,4],[5.1,4],[5.1,5],[4,5],[4,4]]}},
      {countries:['LSO','ZAF'],geometry:{type:'LineString',coordinates:[[1,1],[2.1,1],[2.1,2],[1,2],[1,1]]}});
    const originals={},selections=[];
    for(const [code,geometry] of Object.entries(geometries)){
      const versionId=`state:${code}:current`,entity={entityId:`state:${code}`,sourceInfo:{featureId:code},
        geometryVersions:[{versionId,validFrom:null,validTo:null,geometry,sourceId:'natural-earth-5.1.1'},
          {versionId:`state:${code}:past`,validFrom:'1900-01-01',validTo:'1910-01-01',geometry}]};
      originals[code]=await file(join(source,'countries',`state-${code}.json`),entity);
      selections.push({entityId:entity.entityId,geometryVersionId:versionId});
    }
    await file(join(source,'views/world.json'),{selections});
    const raw=gzipSync(Buffer.from(JSON.stringify({features:references.map(row=>({type:'Feature',
      properties:{CC1_GENC3:row.countries[0],CC2_GENC3:row.countries[1],RANK:'1',STATUS:'International Boundary',NOTES:'',ID:row.countries.join('/')},geometry:row.geometry}))})));
    await file(join(evidence,'boundaries.geojson.gz'),raw);
    await file(join(evidence,'provenance.json'),{published:'2025-02-24',masterSha256:sha(raw)});
    await file(join(root,'config/library-data.json'),{revision:'fixture-revision'});
    const targets=['AND/FRA','ITA/SMR','ITA/VAT','LSO/ZAF'];
    const result=await buildLSIBTargetedCandidate({root,targets,binary});
    assert.equal(result.sourceRevision,'fixture-revision');assert.equal(result.changes.length,8);
    for(const change of result.changes){
      const code=change.entityId.split(':')[1];
      assert.equal(change.inputFileSha256,sha(originals[code]));
      assert.equal(change.geometryVersionId,`state:${code}:current`);
      assert.equal(change.sourceId,'natural-earth-5.1.1+dos-lsib-11.4');
      assert.deepEqual(await readFile(join(source,'countries',`state-${code}.json`)),originals[code]);
    }
    const italy=result.changes.find(value=>value.entityId==='state:ITA');
    assert.equal(italy.supplement.reviewedBoundaryRepairs.length,2);
    assert.equal(result.changes.find(value=>value.entityId==='state:VAT').supplement.simplificationToleranceDegrees,0);
    for(const change of result.changes){
      const code=change.entityId.split(':')[1];
      assert.equal(change.inputFileSha256,sha(originals[code]));assert.equal(change.geometryVersionId,`state:${code}:current`);
      assert.equal(change.sourceId,'natural-earth-5.1.1+dos-lsib-11.4');
      assert.deepEqual(await readFile(join(source,'countries',`state-${code}.json`)),originals[code]);
    }
    const official=await file(join(evidence,'igm.geojson'),{features:[{properties:{globalid:'fixture-smr',comune_ist:'san_mar_com'},
      geometry:{type:'Polygon',coordinates:[[[1,1],[2.3,1],[2.3,2],[1,2],[1,1]]]}}]});
    const manifest={schemaVersion:1,countries:['ITA','SMR'],sourceId:'igm-dbsn-2025-06-27',sourceCrs:'EPSG:4258',
      sourceFile:'tools/historical-library/sources/lsib-11.4/igm.geojson',sourceFileSha256:sha(official),featureGlobalId:'fixture-smr',
      title:'IGM DBSN fixture',published:'2025-06-27',url:'https://example.invalid/igm',license:'ODbL-1.0',
      licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',attribution:'IGM'};
    const manifestPath=join(evidence,'igm.json');await file(manifestPath,manifest);
    const igm=await buildLSIBTargetedCandidate({root,targets:['ITA/SMR'],referenceManifest:manifestPath,binary});
    const smr=igm.changes.find(value=>value.entityId==='state:SMR');
    assert.equal(smr.sourceId,'natural-earth-5.1.1+igm-dbsn-2025-06-27');assert.equal(smr.sourceAttributions[0].license,'ODbL-1.0');
    assert.equal(smr.supplement.simplificationToleranceDegrees,0);
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['AND/FRA'],referenceManifest:manifestPath,binary}),/not explicitly selected/i);
    await writeFile(join(evidence,'igm.geojson'),Buffer.concat([official,Buffer.from('changed')]));
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['ITA/SMR'],referenceManifest:manifestPath,binary}),/pinned evidence/i);
    const old=JSON.parse(originals.AND.toString());old.geometryVersions[0].validTo='1910-01-01';
    await writeFile(join(source,'countries/state-AND.json'),JSON.stringify(old));
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['AND/FRA'],binary}),/historical/i);
    await writeFile(join(source,'countries/state-AND.json'),originals.AND);
    await writeFile(join(evidence,'boundaries.geojson.gz'),Buffer.concat([raw,Buffer.from('changed')]));
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['AND/FRA'],binary}),/master differs/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
