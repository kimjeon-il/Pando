import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import test from 'node:test';
import {buildFrontendIndex,emitFrontendModule,frontendSourceClosure} from "../../../scripts/lib/frontend-layout.mjs";

test('domain sources keep stable public module and Worker URLs across ownership boundaries',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-domain-layout-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,text)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 put('src/app/viewer.js',"import '../ui/preferences.js'; const worker=new URL('../rendering/workers/canvas.js',import.meta.url);");
 put('src/ui/preferences.js','export const preference=1;');
 put('src/rendering/workers/canvas.js','export const frame=1;');
 const index=buildFrontendIndex(root);
 assert.equal(index.get('assets/js/modules/preferences.js')?.sourcePath,'src/ui/preferences.js');
 const output=emitFrontendModule("import '../ui/preferences.js'; const worker=new URL('../rendering/workers/canvas.js',import.meta.url);",'src/app/viewer.js',index);
 assert.match(output,/\.\/modules\/preferences\.js/);
 assert.match(output,/\.\/workers\/canvas\.js/);
 assert.deepEqual(frontendSourceClosure(root,['assets/js/viewer.js'],{index}).map(x=>x.publicPath),[
  'assets/js/modules/preferences.js','assets/js/viewer.js','assets/js/workers/canvas.js']);
});
