import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('country flag menu endpoints belong to selection toolbar presentation, not country property controller', () => {
  const source = readApplicationOwners('domain-assembly');
  const config = source.split('territorialPropertyController = createTerritorialPropertyController({')[1];
  assert.ok(config, 'country controller initialization exists');
  const elements = config.match(/elements:\s*\{([\s\S]*?)\n\s*\},/)[1];
  assert.doesNotMatch(elements, /flagTrigger|flagMenu|flagPreview|flagUpload|flagFile|flagRemove/);

  const toolbar = readFileSync(new URL('../../assets/js/modules/selection-toolbar-presentation.js', import.meta.url), 'utf8');
  for (const id of ['flagMenuBtn', 'flagMenu', 'flagPreview', 'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn']) {
    assert.ok(toolbar.includes("$('" + id + "')"), id + ' must be owned by selection toolbar presentation');
  }
});
