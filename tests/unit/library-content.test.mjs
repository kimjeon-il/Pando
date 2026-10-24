import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as content from '../../tools/library-content.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pando-library-content-'));
  t.after(() => { const walk = p => { if (!existsSync(p)) return; for (const e of content.contentFiles(p)) chmodSync(e.path, 0o600); }; walk(root); rmSync(root, { recursive: true }); });
  mkdirSync(join(root, '.pando-store/blobs'), { recursive: true });
  return root;
}

test('shared originals reject in-place writes and private copies isolate owner changes', t => {
  const root = fixture(t), first = join(root, 'main/data.bin'), second = join(root, 'ui/data.bin');
  const blob = content.publishContent(root, Buffer.from('original'));
  content.linkContent(root, blob.sha256, first); content.linkContent(root, blob.sha256, second);
  assert.equal(statSync(first, { bigint: true }).ino, statSync(second, { bigint: true }).ino);
  assert.throws(() => writeFileSync(first, 'unsafe'));
  content.makePrivate(root, first);
  writeFileSync(first, 'ui only');
  assert.equal(readFileSync(second, 'utf8'), 'original');
  assert.notEqual(statSync(first, { bigint: true }).ino, statSync(second, { bigint: true }).ino);
  assert.equal(statSync(second).mode & 0o200, 0);
});

test('removing one readonly view keeps the shared blob and other view immutable', t => {
  const root = fixture(t), a = join(root, 'a'), b = join(root, 'b');
  const blob = content.publishContent(root, Buffer.from('keep'));
  content.linkContent(root, blob.sha256, a); content.linkContent(root, blob.sha256, b);
  content.removeContentLink(root, a);
  assert.equal(existsSync(a), false); assert.equal(readFileSync(b, 'utf8'), 'keep');
  assert.equal(statSync(blob.path).mode & 0o200, 0);
  assert.throws(() => writeFileSync(b, 'changed'));
});

test('a changed or linked content-pool object is never overwritten', t => {
  const root = fixture(t), bytes = Buffer.from('evidence'), blob = content.publishContent(root, bytes);
  chmodSync(blob.path, 0o600); writeFileSync(blob.path, 'corrupt!');
  assert.throws(() => content.publishContent(root, bytes), /content|hash|modified/i);
  assert.equal(readFileSync(blob.path, 'utf8'), 'corrupt!');
});

test('exclusive temporary-file collisions preserve the earlier unfinished work', t => {
  const root = fixture(t), target = join(root, 'record.json');
  const temporary = `${target}.${process.pid}.pending`;
  writeFileSync(temporary, 'unfinished');
  assert.throws(() => content.atomicStorageJSON(target, {}), /EEXIST/);
  assert.equal(readFileSync(temporary, 'utf8'), 'unfinished');
  assert.throws(() => content.replaceLibraryFile(root, target, Buffer.from('new')), /EEXIST/);
  assert.equal(readFileSync(temporary, 'utf8'), 'unfinished');
});

test('an independent readonly edit becomes writable while the pool itself stays immutable',t=>{
  const root=fixture(t),edit=join(root,'edit.bin');writeFileSync(edit,'private edit');chmodSync(edit,0o400);
  content.makePrivate(root,edit);writeFileSync(edit,'updated');assert.equal(readFileSync(edit,'utf8'),'updated');
  const blob=content.publishContent(root,Buffer.from('immutable'));
  assert.throws(()=>content.makePrivate(root,blob.path));assert.equal(statSync(blob.path).mode&0o200,0);
});
