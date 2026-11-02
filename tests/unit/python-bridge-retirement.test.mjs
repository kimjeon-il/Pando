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

test('project-owned Python files have been retired', () => {
  assert.deepEqual(tracked('*.py', '*.pyi', '*.ipynb'), []);
});

const pythonCommand = /(?:^|[;&|]\s*|(?:^|\n)\s*-?\s*run:\s*)\s*(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?\s+(?:-m\s+|-c\s+|[^\s]+\.py\b)/im;

test('Python command guard recognizes workflow and package invocations', () => {
  for (const command of ['- run: python -m pip install x', '- run: python tools/example.py',
    'run: |\n  python3 -c x', 'node first.js && python3.12 tools/a.py']) {
    assert.match(command, pythonCommand);
  }
  assert.doesNotMatch('node tools/example.mjs', pythonCommand);
});

test('project workflows and package scripts do not run Python', () => {
  for (const path of tracked('.github/workflows/*.yml', '.github/workflows/*.yaml')) {
    const content = read(path);
    assert.doesNotMatch(content, /uses:\s*actions\/setup-python@/i, path);
    assert.doesNotMatch(content, pythonCommand, path);
  }
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const [name, command] of Object.entries(scripts)) {
    assert.doesNotMatch(command, pythonCommand, `package script ${name}`);
  }
});

test('project tools do not launch a Python interpreter', () => {
  const launch = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(\s*['"](?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?(?:['"]|\s)/i;
  const retiredEnvironment = /\b(?:PANDOLAB_PYTHON(?:_EXECUTABLE)?|PANDO_HYDRO_(?:NAME|CONNECTIVITY)_PYTHON|PANDO_MAP_PYTHON)\b/;
  for (const path of tracked('tools/**/*.mjs', 'tools/*.mjs', 'scripts/**/*.mjs', 'scripts/*.mjs')) {
    const content = read(path);
    assert.doesNotMatch(content, launch, path);
    assert.doesNotMatch(content, retiredEnvironment, path);
  }
});
