import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('territorial editor owns flag endpoints and the metadata command', () => {
  const source = readApplicationOwners('domain-assembly');
  const config = source.split('territorialPropertyController = createTerritorialPropertyController({')[1];
  assert.ok(config, 'territorial editor initialization exists');
  assert.match(config, /commitFlag: \(ref, value\) => commitTerritorialMetadata/);
  const editor = readFileSync(new URL('../../assets/js/modules/territorial-property-controller.js', import.meta.url), 'utf8');
  for (const id of ['flagMenuBtn', 'flagMenu', 'flagPreview', 'flagUploadBtn', 'flagFileInput', 'flagRemoveBtn']) {
    assert.ok(editor.includes(id), id + ' must be owned by territorial editor');
  }
});
