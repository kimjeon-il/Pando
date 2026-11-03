import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tracked = (...patterns) => execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter(Boolean);
const read = path => readFileSync(join(root, path), 'utf8');

// These are static checks of owned commands, not a claim about external SDKs.
const commandStart = /(?:^|[\n;&|])\s*(?:(?:-\s*)?run:\s*|&\s*|(?:\/usr\/bin\/)?env\s+|uv\s+run\s+|conda\s+run\s+)*(?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?(?=\s|$)/im;
const commandArgs = /(?<![\w.\/\\-])(?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?(?=\s+(?:-m\b|-c\b|-3(?:\.\d+)?\b|--version\b|-[vV]\b|[^\s'"\x60]+\.pyw?(?=\s|$)))/im;
const quotedPath = /(?:^|[\n;&|])\s*&?\s*['"][^'"\n]*[\\/](?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?['"](?=\s|$)/im;
const pipCommand = /(?:^|[\n;&|])\s*(?:(?:-\s*)?run:\s*|&\s*)?(?:uv\s+)?pip(?:\d+(?:\.\d+)*)?(?:\.exe)?(?=\s|$)/im;
const cmakePython = /\bfind_package\s*\(\s*Python(?:3|Interp)?\b|\b(?:execute_process|add_custom_command)\s*\([^\n]{0,250}\bCOMMAND\s+(?:\S+[\\/])?(?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?\b/i;
const shebang = /^#!\s*(?:\/[^\s]*\/)?(?:env\s+)?(?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?(?=\s|$)/im;
const withoutCommentLines = content => content.split(/\r?\n/).filter(line => !/^\s*(?:#|\/\/)/.test(line)).join('\n');
const launchesPython = content => {
  const source = withoutCommentLines(content);
  return shebang.test(content) || commandStart.test(source) || commandArgs.test(source) ||
    quotedPath.test(source) || pipCommand.test(source) || cmakePython.test(source);
};

test('project-owned Python files, including GUI scripts, have been retired', () => {
  assert.deepEqual(tracked('*.py', '*.pyw', '*.pyi', '*.ipynb'), []);
});

test('Python command guard recognizes interpreter and installer launch forms', () => {
  for (const command of [
    '- run: python -m pip install x', '- run: python tools/example.py',
    'run: |\n  python3 -c x', 'node first.js && python3.12 tools/a.py',
    'py -3.12 tools/a.py', 'python --version', 'python',
    '& python.exe -V', '& "C:\\Python312\\python.exe" -m pip',
    '/usr/bin/env python3 -m pip', 'uv run python tools/example.py',
    'conda run python3 -m unittest', 'if python3 --version; then',
    'pip install -r requirements.txt', 'find_package(Python3 REQUIRED)',
    'execute_process(COMMAND python3 -c print(1))', 'pythonw.exe -m pip',
    '#!/usr/bin/env python3',
  ]) assert.equal(launchesPython(command), true, command);
  for (const reference of [
    'node tools/example.mjs', 'echo Python interpreter removed',
    '// python -m pip install x', '# python -m pip install x',
    'node --test tests/unit/python-bridge-retirement.test.mjs',
    'export PYTHONPATH=/tmp/ignored',
  ]) assert.equal(launchesPython(reference), false, reference);
});

test('project workflows and package scripts do not run Python', () => {
  for (const path of tracked('.github/workflows/*.yml', '.github/workflows/*.yaml')) {
    const content = read(path);
    assert.doesNotMatch(content, /uses:\s*actions\/setup-python@/i, path);
    assert.equal(launchesPython(content), false, path);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(launchesPython(command), false, 'package script ' + name);
  }
});

test('owned shell, composite actions and CMake files do not launch Python', () => {
  const paths = new Set(tracked('.github/actions/**/*.yml', '.github/actions/**/*.yaml',
    '*.ps1', '*.psm1', '*.sh', '*.bat', '*.cmd', '*.cmake', 'CMakeLists.txt', '**/CMakeLists.txt'));
  for (const path of paths) assert.equal(launchesPython(read(path)), false, path);
});

test('project tools do not launch a Python interpreter', () => {
  const launch = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(\s*['"](?:(?:[A-Za-z]:[\\/]|\/)[^'"]*[\\/])?(?:pythonw?(?:\d+(?:\.\d+)*)?|pyw?)(?:\.exe)?(?:['"]|\s)/i;
  const retiredEnvironment = /\b(?:PANDOLAB_PYTHON(?:_EXECUTABLE)?|PANDO_HYDRO_(?:NAME|CONNECTIVITY)_PYTHON|PANDO_MAP_PYTHON)\b/;
  const pythonEnvironment = /\bprocess\.env\.(?:PYTHON|PYTHON3|PYTHON_EXECUTABLE)\b/;
  const paths = new Set(tracked('tools/**/*.mjs', 'tools/**/*.js', 'tools/*.mjs', 'tools/*.js',
    'scripts/**/*.mjs', 'scripts/**/*.js', 'scripts/*.mjs', 'scripts/*.js',
    'apps/**/*.mjs', 'apps/**/*.js', 'shared/**/*.mjs', 'shared/**/*.js',
    'plugins/**/*.mjs', 'plugins/**/*.js'));
  for (const path of paths) {
    const content = read(path);
    assert.doesNotMatch(content, launch, path);
    assert.doesNotMatch(content, retiredEnvironment, path);
    assert.doesNotMatch(content, pythonEnvironment, path);
  }
});
