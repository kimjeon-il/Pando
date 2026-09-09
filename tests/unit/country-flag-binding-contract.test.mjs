import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('country flag menu endpoints belong to the controller elements, not top-level options', () => {
  const source = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
  const config = source.split('countryPropertyController = createCountryPropertyController({')[1];
  assert.ok(config, 'country controller initialization exists');
  const elements = config.match(/elements:\s*\{([\s\S]*?)\n\s*\},/)[1];
  for (const [key, id] of [['flagTrigger', 'flagMenuBtn'], ['flagMenu', 'flagMenu']]) {
    assert.ok(elements.includes(`${key}: $('${id}')`), `${key} must be passed within elements`);
  }
});
