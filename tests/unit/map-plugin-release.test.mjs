import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {planPrivateRelease,recordPrivateUpload,verifyPrivateRelease,nextReleaseVersion,assertPushedRevision,assertReleaseAncestor,verifyReleaseArchive,runVerifiedCommands,releaseInputPaths} from '../../tools/reference-analysis/release-private-plugin.mjs';
import {frontendWasmRoot} from '../../scripts/lib/frontend-layout.mjs';
import {fileURLToPath} from 'node:url';
import {privatePluginFingerprint} from '../../tools/reference-analysis/package-private-plugin.mjs';
import {archiveDirectory} from '../../tools/reference-analysis/runtime-assets.mjs';

const sha='a'.repeat(64),revision='b'.repeat(40);
const candidate={codeRevision:revision,contentSha256:sha,dataRevision:'c'.repeat(40),modelSha256:'d'.repeat(64),version:'0.6.0',files:[{path:'plugin.json',bytes:2,sha256:sha},{path:'skills/pando-map-analysis/lib/new.mjs',bytes:3,sha256:sha}]};
const plugin={plugin_id:'plugins_fixture',name:'map-toolkit',scope:'USER',discoverability:'PRIVATE',version:'0.6.0',current_release_id:'pluginrel_before'};
const remote={plugin,complete:true,files:[{path:'plugin.json'},{path:'.codex-plugin/plugin.json'},{path:'skills/pando-map-analysis/lib/old.mjs'},{path:'unrelated.txt'}],contents:{'plugin.json':'{}'}};
const checks={schema:'map-toolkit-verification',codeRevision:revision,contentSha256:sha,checks:[{command:'node',args:['--test','focused.mjs'],exitCode:0}]};
const target={pluginId:plugin.plugin_id};

test('release requires successful matching verification and the original private personal identity',()=>{
  for(const verification of [null,{...checks,codeRevision:'e'.repeat(40)},{...checks,contentSha256:'e'.repeat(64)},{...checks,checks:[]},{...checks,checks:[{exitCode:1}]}])
    assert.throws(()=>planPrivateRelease({target,remote,candidate,verification}),/verification|checks/i);
  for(const patch of [{plugin_id:'plugins_other'},{scope:'WORKSPACE'},{discoverability:'LISTED'}])
    assert.throws(()=>planPrivateRelease({target,remote:{...remote,plugin:{...plugin,...patch}},candidate,verification:checks}),/identity|private/i);
  assert.throws(()=>planPrivateRelease({target,remote:{...remote,complete:false},candidate,verification:checks}),/inventory/i);
});

test('release chooses a higher patch and deletes only retired owned paths',()=>{
  const plan=planPrivateRelease({target,remote,candidate,verification:checks});
  assert.equal(plan.version,'0.6.1');
  assert.equal(plan.expectedReleaseId,plugin.current_release_id);
  assert.deepEqual(plan.deletePaths,['skills/pando-map-analysis/lib/old.mjs']);
  assert.equal(nextReleaseVersion('0.6.2','0.6.0'),'0.6.2');
  assert.throws(()=>nextReleaseVersion('invalid','0.6.0'),/version/i);
});

test('unchanged content skips upload even when an unrelated commit changes the source SHA',()=>{
  const previous={...candidate,codeRevision:'f'.repeat(40)};
  const current={...remote,contents:{'release.json':JSON.stringify(previous)}};
  assert.equal(planPrivateRelease({target,remote:current,candidate,verification:checks}).status,'verification-required');
  const plan=planPrivateRelease({target:{...target,verifiedRelease:{releaseId:plugin.current_release_id,contentSha256:sha}},remote:current,candidate,verification:checks});
  assert.equal(plan.status,'unchanged');
  assert.equal(planPrivateRelease({target:{...target,verifiedRelease:{releaseId:plugin.current_release_id,contentSha256:'e'.repeat(64)}},remote:current,candidate,verification:checks}).status,'prepared');
});

