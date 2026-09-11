import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXCHANGE_TARGETS,
  createExchangeAdapterRegistry,
  exchangeDomainForTarget,
  exchangeTargetDescriptor,
  normalizeExchangeTarget,
} from '../../assets/js/modules/exchange-adapter-registry.js';

test('exchange targets own canonical domain and fallback metadata', () => {
  assert.equal(exchangeDomainForTarget('country'), 'territorial');
  assert.equal(exchangeDomainForTarget('administrative'), 'territorial');
  assert.equal(exchangeDomainForTarget('distribution'), 'distribution');
  assert.equal(exchangeTargetDescriptor('generic').fallback, true);
  assert.equal(normalizeExchangeTarget('admin'), EXCHANGE_TARGETS.SUBUNIT);
  assert.equal(normalizeExchangeTarget('unknown'), EXCHANGE_TARGETS.GENERIC);
});

test('one registry dispatches import and export handlers by canonical target', async () => {
  const calls = [];
  const registry = createExchangeAdapterRegistry({
    adapters: {
      country: {
        importPayload(payload) { calls.push(['import', payload.id]); return 'imported'; },
        exportPayload(value) { calls.push(['export', value.id]); return { id: value.id }; },
      },
    },
  });

  assert.equal(await registry.importPayload('country', { id: 'DEU' }), 'imported');
  assert.deepEqual(registry.exportPayload('country', { id: 'FRA' }), { id: 'FRA' });
  assert.deepEqual(calls, [['import', 'DEU'], ['export', 'FRA']]);
  assert.throws(() => registry.exportPayload('generic', {}), error => error.code === 'PL-EXCHANGE-UNSUPPORTED');
});
