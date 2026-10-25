import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'build-native/web-shell');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
const sourcePaths = [...new Set([
  ...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
])].filter(path => path && !path.startsWith('reports/')).sort();
const changedSources = [];
for (const path of sourcePaths) {
  const absolute = resolve(root, path);
  try { changedSources.push({ path, bytes: (await stat(absolute)).size, sha256: await digest(absolute) }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; changedSources.push({ path, deleted: true }); }
}
const artifacts = [];
for (const argument of process.argv.slice(2)) {
  const path = resolve(argument);
  artifacts.push({ path, bytes: (await stat(path)).size, sha256: await digest(path) });
}
const stagePath = resolve(root, 'apps/editor/dist/shell/stage-evidence.json');
const stage = JSON.parse(await readFile(stagePath, 'utf8'));
const probes = {};
for (const phase of ['write', 'reopen']) {
  const path = resolve(output, `windows-${phase}.json`);
  try { probes[phase] = { path, sha256: await digest(path), report: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; probes[phase] = { status: 'NOT_RUN' }; }
}
await mkdir(output, { recursive: true });
const result = { schema: 'pandolab-web-shell-evidence', generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(),
  cleanCheckout: changedSources.length === 0, changedSources, stage: { path: stagePath, sha256: await digest(stagePath),
    fixture: stage.fixture, coreSourceSha256: stage.coreSourceSha256, bytes: stage.bytes, fileCount: stage.files.length },
  platform: { os: process.platform, architecture: process.arch, node: process.version }, artifacts, probes,
  androidRuntime: 'NOT_RUN', nativeFilePickers: 'NOT_RUN', qtApp: 'NOT_RUN', wholeWorldPerformance: 'NOT_RUN' };
await writeFile(resolve(output, 'evidence.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ evidence: resolve(output, 'evidence.json'), artifacts, changedSourceCount: changedSources.length }));
