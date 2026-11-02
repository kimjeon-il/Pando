import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildFrontendIndex,frontendAsset,emitFrontendModule,frontendSourceClosure} from '../../scripts/lib/frontend-layout.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-reviewer-layout-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,path,text='export const value=1;'){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;}
test('E6 permits Viewer/shared code but retires native shell and editor product from frontend graph',t=>{
 const root=fixture(t);
 put(root,'shared/frontend/js/modules/common.js');put(root,'apps/viewer/js/viewer.js');
 put(root,'apps/editor/frontend/js/app.js');put(root,'apps/editor/frontend/js/modules/private.js');
 put(root,'apps/editor/startup.js');put(root,'shared/frontend/static/fonts/font.woff','font');
 const index=buildFrontendIndex(root);
 assert.deepEqual(index.get('assets/js/modules/common.js'),{
   sourcePath:'shared/frontend/js/modules/common.js',publicPath:'assets/js/modules/common.js',product:'shared'});
 assert.equal(frontendAsset(root,'assets/js/viewer.js',{index}).sourcePath,'apps/viewer/js/viewer.js');
 for(const forbidden of ['assets/js/app.js','assets/js/modules/private.js','shell/startup.js'])
   assert.throws(()=>frontendAsset(root,forbidden,{index}),/missing/i);
 assert.equal(frontendAsset(root,'assets/fonts/font.woff',{index}).bytes.toString(),'font');
 assert.throws(()=>frontendAsset(root,'assets/js/viewer.js',{index,product:'editor'}),/Viewer/i);
});
test('duplicate public ownership, private paths and junctions fail visibly',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/a.js');put(root,'apps/viewer/js/a.js');
 assert.throws(()=>buildFrontendIndex(root),/duplicate/i);
 const other=fixture(t);put(other,'shared/frontend/js/a.js');const index=buildFrontendIndex(other);
 for(const path of ['../AGENTS.md','assets/../../AGENTS.md','apps/editor/src-tauri/Cargo.toml','assets/js/missing.js'])
   assert.throws(()=>frontendAsset(other,path,{index}),/invalid|missing|private/i);
 const outside=fixture(t);put(outside,'private.js');symlinkSync(outside,join(other,'shared/frontend/js/linked'),'junction');
 assert.throws(()=>buildFrontendIndex(other),/link|junction/i);
});
test('browser emission resolves physical shared imports to public module URLs',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/modules/common.js');put(root,'apps/viewer/js/viewer.js');
 const index=buildFrontendIndex(root);
 const source="import {value} from '../../../shared/frontend/js/modules/common.js';\n"
  +"export * from '../../../shared/frontend/js/modules/common.js';\n"
  +"const url=new URL('../../../shared/frontend/js/modules/common.js',import.meta.url);";
 const output=emitFrontendModule(source,'apps/viewer/js/viewer.js',index);
 assert.equal((output.match(/\.\/modules\/common\.js/g)||[]).length,3);
 assert.throws(()=>emitFrontendModule("import '../../../tools/private.mjs';",
   'apps/viewer/js/viewer.js',index),/private|unmapped/i);
});
test('shared and Viewer sources cannot import retired editor implementations',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/common.js');put(root,'apps/viewer/js/viewer.js');
 put(root,'apps/editor/frontend/js/private.js');const index=buildFrontendIndex(root);
 assert.throws(()=>emitFrontendModule("import '../../editor/frontend/js/private.js';",
   'apps/viewer/js/viewer.js',index),/private|unmapped/i);
 assert.throws(()=>emitFrontendModule("import '../../../apps/editor/frontend/js/private.js';",
   'shared/frontend/js/common.js',index),/private|unmapped/i);
});
test('generated metadata resolves without a source placeholder',t=>{
 const root=fixture(t);put(root,'apps/viewer/js/viewer.js');const index=buildFrontendIndex(root);
 assert.ok(emitFrontendModule("const meta=new URL('../../../assets/js/build-meta.js',import.meta.url);",
   'apps/viewer/js/viewer.js',index).includes('./build-meta.js'));
});
test('Viewer Worker URLs resolve without the native editor bridge',t=>{
 const root=fixture(t);put(root,'apps/viewer/js/viewer.js');
 put(root,'shared/frontend/js/workers/map-display-worker.js');
 const index=buildFrontendIndex(root);
 const output=emitFrontendModule("const worker=new URL('../../../shared/frontend/js/workers/map-display-worker.js',import.meta.url);",
   'apps/viewer/js/viewer.js',index);
 assert.ok(output.includes('./workers/map-display-worker.js'));
});
test('frontend source closure follows static imports and catalogued runtime edges',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/modules/entry.js',"import './static.js';\nexport const entry=1;");
 put(root,'shared/frontend/js/modules/static.js','export const stat=1;');
 put(root,'shared/frontend/js/modules/runtime.js','export const runtime=1;');
 const closure=frontendSourceClosure(root,['assets/js/modules/entry.js'],{runtimeDependencies:{
   'assets/js/modules/entry.js':['shared/frontend/js/modules/runtime.js'],
 }});
 assert.deepEqual(closure.map(row=>row.publicPath),[
   'assets/js/modules/entry.js','assets/js/modules/runtime.js','assets/js/modules/static.js']);
});
test('runtime closure rejects private retired editor dependencies',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/modules/common.js');
 put(root,'apps/editor/frontend/js/private.js');
 assert.throws(()=>frontendSourceClosure(root,['assets/js/modules/common.js'],{
   runtimeDependencies:{'assets/js/modules/common.js':['apps/editor/frontend/js/private.js']},
 }),/missing/i);
});
test('world fixture uses real dependency closure instead of ad-hoc copies',()=>{
 const source=readFileSync(new URL('../../apps/editor/tests/helpers/world-fixture.mjs',import.meta.url),'utf8');
 assert.match(source,/frontendSourceClosure/);assert.match(source,/runtimeDependencies/);
});
