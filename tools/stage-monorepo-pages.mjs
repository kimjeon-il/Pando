#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectViewerAssets } from '../scripts/lib/product-assets.mjs';
import { prepareLibraryData } from './library-data.mjs';
import { BASELINE_DATA_CHANNEL } from '../assets/js/modules/publication-data-channel.js';

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

export async function stageWebPages(rootInput, stageInput, manifestInput, { skipChecks = false } = {}) {
  const root = resolve(rootInput), stage = resolve(stageInput), manifest = resolve(manifestInput);
  const library = prepareLibraryData({ root });
  const generator = resolve(root, 'scripts/generate-build-metadata.mjs');
  const metadataCheck = skipChecks ? 'skipped' : existsSync(generator) ? 'passed' : 'unavailable';
  if (metadataCheck === 'passed') execFileSync(process.execPath, [generator, '--check'], { cwd: root, stdio: 'pipe' });
  if (within(root, stage) || stage === root) throw Error('Pages stage must be outside the source repository');
  if (within(root, manifest) || manifest === root || within(stage, manifest)) {
    throw Error('Pages evidence must be outside the source repository and stage');
  }
  if (existsSync(stage) || existsSync(manifest)) throw Error('Pages stage or evidence already exists');
  const all = gitFiles(root);
  if (library) for (const [path, entry] of Object.entries(library.files)) {
    if (!path.startsWith('assets/data/')) continue;
    all.push({ path, mode: '100644', bytes: entry.bytes, blob: null, sha256: entry.sha256, data: true });
  }
  const sourceBytes = file => file.data ? readFileSync(resolve(library.materialized, file.path)) : committedBlob(root, file);
  const excludedNativeFiles = all.filter(file => file.path.startsWith('native/')).length;
  const excludedSharedFiles = all.filter(file => file.path.startsWith('shared/')).length;
  const excludedAppFiles = all.filter(file => file.path.startsWith('apps/')).length;
  const byPath = new Map(all.map(file => [file.path, file]));
  const viewerPaths = await collectViewerAssets({ root, availablePaths: all.map(file => file.path),
    readSource: path => sourceBytes(byPath.get(path)).toString('utf8') });
  const web = all.filter(file => viewerPaths.has(file.path));
  const paths = new Set(web.map(file => file.path));
  const required=[...REQUIRED];
  if([...paths].some(path => path === 'assets/js/workers/core-viewer-session-worker.js'
    || path.endsWith('/assets/js/workers/core-viewer-session-worker.js')))required.push(
    'assets/wasm/pandoeditor-core.js','assets/wasm/pandoeditor-core.wasm','assets/wasm/pandoeditor-core.manifest.json');
  for (const path of required) if (!paths.has(path)) throw Error(`Missing protected Web URL: ${path}`);
  const channelPath = 'assets/data/library-channel/current.json';
  const channelBytes = Buffer.from(JSON.stringify(BASELINE_DATA_CHANNEL) + '\n');
  const total = web.reduce((sum, file) => sum + file.bytes, 0) + channelBytes.length;
  if (total > LIMIT_BYTES) throw Error(`Pages site exceeds ${LIMIT_BYTES} bytes: ${total}`);
  const files = web.map(file => {
    if (file.mode !== '100644' && file.mode !== '100755') throw Error(`Unsupported source mode: ${file.path}`);
    const source = resolve(root, file.path);
    if (!within(root, source) || !existsSync(source) || !lstatSync(source).isFile()) {
      throw Error(`Invalid source file: ${file.path}`);
    }
    const working = readFileSync(source);
    const exact = working.length === file.bytes && (file.data ? hash('sha256', working) === file.sha256 : blobHash(working) === file.blob);
    const committed = exact ? working : sourceBytes(file);
    if (file.data && !exact) throw Error(`Pinned library transfer mismatch: ${file.path}`);
    if (!exact && !isEquivalentCrLfCheckout(working, committed)) {
      throw Error(`Committed Web file changed or mismatch: ${file.path}`);
    }
    return { path: file.path, blob: file.blob, bytes: file.bytes,
      sha256: hash('sha256', committed), convertedCrLf: !exact };
  });
  files.push({ path: channelPath, blob: null, bytes: channelBytes.length,
    sha256: hash('sha256', channelBytes), generated: true });
  mkdirSync(stage, { recursive: true });
  for (const file of files) {
    const output = resolve(stage, file.path);
    if (!within(stage, output)) throw Error(`Invalid Pages output: ${file.path}`);
    mkdirSync(dirname(output), { recursive: true });
    if (file.generated) writeFileSync(output, channelBytes);
    else if (file.convertedCrLf) writeFileSync(output, sourceBytes(file));
    else { copyFileSync(resolve(root, file.path), output); chmodSync(output, 0o600); }
    if (hash('sha256', readFileSync(output)) !== file.sha256) throw Error(`Staged copy mismatch: ${file.path}`);
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const evidence = { schema: 'pando-web-pages-staging', productMode: 'viewer', sourceCommit, metadataCheck, fileCount: files.length,
    dataRepository: library?.repository, dataCommit: library?.revision,
    bytes: total, limitBytes: LIMIT_BYTES, excludedNativeFiles, excludedSharedFiles, excludedAppFiles, files };
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
