import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const script = `${repository}/native/cmake/BuildProvenance.cmake`;
const cmake = process.env.PANDOEDITOR_CMAKE_EXE || 'cmake';
const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
const okay = result => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
const referencePaths = ['shared/core/src/referenceimage.cpp','shared/core/src/referencetracing.cpp'];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'pando-provenance-check-')).replace(/\\/g, '/');
  const root = `${directory}/source`, output = `${directory}/build`;
  mkdirSync(`${root}/native`, { recursive: true });
  mkdirSync(output);
  writeFileSync(`${root}/native/payload.txt`, 'executable fixture A');
  mkdirSync(`${root}/shared/core/src`, { recursive: true });
  writeFileSync(`${root}/shared/core/src/polygonclipping.cpp`, 'int precision = 9;\n');
  for (const sourcePath of referencePaths) {
    mkdirSync(path.dirname(`${root}/${sourcePath}`), { recursive: true });
    writeFileSync(`${root}/${sourcePath}`, 'export const fixture = 1;\n');
  }
  okay(run('git', ['-C', root, 'init', '-q']));
  okay(run('git', ['-C', root, 'add', 'native', 'shared']));
  okay(run('git', ['-C', root, '-c', 'user.name=Provenance Test', '-c', 'user.email=provenance@example.invalid', 'commit', '-qm', 'fixture']));
  const executable = `${output}/pandoeditor.exe`;
  const invoke = mode => run(cmake, [
    `-DPANDO_PROVENANCE_ROOT=${root}`, `-DPANDO_PROVENANCE_OUTPUT=${output}`,
    `-DPANDO_PROVENANCE_EXECUTABLE=${executable}`,
    `-DPANDO_PROVENANCE_CHECK=${mode === 'check' ? 'ON' : 'OFF'}`,
    `-DPANDO_PROVENANCE_FINALIZE=${mode === 'finalize' ? 'ON' : 'OFF'}`,
    '-P', script,
  ]);
  return { root, output, executable, invoke };
}

test('canonical reference source edits invalidate the executable without runtime regeneration', () => {
  const { root, executable, invoke } = fixture();
  okay(invoke('capture'));
  writeFileSync(executable, 'linked executable fixture');
  okay(invoke('finalize'));
  okay(invoke('check'));
  for (const sourcePath of referencePaths) {
    const original = readFileSync(`${root}/${sourcePath}`, 'utf8');
    writeFileSync(`${root}/${sourcePath}`, original.replace('1;', '2;'));
    const rejected = invoke('check');
    assert.notEqual(rejected.status, 0, sourcePath);
    assert.match(rejected.stderr, /different source/, sourcePath);
    writeFileSync(`${root}/${sourcePath}`, original);
  }
  okay(invoke('check'));
});

test('a canonical geometry source edit invalidates the executable without artifact regeneration', () => {
  const { root, executable, invoke } = fixture();
  okay(invoke('capture'));
  writeFileSync(executable, 'linked executable fixture');
  okay(invoke('finalize'));
  okay(invoke('check'));
  writeFileSync(`${root}/shared/core/src/polygonclipping.cpp`, 'export const precision = 8;\n');
  const rejected = invoke('check');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /different source/);
});

test('source capture cannot certify an executable before a successful link', () => {
  const { output, executable, invoke } = fixture();
  writeFileSync(executable, 'previous executable fixture');
  okay(invoke('capture'));
  assert.equal(existsSync(`${output}/build-provenance.json`), false);
  const pending = JSON.parse(readFileSync(`${output}/build-provenance.pending.json`, 'utf8'));
  assert.match(pending.commit, /^[a-f0-9]{40}$/);
  assert.match(pending.sourceHash, /^[a-f0-9]{64}$/);
  const rejected = invoke('check');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /no build provenance/);
});

