#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {buildFrontendSnapshot} from '../scripts/lib/frontend-build.mjs';
import { prepareLibraryData } from './library-data.mjs';

const LIMIT_BYTES = 1_000_000_000;
const REQUIRED = [
  'index.html', '.nojekyll',
  'assets/data/terrain-preview/v0.13.3-p2/manifest.json',
  'assets/data/hydro/v0.13.2/manifest.json'
];
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const blobHash = bytes => hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
const within = (root, target) => {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function gitFiles(root) {
  const output = execFileSync('git', ['ls-tree', '-r', '-l', '-z', 'HEAD'], {
    cwd: root, maxBuffer: 16 * 1024 * 1024
  });
  return output.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/s.exec(row);
    if (!match) throw Error(`Unsupported Git tree entry: ${row.slice(0, 100)}`);
    return { mode: match[1], blob: match[2], bytes: Number(match[3]), path: match[4] };
  });
}

function committedBlob(root, file) {
  const bytes = execFileSync('git', ['cat-file', 'blob', file.blob], {
    cwd: root, maxBuffer: Math.max(file.bytes + 1024, 1024 * 1024)
  });
  if (bytes.length !== file.bytes || blobHash(bytes) !== file.blob) {
    throw Error(`Invalid committed Git blob: ${file.path}`);
  }
  return bytes;
}

function isEquivalentCrLfCheckout(working, committed) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const committedText = decoder.decode(committed);
    const workingText = decoder.decode(working);
    if (committedText.includes('\0') || !committedText.includes('\n')) return false;
    return workingText.replace(/\r\n/g, '\n') === committedText;
  } catch {
    return false;
  }
}

export async function stageWebPages(rootInput, stageInput, manifestInput, { skipChecks = false } = {}) {
  const root = resolve(rootInput), stage = resolve(stageInput), manifest = resolve(manifestInput);
  if (within(root, stage) || stage === root) throw Error('Pages stage must be outside the source repository');
  if (within(root, manifest) || manifest === root || within(stage, manifest)) throw Error('Pages evidence must be outside source and stage');
  if (existsSync(stage) || existsSync(manifest)) throw Error('Pages stage or evidence already exists');
  const all=gitFiles(root),byPath=new Map(all.map(file=>[file.path,file]));
  const readSourceBytes=path=>{
    const file=byPath.get(path);if(!file)throw Error('Uncommitted frontend source: '+path);
    const target=resolve(root,path);if(!within(root,target)||!lstatSync(target).isFile())throw Error('Invalid source file: '+path);
    const working=readFileSync(target);if(blobHash(working)===file.blob)return working;
    const committed=committedBlob(root,file);
    if(!working.equals(committed)&&!isEquivalentCrLfCheckout(working,committed))throw Error('Committed frontend source changed or mismatch: '+path);
    return committed;
  };
  // The generator and native-free staging recipe must also belong to HEAD.
  for(const file of all)if(/^(?:scripts\/|tools\/stage-monorepo-pages\.mjs$|tools\/library-(?:data|archive)\.mjs$|config\/library-data\.json$)/.test(file.path))readSourceBytes(file.path);
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const snapshot=await buildFrontendSnapshot({root,sourceCommit,readSourceBytes});
  if([...snapshot.viewerPaths].some(path=>path.endsWith('/assets/js/workers/core-viewer-session-worker.js')))for(const name of ['pandoeditor-core.js','pandoeditor-core.wasm','pandoeditor-core.manifest.json']){const path='assets/wasm/'+name;if(!snapshot.assets.has(path))throw Error('Missing protected Web URL: '+path);snapshot.viewerPaths.add(path);}
  const library=prepareLibraryData({root}),payload=new Map(),files=[];
  for(const path of snapshot.viewerPaths){
    const generated=snapshot.assets.get(path);let bytes,sourcePath=null;
    if(generated){bytes=generated.bytes;sourcePath=generated.sourcePath;}
    else{const spec=library.files[path];if(!path.startsWith('assets/data/')||!spec)throw Error('Missing protected Web URL: '+path);bytes=readFileSync(resolve(library.materialized,path));if(bytes.length!==spec.bytes||hash('sha256',bytes)!==spec.sha256)throw Error('Pinned library transfer mismatch: '+path);}
    payload.set(path,bytes);files.push({path,sourcePath,bytes:bytes.length,sha256:hash('sha256',bytes),generated:!sourcePath});
  }
  for(const path of REQUIRED)if(!payload.has(path))throw Error('Missing protected Web URL: '+path);
  const total=files.reduce((n,f)=>n+f.bytes,0);if(total>LIMIT_BYTES)throw Error('Pages site exceeds size limit: '+total);
  mkdirSync(stage,{recursive:true});
  for(const file of files){const output=resolve(stage,file.path);if(!within(stage,output))throw Error('Invalid Pages output');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,payload.get(file.path));if(hash('sha256',readFileSync(output))!==file.sha256)throw Error('Staged copy mismatch');}
  const evidence={schema:'pando-web-pages-staging',productMode:'viewer',sourceCommit,frontendInputSha256:snapshot.sourceSha256,metadataCheck:skipChecks?'skipped':'passed',fileCount:files.length,dataRepository:library.repository,dataCommit:library.revision,bytes:total,limitBytes:LIMIT_BYTES,excludedNativeFiles:all.filter(f=>f.path.startsWith('native/')).length,excludedSharedFiles:all.filter(f=>f.path.startsWith('shared/')).length,excludedAppFiles:all.filter(f=>f.path.startsWith('apps/')).length,files};
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

// Publication may replace the baseline pointer and add immutable releases.
// Record the actual final artifact rather than the pre-overlay file list.
export function finalizeWebPages(stageInput, manifestInput) {
  const stage = resolve(stageInput), manifest = resolve(manifestInput);
  if (within(stage, manifest) || stage === manifest) throw Error('Pages evidence must be outside stage');
  const evidence = JSON.parse(readFileSync(manifest, 'utf8'));
  if (evidence.schema !== 'pando-web-pages-staging') throw Error('Invalid Pages staging evidence');
  const previous = new Map(evidence.files.map(file => [file.path, file]));
  const files = [];
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix + name, absolute = resolve(directory, name), stat = lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, path + '/');
      else {
        if (!stat.isFile()) throw Error(`Invalid Pages artifact file: ${path}`);
        const bytes = readFileSync(absolute), sha256 = hash('sha256', bytes), old = previous.get(path);
        files.push(old?.sha256 === sha256 ? old : { path, blob: null, bytes: bytes.length, sha256 });
      }
    }
  }
  visit(stage);
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  if (bytes > LIMIT_BYTES) throw Error(`Pages site exceeds ${LIMIT_BYTES} bytes: ${bytes}`);
  const final = { ...evidence, files, bytes, fileCount: files.length };
  writeFileSync(manifest, JSON.stringify(final, null, 2) + '\n');
  return final;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
  if (!arg('--stage') || !arg('--manifest')) throw Error('Usage: stage-monorepo-pages.mjs --root ROOT --stage OUT --manifest EVIDENCE [--skip-checks]');
  const result = args.includes('--finalize')
    ? finalizeWebPages(arg('--stage'), arg('--manifest'))
    : await stageWebPages(arg('--root') || '.', arg('--stage'), arg('--manifest'), { skipChecks: args.includes('--skip-checks') });
  process.stdout.write(`${result.fileCount} Web files, ${result.bytes} bytes, ${result.excludedNativeFiles} native, ${result.excludedSharedFiles} shared and ${result.excludedAppFiles} app source files excluded\n`);
}
