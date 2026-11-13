import { describe as contractSuite } from 'node:test';
import * as __library_dep0 from "node:test";
import * as __library_dep1 from "node:assert/strict";
import * as __library_dep2 from "node:fs/promises";
import * as __library_dep3 from "node:os";
import * as __library_dep4 from "node:path";
import * as __library_dep5 from "../../../tools/data/shared-toolkit.mjs";
import * as __library_dep6 from "node:fs";
import * as __library_dep7_context from "../../../tools/data/library-context.mjs";
import * as __library_dep7_reports from "../../../tools/data/library-reports.mjs";
import * as __library_dep7_runtime from "../../../tools/data/library-runtime.mjs";
import * as __library_dep7_publication from "../../../tools/data/library-report-publication.mjs";
import * as __library_dep7_store from "../../../tools/data/library-store.mjs";
const __library_dep7={...__library_dep7_context,...__library_dep7_reports,...__library_dep7_runtime,...__library_dep7_publication,...__library_dep7_store};

// Original feature contract: shared-toolkit.test.mjs
contractSuite("shared-toolkit", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { mkdtemp, readFile, writeFile, rm } = __library_dep2;
const { tmpdir } = __library_dep3;
const { join } = __library_dep4;
const { encodeSharedToolkit, installSharedToolkit, verifySharedToolkit, retireSharedToolkit } = __library_dep5;

const source={repository:'kimjeon-il/Pando',revision:'a'.repeat(40)};
test('shared tooling installs a pinned immutable dependency and reuses verified bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-shared-'));
  try {
    const artifact=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('export const value=42;\n')}]});
    const first=await installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin});
    assert.equal(first.cacheHit,false);
    assert.equal((await installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin})).cacheHit,true);
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'export const value=42;\n');
    await verifySharedToolkit(root,artifact.pin);
    await writeFile(join(root,'tools/example.mjs'),'changed');
    await assert.rejects(verifySharedToolkit(root,artifact.pin),/hash|identity/i);
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin}),/hash|identity/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('explicit pinned retirement permits an upgrade and protects active leases and modified files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-upgrade-'));
  try{
    const a=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('old')}]});
    const b=encodeSharedToolkit({source:{...source,revision:'b'.repeat(40)},entries:[{path:'tools/example.mjs',data:Buffer.from('new')}]});
    await installSharedToolkit({root,bytes:a.bytes,pin:a.pin});
    await assert.rejects(installSharedToolkit({root,bytes:b.bytes,pin:b.pin}),/identity/);
    const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'.shared-toolkit-leases'));
    const lease=join(root,'.shared-toolkit-leases',process.pid+'-abc.json');
    await writeFile(lease,JSON.stringify({pid:process.pid}));
    await assert.rejects(retireSharedToolkit({root,pin:a.pin}),/in use/);
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'old');
    await rm(lease);await writeFile(join(root,'tools/example.mjs'),'user change');
    await assert.rejects(retireSharedToolkit({root,pin:a.pin}),/modified/);
    await writeFile(join(root,'tools/example.mjs'),'old');
    assert.equal((await retireSharedToolkit({root,pin:a.pin})).logicalBytes,3);
    await installSharedToolkit({root,bytes:b.bytes,pin:b.pin});
    assert.equal(await readFile(join(root,'tools/example.mjs'),'utf8'),'new');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('shared tooling rejects tampering, path escape, duplicates and unsupported contracts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'map-shared-'));
  try{
    const artifact=encodeSharedToolkit({source,entries:[{path:'tools/example.mjs',data:Buffer.from('ok')}]});
    await assert.rejects(installSharedToolkit({root,bytes:Buffer.from('bad'),pin:artifact.pin}),/hash|identity/i);
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:{...artifact.pin,interfaceVersion:2}}),/interface/i);
    for(const path of ['../escape','tools/../../escape','/absolute','tools\\escape','plugins/pando-map-tools/lib/jobs.mjs'])
      assert.throws(()=>encodeSharedToolkit({source,entries:[{path,data:Buffer.from('x')}]}),/path|ownership/i);
    assert.throws(()=>encodeSharedToolkit({source,entries:[{path:'tools/a',data:Buffer.from('x')},{path:'tools/a',data:Buffer.from('x')}]}),/duplicate/i);
    await writeFile(join(root,'.shared-toolkit.lock'),'active');
    await assert.rejects(installSharedToolkit({root,bytes:artifact.bytes,pin:artifact.pin}),/EEXIST|lock/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
});

// Original feature contract: library-toolkit-owner.test.mjs
contractSuite("library-toolkit-owner", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = __library_dep6;
const { join } = __library_dep4;
const { tmpdir } = __library_dep3;
const { libraryOwnerId } = __library_dep7;
test('independent toolkit explicitly owns its reports without borrowing Pando main ownership',()=>{
  const root=mkdtempSync(join(tmpdir(),'map-owner-'));
  try{
    mkdirSync(join(root,'config'));mkdirSync(join(root,'.git'));
    writeFileSync(join(root,'config/library-data.json'),JSON.stringify({reportOwner:'map-toolkit'}));
    assert.equal(libraryOwnerId(root),'map-toolkit');
    writeFileSync(join(root,'config/library-data.json'),JSON.stringify({reportOwner:'../ui'}));
    assert.throws(()=>libraryOwnerId(root),/owner/i);
  }finally{rmSync(root,{recursive:true,force:true});}
});
});

