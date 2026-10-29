// Build-time source/dependency closure shared by production packaging and diagnostics.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bundlePath, regularResourcePath } from '../../plugins/pando-map-tools/lib/runtime.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const unix=path=>path.split(sep).join('/');
const git=promisify(execFile);
export async function writeArtifactFiles(directory,entries) {
  const seen=new Set();
  for(const row of entries) {
    bundlePath(directory,row.path);
    if(seen.has(row.path))throw Error('Duplicate artifact path: '+row.path);seen.add(row.path);
  }
  await mkdir(directory); // Exclusive root: never merge into an old distribution.
  const files=[];
  for(const row of entries) {
    const target=bundlePath(directory,row.path),bytes=Buffer.from(row.data);
    await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
    files.push({path:row.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return files;
}
export async function archiveDirectory(directory,{python,archive=directory+'.zip'}) {
  await git(python,['-c',"import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'x',zipfile.ZIP_DEFLATED); [(z.write(p,p.relative_to(root).as_posix())) for p in sorted(root.rglob('*')) if p.is_file()]; z.close()",directory,archive],{windowsHide:true,maxBuffer:1024*1024});
  return {archive,archiveBytes:(await stat(archive)).size,archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex')};
}
export async function readPinnedSource(workspace,revision,path) {
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('A full commit revision is required');
  bundlePath(workspace,path);
  return (await git('git',['show',revision+':'+path],{cwd:workspace,encoding:null,maxBuffer:64*1024*1024})).stdout;
}
async function walk(directory,prefix,include=()=>true) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('Source symlink is not a regular source: '+join(directory,entry.name));
    if(['__pycache__','node_modules','.git'].includes(entry.name)||entry.name.endsWith('.pyc'))continue;
    const name=prefix+'/'+entry.name;
    if(entry.isDirectory())files.push(...await walk(join(directory,entry.name),name,include));
    else if(entry.isFile()&&include(name))files.push(name);
  }
  return files;
}
export async function collectSourceFiles(workspace=root,{diagnostics=false,revision}={}) {
  const seeds=['package.json','pnpm-lock.yaml','config/library-data.json','shared/frontend/js/modules/temporal.js',
    'shared/frontend/js/modules/core-wasm-loader.js','shared/frontend/js/modules/source-provenance.js','shared/frontend/js/modules/version-contract.js',
    'shared/frontend/js/modules/place-worker-store.js','shared/frontend/js/modules/worker-rpc.js','shared/frontend/js/workers/worker-rpc-host.js',
    'tools/load-node-core.mjs','tools/package-shared-core-assets.mjs','tools/library-archive.mjs'];
  if(diagnostics)seeds.push('tools/reference-analysis/verify-trained-onnx.mjs','tools/reference-analysis/cloud-probe.mjs');
  if(revision) {
    if(!/^[a-f0-9]{40}$/.test(revision))throw Error('A full commit revision is required');
    const tree=(await git('git',['ls-tree','-r','--format=%(objectmode) %(path)',revision,'--','plugins/pando-map-tools','shared'],{cwd:workspace,maxBuffer:4000000})).stdout;
    for(const row of tree.trim().split('\n')) {
      const [mode,...parts]=row.split(' '),path=parts.join(' ');
      if(mode==='120000')throw Error('Pinned source must not be a link: '+path);
      if(path.startsWith('plugins/pando-map-tools/')&&!path.includes('skills/pando-map-training/'))seeds.push(path);
      else if(/\.(cpp|h|hpp)(\.in)?$|\.cmake$/.test(path)||path.endsWith('/CMakeLists.txt'))seeds.push(path);
    }
  } else {
    seeds.push(...(await walk(join(workspace,'plugins/pando-map-tools'),'plugins/pando-map-tools')).filter(name=>!name.includes('skills/pando-map-training/')));
    seeds.push(...await walk(join(workspace,'shared'),'shared',name=>/\.(cpp|h|hpp)(\.in)?$|\.cmake$/.test(name)||name.endsWith('/CMakeLists.txt')));
  }
  const files=new Set();
  async function visit(name) {
    if(files.has(name))return;bundlePath(workspace,name);if(!revision)await regularResourcePath(workspace,name);files.add(name);
    if(!/\.[cm]?js$/.test(name))return;
    const source=revision?(await readPinnedSource(workspace,revision,name)).toString('utf8'):await readFile(join(workspace,name),'utf8');
    const imports=/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"]+)\1/g;
    for(const match of source.matchAll(imports))if(match[2].startsWith('.'))await visit(unix(relative(workspace,resolve(workspace,dirname(name),match[2]))));
  }
  for(const name of seeds)await visit(name);
  return [...files].sort();
}
export function nodeManifest(workspace=root) {
  const versions=new Map(),request=createRequire(join(workspace,'package.json'));
  function visit(name,req) {
    let directory;
    try {directory=dirname(req.resolve(name+'/package.json'));}
    catch {
      directory=dirname(req.resolve(name));
      while(!existsSync(join(directory,'package.json'))||JSON.parse(readFileSync(join(directory,'package.json'))).name!==name) {
        const parent=dirname(directory);if(parent===directory)throw Error('Cannot resolve package '+name);directory=parent;
      }
    }
    const manifest=JSON.parse(readFileSync(join(directory,'package.json')));
    if(versions.has(name)) {if(versions.get(name)!==manifest.version)throw Error('Conflicting dependency versions: '+name);return;}
    versions.set(name,manifest.version);
    const local=createRequire(join(directory,'package.json'));
    for(const dependency of Object.keys(manifest.dependencies||{}))visit(dependency,local);
  }
  for(const name of ['onnxruntime-web','tesseract.js'])visit(name,request);
  const original=JSON.parse(readFileSync(join(workspace,'package.json'))),dependencies={},overrides={};
  for(const [name,version]of [...versions].sort(([a],[b])=>a.localeCompare(b))) {
    if(['onnxruntime-web','tesseract.js'].includes(name)) {assert.equal(original.dependencies?.[name]??original.devDependencies?.[name],version);dependencies[name]=version;}
    else overrides[name]=version;
  }
  return {name:'map-toolkit-runtime',private:true,type:'module',dependencies,overrides};
}
