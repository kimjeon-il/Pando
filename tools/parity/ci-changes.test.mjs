import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyChangedPaths, shouldRunParity } from './ci-changes.mjs';

const registry = JSON.parse(readFileSync(new URL('../../tests/fixtures/portability/index.json', import.meta.url), 'utf8'));

test('classifies one commit diff by Web root and native subtree', () => {
  assert.deepEqual(classifyChangedPaths([
    'assets/js/editor.js',
    'native/app/editorcontroller.cpp',
    'native/tools/run-final-oracles.mjs',
    'reports/README.md'
  ]), {
    web: ['assets/js/editor.js', 'reports/README.md'],
    app: ['app/editorcontroller.cpp', 'tools/run-final-oracles.mjs']
  });
});

test('unrelated documentation skips parity while unclassified source changes still run', () => {
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/README.md'])), false);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['native/app/new-command.cpp'])), true);
  assert.equal(shouldRunParity(registry, classifyChangedPaths(['tools/parity/registry.mjs'])), true);
});
