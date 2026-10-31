import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {buildLSIBTargetedCandidate} from '../../tools/gis/lsib-targeted.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const fixture=JSON.parse(await readFile(new URL('../fixtures/lsib-coast-oracle.json',import.meta.url),'utf8'))[0];
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
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),
      binary:join(root,'missing-native-tool')}),/Native LSIB screen operation failed/);
    await writeFile(join(evidence,'coast.json'),Buffer.concat([coastBytes,Buffer.from('x')]));
    await assert.rejects(buildLSIBTargetedCandidate({root,targets:['FRA/MCO'],coastManifest:join(evidence,'coast-manifest.json'),binary}),/pinned evidence/i);
  } finally {await rm(root,{recursive:true,force:true});}
});
