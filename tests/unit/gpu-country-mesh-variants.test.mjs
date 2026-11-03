import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountryMeshVariants } from '../../shared/frontend/js/modules/gpu-country-mesh-variants.js';

test('country mesh variants retire replaced resources once and keep the other quality when requested', () => {
  const retired = [];
  const variants = createCountryMeshVariants(entry => retired.push(entry.name));
  variants.replace('preview', () => ({ quality: 'preview', name: 'preview-1' }));
  variants.replace('canonical', () => ({ quality: 'canonical', name: 'canonical-1' }), { preserveOtherVariants: true });
  assert.deepEqual([...variants.keys()], ['preview', 'canonical']);
  variants.replace('canonical', () => {
    assert.deepEqual(retired, ['canonical-1'], 'old GPU resources are released before allocating replacements');
    return { quality: 'canonical', name: 'canonical-2' };
  }, { preserveOtherVariants: true });
  assert.deepEqual(retired, ['canonical-1']);
  variants.replace('canonical', () => ({ quality: 'canonical', name: 'canonical-3' }));
  assert.deepEqual(retired, ['canonical-1', 'preview-1', 'canonical-2']);
  assert.equal(variants.get('canonical').name, 'canonical-3');
  variants.clear();
  assert.deepEqual(retired, ['canonical-1', 'preview-1', 'canonical-2', 'canonical-3']);
});
