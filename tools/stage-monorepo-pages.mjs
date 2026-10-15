#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT_BYTES = 1_000_000_000;
const REQUIRED = [
  'index.html', '.nojekyll',
  'assets/data/terrain-preview/v0.13.3-p1/manifest.json',
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

export function stageWebPages(rootInput, stageInput, manifestInput) {
  const root = resolve(rootInput), stage = resolve(stageInput), manifest = resolve(manifestInput);
  if (within(root, stage) || stage === root) throw Error('Pages stage must be outside the source repository');
  if (within(root, manifest) || manifest === root || within(stage, manifest)) {
    throw Error('Pages evidence must be outside the source repository and stage');
  }
  if (existsSync(stage) || existsSync(manifest)) throw Error('Pages stage or evidence already exists');
  const all = gitFiles(root);
  const excludedNativeFiles = all.filter(file => file.path.startsWith('native/')).length;
  const excludedSharedFiles = all.filter(file => file.path.startsWith('shared/')).length;
  const web = all.filter(file => !file.path.startsWith('native/') && !file.path.startsWith('shared/'));
  const paths = new Set(web.map(file => file.path));
  const required=[...REQUIRED];
  if(paths.has('assets/js/workers/core-session-worker.js'))required.push(
    'assets/wasm/pandoeditor-core.js','assets/wasm/pandoeditor-core.wasm','assets/wasm/pandoeditor-core.manifest.json');
  for (const path of required) if (!paths.has(path)) throw Error(`Missing protected Web URL: ${path}`);
  const total = web.reduce((sum, file) => sum + file.bytes, 0);
  if (total > LIMIT_BYTES) throw Error(`Pages site exceeds ${LIMIT_BYTES} bytes: ${total}`);
  const files = web.map(file => {
    if (file.mode !== '100644' && file.mode !== '100755') throw Error(`Unsupported source mode: ${file.path}`);
    const source = resolve(root, file.path);
    if (!within(root, source) || !existsSync(source) || !lstatSync(source).isFile()) {
      throw Error(`Invalid source file: ${file.path}`);
    }
    const working = readFileSync(source);
    const exact = working.length === file.bytes && blobHash(working) === file.blob;
    const committed = exact ? working : committedBlob(root, file);
    if (!exact && !isEquivalentCrLfCheckout(working, committed)) {
      throw Error(`Committed Web file changed or mismatch: ${file.path}`);
    }
    return { path: file.path, blob: file.blob, bytes: file.bytes,
      sha256: hash('sha256', committed), convertedCrLf: !exact };
  });
  mkdirSync(stage, { recursive: true });
  for (const file of files) {
    const output = resolve(stage, file.path);
    if (!within(stage, output)) throw Error(`Invalid Pages output: ${file.path}`);
    mkdirSync(dirname(output), { recursive: true });
    if (file.convertedCrLf) writeFileSync(output, committedBlob(root, file));
    else copyFileSync(resolve(root, file.path), output);
    if (hash('sha256', readFileSync(output)) !== file.sha256) throw Error(`Staged copy mismatch: ${file.path}`);
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const evidence = { schema: 'pando-web-pages-staging', sourceCommit, fileCount: files.length,
    bytes: total, limitBytes: LIMIT_BYTES, excludedNativeFiles, excludedSharedFiles, files };
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
  if (!arg('--stage') || !arg('--manifest')) throw Error('Usage: stage-monorepo-pages.mjs --root ROOT --stage OUT --manifest EVIDENCE');
  const result = stageWebPages(arg('--root') || '.', arg('--stage'), arg('--manifest'));
  process.stdout.write(`${result.fileCount} Web files, ${result.bytes} bytes, ${result.excludedNativeFiles} native and ${result.excludedSharedFiles} shared source files excluded\n`);
}
