import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {artifactGraph,graphStatus,publishArtifacts,stageArtifacts,GRAPH_PATH,RECEIPT_PATH} from '../../scripts/lib/p2-artifact-graph.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestPath='assets/data/world/current.json';
const objectPath=bytes=>'assets/data/world/objects/countries-canonical-sha256-'+digest(bytes)+'.pcg.gz';
const descriptor=bytes=>({assets:{canonicalCountryPacket:{url:objectPath(bytes).slice('assets/data/'.length),sha256:digest(bytes)}}});

async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'pando-p2-paths-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,bytes)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);};
 const get=path=>readFileSync(join(root,path));
 const putJson=(path,value)=>put(path,JSON.stringify(value)+'\n');
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe']}).toString().trim();
 const oldBytes=Buffer.from('previous immutable country packet'),newBytes=Buffer.from('next immutable country packet');
 const oldPath=objectPath(oldBytes),newPath=objectPath(newBytes);
 put('.gitignore','build-native/\n');
 putJson('config/toolchain-versions.json',{});
 putJson('assets/data/world/build-input.json',{legacyPreviewManifest:'world/legacy.json'});
 putJson('assets/data/world/legacy.json',{assets:{}});
 putJson(GRAPH_PATH,{schema:'pandolab-generated-artifact-graph',schemaVersion:1,families:[
  {id:'world-bundle',resolve:'world-bundle',inputs:['input/packet.bin'],outputs:[manifestPath],
   generate:[['fixture','generate']],validate:[['fixture','check']]},
  {id:'unselected',outputs:['out/unselected.bin']}
 ]});
 put('input/packet.bin',newBytes);put(oldPath,oldBytes);putJson(manifestPath,descriptor(oldBytes));
 put('out/unselected.bin','unrelated bytes');put('scripts/protected.mjs','protected source');
 git('init','-q');git('config','user.name','P2 path fixture');git('config','user.email','fixture@example.invalid');
 git('add','.');git('commit','-qm','fixture');
 const sourceSha=git('rev-parse','HEAD'),stageDir='build-native/p2/publication',checkout=join(stageDir,'checkout');
 const options={stageDir,expectedSourceSha:sourceSha};
 const publication=await stageArtifacts(root,{families:['world-bundle'],...options,run:([,mode],cwd)=>{
  if(mode==='generate'){
   const path=join(cwd,newPath);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,newBytes);
   writeFileSync(join(cwd,manifestPath),JSON.stringify(descriptor(newBytes))+'\n');
  }else{
   assert.deepEqual(readFileSync(join(cwd,newPath)),newBytes);
   assert.deepEqual(JSON.parse(readFileSync(join(cwd,manifestPath))),descriptor(newBytes));
  }
 }});
 const stageFile=path=>join(checkout,path);
 const savePublication=()=>putJson(join(stageDir,'stage.json'),publication);
 const inject=(path,bytes)=>{
  put(stageFile(path),bytes);publication.paths.push(path);
  publication.before[path]=existsSync(join(root,path))?digest(get(path)):null;
  publication.after[path]=digest(bytes);savePublication();
 };
 const unchanged=()=>{
  assert.deepEqual(get(oldPath),oldBytes);
  assert.deepEqual(JSON.parse(get(manifestPath)),descriptor(oldBytes));
  assert.equal(existsSync(join(root,newPath)),false);
  assert.equal(get('out/unselected.bin').toString(),'unrelated bytes');
  assert.equal(get('scripts/protected.mjs').toString(),'protected source');
  assert.equal(existsSync(join(root,RECEIPT_PATH)),false);
 };
 return {root,put,get,putJson,git,oldBytes,newBytes,oldPath,newPath,options,publication,stageDir,stageFile,savePublication,inject,unchanged};
}

