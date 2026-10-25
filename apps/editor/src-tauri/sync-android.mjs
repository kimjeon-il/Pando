import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDirectory = fileURLToPath(new URL('./android/', import.meta.url));
const generatedDirectory = fileURLToPath(new URL('./gen/android/', import.meta.url));

async function sourceFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(join(directory, entry.name), relative));
    else if (entry.isFile() && relative !== 'README.md') files.push(relative);
  }
  return files.sort();
}

export async function syncAndroid({ directory = generatedDirectory, check = false } = {}) {
  try {
    await readFile(join(directory, 'settings.gradle'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Android scaffold is missing; initialize it through the CI native producer.', { cause: error });
  }
  const changed = [];
  for (const relative of await sourceFiles(sourceDirectory)) {
    const expected = await readFile(join(sourceDirectory, relative), 'utf8');
    const target = join(directory, relative);
    let actual;
    try { actual = await readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Git may check out generated and canonical files with different line endings.
    if (actual?.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n')) continue;
    changed.push(relative);
    if (!check) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, expected);
    }
  }
  if (check && changed.length) {
    throw new Error(`Android sources are out of sync: ${changed.join(', ')}. Run node apps/editor/src-tauri/sync-android.mjs.`);
  }
  return { changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node sync-android.mjs [--check]');
  const { changed } = await syncAndroid({ check: process.argv.includes('--check') });
  console.log(`Android canonical sources: ${changed.length ? `${changed.length} updated` : 'in sync'}`);
}
