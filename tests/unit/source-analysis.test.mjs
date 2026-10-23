import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJavaScript, walkJavaScript } from '../../scripts/lib/source-analysis.mjs';

test('JavaScript analysis ignores comment text and retains actual syntax after formatting changes', () => {
  const code = parseJavaScript('// document.querySelector();\nexport const value =\n  2;', { filePath: 'fixture.js' });
  const calls = [];
  walkJavaScript(code, node => { if (node.type === 'CallExpression') calls.push(node); });
  assert.equal(calls.length, 0);
  assert.equal(code.ast.body[0].declaration.declarations[0].init.value, 2);
});

test('JavaScript analysis preserves alias bindings and detects real global access', () => {
  const code = parseJavaScript("import { createWorkerRpcClient as transport } from './worker-rpc.js';\ntransport(); document.querySelector('button');");
  const imports = [], calls = [];
  walkJavaScript(code, node => {
    if (node.type === 'ImportSpecifier') imports.push([node.imported.name, node.local.name]);
    if (node.type === 'CallExpression') calls.push(node.callee.type);
  });
  assert.deepEqual(imports, [['createWorkerRpcClient', 'transport']]);
  assert.deepEqual(calls, ['Identifier', 'MemberExpression']);
  assert.ok(code.scopeManager.globalScope.through.some(reference => reference.identifier.name === 'document'));
});

test('JavaScript analysis fails visibly on malformed code', () => {
  assert.throws(() => parseJavaScript('export const broken = ;', { filePath: 'broken.js' }), /broken\.js.*Unexpected token/);
});

test('successive analyses preserve earlier AST, scopes, source type and syntax errors', () => {
  const first = parseJavaScript('export const original = document.title;');
  const firstAst = first.ast, firstScope = first.scopeManager;
  const common = parseJavaScript('return require("node:fs");', { sourceType: 'commonjs' });
  assert.equal(common.ast.sourceType, 'commonjs');
  assert.throws(() => parseJavaScript('export const broken = ;', { filePath: 'second.js' }), /second\.js.*Unexpected token/);
  const script = parseJavaScript('var ordinary = 1;', { sourceType: 'script' });
  assert.equal(script.ast.sourceType, 'script');
  const last = parseJavaScript('export const last = 2;');
  assert.equal(last.ast.sourceType, 'module');
  assert.equal(first.ast, firstAst);
  assert.equal(first.scopeManager, firstScope);
  assert.equal(first.getText(), 'export const original = document.title;');
  assert.ok(first.scopeManager.globalScope.through.some(reference => reference.identifier.name === 'document'));
  assert.equal(first.ast.body[0].declaration.declarations[0].id.name, 'original');
});
