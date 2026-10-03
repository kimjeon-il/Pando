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
  assert.equal(exchangeDomainForTarget('general'), 'territorial');
  assert.equal(exchangeDomainForTarget('regional'), 'territorial');
  assert.equal(exchangeDomainForTarget('distribution'), 'distribution');
  assert.equal(exchangeTargetDescriptor('generic').fallback, true);
  for (const retired of ['country', 'subunit', 'region', 'administrative', 'admin', 'territory']) assert.equal(normalizeExchangeTarget(retired, ''), '');
  assert.deepEqual(Object.keys(EXCHANGE_TARGETS), ['PROJECT', 'GENERAL', 'REGIONAL', 'DISTRIBUTION', 'GENERIC']);
  assert.equal(normalizeExchangeTarget('unknown'), EXCHANGE_TARGETS.GENERIC);
});

test('one registry dispatches import and export handlers by canonical target', async () => {
  const calls = [];
  const registry = createExchangeAdapterRegistry({
    adapters: {
      general: {
        importPayload(payload) { calls.push(['import', payload.id]); return 'imported'; },
        exportPayload(value) { calls.push(['export', value.id]); return { id: value.id }; },
      },
    },
  });

  assert.equal(await registry.importPayload('general', { id: 'DEU' }), 'imported');
  assert.deepEqual(registry.exportPayload('general', { id: 'FRA' }), { id: 'FRA' });
  assert.deepEqual(calls, [['import', 'DEU'], ['export', 'FRA']]);
  assert.throws(() => registry.exportPayload('generic', {}), error => error.code === 'PL-EXCHANGE-UNSUPPORTED');
});
