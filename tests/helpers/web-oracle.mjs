import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../fixtures/portability/web-9300609-oracle/', import.meta.url);
let admission;
async function verify() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  if (manifest.schema !== 'pandoeditor-web-test-oracle' || manifest.baseline !== '930060923889d17134e36e152c29f4adbb2e60a9')
    throw new Error('The frozen Web oracle baseline does not match.');
  for (const row of manifest.files) {
    if (!/^[\w./-]+$/.test(row.path) || row.path.split('/').includes('..')) throw new Error('Invalid frozen oracle path.');
    const bytes = await readFile(new URL(row.path, root));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256
      || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== row.blob)
      throw new Error(`Frozen Web Git blob changed: ${row.path}`);
  }
  return new Set(manifest.files.map(row => row.path));
}

/** The copied original module graph has no import path to the production facade. */
export async function loadWebOracle(path) {
  const files = await (admission ||= verify());
  if (!files.has(path)) throw new Error(`Web oracle module was not admitted: ${path}`);
  return import(new URL(path, root));
}
