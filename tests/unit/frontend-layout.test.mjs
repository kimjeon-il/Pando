import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:fs";
import * as __dep3 from "node:os";
import * as __dep4 from "node:path";
import * as __dep5 from "../../scripts/lib/frontend-layout.mjs";
import * as __dep6 from "../../tools/data/worktree-storage.mjs";
import * as __dep7 from "../../.pnpmfile.mjs";
import * as __dep8 from "node:child_process";
import * as __dep9 from "../../tools/data/worktree-generated.mjs";

// Original feature contract: frontend-layout.test.mjs
contractSuite("frontend-layout", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync }=__dep2;
const { tmpdir }=__dep3;
const { join, dirname }=__dep4;
const { buildFrontendIndex, frontendAsset, emitFrontendModule, frontendSourceClosure }=__dep5;
function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-reviewer-layout-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,path,text='export const value=1;'){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;}
test('E6 permits Viewer/shared code but retires native shell and editor product from frontend graph',t=>{
 const root=fixture(t);
 put(root,'src/document/common.js');put(root,'src/app/viewer.js');
 put(root,'apps/editor/frontend/js/app.js');put(root,'apps/editor/frontend/js/modules/private.js');
 put(root,'apps/editor/startup.js');put(root,'assets/fonts/font.woff','font');
 const index=buildFrontendIndex(root);
 assert.deepEqual(index.get('assets/js/modules/common.js'),{
   sourcePath:'src/document/common.js',publicPath:'assets/js/modules/common.js',product:'viewer'});
 assert.equal(frontendAsset(root,'assets/js/viewer.js',{index}).sourcePath,'src/app/viewer.js');
 for(const forbidden of ['assets/js/app.js','assets/js/modules/private.js','shell/startup.js'])
   assert.throws(()=>frontendAsset(root,forbidden,{index}),/missing/i);
 assert.equal(frontendAsset(root,'assets/fonts/font.woff',{index}).bytes.toString(),'font');
 assert.throws(()=>frontendAsset(root,'assets/js/viewer.js',{index,product:'editor'}),/Viewer/i);
});
test('duplicate public ownership, private paths and junctions fail visibly',t=>{
 const root=fixture(t);put(root,'src/document/a.js');put(root,'src/app/a.js');
 assert.throws(()=>buildFrontendIndex(root),/duplicate/i);
 const other=fixture(t);put(other,'src/document/a.js');const index=buildFrontendIndex(other);
 for(const path of ['../AGENTS.md','assets/../../AGENTS.md','apps/editor/src-tauri/Cargo.toml','assets/js/missing.js'])
   assert.throws(()=>frontendAsset(other,path,{index}),/invalid|missing|private/i);
 const outside=fixture(t);put(outside,'private.js');symlinkSync(outside,join(other,'src/document/linked'),'junction');
 assert.throws(()=>buildFrontendIndex(other),/link|junction/i);
});
test('browser emission resolves physical shared imports to public module URLs',t=>{
 const root=fixture(t);put(root,'src/document/common.js');put(root,'src/app/viewer.js');
 const index=buildFrontendIndex(root);
 const source="import {value} from '../document/common.js';\n"
  +"export * from '../document/common.js';\n"
  +"const url=new URL('../document/common.js',import.meta.url);";
 const output=emitFrontendModule(source,'src/app/viewer.js',index);
 assert.equal((output.match(/\.\/modules\/common\.js/g)||[]).length,3);
 assert.throws(()=>emitFrontendModule("import '../../../tools/private.mjs';",
   'src/app/viewer.js',index),/private|unmapped/i);
});
test('shared and Viewer sources cannot import retired editor implementations',t=>{
 const root=fixture(t);put(root,'src/document/common.js');put(root,'src/app/viewer.js');
 put(root,'apps/editor/frontend/js/private.js');const index=buildFrontendIndex(root);
 assert.throws(()=>emitFrontendModule("import '../../editor/frontend/js/private.js';",
   'src/app/viewer.js',index),/private|unmapped/i);
 assert.throws(()=>emitFrontendModule("import '../../../apps/editor/frontend/js/private.js';",
   'src/document/common.js',index),/private|unmapped/i);
});
test('generated metadata resolves without a source placeholder',t=>{
 const root=fixture(t);put(root,'src/app/viewer.js');const index=buildFrontendIndex(root);
 assert.ok(emitFrontendModule("const meta=new URL('../../assets/js/build-meta.js',import.meta.url);",
   'src/app/viewer.js',index).includes('./build-meta.js'));
});
test('Viewer Worker URLs resolve without the native editor bridge',t=>{
 const root=fixture(t);put(root,'src/app/viewer.js');
 put(root,'src/rendering/workers/map-display-worker.js');
 const index=buildFrontendIndex(root);
 const output=emitFrontendModule("const worker=new URL('../rendering/workers/map-display-worker.js',import.meta.url);",
   'src/app/viewer.js',index);
 assert.ok(output.includes('./workers/map-display-worker.js'));
});
test('frontend source closure follows static imports and catalogued runtime edges',t=>{
 const root=fixture(t);put(root,'src/document/entry.js',"import './static.js';\nexport const entry=1;");
 put(root,'src/document/static.js','export const stat=1;');
 put(root,'src/document/runtime.js','export const runtime=1;');
 const closure=frontendSourceClosure(root,['assets/js/modules/entry.js'],{runtimeDependencies:{
   'assets/js/modules/entry.js':['src/document/runtime.js'],
 }});
 assert.deepEqual(closure.map(row=>row.publicPath),[
   'assets/js/modules/entry.js','assets/js/modules/runtime.js','assets/js/modules/static.js']);
});
test('runtime closure rejects private retired editor dependencies',t=>{
 const root=fixture(t);put(root,'src/document/common.js');
 put(root,'apps/editor/frontend/js/private.js');
 assert.throws(()=>frontendSourceClosure(root,['assets/js/modules/common.js'],{
   runtimeDependencies:{'assets/js/modules/common.js':['apps/editor/frontend/js/private.js']},
 }),/missing/i);
});
});

