// R1: only the shipped Viewer and Windows read-only reviewer are runtime contracts.
// The retired graphical-editor source tree is not a required application domain.
import {readFileSync} from 'node:fs';
import {posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFrontendIndex,frontendModuleReferences,frontendRoots} from './lib/frontend-layout.mjs';
import {isEditorOnlyAsset,runtimeDependencies} from './lib/product-assets.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const index=buildFrontendIndex(root);
const bySource=new Map([...index.values()].map(entry=>[entry.sourcePath,entry]));
const sources=new Map();
const fail=message=>{throw Error('Read-only runtime boundary: '+message);};
const read=path=>readFileSync(resolve(root,path),'utf8');
function source(asset){
  const entry=index.get(asset);
  if(!entry)fail('Missing deployed frontend module: '+asset);
  if(!sources.has(asset))sources.set(asset,read(entry.sourcePath));
  return sources.get(asset);
}
const required=[
  'assets/js/viewer.js',
  'assets/js/modules/viewer-composition.js',
  'assets/js/modules/viewer-review-panel.js',
  'assets/js/modules/core-document-client.js',
  'assets/js/modules/project-domain.js',
  'assets/js/modules/selection-domain.js',
  'assets/js/modules/rendering-domain.js',
  'assets/js/modules/map-owner-composition.js',
  'assets/js/modules/map-workspace-host.js',
  'assets/js/modules/map-render-coordinator.js',
  'assets/js/modules/product-mode-policy.js',
  'assets/js/workers/core-viewer-session-worker.js',
];
for(const entry of frontendRoots)
  if(entry.product==='editor'||entry.sourcePath.startsWith('apps/editor/'))
    fail('Retired editor root reentered the product source index: '+entry.sourcePath);
for(const entry of index.values())
  if(entry.product!=='shared'&&entry.product!=='viewer')
    fail('Unexpected product owner: '+entry.sourcePath);
for(const asset of required)source(asset);

// Follow active import/Worker edges, including the lazily loaded Viewer composition.
// Archived editor HTML, modules, startup and tests are excluded from this check.
const visiting=new Set(),visited=new Set(),stack=[];
function visit(asset){
  if(visited.has(asset))return;
  if(visiting.has(asset))fail('Circular frontend imports: '+[...stack,asset].join(' -> '));
  const entry=index.get(asset);
  if(!entry)fail('Missing frontend asset: '+asset);
  if(entry.product==='editor'||isEditorOnlyAsset(asset))
    fail('Editor-only module reached from Viewer: '+asset);
  visiting.add(asset);stack.push(asset);
  if(/\.m?js$/.test(entry.sourcePath)){
    for(const reference of frontendModuleReferences(source(asset))){
      if(!reference.specifier.startsWith('.'))continue;
      const file=reference.specifier.split(/[?#]/,1)[0];
      if(!/\.m?js$/.test(file))continue;
      const path=posix.normalize(posix.join(posix.dirname(entry.sourcePath),file));
      const target=bySource.get(path)||(reference.kind==='url'
        ?index.get(posix.normalize(posix.join(posix.dirname(asset),file))):null);
      if(!target){
        // Temporal's Node helper is substituted by the existing Web build owner.
        if(path==='tools/load-node-core.mjs'&&asset==='assets/js/modules/temporal.js')continue;
        fail('Unmapped active import: '+entry.sourcePath+' -> '+reference.specifier);
      }
      if(target.product!=='shared'&&target.product!==entry.product)
        fail('Cross-product import: '+entry.sourcePath+' -> '+target.sourcePath);
      visit(target.publicPath);
    }
  }
  for(const dependency of runtimeDependencies[asset]||[])
    if(index.has(dependency)&&/\.m?js$/.test(dependency))visit(dependency);
  stack.pop();visiting.delete(asset);visited.add(asset);
}
for(const asset of required)visit(asset);

const mustContain=(asset,expression,message)=>{
  if(!expression.test(source(asset)))fail(message);
};
for(const [name,factory] of [
  ['project-domain.js','createProjectDomain'],
  ['selection-domain.js','createSelectionDomain'],
  ['rendering-domain.js','createRenderingDomain'],
]){
  const asset='assets/js/modules/'+name;
  if(!new RegExp('export\\s+function\\s+'+factory+'\\b').test(source(asset)))
    fail('Missing canonical domain factory: '+name);
}
for(const name of ['project-domain.js','selection-domain.js','map-render-coordinator.js']){
  const body=source('assets/js/modules/'+name);
  for(const token of ['document.','querySelector(','getElementById('])
    if(body.includes(token))fail(name+' must stay DOM-free: '+token);
}
mustContain('assets/js/modules/viewer-composition.js',/createMapOwners\(\{productMode,readOnly:true,/,
  'Viewer must create read-only map owners');
mustContain('assets/js/modules/viewer-composition.js',/createDocumentSession\(\{productMode,readOnly:true,/,
  'Viewer must create a read-only document session');
mustContain('assets/js/modules/viewer-composition.js',/createProjectDomain\(\{productMode,readOnly:true,/,
  'Viewer must create a read-only project domain');
mustContain('assets/js/modules/product-mode-policy.js',/PL-PRODUCT-READONLY/,
  'Core product mode must reject mutation operations');
mustContain('assets/js/modules/core-document-client.js',/policy\.assertOperation\(operation\)/,
  'Core document client must check the product policy');
mustContain('assets/js/modules/rendering-domain.js',/if\s*\(\s*readOnly\s*&&\s*\(editPreviewController/,
  'Read-only renderer must reject edit/preview hooks');
mustContain('assets/js/modules/map-owner-composition.js',/if\s*\(\s*readOnly\s*&&\s*editing\s*\)/,
  'Read-only map owner must reject editing hooks');
mustContain('assets/js/modules/map-workspace-host.js',/const editOverlays=productMode==='editor'&&!readOnly/,
  'Read-only map host must exclude editable overlays');
mustContain('assets/js/modules/rendering-domain.js',/createMapRenderCoordinator\(\{/,
  'RenderingDomain must own the canonical render coordinator');
for(const [asset,body] of sources)
  if(asset!=='assets/js/modules/rendering-domain.js'&&/createMapRenderCoordinator\(\{/.test(body))
    fail('Duplicate render coordinator: '+asset);

// Windows retains only reviewed diagnostic and user-selected correction writes.
const rust=read('apps/editor/src-tauri/src/lib.rs');
const handler=rust.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];
if(!handler||!handler.includes('review_correction::save_review_correction')
  ||!handler.includes('write_diagnostic_report'))
  fail('Windows review command handler is missing');
if(/\b(?:begin_document_write|append_document_chunk|finish_document_write|begin_document_read|read_document_chunk|abort_document_transfer|save_project|commit_import)\b/.test(handler))
  fail('Retired editor write command is registered in the Windows reviewer');
if(!rust.includes('let entry = "review.html";'))
  fail('Windows shell must start at review.html');
const capability=JSON.parse(read('apps/editor/src-tauri/capabilities/prototype-review.json'));
const allowed=['allow-save-review-correction','allow-write-diagnostic-report'];
if(JSON.stringify([...capability.permissions].sort())!==JSON.stringify(allowed))
  fail('Windows reviewer capability exceeds allowed writes');

console.log('Viewer/Windows runtime boundaries passed ('+visited.size+' reachable modules).');