test('readback requires the uploaded release, manifests, receipt and actual removal',()=>{
  const prepared=planPrivateRelease({target,remote,candidate,verification:checks});
  const manifests={'plugin.json':{name:'map-toolkit',version:prepared.version,skills:'./skills'},'.codex-plugin/plugin.json':{name:'map-toolkit',version:prepared.version,skills:'./skills'}};
  const plan=recordPrivateUpload({plan:{...prepared,manifests},response:{...plugin,status:'updated',version:prepared.version,current_release_id:'pluginrel_after'}});
  const receipt={...candidate,version:plan.version,verificationSha256:plan.verificationSha256};
  const after={complete:true,plugin:{...plugin,version:plan.version,current_release_id:'pluginrel_after'},files:candidate.files,
    contents:{'plugin.json':JSON.stringify(manifests['plugin.json']),'.codex-plugin/plugin.json':JSON.stringify(manifests['.codex-plugin/plugin.json']),'release.json':JSON.stringify(receipt)}};
  assert.equal(verifyPrivateRelease({plan,remote:after}).releaseId,'pluginrel_after');
  assert.throws(()=>verifyPrivateRelease({plan,remote}),/release|version/i);
  assert.throws(()=>verifyPrivateRelease({plan,remote:{...after,files:[...after.files,{path:plan.deletePaths[0]}]}}),/retired/i);
  assert.throws(()=>verifyPrivateRelease({plan,remote:{...after,contents:{...after.contents,'release.json':JSON.stringify({...receipt,contentSha256:'f'.repeat(64)})}}}),/receipt/i);
  assert.throws(()=>verifyPrivateRelease({plan,remote:{...after,contents:{...after.contents,'plugin.json':JSON.stringify({name:'map-toolkit',version:plan.version})}}}),/manifest/i);
});

test('failed uploads leave the prepared candidate retryable; conflicts cannot be treated as success',()=>{
  const plan=planPrivateRelease({target,remote,candidate,verification:checks});
  for(const response of [{isError:true},{...plugin,status:'failed'},{...plugin,status:'updated',version:plan.version},{...plugin,status:'updated',version:plan.version,current_release_id:'new',plugin_id:'plugins_other'}])
    assert.throws(()=>recordPrivateUpload({plan,response}),/upload|identity|release/i);
  assert.equal(plan.status,'prepared');assert.equal(plan.expectedReleaseId,plugin.current_release_id);
});

