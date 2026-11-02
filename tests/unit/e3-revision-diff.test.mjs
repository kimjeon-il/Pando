import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {
  collectRevisionDiff,createPendingRevisionReview,diffTerritorialEntities,
  revisionIndexDiff,verificationSummary,
} from '../../tools/review/e3-revision-diff.mjs';
import {generateE3RevisionEvidence} from '../../tools/review/generate-e3-review.mjs';
import {normalizeReviewBundle,reviewState} from '../../shared/frontend/js/modules/review-change-records.js';

const A='a'.repeat(40),B='b'.repeat(40),D='d'.repeat(40);
const hash=value=>createHash('sha256').update(value).digest('hex');
const geo=extent=>({type:'Polygon',coordinates:[[[0,0],[extent,0],[extent,1],[0,1],[0,0]]]});
const entity=()=>({
  schemaVersion:2,entityId:'state:EXAMPLE_A',entityKind:'general',lineageId:'example-a',
  names:{ko:'예시국',en:'Example'},alternateNames:[],
  lifetime:{validFrom:'1900',validTo:null},parentEntityId:'',
  geometryVersions:[{versionId:'geo-original',validFrom:null,validTo:null,certainty:'high',
    sourceId:'synthetic',geometry:geo(1)}],
  instantiation:{mode:'independent',countryUpdates:{}},
  metadata:{representativeGeometryVersionId:'geo-original'},sourceInfo:{},
});
const snapshots=(before,after)=>{
 const old=Buffer.from(JSON.stringify(before)),next=Buffer.from(JSON.stringify(after));
 const beforeDigest=hash(old),afterDigest=hash(next);
 const baseIndex={schemaVersion:1,entities:{[before.entityId]:beforeDigest}};
 const candidateIndex={schemaVersion:1,entities:{[after.entityId]:afterDigest}};
 const blobs=new Map([[A+':'+beforeDigest,old],[B+':'+afterDigest,next]]);
 const readEntity=({revision,digest})=>({bytes:blobs.get(revision+':'+digest)});
 return {baseIndex,candidateIndex,readEntity};
};
const diff=(before,after,month='2008-10')=>collectRevisionDiff({baseRevision:A,candidateRevision:B,
  ...snapshots(before,after),comparisonMonth:month});

test('E3 reads only the altered object digests in two immutable external Git indices',()=>{
  const a=entity(),other=entity();other.entityId='state:EXAMPLE_B';
  const x={schemaVersion:1,entities:{'state:EXAMPLE_A':'a'.repeat(64),'state:EXAMPLE_B':'b'.repeat(64)}};
  const y={schemaVersion:1,entities:{'state:EXAMPLE_A':'c'.repeat(64),'state:EXAMPLE_B':'b'.repeat(64)}};
  assert.deepEqual(revisionIndexDiff(x,y),[{sourceEntityId:'state:EXAMPLE_A',
    beforeDigest:'a'.repeat(64),afterDigest:'c'.repeat(64)}]);
  assert.equal(other.entityId,'state:EXAMPLE_B');
  const updated=structuredClone(a);updated.geometryVersions[0].geometry=geo(2);
  let loads=0;const inputs=snapshots(a,updated);
  const result=collectRevisionDiff({baseRevision:A,candidateRevision:B,...inputs,
    readEntity:entry=>{loads++;return inputs.readEntity(entry);},comparisonMonth:'2008-10'});
  assert.equal(loads,2);
  assert.equal(result.indexChangedEntities,1);
  assert.equal(result.changes.length,1);
  assert.equal(result.issues.length,0);
  assert.equal(result.changes[0].kind,'geometry');
  assert.equal(result.changes[0].after.versionId,'geo-original');
  assert.equal(result.selectedAtComparisonMonth,1);
});

test('E3 preserves actual day precision when the candidate splits an unlimited source version',()=>{
  const before=entity(),after=structuredClone(before);
  after.geometryVersions=[{...after.geometryVersions[0],validFrom:null,validTo:'2008-10-13'},
    {...after.geometryVersions[0],versionId:'geo-2008',
      validFrom:'2008-10-14',validTo:null,geometry:geo(2)}];
  const result=diff(before,after),change=result.changes.find(row=>row.kind==='geometry');
  assert.equal(result.changes.length,1);
  assert.equal(result.issues.length,0);
  assert.equal(change.validFrom,'2008-10-14');
  assert.equal(change.validTo,null);
  assert.equal(change.before.versionId,'geo-original');
  assert.equal(change.after.versionId,'geo-2008');
  assert.equal(result.selectedAtComparisonMonth,1);
  assert.equal(diff(before,after,'2008-09').selectedAtComparisonMonth,0);
});

