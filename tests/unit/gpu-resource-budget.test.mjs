import assert from 'node:assert/strict';
import test from 'node:test';

import { createGpuResourceBudget } from '../../assets/js/modules/gpu-resource-budget.js';

test('GPU byte budget evicts inactive low-priority LRU resources first', () => {
  const budget = createGpuResourceBudget({ byteBudget: 100 });
  budget.track('old-background', 60, 0);
  budget.track('recent-background', 60, 0);
  budget.touch('recent-background');
  assert.deepEqual(budget.reconcile({ active: ['recent-background'] }), ['old-background']);
  assert.equal(budget.stats().activeBytes, 60);
});

test('active and protected resources are never evicted even under pressure', () => {
  const budget = createGpuResourceBudget({ byteBudget: 50 });
  budget.track('visible', 60, 0);
  budget.track('editing', 70, 100);
  assert.deepEqual(budget.reconcile({ active: ['visible'], protected: ['editing'] }), []);
  assert.equal(budget.stats().overBudgetBytes, 80);
  assert.equal(budget.stats().blockedEvictionCount, 1);
});

test('lowering the budget returns only safe eviction keys', () => {
  const budget = createGpuResourceBudget({ byteBudget: 500 });
  budget.track('visible', 100, 10);
  budget.track('cached-a', 120, 0);
  budget.track('cached-b', 120, 1);
  budget.reconcile({ active: ['visible'] });
  assert.deepEqual(budget.setByteBudget(210), ['cached-a', 'cached-b']);
  assert.equal(budget.stats().activeBytes, 100);
});
