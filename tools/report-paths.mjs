import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

// Report callers name the current repository-relative path explicitly.
export function reportPath(relative, root = repo) {
  if (typeof relative !== 'string' || !relative.startsWith('reports/') || relative.split('/').includes('..')) {
    throw new TypeError('Expected a current reports/ path.');
  }
  return resolve(root, relative);
}
