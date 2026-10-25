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
const remaining = tracked('*.py', '*.pyi', '*.ipynb').sort();

test('Python files only decrease from the original reviewed 101-file migration inventory', () => {
  const plan = read('docs/development/python-zero-migration-plan-2026-10-25.md');
  const inventory = plan.split('## 부록. 전수 분류 매니페스트')[1];
  assert.ok(inventory, 'Python migration inventory must remain available');
  const original = [...inventory.matchAll(/^- `([^`]+\.py)`$/gm)].map(match => match[1]);
  assert.equal(original.length, 101, 'the reviewed migration inventory must cover 101 files');
  assert.equal(new Set(original).size, 101, 'the initial inventory must not contain duplicates');
  assert.ok(remaining.length <= 89, `Python file count exceeded B1 baseline: ${remaining.length}`);
  for (const path of remaining) assert.ok(original.includes(path), `Unreviewed Python file: ${path}`);
});

test('temporary Python bridge modules have real consumers and leave no orphaned adapters', t => {
  const python = tracked('*.py');
  const bridgeImports = [
    ['tools/library_data.py', /\b(?:from\s+(?:tools\.)?library_data\s+import|import\s+(?:tools\.)?library_data\b)/],
    ['tools/report_paths.py', /\b(?:from\s+(?:tools\.)?report_paths\s+import|import\s+(?:tools\.)?report_paths\b)/],
    ['tests/application_source.py', /\b(?:from\s+tests\.application_source\s+import|import\s+tests\.application_source\b)/],
  ];
  for (const [bridge, importPattern] of bridgeImports) {
    const consumers = python.filter(path => path !== bridge && importPattern.test(read(path)));
    assert.equal(remaining.includes(bridge), consumers.length > 0,
      `${bridge}: ${consumers.length ? 'bridge removed before callers' : 'unreferenced bridge remains'}`);
    t.diagnostic(`${bridge}: ${consumers.length} Python caller(s)`);
  }
});
