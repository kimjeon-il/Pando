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
