// Build-time source/dependency closure shared by production packaging and diagnostics.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile, lstat, open, unlink, realpath, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, join, sep, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
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
export async function archiveDirectory(directory,{archive=directory+'.zip',signal}={}) {
  directory=resolve(directory);archive=resolve(archive);
  if((await lstat(directory)).isSymbolicLink())throw Error('Archive input must not traverse links: '+directory);
  const realDirectory=await realpath(directory),realArchive=join(await realpath(dirname(archive)),basename(archive));
  const rel=relative(realDirectory,realArchive);
  if (!rel || (!rel.startsWith('..'+sep) && rel!=='..' && !isAbsolute(rel))) throw Error('ZIP destination must be outside its input directory');
  const paths=[];let inputBytes=0;
  async function collect(path,prefix='') {
    signal?.throwIfAborted();
    const info=await lstat(path);
    if(info.isSymbolicLink())throw Error('Archive input must not traverse links: '+path);
    if(info.isDirectory()) {
      for(const name of (await readdir(path)).sort())await collect(join(path,name),prefix?prefix+'/'+name:name);
    } else if(info.isFile()) {bundlePath(directory,prefix);inputBytes+=info.size;paths.push({path,name:prefix});}
    else throw Error('Archive input is not a regular file: '+path);
  }
  await collect(directory);
  if(inputBytes>=1024**3) {
    const disk=await statfs(dirname(archive));
    if(disk.bavail*disk.bsize<inputBytes+paths.length*65536+5*1024**3)throw Error('ZIP requires peak bytes plus 5 GiB headroom');
  }
  signal?.throwIfAborted();
  let output,created=false,success=false;
  try {
    output=await open(archive,'wx');created=true;
    const zip=new yazl.ZipFile(),hash=createHash('sha256');let bytes=0;
    zip.on('error',error=>zip.outputStream.destroy(error));
    const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;hash.update(chunk);callback(null,chunk);}});
    const writing=pipeline(zip.outputStream,meter,output.createWriteStream(),{signal});
    for(const row of paths)zip.addFile(row.path,row.name);
    zip.end();await writing;output=null;
    success=true;
    return {archive,archiveBytes:bytes,archiveSha256:hash.digest('hex')};
  } finally {
    if(output)await output.close();
    if(created&&!success)await unlink(archive).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
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
  const seeds=['package.json','pnpm-lock.yaml','config/library-data.json','assets/js/modules/temporal.js',
    'assets/js/modules/core-wasm-loader.js','assets/js/modules/source-provenance.js','assets/js/modules/version-contract.js',
    'assets/js/modules/place-worker-store.js','assets/js/modules/worker-rpc.js','assets/js/workers/worker-rpc-host.js',
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
export function nodeManifest(workspace=root,{diagnostics=false}={}) {
  const versions=new Map(),request=createRequire(join(workspace,'package.json'));
  const direct=['onnxruntime-web','tesseract.js',...(diagnostics?['yazl']:[])];
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
  for(const name of direct)visit(name,request);
  const original=JSON.parse(readFileSync(join(workspace,'package.json'))),dependencies={},overrides={};
  for(const [name,version]of [...versions].sort(([a],[b])=>a.localeCompare(b))) {
    if(direct.includes(name)) {assert.equal(original.dependencies?.[name]??original.devDependencies?.[name],version);dependencies[name]=version;}
    else overrides[name]=version;
  }
  return {name:'map-toolkit-runtime',private:true,type:'module',dependencies,overrides};
}
