import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {buildFrontendIndex} from '../../scripts/lib/frontend-layout.mjs';
import {syncAndroid} from '../../apps/editor/src-tauri/sync-android.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=path=>readFileSync(join(root,path));
const text=path=>bytes(path).toString('utf8');
const brand='shared/frontend/static/brand/';
const android='apps/editor/src-tauri/android/app/src/main/';
const templates={
 'apps/viewer/templates/index.html':'<!doctype html><head><link rel="icon" href="data:,"></head><body>viewer</body>',
 'apps/editor/templates/index.html':'<!doctype html><head><base href="../../" data-product-base="editor" /><link rel="icon" href="data:," /></head><body>editor</body>',
};
const pages=()=>renderProductHtml(path=>templates[path]??text(path));

function icoSizes(buffer){
 assert.equal(buffer.readUInt16LE(0),0);assert.equal(buffer.readUInt16LE(2),1);
 const count=buffer.readUInt16LE(4),sizes=[];
 for(let i=0;i<count;i++){
  const at=6+i*16,width=buffer[at]||256,height=buffer[at+1]||256;
  const length=buffer.readUInt32LE(at+8),offset=buffer.readUInt32LE(at+12);
  assert.equal(width,height);assert.ok(offset>=6+count*16&&offset+length<=buffer.length);
  const image=buffer.subarray(offset,offset+length);
  assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16),width);assert.equal(image.readUInt32BE(20),height);sizes.push(width);
 }
 return sizes.sort((a,b)=>a-b);
}

test('both product heads expand the shared icon source without touching body or base',()=>{
 for(const [mode,page] of Object.entries(pages())){
  assert.doesNotMatch(page,/href="data:,"/);
  assert.equal((page.match(/rel="icon"/g)||[]).length,2);
  assert.equal((page.match(/rel="apple-touch-icon"/g)||[]).length,1);
  assert.match(page,/assets\/brand\/favicon\.svg\?v=\{\{assetRevision\}\}/);
  assert.match(page,/assets\/brand\/favicon\.ico\?v=\{\{assetRevision\}\}/);
  assert.match(page,new RegExp(`<body>${mode==='web'?'viewer':'editor'}</body>`));
  if(mode==='editor')assert.match(page,/<base href="\.\.\/\.\.\/" data-product-base="editor"/);
 }
});

test('icon URLs stay in the shared closure and resolve below a Pages subpath and editor base',()=>{
 const index=buildFrontendIndex(root),links=[...pages().web.matchAll(/href="(assets\/brand\/[^"?]+)[^"]*"/g)].map(m=>m[1]);
 assert.equal(links.length,3);
 for(const path of links){
  assert.equal(index.get(path)?.product,'shared',path);
  assert.equal(index.get(path)?.sourcePath,'shared/frontend/static/'+path.slice(7));
  assert.ok(bytes(index.get(path).sourcePath).length);
  // Pages publishes the viewer below /Pando/. The private editor and native shell use root URLs.
  for(const [page,baseHref,prefix]of [['https://example.test/Pando/',null,'/Pando/'],['http://127.0.0.1:4175/__editor/index.html','../../','/'],['http://tauri.localhost/index.html','../../','/']]){
   const base=baseHref?new URL(baseHref,page):new URL(page);
   assert.equal(new URL(path,base).pathname,prefix+path);
  }
 }
 assert.doesNotMatch(text('shared/frontend/ui/fragments/brand-icons.html'),/rel="manifest"|https?:/);
});

test('Windows and favicon containers retain their reviewed optical-size PNG frames',()=>{
 assert.deepEqual(icoSizes(bytes('apps/editor/src-tauri/icons/icon.ico')),[16,24,32,48,64,128,256]);
 assert.deepEqual(icoSizes(bytes(brand+'favicon.ico')),[16,32,48]);
 const png=bytes('apps/editor/src-tauri/icons/icon.png');
 assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);assert.equal(png[25],6);
 const apple=bytes(brand+'apple-touch-icon.png');assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 const approved=JSON.parse(text('design/brand/asset-hashes.json'));
 for(const [path,sha]of Object.entries(approved))assert.equal(createHash('sha256').update(bytes(path)).digest('hex'),sha,path);
});

test('favicon preserves the reviewed small form instead of auto-scaling the standard glyph',()=>{
 const favicon=text(brand+'favicon.svg');
 assert.match(favicon,/fill="#315EDB"/);
 assert.match(favicon,/M9 6 H18 V27 H24 V42/);assert.match(favicon,/M39 42 H30 V21 H24 V6/);
 assert.doesNotMatch(favicon,/<(?:script|image|filter)\b|href=/);
});

test('Android manifest selects owned launcher names with legacy, adaptive and themed resources',()=>{
 const manifest=text(android+'AndroidManifest.xml');
 assert.match(manifest,/android:icon="@mipmap\/pando_launcher"/);
 assert.match(manifest,/android:roundIcon="@mipmap\/pando_launcher_round"/);
 for(const name of ['pando_launcher','pando_launcher_round']){
  assert.match(text(android+`res/mipmap-anydpi-v24/${name}.xml`),/<vector\b/);
  const adaptive=text(android+`res/mipmap-anydpi-v26/${name}.xml`);
  assert.match(adaptive,/<adaptive-icon\b/);assert.doesNotMatch(adaptive,/<monochrome\b/);
  assert.match(adaptive,/@color\/pando_icon_background/);assert.match(adaptive,/@drawable\/pando_icon_foreground/);
  assert.match(text(android+`res/mipmap-anydpi-v33/${name}.xml`),/<monochrome android:drawable="@drawable\/pando_icon_monochrome"/);
 }
 assert.match(text(android+'res/values/pando_brand.xml'),/#315EDB/);
 for(const name of ['foreground','monochrome']){
  const xml=text(android+`res/drawable/pando_icon_${name}.xml`);
  assert.match(xml,/android:viewportWidth="108"/);assert.match(xml,/android:translateX="22"/);
  assert.equal((xml.match(/<path\b/g)||[]).length,2);
 }
});

test('existing Android synchronizer regenerates icon sources, detects drift and repairs it',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'pando-brand-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeFileSync(join(directory,'settings.gradle'),'// isolated regeneration fixture\n');
 const first=await syncAndroid({directory});assert.ok(first.changed.some(p=>p.replaceAll('\\','/').includes('pando_launcher')));
 await syncAndroid({directory,check:true});
 const path='app/src/main/res/drawable/pando_icon_foreground.xml';
 assert.equal(readFileSync(join(directory,path),'utf8'),text(android+'res/drawable/pando_icon_foreground.xml'));
 writeFileSync(join(directory,path),'<invalid/>');
 await assert.rejects(syncAndroid({directory,check:true}),/out of sync/);
 await syncAndroid({directory});assert.deepEqual((await syncAndroid({directory,check:true})).changed,[]);
});
