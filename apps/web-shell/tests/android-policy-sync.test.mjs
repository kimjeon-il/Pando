import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('../src-tauri/sync-android.mjs', import.meta.url);
const source = new URL('../src-tauri/android/', import.meta.url);
const activity = 'app/src/main/java/com/pandolab/webshell/prototype/MainActivity.kt';
const policy = 'app/src/main/java/com/pandolab/webshell/prototype/OrientationPolicy.kt';

test('Android regeneration restores canonical policy without touching unrelated scaffold files', async () => {
  assert.ok(existsSync(script), 'Android regeneration needs a canonical source sync');
  const { syncAndroid } = await import(script.href);
  const directory = await mkdtemp(join(tmpdir(), 'pandolab-android-policy-'));
  await mkdir(join(directory, 'app/src/main/java/com/pandolab/webshell/prototype'), { recursive: true });
  await writeFile(join(directory, activity), 'upstream generated activity');
  await writeFile(join(directory, 'app/build.gradle.kts'), 'upstream SDK defaults');
  await writeFile(join(directory, 'gradle.properties'), 'upstream memory defaults');
  await writeFile(join(directory, 'settings.gradle'), 'keep upstream settings');

  await syncAndroid({ directory });
  for (const file of [activity, policy, 'app/build.gradle.kts', 'gradle.properties',
    'app/src/test/java/com/pandolab/webshell/prototype/OrientationPolicyTest.kt']) {
    assert.equal(await readFile(join(directory, file), 'utf8'), await readFile(new URL(file, source), 'utf8'));
  }
  assert.equal(await readFile(join(directory, 'settings.gradle'), 'utf8'), 'keep upstream settings');
  assert.equal((await syncAndroid({ directory })).changed.length, 0, 'sync must be idempotent');
  await syncAndroid({ directory, check: true });

  await writeFile(join(directory, activity), 'regenerated without policy');
  await assert.rejects(syncAndroid({ directory, check: true }), /out of sync.*MainActivity/s);
  assert.equal(await readFile(join(directory, activity), 'utf8'), 'regenerated without policy', 'check must not mutate');
  await syncAndroid({ directory });
  await syncAndroid({ directory, check: true });
});

test('Android sync reports an uninitialized scaffold instead of creating a partial project', async () => {
  assert.ok(existsSync(script), 'Android regeneration needs a canonical source sync');
  const { syncAndroid } = await import(script.href);
  const directory = await mkdtemp(join(tmpdir(), 'pandolab-android-uninitialized-'));
  await assert.rejects(syncAndroid({ directory }), /CI native producer/);
  assert.equal(existsSync(join(directory, activity)), false);
});