test('E3 independent name/formal/flag/parent/lifetime changes remain separately scoped',()=>{
  const old=entity(),after=structuredClone(old);
  after.lifetime={validFrom:'1914-07-28',validTo:null};
  after.parentEntityId='state:EXAMPLE_B';
  after.nameVersions=[
    {validFrom:null,validTo:'2002-02-13',names:{ko:{common:'예시국'},en:{common:'Example'}}},
    {validFrom:'2002-02-14',validTo:null,names:{ko:{common:'예시국',formal:'예시왕국'},
      en:{common:'Example',formal:'Kingdom of Example'}}},
  ];
  const svg=svgColor=>Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="'+svgColor+'"/></svg>').toString('base64');
  old.metadata.flagHistory=[{validFrom:null,validTo:null,policy:'embedded',flagDataUrl:'data:image/svg+xml;base64,'+svg('#fff')}];
  after.metadata.flagHistory=[{validFrom:null,validTo:null,policy:'embedded',flagDataUrl:'data:image/svg+xml;base64,'+svg('#000')}];
  const result=diff(old,after);
  assert.equal(result.issues.length,0);
  assert.ok(result.changes.some(c=>c.kind==='lifetime'&&c.after.validFrom==='1914-07-28'));
  assert.ok(result.changes.some(c=>c.kind==='parent'&&c.after==='state:EXAMPLE_B'));
  assert.equal(result.changes.filter(c=>c.kind==='name').length,2);
  assert.ok(result.changes.some(c=>c.kind==='name'&&c.field==='names.ko.formal'&&c.before===null&&c.after==='예시왕국'));
  assert.equal(result.changes.filter(c=>c.kind==='flag').length,1);
  assert.match(result.changes.find(c=>c.kind==='flag').before.sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.changes.find(c=>c.kind==='flag').after.sha256===result.changes.find(c=>c.kind==='flag').before.sha256,false);
});

test('E3 does not fake flag artwork hashes when the external asset cannot be opened',()=>{
  const old=entity(),after=structuredClone(old);
  old.metadata.defaultFlagDataUrl='assets/vendor/old.svg';
  after.metadata.defaultFlagDataUrl='assets/vendor/new.svg';
  const result=diff(old,after);
  assert.equal(result.changes.length,0);
  assert.equal(result.issues[0].code,'unresolved-flag-artwork');
  assert.equal(verificationSummary(result).coverage,'partial');
  assert.throws(()=>createPendingRevisionReview(result,{proposalId:'e3-fake',createdAt:'2026-11-02T01:00:00.000Z',
    evidence:{reportPath:'reports/borders/reconstruction/test.md',revision:B}}),/empty, incomplete/);
});

test('E3 refuses to represent partially aligned source intervals as valid E2 changes',()=>{
  const old=entity(),next=structuredClone(old);
  old.geometryVersions=[{...old.geometryVersions[0],validTo:'2000-12-31'},
    {...old.geometryVersions[0],versionId:'second-old',validFrom:'2001-01-01',validTo:null,geometry:geo(1.5)}];
  next.geometryVersions=[{...next.geometryVersions[0],validFrom:null,validTo:null,geometry:geo(2)}];
  const result=diff(old,next);
  assert.ok(result.issues.some(x=>x.code==='unaligned-interval'));
  assert.equal(result.changes.length,0);
  assert.equal(verificationSummary(result).coverage,'partial');
});

