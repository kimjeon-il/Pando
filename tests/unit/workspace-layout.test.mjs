import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceLayoutDetector } from "../../shared/frontend/js/modules/workspace-layout.js";

test('phone landscape requires coarse input, landscape and layout height below 600', () => {
  const detect = createWorkspaceLayoutDetector();
  assert.equal(detect({ width: 844, height: 390, coarse: true }), 'phone-landscape');
  assert.equal(detect({ width: 844, height: 390, coarse: false }), 'compact');
  assert.equal(detect({ width: 1024, height: 768, coarse: true }), 'compact');
  assert.equal(detect({ width: 390, height: 844, coarse: true }), 'mobile');
  assert.equal(detect({ width: 1440, height: 900, coarse: false }), 'wide');
});

test('keyboard height changes do not turn portrait or tablet editing into phone landscape', () => {
  const detect = createWorkspaceLayoutDetector();
  assert.equal(detect({ width: 390, height: 844, coarse: true }), 'mobile');
  assert.equal(detect({ width: 390, height: 300, coarse: true, editingText: true }), 'mobile');
  assert.equal(detect({ width: 844, height: 390, coarse: true, editingText: true }), 'phone-landscape');
  assert.equal(detect({ width: 1024, height: 768, coarse: true }), 'compact');
  assert.equal(detect({ width: 1024, height: 400, coarse: true, editingText: true }), 'compact');
});