__library_dep0.default('storage SDK upgrades retain immutable computation and use current source paths',async t=>{
 const fs=await import('node:fs/promises'),{execFileSync}=await import('node:child_process'),{packageSharedToolkit}=await import('../../../tools/build/package-shared-toolkit.mjs');
 const assert=__library_dep1.default,{join}=__library_dep4,{tmpdir}=__library_dep3;
 const base=await fs.mkdtemp(join(tmpdir(),'pando-storage-sdk-')),root=join(base,'source'),dependency=join(base,'dependency'),installed=join(base,'installed');
 t.after(()=>fs.rm(base,{recursive:true,force:true}));await fs.mkdir(root);
 const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 for(const [path,bytes]of Object.entries({'tools/data/shared-toolkit.mjs':'export const codec=true;','tools/data/report-paths.mjs':'export const reports=true;','tools/data/library-context.mjs':'export const context=true;','tools/data/library-runtime.mjs':"import '../../src/data/current.js';export const runtime=true;",'tools/data/library-content.mjs':'export const content=true;','src/data/current.js':'export const current=true;'})){
  await fs.mkdir(join(root,path,'..'),{recursive:true});await fs.writeFile(join(root,path),bytes);
 }
 git('add','.');git('commit','-qm','source');const revision=git('rev-parse','HEAD');
 const prior=__library_dep5.encodeSharedToolkit({source:{repository:'kimjeon-il/Pando',revision:'a'.repeat(40)},entries:[{path:'build-native/map-image/opaque.bin',data:Buffer.from([0,1,2,255])},{path:'tools/library-content.mjs',data:'export const old=true;'},{path:'tools/library-data.mjs',data:'export const retired=true;'},{path:'tools/native-tool.mjs',data:"import './library-content.mjs';export const native=true;"}]});
 await __library_dep5.installSharedToolkit({root:dependency,bytes:prior.bytes,pin:prior.pin});
 const next=await packageSharedToolkit({root,revision,baseDependency:{root:dependency,pin:prior.pin}});
 assert.equal(next.pin.source.revision,revision);assert.equal(next.pin.source.compute.artifactSha256,prior.pin.sha256);
 await __library_dep5.installSharedToolkit({root:installed,bytes:next.bytes,pin:next.pin});
 assert.deepEqual(await fs.readFile(join(installed,'build-native/map-image/opaque.bin')),Buffer.from([0,1,2,255]));
 assert.equal(__library_dep6.existsSync(join(installed,'tools/library-data.mjs')),false);
 assert.match(await fs.readFile(join(installed,'tools/native-tool.mjs'),'utf8'),/data\/library-content/);
 assert.equal(await fs.readFile(join(installed,'src/data/current.js'),'utf8'),'export const current=true;');
 await fs.writeFile(join(root,'tools/data/library-runtime.mjs'),"import '../../src/data/current.js';export const runtime='next';");git('add','.');git('commit','-qm','next storage');
 const again=await packageSharedToolkit({root,revision:git('rev-parse','HEAD'),baseDependency:{root:installed,pin:next.pin}});
 const final=join(base,'final');await __library_dep5.installSharedToolkit({root:final,bytes:again.bytes,pin:again.pin});
 assert.match(await fs.readFile(join(final,'tools/data/library-runtime.mjs'),'utf8'),/runtime='next'/);
 assert.equal(again.pin.source.compute.artifactSha256,prior.pin.sha256);
});

__library_dep0.default('SDK retirement reuses byte-identical replacement files',async t=>{
 const fs=__library_dep2,{join}=__library_dep4,assert=__library_dep1.default,source={repository:'kimjeon-il/Pando',revision:'a'.repeat(40)};
 const root=await fs.mkdtemp(join(__library_dep3.tmpdir(),'pando-sdk-reuse-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const unchanged={path:'build-native/map-image/opaque.bin',data:Buffer.from([0,1,2,255])};
 const a=__library_dep5.encodeSharedToolkit({source,entries:[unchanged,{path:'tools/old.mjs',data:'old'}]});
 const b=__library_dep5.encodeSharedToolkit({source:{...source,revision:'b'.repeat(40)},entries:[unchanged,{path:'src/data/current.js',data:'new'}]});
 await __library_dep5.installSharedToolkit({root,bytes:a.bytes,pin:a.pin});const before=await fs.stat(join(root,unchanged.path));
 await __library_dep5.retireSharedToolkit({root,pin:a.pin,replacement:b});
 assert.deepEqual(await fs.readFile(join(root,unchanged.path)),unchanged.data);assert.equal(__library_dep6.existsSync(join(root,'tools/old.mjs')),false);
 await __library_dep5.installSharedToolkit({root,bytes:b.bytes,pin:b.pin});assert.equal((await fs.stat(join(root,unchanged.path))).ino,before.ino);
});
