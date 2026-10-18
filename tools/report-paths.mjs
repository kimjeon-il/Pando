import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const mapping = JSON.parse(readFileSync(new URL('./report-paths.json', import.meta.url), 'utf8'));

export function reportPath(legacy, root = repo) {
  let target = mapping.files[legacy] ?? legacy;
  for (const [old, replacement] of Object.entries(mapping.directories)) {
    const recursive = old === 'assets/data/research/siachen';
    if (legacy === old || (recursive && legacy.startsWith(old + '/'))) {
      target = mapping.files[legacy] ?? replacement + legacy.slice(old.length);
      break;
    }
  }
  const migrated = existsSync(resolve(root, 'reports/places/source-manifest.json'));
  return resolve(root, migrated || existsSync(resolve(root, target)) ? target : legacy);
}
