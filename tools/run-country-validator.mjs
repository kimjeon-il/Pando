// Native C++ country validator; no Python/Shapely dependency on the production build path.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = process.argv.length === 3 && process.argv[2] === '--normalize-stdin';
const build = path.join(root, 'build-native', normalize ? 'territorial-normalizer' : 'territorial-tools');
const target = normalize ? 'pando-spherical-polygon-normalize' : 'pando-country-geometry-check';
const executableName = process.platform === 'win32' ? `${target}.exe` : target;
const executablePaths = process.platform === 'win32'
  ? [path.join(build, 'Release', executableName), path.join(build, executableName)]
  : [path.join(build, executableName)];

function run(command, args, buildOutput = false) {
  const result = spawnSync(command, args, { cwd: root, stdio: buildOutput ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
  if (buildOutput && result.stdout?.length) process.stderr.write(result.stdout);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (normalize && process.env.PANDOEDITOR_WASM_MODULE) {
  // Explicit local build override; CI and production builds use the native CLI.
  const { sphericalCore } = await import('./load-spherical-core.mjs');
  const normalizeGeometry = source => {
    let geometry = sphericalCore.normalizePolygonGeometry(source, false);
    if (source.type === 'MultiPolygon' && geometry.type === 'Polygon') {
      geometry = { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
    }
    return geometry;
  };
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (Array.isArray(input)) console.log(JSON.stringify(input.map(source => {
    try { return { ok: true, geometry: normalizeGeometry(source) }; }
    catch (error) { return { ok: false, error: error.message }; }
  })));
  else {
    try { console.log(JSON.stringify(normalizeGeometry(input))); }
    catch (error) { console.error(`polygon-normalize: ${error.message}`); process.exitCode = 1; }
  }
} else {
  if (!executablePaths.some(existsSync)) run('cmake', ['-S', 'tools/cpp', '-B', build, '-DCMAKE_BUILD_TYPE=Release',
    `-DPANDO_BUILD_COUNTRY_VALIDATOR=${normalize ? 'OFF' : 'ON'}`], normalize);
  if (process.argv.includes('--self-test')) {
    run('cmake', ['--build', build, '--config', 'Release', '--target', 'pando-spherical-polygon-tests', '--parallel', '2']);
    const executableTest = path.join(build, process.platform === 'win32' ? 'Release/pando-spherical-polygon-tests.exe' : 'pando-spherical-polygon-tests');
    run(executableTest, []);
  }
  run('cmake', ['--build', build, '--config', 'Release', '--target', target, '--parallel', '2'], normalize);
  const executable = executablePaths.find(existsSync);
  if (!executable) throw Error(`Built ${target} executable is missing in ${build}`);
  if (normalize) {
    const result = spawnSync(executable, [], { cwd: root, input: readFileSync(0), maxBuffer: 64 * 1024 * 1024 });
    if (result.stdout?.length) process.stdout.write(result.stdout);
    if (result.stderr?.length) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else run(executable, ['--root', root, ...process.argv.slice(2)]);
}
