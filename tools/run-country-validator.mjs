// Native C++ country validator; no Python/Shapely dependency on the production build path.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build-native', 'territorial-tools');
const executable = path.join(build, process.platform === 'win32' ? 'Release/pando-country-geometry-check.exe' : 'pando-country-geometry-check');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(executable)) run('cmake', ['-S', 'tools/cpp', '-B', build, '-DCMAKE_BUILD_TYPE=Release']);
if (process.argv.includes('--self-test')) {
  run('cmake', ['--build', build, '--config', 'Release', '--target', 'pando-spherical-polygon-tests', '--parallel', '2']);
  const executableTest = path.join(build, process.platform === 'win32' ? 'Release/pando-spherical-polygon-tests.exe' : 'pando-spherical-polygon-tests');
  run(executableTest, []);
}
run('cmake', ['--build', build, '--config', 'Release', '--target', 'pando-country-geometry-check', '--parallel', '2']);
run(executable, ['--root', root, ...process.argv.slice(2)]);
