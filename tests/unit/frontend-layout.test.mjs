import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildFrontendIndex,frontendAsset,emitFrontendModule} from '../../scripts/lib/frontend-layout.mjs';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-frontend-layout-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,path,text='export const value=1;'){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;}

test('product source ownership and public URLs are separate identities',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/modules/common.js');put(root,'apps/viewer/js/viewer.js');put(root,'apps/editor/frontend/js/app.js');put(root,'shared/frontend/static/fonts/font.woff','font');
 const index=buildFrontendIndex(root);
 assert.deepEqual(index.get('assets/js/modules/common.js'),{sourcePath:'shared/frontend/js/modules/common.js',publicPath:'assets/js/modules/common.js',product:'shared'});
 assert.equal(frontendAsset(root,'assets/js/viewer.js',{index,product:'viewer'}).sourcePath,'apps/viewer/js/viewer.js');
 assert.throws(()=>frontendAsset(root,'assets/js/app.js',{index,product:'viewer'}),/editor|product/i);
 assert.equal(frontendAsset(root,'assets/fonts/font.woff',{index}).bytes.toString(),'font');
});

test('duplicate public ownership, private paths and source junctions fail visibly',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/a.js');put(root,'apps/viewer/js/a.js');
 assert.throws(()=>buildFrontendIndex(root),/duplicate/i);
 const other=fixture(t);put(other,'shared/frontend/js/a.js');const index=buildFrontendIndex(other);
 for(const path of ['../AGENTS.md','assets/../../AGENTS.md','apps/editor/src-tauri/Cargo.toml','assets/js/missing.js'])assert.throws(()=>frontendAsset(other,path,{index}),/invalid|missing|private/i);
 const outside=fixture(t);put(outside,'private.js');symlinkSync(outside,join(other,'shared/frontend/js/linked'),'junction');
 assert.throws(()=>buildFrontendIndex(other),/link|junction/i);
});

test('browser emission resolves physical cross-product imports back to public identities',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/modules/common.js');put(root,'apps/viewer/js/viewer.js');
 const index=buildFrontendIndex(root),source=`import {value} from '../../../shared/frontend/js/modules/common.js';\nexport * from '../../../shared/frontend/js/modules/common.js';\nconst lazy=import(\`../../../shared/frontend/js/modules/common.js?v=\${revision}\`);\nconst url=new URL('../../../shared/frontend/js/modules/common.js',import.meta.url);`;
 const emitted=emitFrontendModule(source,'apps/viewer/js/viewer.js',index);
 assert.equal((emitted.match(/\.\/modules\/common\.js/g)||[]).length,4);
 assert.ok(emitted.includes('?v=${revision}'));
 assert.throws(()=>emitFrontendModule(`import '../../../tools/private.mjs';`,'apps/viewer/js/viewer.js',index),/private|unmapped/i);
});

test('native bridge modules retain shell URLs without leaking into viewer',t=>{
 const root=fixture(t);put(root,'apps/editor/native-storage.js');
 const index=buildFrontendIndex(root);
 assert.equal(index.get('shell/native-storage.js').product,'editor');
 assert.throws(()=>frontendAsset(root,'shell/native-storage.js',{index,product:'viewer'}),/editor|product/i);
});

test('shared and viewer code cannot acquire an editor implementation through an import',t=>{
 const root=fixture(t);put(root,'shared/frontend/js/common.js');put(root,'apps/viewer/js/viewer.js');put(root,'apps/editor/frontend/js/private.js');
 const index=buildFrontendIndex(root);
 assert.throws(()=>emitFrontendModule(`import '../../editor/frontend/js/private.js';`,'apps/viewer/js/viewer.js',index),/product|ownership/i);
 assert.throws(()=>emitFrontendModule(`import '../../../apps/editor/frontend/js/private.js';`,'shared/frontend/js/common.js',index),/product|ownership/i);
});
