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

test('archive decoders reject duplicate normalized names and links before building byte maps',async()=>{
  const {readPrivateReleaseArchive}=await import('../../tools/reference-analysis/release-private-plugin.mjs');
  assert.equal(typeof readPrivateReleaseArchive,'function','strict archive decoder must exist');
  const dir=await mkdtemp(join(tmpdir(),'map-release-structure-'));
  const run=promisify(execFile);
  try{
    await writeFile(join(dir,'plugin.json'),'{}');await writeFile(join(dir,'payload'),'original');
    const inventory=[{path:'plugin.json',size_bytes:2},{path:'payload',size_bytes:8}];
    const archive=join(dir,'duplicate.tar.gz');await run('tar',['-czf',archive,'-C',dir,'plugin.json','payload','payload']);
    await assert.rejects(readPrivateReleaseArchive(archive,inventory),{code:'ERR_ASSERTION',message:/Duplicate account archive path/});
    // Construct real USTAR link entries without requiring Windows symlink
    // privileges. The archive decoder must reject both link type flags.
    const {gzipSync}=await import('node:zlib');
    const member=(name,body,type='0',link='')=>{
      const header=Buffer.alloc(512),bytes=Buffer.from(body);
      header.write(name,0,100);header.write('0000644\0',100,8);
      header.write('0000000\0',108,8);header.write('0000000\0',116,8);
      header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);
      header.write('00000000000\0',136,12);header.fill(32,148,156);
      header.write(type,156,1);header.write(link,157,100);header.write('ustar\0',257,6);header.write('00',263,2);
      header.write([...header].reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8);
      return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512)]);
    };
    for(const [name,type]of [['symlink','2'],['hardlink','1']]){
      const archive=join(dir,name+'.tar.gz');
      await writeFile(archive,gzipSync(Buffer.concat([member('plugin.json','{}'),member('payload','original'),member(name,'',type,'payload'),Buffer.alloc(1024)])));
      await assert.rejects(readPrivateReleaseArchive(archive,[...inventory,{path:name,size_bytes:8}]),{code:'ERR_ASSERTION',message:/Archive entry must be a regular file or directory/});
    }
    const {ZipFile}=await import('yazl');
    for(const kind of ['duplicate','symlink','control']){
      const zip=new ZipFile(),archive=join(dir,kind+'.zip');zip.addBuffer(Buffer.from('{}'),'plugin.json');
      zip.addBuffer(Buffer.from('original'),'payload');
      if(kind==='duplicate')zip.addBuffer(Buffer.from('original'),'payload');
      if(kind==='symlink')zip.addBuffer(Buffer.from('payload'),'link',{mode:0o120777});
      if(kind==='control')zip.addBuffer(Buffer.from('x'),'bad\nname');
      const chunks=[];zip.outputStream.on('data',x=>chunks.push(x));const done=new Promise((resolve,reject)=>{zip.outputStream.on('end',resolve);zip.outputStream.on('error',reject);});zip.end();await done;await writeFile(archive,Buffer.concat(chunks));
      await assert.rejects(readPrivateReleaseArchive(archive,inventory),/duplicate|type|regular|path/i);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('legacy preservation retains every configuration field and literal escape except version',async()=>{
  const producer=await import('../../tools/reference-analysis/package-private-plugin.mjs');
  assert.equal(typeof producer.compatibilityManifest,'function','producer compatibility projection must be testable');
  const legacy={name:'map-toolkit',version:'0.6.9',description:'unchanged',interface:{defaultPrompt:['literal \\uc73c']},mcpServers:{bound:{id:'existing'}}};
  const outer={name:'map-toolkit',version:'0.6.10',description:'current',extensions:{'com.openai':{interface:{defaultPrompt:['actual 으']}}}};
  assert.deepEqual(producer.compatibilityManifest(legacy,outer,{preserve:true}),{...legacy,version:'0.6.10'});
  assert.equal(producer.compatibilityManifest(legacy,outer).description,'current');
});

test('baseline preparation requires both explicit archive path and exact release identity',async()=>{
  const {preparePrivateRelease}=await import('../../tools/reference-analysis/release-private-plugin.mjs');
  await assert.rejects(preparePrivateRelease({rebaselineArchive:'/unused'}),/supplied together/i);
  await assert.rejects(preparePrivateRelease({archiveReleaseId:'release_fixture'}),/supplied together/i);
});

test('tar members with offsetting size changes cannot fabricate the inventoried payloads',async()=>{
  const {readPrivateReleaseArchive}=await import('../../tools/reference-analysis/release-private-plugin.mjs');
  const dir=await mkdtemp(join(tmpdir(),'map-release-tar-size-')),archive=dir+'.tar.gz';
  try{
    await writeFile(join(dir,'plugin.json'),'{}o');await writeFile(join(dir,'payload'),'riginal');
    await promisify(execFile)('tar',['-czf',archive,'-C',dir,'plugin.json','payload']);
    await assert.rejects(readPrivateReleaseArchive(archive,[{path:'plugin.json',size_bytes:2},{path:'payload',size_bytes:8}]),{code:'ERR_ASSERTION',message:/member size/i});
  }finally{await rm(archive,{force:true});await rm(dir,{recursive:true,force:true});}
});

test('ZIP local header path and flags must agree with the central inventory',async()=>{
  const {readPrivateReleaseArchive}=await import('../../tools/reference-analysis/release-private-plugin.mjs');
  const dir=await mkdtemp(join(tmpdir(),'map-release-local-zip-'));
  try{
    await writeFile(join(dir,'plugin.json'),'{}');await writeFile(join(dir,'payload'),'original');const {archive}=await archiveDirectory(dir);
    try{
      const original=await readFile(archive),inventory=[{path:'plugin.json',size_bytes:2},{path:'payload',size_bytes:8}];
      let at=0;while(at<original.length){if(original.readUInt32LE(at)===0x04034b50&&original.toString('utf8',at+30,at+37)==='payload')break;at++;}
      assert(at<original.length-30,'payload local header exists');
      const path=Buffer.from(original);path.write('../evil',at+30);await writeFile(archive,path);await assert.rejects(readPrivateReleaseArchive(archive,inventory),/local.*name|local.*path/i);
      const flags=Buffer.from(original);flags.writeUInt16LE(flags.readUInt16LE(at+6)^1,at+6);await writeFile(archive,flags);await assert.rejects(readPrivateReleaseArchive(archive,inventory),/local.*flag|local.*header/i);
    }finally{await rm(archive,{force:true});}
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('pending plan cannot substitute saved upload identity, destination or metadata',async()=>{
  const {restorePreparedPlan}=await import('../../tools/reference-analysis/release-private-plugin.mjs');
  assert.equal(typeof restorePreparedPlan,'function','pending plan reconstruction gate must exist');
  const plan={pluginId:'plugins_fixture',expectedReleaseId:'release_before',codeRevision:revision,version:'0.6.10',contentSha256:sha,verificationSha256:'f'.repeat(64),deletePaths:[]};
  const current={plan,archive:'/tmp/fixed-candidate.zip',archiveBytes:7,archiveSha256:'e'.repeat(64),files:[{path:'plugin.json',bytes:2,sha256:sha}],manifests:{'plugin.json':{name:'map-toolkit',version:plan.version}}};
  const pending={...plan,...current,upload:{plugin_id:plan.pluginId,expected_release_id:plan.expectedReleaseId,archive:current.archive,delete_paths:[]}};delete pending.plan;
  assert.equal(restorePreparedPlan({...current,pending}).upload.expected_release_id,'release_before');
  for(const [key,value]of Object.entries({plugin_id:'other',expected_release_id:'stale',archive:'/tmp/other.zip',delete_paths:['plugin.json']})){
    assert.throws(()=>restorePreparedPlan({...current,pending:{...pending,upload:{...pending.upload,[key]:value}}}),/pending/i);
  }
  for(const [key,value]of Object.entries({pluginId:'other',version:'0.6.99',codeRevision:'9'.repeat(40),archiveBytes:99,archiveSha256:'9'.repeat(64),manifests:{},files:[]})){
    assert.throws(()=>restorePreparedPlan({...current,pending:{...pending,[key]:value}}),/pending/i);
  }
});
