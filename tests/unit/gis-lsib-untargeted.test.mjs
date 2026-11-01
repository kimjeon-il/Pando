import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {buildLSIBUntargetedCandidate,prepareLSIBEvidence,runLSIBUntargeted} from '../../tools/gis/lsib-untargeted.mjs';

const cases=JSON.parse(await readFile(new URL('../fixtures/lsib-untargeted-oracle.json',import.meta.url),'utf8'));
test('LSIB evidence retains raw source attributes and records output hashes',()=>{
  const row=cases[0],archiveEvidence={checksum:Buffer.from('checksum\r\n'),readme:Buffer.from('readme\r\n'),
    archiveSha256:'a'.repeat(64),innerArchiveSha256:'b'.repeat(64),shpSha256:'c'.repeat(64),dbfSha256:'d'.repeat(64)};
  const disputeShp=Buffer.from('shp'),disputeDbf=Buffer.from('dbf');
  const disputes=row.disputes.map(geometry=>({properties:{source:'fixture'},geometry}));
  const output=prepareLSIBEvidence({archiveEvidence,records:row.records,disputes,disputeShp,disputeDbf});
  assert.deepEqual(output.get('upstream-checksums.txt'),archiveEvidence.checksum);
  assert.deepEqual(output.get('upstream-readme.txt'),archiveEvidence.readme);
  assert.deepEqual(JSON.parse(gunzipSync(output.get('boundaries.geojson.gz'))).features,
    row.records.map(record=>({type:'Feature',properties:record.properties,geometry:record.geometry})));
  const index=JSON.parse(output.get('line-index.json'));assert.deepEqual(index[0].bbox,[2,.1,2.1,1.9]);
  const provenance=JSON.parse(output.get('provenance.json'));
  const sha=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(provenance.masterSha256,sha(output.get('boundaries.geojson.gz')));
  assert.equal(provenance.naturalEarthDisputes.shpSha256,sha(disputeShp));
  assert.equal(provenance.naturalEarthDisputes.dbfSha256,sha(disputeDbf));
});
test('untargeted source runner writes fresh candidate and evidence without changing sources',{
  skip:!process.env.PANDO_TERRITORIAL_RECIPE_BINARY
},async()=>{
  const base=resolve(tmpdir()),root=await mkdtemp(join(base,'pando-lsib-run-'));
  assert.ok(root.startsWith(base+sep+'pando-lsib-run-'));
  try{
    const fixture=cases[0],source=join(root,'assets/data/territorial-entities/source'),disputedDirectory=join(root,'disputed');
    await mkdir(join(source,'countries'),{recursive:true});await mkdir(join(source,'views'),{recursive:true});
    await mkdir(join(root,'config'),{recursive:true});await mkdir(disputedDirectory,{recursive:true});
    const selections=[],originals={};
    for(const code of ['AAA','BBB']){
      const entity={entityId:'state:'+code,sourceInfo:{featureId:code},geometryVersions:[{...fixture.versions[code],
        validTo:null,geometry:fixture.geometries[code]}]};
      const bytes=Buffer.from(JSON.stringify(entity));originals[code]=bytes;
      await writeFile(join(source,'countries',`state-${code}.json`),bytes,{flag:'wx'});
      selections.push({entityId:entity.entityId,geometryVersionId:entity.geometryVersions[0].versionId});
    }
    await writeFile(join(source,'views/world.json'),JSON.stringify({selections}),{flag:'wx'});
    await writeFile(join(root,'config/library-data.json'),JSON.stringify({revision:'fixture-revision'}),{flag:'wx'});
    const shp=Buffer.from('dispute shp'),dbf=Buffer.from('dispute dbf');
    await writeFile(join(disputedDirectory,'ne-disputed.shp'),shp,{flag:'wx'});
    await writeFile(join(disputedDirectory,'ne-disputed.dbf'),dbf,{flag:'wx'});
    const archiveEvidence={checksum:Buffer.from('checksum\r\n'),readme:Buffer.from('readme\r\n'),
      archiveSha256:'a'.repeat(64),innerArchiveSha256:'b'.repeat(64),shpSha256:'c'.repeat(64),dbfSha256:'d'.repeat(64)};
    let calls=0;
    const options={
      readArchiveEvidence:async request=>{calls++;assert.equal(request.requirePinned,true);return archiveEvidence;},
      readLines:async request=>{calls++;assert.equal(request.all,true);return fixture.records;},
      readDisputedShape:async request=>{calls++;assert.deepEqual(request.shp,shp);assert.deepEqual(request.dbf,dbf);
        return fixture.disputes.map(geometry=>({properties:{source:'fixture'},geometry}));},
    };
    const output=join(root,'candidate.json'),evidenceDirectory=join(root,'evidence');
    const request={root,archive:join(root,'pinned.zip'),disputedDirectory,evidenceDirectory,output};
    const controller=new AbortController();controller.abort();
    await assert.rejects(runLSIBUntargeted(request,{...options,signal:controller.signal}),{name:'AbortError'});
    assert.equal(calls,0);
    const receipt=await runLSIBUntargeted(request,options);
    assert.equal(calls,3);assert.equal(receipt.changedCountries,2);
    const candidate=JSON.parse(await readFile(output,'utf8'));
    assert.equal(candidate.sourceRevision,'fixture-revision');assert.deepEqual(candidate.boundaries,fixture.expected.boundaries);
    for(const change of candidate.changes){
      const code=change.entityId.slice(-3);
      assert.equal(change.inputFileSha256,createHash('sha256').update(originals[code]).digest('hex'));
      assert.deepEqual(await readFile(join(source,'countries',`state-${code}.json`)),originals[code]);
    }
    assert.deepEqual(await readFile(join(evidenceDirectory,'upstream-checksums.txt')),archiveEvidence.checksum);
    assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(evidenceDirectory,'boundaries.geojson.gz')))).features,
      fixture.records.map(record=>({type:'Feature',properties:record.properties,geometry:record.geometry})));
    const outputBytes=await readFile(output);calls=0;
    await assert.rejects(runLSIBUntargeted(request,options),/EEXIST/);
    assert.equal(calls,0);assert.deepEqual(await readFile(output),outputBytes);
    const cli=spawnSync(process.execPath,['tools/gis/lsib-untargeted.mjs','--archive','absent.zip',
      '--disputed-directory',disputedDirectory,'--evidence-directory',evidenceDirectory,'--output',output],{encoding:'utf8',windowsHide:true});
    assert.notEqual(cli.status,0);assert.match(cli.stderr,/EEXIST/);assert.deepEqual(await readFile(output),outputBytes);
    await rm(output);calls=0;
    await assert.rejects(runLSIBUntargeted(request,options),/EEXIST/);
    assert.equal(calls,0);await assert.rejects(readFile(output),{code:'ENOENT'});
    const altered=JSON.parse(originals.AAA);altered.geometryVersions[0].validTo='1910-01-01';
    await writeFile(join(source,'countries/state-AAA.json'),JSON.stringify(altered));
    await assert.rejects(runLSIBUntargeted({...request,evidenceDirectory:join(root,'new-evidence')},options),/historical/i);
    await assert.rejects(readFile(output),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});
for(const fixture of cases)test(`untargeted LSIB: ${fixture.name}`,async()=>{
  const input=structuredClone(fixture),result=await buildLSIBUntargetedCandidate(input);
  assert.deepEqual(result.changes,fixture.expected.changes);
  assert.deepEqual(result.boundaries,fixture.expected.boundaries);
  assert.equal(result.sourceRevision,'fixture');assert.deepEqual(input,fixture);
});
test('untargeted LSIB rejects missing execution dependencies',async()=>{
  await assert.rejects(buildLSIBUntargetedCandidate(cases[0],{binary:'missing-lsib-native'}),/native.*failed/i);
  await assert.rejects(buildLSIBUntargetedCandidate({...cases[0],sourceRevision:null}),/inputs required/i);
});
test('selected AUT/LIE candidate matches the prior Python output',{skip:!process.env.PANDO_LSIB_UNTARGETED_ORACLE},async()=>{
  const fixture=JSON.parse(await readFile(process.env.PANDO_LSIB_UNTARGETED_ORACLE,'utf8'));
  const result=await buildLSIBUntargetedCandidate(fixture);
  assert.deepEqual(result.changes,fixture.expected.changes);
  assert.deepEqual(result.boundaries,fixture.expected.boundaries);
});
