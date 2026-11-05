// P7: the Web Viewer is the only shipped runtime; retired editor/Windows files are absent.
import {readFileSync,existsSync} from 'node:fs';
import {posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFrontendIndex,frontendGeneratedOwners,frontendModuleReferences,frontendRoots} from './lib/frontend-layout.mjs';
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
  'assets/js/modules/viewer-inspector-controller.js',
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
        // Generated frontend metadata has no checked-in module source.
        if(Object.hasOwn(frontendGeneratedOwners,path))continue;
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
mustContain('assets/js/modules/viewer-composition.js',/await import\('\.\/viewer-review-panel\.js'\)/,
  'Viewer review panel must remain a lazy dynamic import');
mustContain('assets/js/modules/viewer-inspector-controller.js',/readOnly!==true/,
  'Viewer inspector controller must fail closed for mutable document sessions');
mustContain('assets/js/modules/viewer-inspector-controller.js',/requestRevision/,
  'Inspector async opens must use one cancellation sequence');
mustContain('assets/js/modules/viewer-review-panel.js',/documentSession\.readOnly!==true/,
  'Review panel must independently enforce a read-only document');
if(/^import\s+[^\n]*from\s+['"]\.\/viewer-review-panel\.js['"]/m.test(source('assets/js/modules/viewer-composition.js')))
  fail('The review module must not be eagerly imported at Viewer boot');
mustContain('assets/js/modules/core-document-client.js',/policy\.assertOperation\(operation\)/,
  'Core document client must check the product policy');
for(const token of ['editPreviewController','editingRenderResources','getEditingRenderPacket','emitEditingInteraction','createEditingPresentation'])
  if(source('assets/js/modules/rendering-domain.js').includes(token))fail('Renderer retains retired editor hook: '+token);
mustContain('assets/js/modules/map-owner-composition.js',/if\s*\(\s*readOnly\s*!==\s*true\s*\|\|\s*editing\s*\)/,
  'Read-only map owner must reject editing hooks');
for(const token of ['boundaryEditLayer','previewLayer','vertexLayer','draftLayer','snapLayer'])
  if(source('assets/js/modules/map-workspace-host.js').includes(token))fail('Map host retains retired editing layer: '+token);
mustContain('assets/js/modules/rendering-domain.js',/createMapRenderCoordinator\(\{/,
  'RenderingDomain must own the canonical render coordinator');
for(const [asset,body] of sources)
  if(!['assets/js/modules/rendering-domain.js','assets/js/modules/map-render-coordinator.js'].includes(asset)
    &&/createMapRenderCoordinator\(\{/.test(body))
    fail('Duplicate render coordinator: '+asset);

// The retired shell and its staging graph are physically absent, not just unshipped.
if(existsSync(resolve(root,'apps/editor')))
  fail('Retired editor application root returned');
for(const asset of ['assets/js/viewer.js','assets/js/modules/viewer-composition.js',
  'assets/js/modules/viewer-inspector-controller.js'])
  if(/PANDOLAB_NATIVE_REVIEW|PANDOLAB_SHELL_VERIFICATION|nativeReview/.test(source(asset)))
    fail('Retired Windows review mode reentered Viewer: '+asset);
// Optional static baseline for the checked-out commit. No browser timings are inferred.
if (process.argv.includes('--baseline-json')) {
  const {execFileSync} = await import('node:child_process');
  const raw = execFileSync('git', ['ls-tree', '-r', '-l', '-z', 'HEAD'],
    {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  const prefixes = ['apps/viewer/', 'apps/editor/', 'shared/frontend/', 'shared/core/',
    'shared/wasm/', 'tools/', 'scripts/', 'tests/', '.github/workflows/'];
  const areas = new Map();
  let trackedFiles = 0, trackedBytes = 0;
  for (const item of raw.split('\0').filter(Boolean)) {
    const match = /^[0-7]{6} blob [0-9a-f]{40} +([0-9]+)\t(.+)$/u.exec(item);
    if (!match) throw new Error('Unsupported tracked tree entry');
    const bytes = Number(match[1]), path = match[2];
    const area = prefixes.find(prefix => path.startsWith(prefix))?.slice(0, -1) || 'other';
    const row = areas.get(area) || {files: 0, bytes: 0};
    row.files++; row.bytes += bytes; areas.set(area, row);
    trackedFiles++; trackedBytes += bytes;
  }
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  const dataPin = JSON.parse(read('config/library-data.json'));
  console.log(JSON.stringify({
    schema: 'pando-static-runtime-baseline-v1',
    sourceCommit: git(['rev-parse', 'HEAD']),
    externalDataRevision: dataPin.revision,
    trackedFiles, trackedBytes,
    areas: Object.fromEntries([...areas].sort(([a], [b]) => a.localeCompare(b))),
    indexedFrontendAssets: index.size,
    boundaryCheckedModules: visited.size,
    runtimeMetricsMeasured: false,
    note: 'Git-tree sizes and static Viewer boundary closure, not load/CPU/GPU/memory measurements',
  }, null, 2));
} else {
  console.log('Viewer runtime boundaries passed ('+visited.size+' reachable modules).');
}