test('P2 publishes newly addressed world objects before their manifest without a directory allowlist',async t=>{
 const f=await fixture(t),writes=[];
 assert.equal(artifactGraph(f.root).find(x=>x.id==='world-bundle').outputs.includes(f.newPath),false);
 const result=publishArtifacts(f.root,{...f.options,beforeWrite:path=>{
  writes.push(path);
  if(path===manifestPath)assert.deepEqual(f.get(f.newPath),f.newBytes);
 }});
 assert.ok(result.changedPaths.includes(f.newPath));assert.ok(writes.indexOf(f.newPath)<writes.indexOf(manifestPath));
 assert.deepEqual(f.get(f.newPath),f.newBytes);assert.deepEqual(f.get(f.oldPath),f.oldBytes);
 assert.deepEqual(JSON.parse(f.get(manifestPath)),descriptor(f.newBytes));
 assert.equal(f.get('out/unselected.bin').toString(),'unrelated bytes');
 assert.equal(graphStatus(f.root).statuses['world-bundle'].needed,false);
});

test('P2 still rejects an unreferenced hash-named object in the same directory',async t=>{
 const f=await fixture(t),bytes=Buffer.from('not selected by the manifest');f.inject(objectPath(bytes),bytes);
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 cannot derive new paths from a manifest omitted from the publication',async t=>{
 const f=await fixture(t);f.publication.paths=f.publication.paths.filter(p=>p!==manifestPath);
 delete f.publication.before[manifestPath];delete f.publication.after[manifestPath];f.savePublication();
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 ignores a staged graph edit attempting to authorize application source',async t=>{
 const f=await fixture(t),graph=JSON.parse(f.get(GRAPH_PATH));
 graph.families[0].outputs.push('scripts/protected.mjs');f.putJson(f.stageFile(GRAPH_PATH),graph);
 f.inject('scripts/protected.mjs','injected source');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 still rejects outputs belonging only to an unselected family',async t=>{
 const f=await fixture(t);f.inject('out/unselected.bin','unexpected change');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 checks staged manifest bytes before using its new paths',async t=>{
 const f=await fixture(t);f.put(f.stageFile(manifestPath),'tampered manifest');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_STAGE_BYTES_CHANGED/);f.unchanged();
});

test('P2 checks staged object bytes and destination movement before publishing',async t=>{
 const f=await fixture(t);f.put(f.stageFile(f.newPath),'corrupt object');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_STAGE_BYTES_CHANGED/);f.unchanged();
 f.put(f.stageFile(f.newPath),f.newBytes);f.put(manifestPath,'newer destination');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_DESTINATION_CHANGED/);
 assert.equal(f.get(manifestPath).toString(),'newer destination');assert.equal(existsSync(join(f.root,f.newPath)),false);
});

test('P2 refuses manifest URLs that escape the canonical content-addressed object format',async t=>{
 const f=await fixture(t),manifest=descriptor(f.newBytes);
 manifest.assets.canonicalCountryPacket.url='../../scripts/protected.mjs';
 const bytes=JSON.stringify(manifest)+'\n';f.put(f.stageFile(manifestPath),bytes);
 f.publication.after[manifestPath]=digest(bytes);f.inject('scripts/protected.mjs','injected source');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_WORLD_ASSET_PATH|P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 does not use an unselected staged manifest to authorize a selected family output',async t=>{
 const f=await fixture(t);f.publication.families=['unselected'];f.savePublication();
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_UNEXPECTED_GENERATED_FILE/);f.unchanged();
});

test('P2 retains local and remote branch movement guards with dynamic output paths',async t=>{
 const f=await fixture(t);
 assert.throws(()=>publishArtifacts(f.root,{...f.options,guard:()=>{throw Error('P2_REMOTE_BRANCH_CHANGED');}}),/P2_REMOTE_BRANCH_CHANGED/);
 f.unchanged();f.git('commit','--allow-empty','-qm','source moved');
 assert.throws(()=>publishArtifacts(f.root,f.options),/P2_LOCAL_SOURCE_CHANGED/);f.unchanged();
});

test('P2 rolls back new objects and the replaced manifest after a late write failure',async t=>{
 const f=await fixture(t);let checks=0;
 assert.throws(()=>publishArtifacts(f.root,{...f.options,guard:()=>{if(++checks===2)throw Error('late branch movement');}}),/late branch movement/);
 f.unchanged();assert.equal(existsSync(join(f.root,f.stageDir,'publish-journal.json')),false);
 publishArtifacts(f.root,f.options);assert.deepEqual(f.get(f.newPath),f.newBytes);
});
