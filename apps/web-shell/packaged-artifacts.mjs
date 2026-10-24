import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { requireBuildSpace } from './dev.mjs';
import { validateShellProfile } from './stage.mjs';

const shell = fileURLToPath(new URL('./', import.meta.url));
const exists = path => stat(path).then(() => true, () => false);
const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
export function assertOrdinaryBuild(info) {
  if (typeof info.verification !== 'boolean') throw Error('Native build identity is missing; rebuild the ordinary offline app.');
  if (info.verification) throw Error('A verification binary cannot replace the ordinary offline app.');
  if (info.executionMode === 'development') throw Error('A development binary cannot replace the offline app.');
  if (info.profile !== 'map-data') throw Error('An ordinary offline artifact must use the map-data profile.');
}
export function assertVerificationBuild(info) {
  if (info.verification !== true) throw Error('This check requires an explicit verification build.');
}
export function windowsBuildArguments(verification) {
  return ['build', '--debug', '--no-bundle', '--target', 'x86_64-pc-windows-gnu', '--features',
    verification ? 'custom-protocol,verification' : 'custom-protocol',
    ...(verification ? ['--config', 'src-tauri/tauri.verification.json'] : [])];
}
export function inspectWindowsBinary(path) {
  return JSON.parse(execFileSync(path, ['--build-info'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
}

async function main() {
const target = resolve(process.env.CARGO_TARGET_DIR || resolve(shell, 'src-tauri/target'));
const android = process.argv.includes('--android');
const verification = process.argv.includes('--verification');
const inspect = process.argv.find(arg => arg.startsWith('--verify-binary='));
if (inspect) { assertVerificationBuild(inspectWindowsBinary(resolve(inspect.slice('--verify-binary='.length)))); return; }
validateShellProfile(process.env.PANDOLAB_SHELL_PROFILE || 'map-data', verification);
const abi = process.argv.find(arg => arg.startsWith('--abi='))?.slice(6) || 'arm64';
if (!['arm64', 'x86_64'].includes(abi)) throw Error('Unsupported packaged Android ABI.');
if (process.argv.includes('--build')) {
  await mkdir(target, { recursive: true });
  await requireBuildSpace(target);
  execFileSync(process.execPath, [resolve(shell, 'node_modules/@tauri-apps/cli/tauri.js'), ...windowsBuildArguments(verification)],
    { cwd: shell, stdio: 'inherit', env: { ...process.env, CARGO_INCREMENTAL: '0', PANDOLAB_SHELL_DEVELOPMENT: '0',
      PANDOLAB_SHELL_VERIFICATION: verification ? '1' : '0' } });
}
const source = android ? resolve(shell, `src-tauri/gen/android/app/build/outputs/apk/${abi}/debug/app-${abi}-debug.apk`) : resolve(target, 'x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe');
const directory = resolve(target, android ? 'packaged/android' : 'packaged/windows');
const output = resolve(directory, android ? `app-${abi}-debug.apk` : 'pandolab-web-shell.exe');
const preserve = process.argv.includes('--preserve-existing');
const modeMarker = resolve(target, android ? `.development-output-android-${abi}` : '.development-output-windows');
if (process.argv.includes('--record-android')) {
  if (!android) throw Error('Android build identity requires an APK.');
  const evidence = JSON.parse(await readFile(resolve(shell, 'dist/shell/stage-evidence.json'), 'utf8'));
  if (evidence.verification !== verification) throw Error('Android build and stage mode disagree.');
  validateShellProfile(evidence.profile, verification);
  await writeFile(source + '.build.json', JSON.stringify({ verification, profile: evidence.profile, sha256: await digest(source), commit: evidence.commit }));
}
if (verification) {
  if (preserve) throw Error('Verification output must not enter the preserved offline package.');
  console.log('Verification output retained only at the fixed native build path:', source);
  return;
}
if (!preserve && !await exists(source)) throw Error(`Packaged native artifact is missing: ${source}`);
if (preserve && !await exists(output) && await exists(modeMarker) && await exists(source)) throw Error('An offline artifact is missing; refusing to label a development binary as packaged.');
if (!(preserve && await exists(output)) && await exists(source)) {
  const info = android ? JSON.parse(await readFile(source + '.build.json', 'utf8')) : inspectWindowsBinary(source);
  assertOrdinaryBuild(info);
  if (android && info.sha256 !== await digest(source)) throw Error('Android artifact changed since its build identity was recorded.');
  await requireBuildSpace(target, (await stat(source)).size / 2 ** 30);
  await mkdir(directory, { recursive: true });
  const pending = output + '.pending';
  try { await copyFile(source, pending); await rename(pending, output); }
  finally { if (await exists(pending)) await unlink(pending); }
  if (!android) {
    const build = resolve(target, 'x86_64-pc-windows-gnu/debug/build');
    for (const entry of await readdir(build)) if (entry.startsWith('webview2-com-sys-')) {
      const loader = resolve(build, entry, 'out/x64/WebView2Loader.dll');
      if (await exists(loader)) { await copyFile(loader, resolve(directory, 'WebView2Loader.dll')); break; }
    }
  }
}
if (preserve) { await mkdir(target, { recursive: true }); await writeFile(modeMarker, 'Development reuses Cargo outputs; launch only packaged artifacts offline.\n'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