test('publication refuses unpushed commits without requiring a real repository dataset',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-release-git-'));
  const run=promisify(execFile),git=(...args)=>run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:dir});
  try{
    await git('init','-q');await writeFile(join(dir,'one'),'original');await git('add','one');await git('commit','-qm','first');
    const first=(await git('rev-parse','HEAD')).stdout.trim();await git('update-ref','refs/remotes/origin/work/ui',first);
    await assertPushedRevision(dir,first);
    await assert.rejects(assertPushedRevision(dir,first,{branch:'work/gis'}));
    await git('update-ref','refs/remotes/origin/work/gis',first);
    await assertPushedRevision(dir,first,{branch:'work/gis'});
    await assertReleaseAncestor(dir,first,first);
    await assert.rejects(assertPushedRevision(dir,first,{branch:'main'}),/branch/i);
    await writeFile(join(dir,'one'),'new');await git('commit','-qam','unpublished');
    const second=(await git('rev-parse','HEAD')).stdout.trim();
    await assert.rejects(assertPushedRevision(dir,second));
    await assert.rejects(assertPushedRevision(dir,second,{branch:'work/gis'}));
    await assertReleaseAncestor(dir,first,second);
    await assert.rejects(assertReleaseAncestor(dir,second,first));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('content identity ignores revision/version stamps but detects runtime and paired data changes',()=>{
  const entries=[{path:'plugin.json',data:Buffer.from('{"name":"map-toolkit","version":"0.6.0"}')},
    {path:'skills/pando-map-analysis/runtime.json',data:Buffer.from(JSON.stringify({codeRevision:revision,dataRevision:'one',files:[]}))}];
  const same=entries.map(row=>({...row,data:Buffer.from(row.data.toString().replace('0.6.0','0.6.1').replace(revision,'e'.repeat(40)))}));
  assert.equal(privatePluginFingerprint(entries),privatePluginFingerprint(same));
  same[1].data=Buffer.from(same[1].data.toString().replace('one','two'));
  assert.notEqual(privatePluginFingerprint(entries),privatePluginFingerprint(same));
});

test('downloaded release bytes are checked without extracting another workspace',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-release-zip-'));
  try{
    const bytes=Buffer.from([1,2,3]);await writeFile(join(dir,'plugin.json'),'{}');await writeFile(join(dir,'core.wasm'),bytes);
    const {archive}=await archiveDirectory(dir);
    try{
      const plan={files:[{path:'core.wasm',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
      assert.deepEqual(await verifyReleaseArchive(plan,archive),{checkedFiles:1});
      await assert.rejects(verifyReleaseArchive({...plan,files:[{...plan.files[0],sha256:sha}]},archive),/hash mismatch/i);
    }finally{await rm(archive,{force:true});}
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('focused command failures and edits during verification cannot produce a passing receipt',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-release-checks-'));
  const run=promisify(execFile),git=(...args)=>run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:dir});
  try{
    await git('init','-q');await writeFile(join(dir,'input'),'original');await git('add','input');await git('commit','-qm','source');
    const revision=(await git('rev-parse','HEAD')).stdout.trim();
    const options={workspace:dir,revision,paths:['input']};
    const commands=code=>[{command:process.execPath,args:['-e',code],inputs:['input']}];
    assert.equal((await runVerifiedCommands({...options,commands:commands('console.log("passed")')}))[0].exitCode,0);
    await assert.rejects(runVerifiedCommands({...options,commands:commands('process.exit(2)')}));
    await assert.rejects(runVerifiedCommands({...options,commands:commands('require("fs").writeFileSync("input","changed")')}),/differ/i);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('verification binds the actual loaded WASM pair and policy as well as JavaScript source',async()=>{
  const paths=await releaseInputPaths(undefined,undefined,[]);
  for(const name of ['pandoeditor-core.js','pandoeditor-core.wasm','pandoeditor-core.manifest.json'])assert(paths.includes(frontendWasmRoot+'/'+name),name);
  assert(paths.includes('docs/historical-border-reconstruction-policy.md'));
});

test('the account tar.gz archive is verified without extracting a second workspace',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-release-tar-')),archive=dir+'.tar.gz';
  try{
    const bytes=Buffer.from([4,5,6]);await writeFile(join(dir,'plugin.json'),'{}');await writeFile(join(dir,'core.wasm'),bytes);
    await promisify(execFile)('tar',['-czf',archive,'-C',dir,'plugin.json','core.wasm']);
    const file={path:'core.wasm',bytes:3,sha256:createHash('sha256').update(bytes).digest('hex')};
    const plan={files:[file],archiveFiles:[{path:'core.wasm',size_bytes:3}]};
    assert.deepEqual(await verifyReleaseArchive(plan,archive),{checkedFiles:1});
    await assert.rejects(verifyReleaseArchive({...plan,files:[{...file,sha256:sha}]},archive),/hash mismatch/i);
  }finally{await rm(archive,{force:true});await rm(dir,{recursive:true,force:true});}
});

test('a failed verify invocation cannot leave an older passing completion receipt active',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'map-release-failure-'));
  try{
    const output=join(dir,'verification.json'),commands=join(dir,'checks.json');
    await writeFile(output,JSON.stringify(checks));await writeFile(commands,'[]');
    const script=fileURLToPath(new URL('../../tools/reference-analysis/release-private-plugin.mjs',import.meta.url));
    await assert.rejects(promisify(execFile)(process.execPath,[script,'verify','--revision','invalid','--model','unused','--checks',commands,'--output',output]));
    const failed=JSON.parse(await readFile(output,'utf8'));assert.equal(failed.status,'failed');assert.equal(failed.checks[0].exitCode,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
