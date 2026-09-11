import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('country flag menu endpoints belong to the controller elements, not top-level options', () => {
  const source = readApplicationOwners('domain-assembly');
  const config = source.split('countryPropertyController = createCountryPropertyController({')[1];
  assert.ok(config, 'country controller initialization exists');
  const elements = config.match(/elements:\s*\{([\s\S]*?)\n\s*\},/)[1];
  for (const [key, id] of [['flagTrigger', 'flagMenuBtn'], ['flagMenu', 'flagMenu']]) {
    assert.ok(elements.includes(`${key}: $('${id}')`), `${key} must be passed within elements`);
  }
});
