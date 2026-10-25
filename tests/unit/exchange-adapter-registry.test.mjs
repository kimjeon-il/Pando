import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXCHANGE_TARGETS,
  exchangeTargetDescriptor,
  normalizeExchangeTarget,
} from "../../apps/editor/frontend/js/modules/exchange-adapter-registry.js";

test('exchange targets own canonical domain and fallback metadata', () => {
  assert.equal(exchangeTargetDescriptor('general').domain, 'territorial');
  assert.equal(exchangeTargetDescriptor('regional').domain, 'territorial');
  assert.equal(exchangeTargetDescriptor('distribution').domain, 'distribution');
  assert.equal(exchangeTargetDescriptor('generic').fallback, true);
  for (const retired of ['country', 'subunit', 'region', 'administrative', 'admin', 'territory']) assert.equal(normalizeExchangeTarget(retired, ''), '');
  assert.deepEqual(Object.keys(EXCHANGE_TARGETS), ['PROJECT', 'GENERAL', 'REGIONAL', 'DISTRIBUTION', 'GENERIC']);
  assert.equal(normalizeExchangeTarget('unknown'), EXCHANGE_TARGETS.GENERIC);
});
