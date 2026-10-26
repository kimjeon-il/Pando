#!/usr/bin/env node
// Read-only LSIB country-source identity gate. GEOS and canonical edge parity
// are owned by pando-territorial-recipe; Node owns git data, IDs and reporting.
// Does not approve modern LSIB output as historical ground truth.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const SOURCE='assets/data/territorial-entities/source';
const json=path=>JSON.parse(readFileSync(path,'utf8'));

export function readOriginalLineages(base,paths,{root=ROOT,git=execFileSync}={}) {
  assert.ok(/^[\w./-]+$/.test(base) && !base.startsWith('-'),'Unsafe source revision');
  const requests=paths.map(path=>base+':'+SOURCE+'/countries/'+path+'.json');
  const bytes=git('git',['cat-file','--batch'],{
    cwd:root,input:requests.join('\n')+'\n',maxBuffer:256*1024*1024});
  const documents=[];
  let offset=0;
  for(const path of paths) {
    const newline=bytes.indexOf(10,offset);
    assert.ok(newline>=0,'Missing git cat-file header for '+path);
    const header=bytes.subarray(offset,newline).toString('utf8').split(' ');
    assert.equal(header[1],'blob','Missing original country lineage '+path);
    const length=Number(header[2]);
    assert.ok(Number.isSafeInteger(length)&&length>=0,'Invalid git blob length');
    offset=newline+1;
    assert.ok(offset+length<bytes.length,'Truncated original country lineage');
    documents.push(JSON.parse(bytes.subarray(offset,offset+length).toString('utf8')));
    offset+=length;
    assert.equal(bytes[offset],10,'Malformed git cat-file record');
    ++offset;
  }
  assert.equal(offset,bytes.length,'Unexpected git cat-file trailing bytes');
  return documents;
}

export function verifyLSIBCountryContracts({originals,after,view,candidate}) {
  const before={};
  for(const document of originals) {
    for(const entity of document.entities) {
      assert.ok(!Object.hasOwn(before,entity.entityId),'Duplicate original country ID');
      before[entity.entityId]={...entity,lineageId:document.lineageId};
    }
  }
  const beforeKeys=Object.keys(before).sort();
  assert.deepEqual(Object.keys(after).sort(),beforeKeys,'Country identity set changed');
  assert.ok(Array.isArray(candidate.changes),'Candidate changes must be an array');
  const changed=new Set(candidate.changes.map(row=>row.entityId));
  for(const id of changed)
    assert.ok(Object.hasOwn(before,id),'Candidate references unknown country '+id);
  const displayVersions=new Map(view.selections.map(
    row=>[row.entityId,row.geometryVersionId]));
  assert.equal(displayVersions.size,view.selections.length,'Duplicate world selection');
  let unchanged=0,historical=0;
  const changedModern=[];
  for(const [entityId,current] of Object.entries(after)) {
    const previous=before[entityId];
    assert.deepEqual(current.lifetime,previous.lifetime,'Lifetime changed: '+entityId);
    assert.deepEqual(current.geometryVersions.map(x=>x.versionId),
      previous.geometryVersions.map(x=>x.versionId),'Geometry version IDs changed: '+entityId);
    assert.deepEqual(current.names,previous.names,'Names changed: '+entityId);
    assert.deepEqual(current.parentEntityId,previous.parentEntityId,'Parent changed: '+entityId);
    for(let i=0;i<current.geometryVersions.length;++i) {
      const old=previous.geometryVersions[i],next=current.geometryVersions[i];
      assert.deepEqual([next.validFrom,next.validTo],[old.validFrom,old.validTo],
        'Version interval changed: '+entityId+'/'+next.versionId);
      if(old.validTo!=null||old.versionId!==displayVersions.get(entityId)) {
        assert.deepEqual(next,old,'Historical version overwritten: '+entityId+'/'+next.versionId);
        ++historical;
      }
    }
    if(!changed.has(entityId)) {
      const copy=structuredClone(current);
      assert.ok(copy.metadata&&typeof copy.metadata==='object','Missing country metadata');
      delete copy.metadata.representativeGeometryVersionId;
      assert.deepEqual(copy,previous,'Unrelated country changed: '+entityId);
      ++unchanged;
    } else {
      const version=current.geometryVersions.find(
        item=>item.versionId===displayVersions.get(entityId));
      assert.ok(version?.geometry,'Missing changed modern geometry: '+entityId);
      changedModern.push(version.geometry);
    }
  }
  const beforeWorld=[],afterWorld=[];
  for(const {entityId,geometryVersionId} of view.selections) {
    assert.ok(before[entityId]&&after[entityId],'World selection references missing country');
    for(const [collection,result] of [[before,beforeWorld],[after,afterWorld]]) {
      const version=collection[entityId].geometryVersions.find(
        item=>item.versionId===geometryVersionId);
      assert.ok(version?.geometry,'Missing world geometry: '+entityId+'/'+geometryVersionId);
      result.push(version.geometry);
    }
  }
  assert.ok(beforeWorld.length>0,'Empty world view');
  return {beforeWorld,afterWorld,changedModern,unchanged,historical,changedCount:changed.size,
    countryCount:Object.keys(after).length};
}

