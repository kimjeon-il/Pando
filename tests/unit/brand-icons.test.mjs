import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {buildFrontendIndex} from '../../scripts/lib/frontend-layout.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=path=>readFileSync(join(root,path));
const text=path=>bytes(path).toString('utf8');
const brand='shared/frontend/static/brand/';
const templates={
 'apps/viewer/templates/index.html':'<!doctype html><head><link rel="icon" href="data:,"></head><body>viewer</body>',
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

test('Viewer and Windows reviewer use the same canonical shared brand icons',()=>{
 for(const [mode,page] of Object.entries(pages())){
  assert.doesNotMatch(page,/href="data:,"/);
  assert.equal((page.match(/rel="icon"/g)||[]).length,2);
  assert.equal((page.match(/rel="apple-touch-icon"/g)||[]).length,1);
  assert.match(page,/assets\/brand\/favicon\.svg\?v=\{\{assetRevision\}\}/);
  assert.match(page,/assets\/brand\/favicon\.ico\?v=\{\{assetRevision\}\}/);
  assert.equal(mode,'web');assert.match(page,/<body>viewer<\/body>/);
 }
});

test('brand URLs resolve under the published Viewer and local Windows reviewer',()=>{
 const index=buildFrontendIndex(root),links=[...pages().web.matchAll(/href="(assets\/brand\/[^"?]+)[^"]*"/g)].map(m=>m[1]);
 assert.equal(links.length,3);
 for(const path of links){
  assert.equal(index.get(path)?.product,'shared',path);
  assert.equal(index.get(path)?.sourcePath,'shared/frontend/static/'+path.slice(7));
  assert.ok(bytes(index.get(path).sourcePath).length);
  // Browser Pages uses a subpath; Windows review uses the local packaged app origin.
  for(const [page,baseHref,prefix]of [['https://example.test/Pando/',null,'/Pando/'],['http://tauri.localhost/review.html',null,'/']]){
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
 for(const [path,sha]of Object.entries(approved)){
  const raw=bytes(path),content=/\.(?:svg|xml)$/.test(path)?Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n')):raw;
  assert.equal(createHash('sha256').update(content).digest('hex'),sha,path);
 }
});

test('favicon preserves the reviewed small form instead of auto-scaling the standard glyph',()=>{
 const favicon=text(brand+'favicon.svg');
 assert.match(favicon,/<rect\b[^>]*fill="#FFFFFF"/);
 assert.equal((favicon.match(/<path\b[^>]*fill="#315EDB"/g)||[]).length,2);
 assert.match(favicon,/M9 6 H18 V27 H24 V42/);assert.match(favicon,/M39 42 H30 V21 H24 V6/);
 assert.doesNotMatch(favicon,/<(?:script|image|filter)\b|href=/);
});
