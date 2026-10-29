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

test('Python files only decrease within the reviewed inventory and two integrated tests', () => {
  const plan = read('docs/development/python-zero-migration-plan-2026-10-25.md');
  const inventory = plan.split('## 2026-10-29 잔여 기준 목록')[1]?.split('\n## ')[0];
  assert.ok(inventory, 'Python migration inventory must remain available');
  const reviewed = [...inventory.matchAll(/^- `([^`]+\.(?:py|pyi|ipynb))`\r?$/gm)].map(match => match[1]);
  assert.equal(reviewed.length, 55, 'the reviewed migration inventory must cover 55 files');
  assert.equal(new Set(reviewed).size, 55, 'the reviewed inventory must not contain duplicates');
  // These two tests arrived in a concurrent integration after the 55-file
  // inventory was frozen. Preserve their behavior and migrate them as well;
  // do not use the exception to allow any other added Python file.
  const integrated = new Set(['tests/python/test_map_plugin_geopdf.py', 'tests/python/test_reference_analysis_review.py']);
  const originalRemaining = remaining.filter(path => !integrated.has(path));
  assert.ok(originalRemaining.length <= 44, `Original Python inventory exceeded its current ceiling: ${originalRemaining.length}`);
  assert.ok(remaining.length <= 46, `Python file count exceeded the integrated ceiling: ${remaining.length}`);
  for (const path of originalRemaining) assert.ok(reviewed.includes(path), `Unreviewed Python file: ${path}`);
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