export function auditLSIBGeometry(contract,{binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
  spawn=spawnSync}={}) {
  assert.ok(binary,'PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS auditor');
  const temp=mkdtempSync(join(tmpdir(),'pando-lsib-source-'));
  try {
    const request=join(temp,'input.json');
    writeFileSync(request,JSON.stringify({
      beforeWorld:contract.beforeWorld,afterWorld:contract.afterWorld,
      changedModern:contract.changedModern}));
    const run=spawn(binary,['--audit-lsib-modern-sources',request],
      {encoding:'utf8',maxBuffer:8*1024*1024});
    if(run.error)throw run.error;
    assert.equal(run.status,0,run.stderr||'Native LSIB auditor failed');
    const result=JSON.parse(run.stdout);
    assert.equal(result.schemaVersion,1,'Unexpected native audit schema');
    assert.equal(result.validatedModernPolygons,contract.changedModern.length,
      'Native auditor omitted a changed polygon');
    return result;
  }finally {
    rmSync(temp,{recursive:true,force:true});
  }
}

export function verifyLSIBSources({base,candidatePath,outputPath,root=ROOT,
  binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY}={}) {
  assert.ok(base&&candidatePath&&outputPath,
    'Usage: node tools/gis/verify-lsib-country-sources.mjs --base SHA --candidate FILE --output FILE');
  const sourceRoot=join(root,SOURCE);
  const view=json(join(sourceRoot,'views/world.json'));
  const paths=readdirSync(join(sourceRoot,'lineages'))
    .filter(name=>name.endsWith('.json')).sort().map(name=>name.slice(0,-5));
  const originals=readOriginalLineages(base,paths,{root});
  const after={};
  for(const name of readdirSync(join(sourceRoot,'countries'))
    .filter(name=>name.endsWith('.json')).sort()) {
    const entity=json(join(sourceRoot,'countries',name));
    assert.ok(!Object.hasOwn(after,entity.entityId),'Duplicate current country ID');
    after[entity.entityId]=entity;
  }
  const contract=verifyLSIBCountryContracts({
    originals,after,view,candidate:json(resolve(candidatePath))});
  const audit=auditLSIBGeometry(contract,{binary});
  if(!audit.passed) {
    const diagnostic=join(root,'build-native/lsib-supplement/unpaired-edges.json');
    mkdirSync(dirname(diagnostic),{recursive:true});
    writeFileSync(diagnostic,JSON.stringify(audit,null,2)+'\n');
    throw Error('LSIB changed polygon validity or global unpaired/coastal edges: '+
      JSON.stringify({valid:audit.modernChangedPolygonsValid,
        oldOnly:audit.oldOnlyEdges,newOnly:audit.newOnlyEdges,diagnostic}));
  }
  const result={
    sourceRevision:base,countryObjects:contract.countryCount,lineages:paths.length,
    changedModernCountries:contract.changedCount,
    unchangedCountryObjects:contract.unchanged,
    historicalVersionsUnchanged:contract.historical,
    modernChangedPolygonsValid:audit.modernChangedPolygonsValid,
    lifetimesAndVersionIdentitiesUnchanged:true,
    globalUnpairedEdgesIdentical:audit.globalUnpairedEdgesIdentical,
    unpairedEdgeCount:audit.unpairedEdgeCount,
    groundTruthHistoricalAccuracyVerified:false};
  const destination=resolve(outputPath);
  mkdirSync(dirname(destination),{recursive:true});
  writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
  return result;
}

function args(argv) {
  const values={};
  for(let i=0;i<argv.length;i+=2) {
    const flag=argv[i],value=argv[i+1];
    if(!['--base','--candidate','--output'].includes(flag)||!value)
      throw Error('Unknown or missing CLI option: '+flag);
    values[flag]=value;
  }
  return {base:values['--base'],candidatePath:values['--candidate'],
    outputPath:values['--output']};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const result=verifyLSIBSources(args(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  }catch(error) {
    console.error('LSIB source audit: '+error.message);
    process.exitCode=1;
  }
}