test('a successful link receipt binds source identity and executable bytes', () => {
  const { root, output, executable, invoke } = fixture();
  okay(invoke('capture'));
  writeFileSync(executable, 'linked executable fixture');
  okay(invoke('finalize'));
  const receipt = JSON.parse(readFileSync(`${output}/build-provenance.json`, 'utf8'));
  assert.equal(receipt.sourceRoot, root);
  assert.equal(receipt.dirty, false);
  assert.equal(receipt.executableSha256, createHash('sha256').update('linked executable fixture').digest('hex'));
  okay(invoke('check'));

  writeFileSync(executable, 'replaced executable fixture');
  const replaced = invoke('check');
  assert.notEqual(replaced.status, 0);
  assert.match(replaced.stderr, /executable.*provenance/);
  writeFileSync(executable, 'linked executable fixture');

  writeFileSync(`${root}/native/payload.txt`, 'executable fixture B');
  const changed = invoke('check');
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /different source/);
  const staleCandidate = invoke('finalize');
  assert.notEqual(staleCandidate.status, 0);
  assert.match(staleCandidate.stderr, /changed during the build/);
});

test('configure-only and a failed miniature link preserve the previous receipt', () => {
  const { root, output, executable, invoke } = fixture();
  // LANGUAGES NONE and a copied text artifact exercise CMake completion ordering
  // without compiling or executing any binary, Qt application or launcher.
  writeFileSync(`${root}/link.cmake`, `
if(EXISTS "${root}/fail-link")
  message(FATAL_ERROR "intentional miniature link failure")
endif()
file(COPY_FILE "${root}/native/payload.txt" "${executable}" ONLY_IF_DIFFERENT)
`);
  writeFileSync(`${root}/CMakeLists.txt`, `
cmake_minimum_required(VERSION 3.21)
project(ProvenanceMini LANGUAGES NONE)
set(PANDO_PROVENANCE_ROOT "${root}")
set(PANDO_PROVENANCE_OUTPUT "${output}")
include("${script}")
add_custom_target(provenance
  COMMAND "\${CMAKE_COMMAND}" "-DPANDO_PROVENANCE_ROOT=${root}" "-DPANDO_PROVENANCE_OUTPUT=${output}" -P "${script}")
add_custom_target(link_fixture ALL COMMAND "\${CMAKE_COMMAND}" -P "${root}/link.cmake")
add_dependencies(link_fixture provenance)
add_custom_command(TARGET link_fixture POST_BUILD
  COMMAND "\${CMAKE_COMMAND}" "-DPANDO_PROVENANCE_ROOT=${root}" "-DPANDO_PROVENANCE_OUTPUT=${output}"
    "-DPANDO_PROVENANCE_EXECUTABLE=${executable}" -DPANDO_PROVENANCE_FINALIZE=ON -P "${script}")
`);
  const configure = () => run(cmake, ['-S', root, '-B', output, '-G', 'Ninja']);
  const build = () => run(cmake, ['--build', output, '--parallel', '1']);
  okay(configure());
  okay(build());
  okay(invoke('check'));
  const original = readFileSync(`${output}/build-provenance.json`, 'utf8');

  writeFileSync(`${root}/native/payload.txt`, 'executable fixture B');
  okay(configure());
  assert.equal(readFileSync(`${output}/build-provenance.json`, 'utf8'), original);
  assert.notEqual(invoke('check').status, 0);
  writeFileSync(`${root}/fail-link`, 'fail');
  const failed = build();
  assert.notEqual(failed.status, 0);
  assert.match(`${failed.stdout}\n${failed.stderr}`, /intentional miniature link failure/);
  assert.equal(readFileSync(`${output}/build-provenance.json`, 'utf8'), original);
  assert.equal(readFileSync(executable, 'utf8'), 'executable fixture A');
  assert.notEqual(invoke('check').status, 0);

  unlinkSync(`${root}/fail-link`);
  okay(build());
  okay(invoke('check'));
  assert.equal(readFileSync(executable, 'utf8'), 'executable fixture B');
});
