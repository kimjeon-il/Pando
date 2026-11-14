import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {libraryOwnerId} from '../../../tools/data/library-context.mjs';

test('raw data ownership follows the branch when the source checkout moves', t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-raw-owner-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/work/gis-raw-modern\n');
  assert.equal(libraryOwnerId(root), 'gis-raw-modern');
  writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  assert.equal(libraryOwnerId(root), 'main');
  writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/unregistered\n');
  assert.throws(() => libraryOwnerId(root), {code:'PANDO_LIBRARY_OWNER_UNKNOWN'});
});
