import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { requireBuildSpace } from './dev.mjs';

const shell = fileURLToPath(new URL('./', import.meta.url));
const target = resolve(process.env.CARGO_TARGET_DIR || resolve(shell, 'src-tauri/target'));
const android = process.argv.includes('--android');
if (process.argv.includes('--build')) {
  await requireBuildSpace(shell);
  execFileSync(process.execPath, [resolve(shell, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--debug', '--no-bundle', '--target', 'x86_64-pc-windows-gnu', '--features', 'custom-protocol'],
    { cwd: shell, stdio: 'inherit', env: { ...process.env, CARGO_INCREMENTAL: '0', PANDOLAB_SHELL_DEVELOPMENT: '0' } });
}
const source = android ? resolve(shell, 'src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk') : resolve(target, 'x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe');
const directory = resolve(target, android ? 'packaged/android' : 'packaged/windows');
const output = resolve(directory, android ? 'app-arm64-debug.apk' : 'pandolab-web-shell.exe');
const exists = path => stat(path).then(() => true, () => false);
const preserve = process.argv.includes('--preserve-existing');
const modeMarker = resolve(target, android ? '.development-output-android' : '.development-output-windows');
if (!preserve && !await exists(source)) throw Error(`Packaged native artifact is missing: ${source}`);
if (preserve && !await exists(output) && await exists(modeMarker) && await exists(source)) throw Error('An offline artifact is missing; refusing to label a development binary as packaged.');
if (!(process.argv.includes('--preserve-existing') && await exists(output)) && await exists(source)) {
  // A development launcher cannot replace this offline identity. This command
  // runs after packaging, or once before the first development compilation.
  const evidence = resolve(shell, 'dist/shell/stage-evidence.json');
  await readFile(evidence);
  await mkdir(directory, { recursive: true });
  const pending = output + '.pending';
  try { await copyFile(source, pending); await rename(pending, output); }
  finally { if (await exists(pending)) await unlink(pending); }
  const build = resolve(target, 'x86_64-pc-windows-gnu/debug/build');
  if (!android) {
  for (const entry of await readdir(build)) if (entry.startsWith('webview2-com-sys-')) {
    const loader = resolve(build, entry, 'out/x64/WebView2Loader.dll');
    if (await exists(loader)) { await copyFile(loader, resolve(directory, 'WebView2Loader.dll')); break; }
  }
  }
}
if (preserve) { await mkdir(target, { recursive: true }); await writeFile(modeMarker, 'Development reuses Cargo outputs; launch only packaged artifacts offline.\n'); }
