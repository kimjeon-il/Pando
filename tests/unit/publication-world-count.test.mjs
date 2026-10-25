import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorldBundle } from "../../shared/frontend/js/modules/world-bundle-manifest.js";

test('a published current snapshot may contain fewer countries after an explicit deletion', () => {
  const bundle = JSON.parse(readFileSync(new URL('../../assets/data/world/current.json', import.meta.url)));
  bundle.source.countryCount -= 1;
  assert.equal(validateWorldBundle(bundle).countryCount, bundle.source.countryCount);
});