test('E3 admits a pending E2 review only with verified report revision; topology remains not-run',()=>{
  const old=entity(),next=structuredClone(old);next.geometryVersions[0].geometry=geo(2);
  const result=diff(old,next);
  const audit=verificationSummary(result,{codeRevision:D});
  assert.deepEqual(audit.checks.find(row=>row.name==='geometry-topology'),{name:'geometry-topology',outcome:'not-run'});
  assert.equal(audit.historicalAccuracy,'not-verified');
  assert.equal(audit.sourceHashCheck,'passed');
  assert.equal(audit.coverage,'modeled');
  const proposal=createPendingRevisionReview(result,{proposalId:'e3-example-001',
    createdAt:'2026-11-02T01:00:00.000Z',createdBy:'ai',
    evidence:{reportPath:'reports/borders/reconstruction/synthetic-case/README.md',revision:B}});
  assert.equal(reviewState(proposal).status,'pending');
  assert.equal(proposal.events.length,0);
  assert.deepEqual(normalizeReviewBundle(proposal),proposal);
  assert.throws(()=>createPendingRevisionReview(result,{proposalId:'e3-no-evidence',
    createdAt:'2026-11-02T01:00:00.000Z'}),/report/);
});

test('E3 fails closed on corrupted source bytes, non-ancestor contracts and altered index',()=>{
  const a=entity(),b=structuredClone(a);b.geometryVersions[0].geometry=geo(2);
  const f=snapshots(a,b);
  assert.throws(()=>collectRevisionDiff({baseRevision:A,candidateRevision:B,...f,
    readEntity:()=>({bytes:Buffer.from('tampered')}),comparisonMonth:'2008-10'}),/hash mismatch/);
  assert.throws(()=>collectRevisionDiff({baseRevision:A,candidateRevision:A,...f,comparisonMonth:'2008-10'}),/distinct/);
  assert.throws(()=>collectRevisionDiff({baseRevision:A,candidateRevision:B,...f,comparisonMonth:'2008-10-14'}),/month/);
  assert.throws(()=>revisionIndexDiff({...f.baseIndex,entities:{'state:WRONG':'x'}},f.candidateIndex),/Invalid library index/);
});

function git(root,...args){return execFileSync('git',['-c','user.name=Review Fixture','-c','user.email=fixture@example.invalid',
  ...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function put(root,path,content){
  const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
}
function commitFixture(root,entityValue,report=false){
  const body=Buffer.from(JSON.stringify(entityValue)),digest=hash(body);
  put(root,'objects/'+digest+'.json',body);
  put(root,'library.json',JSON.stringify({schemaVersion:1,indexHash:digest,entities:{[entityValue.entityId]:digest}}));
  if(report)put(root,'reports/borders/reconstruction/synthetic-case/README.md','# Synthetic historical evidence\n');
  git(root,'add','.');git(root,'commit','-qm',report?'candidate':'base');
  return git(root,'rev-parse','HEAD');
}
test('E3 CLI compares two real local Git commits and writes checksummed read-only evidence',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-e3-git-')),output=mkdtempSync(join(tmpdir(),'pando-e3-output-'));
  t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(output,{recursive:true,force:true});});
  git(root,'init','-q');
  git(root,'remote','add','origin','https://github.com/kimjeon-il/PandoLab-library-data.git');
  const old=entity(),candidate=structuredClone(old);
  candidate.geometryVersions[0].geometry=geo(2);
  const base=commitFixture(root,old),head=commitFixture(root,candidate,true);
  const run={base,candidate:head,'data-root':root,'output-dir':output,
    'comparison-month':'2008-10','evidence-path':'reports/borders/reconstruction/synthetic-case/README.md',
    'proposal-id':'e3-local-001','created-at':'2026-11-02T01:00:00.000Z','code-revision':D};
  const checked=generateE3RevisionEvidence(run);
  assert.equal(checked.diff.changes.length,1);
  assert.equal(checked.verification.historicalAccuracy,'not-verified');
  assert.equal(reviewState(checked.bundle).status,'pending');
  const manifest=JSON.parse(readFileSync(join(output,'e3-output-manifest.json'),'utf8'));
  assert.equal(manifest.status,'awaiting-human-review');
  assert.equal(manifest.files.length,3);
  for(const file of manifest.files)assert.equal(hash(readFileSync(join(output,file.name))),file.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'e3-pending-proposal.json'),'utf8')),checked.bundle);
  assert.equal(git(root,'status','--porcelain'),'');
  assert.throws(()=>generateE3RevisionEvidence({...run,base:head,candidate:base,'output-dir':join(output,'bad')}),
    /descend from/);
  assert.throws(()=>generateE3RevisionEvidence({...run,'evidence-path':'reports/borders/reconstruction/unknown/README.md',
    'output-dir':join(output,'other')}),/git show|unknown|path|revision|exist|fatal/i);
});