// Original feature contract: dependency-preparation.test.mjs
contractSuite("dependency-preparation", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { dependencyPreparationArguments }=__dep6;
test('dependency preparation uses graph sharing while preserving separate project links',()=>{
 const args=dependencyPreparationArguments({root:'D:/dev/worktrees/ui',store:'D:/build/cache/pandolab/pnpm/store'});
 assert.ok(args.includes('--config.enableGlobalVirtualStore=true'));assert.ok(args.includes('--store-dir=D:/build/cache/pandolab/pnpm/store'));assert.ok(args.includes('--frozen-lockfile'));assert.equal(args.includes('--ignore-workspace'),false);
});
});

// Original feature contract: dependency-store-hook.test.mjs
contractSuite("dependency-store-hook", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, rmSync }=__dep2;
const { tmpdir }=__dep3;
const { join }=__dep4;
const { preparedDependencyConfiguration }=__dep7;
test('ordinary pnpm commands retain the prepared local graph store and CI stays independent',t=>{const root=mkdtempSync(join(tmpdir(),'pando-deps-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'.library-data'));const store=join(root,'shared-store');writeFileSync(join(root,'.library-data/dependencies.json'),JSON.stringify({schema:'pando-dependency-store-v1',store}));const cfg=preparedDependencyConfiguration({storeDir:'wrong'},{root,ci:false});assert.equal(cfg.enableGlobalVirtualStore,true);assert.equal(cfg.storeDir,store);assert.deepEqual(preparedDependencyConfiguration({storeDir:'ci'},{root,ci:true}),{storeDir:'ci'});});
});

// Original feature contract: worktree-cleanup-protection.test.mjs
contractSuite("worktree-cleanup-protection", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, rmSync }=__dep2;
const { join }=__dep4;
const { tmpdir }=__dep3;
const { execFileSync }=__dep8;
const { protectedWorktreeFiles }=__dep6;
const { previewGeneratedCleanup }=__dep9;
test('cleanup protects every tracked and untracked source on a not-yet-migrated branch',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-source-protection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(p,text='protected')=>{mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),text);};
 execFileSync('git',['init',root],{stdio:'pipe'});put('index.html');put('apps/web-shell/src-tauri/src/lib.rs');put('.gitignore','node_modules/\n');
 execFileSync('git',['-C',root,'add','.'],{stdio:'pipe'});put('assets/worker-runtime/new-worker/source.js');put('node_modules/.pnpm/cache','reproducible');
 const protectedPaths=protectedWorktreeFiles([root]);
 for(const path of ['index.html','apps/web-shell/src-tauri/src/lib.rs','assets/worker-runtime/new-worker/source.js']){
  assert.throws(()=>previewGeneratedCleanup({roots:[root],protectedPaths,requests:[{root,path,action:'delete',reason:'obsolete output'}]}),/Protected source or WIP/);
 }
 assert.equal(previewGeneratedCleanup({roots:[root],protectedPaths,requests:[{root,path:'node_modules/.pnpm',action:'delete',reason:'replaced dependency store'}]}).entries.length,1);
});
});
