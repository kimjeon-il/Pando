// Always create a new detached project input; the canonical Core owns mutation.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const source = new URL('../fixtures/portability/web-document-seed.json', import.meta.url);

export function readPortabilityProjectSeed() {
  return JSON.parse(readFileSync(source, 'utf8'));
}

export async function loadPortabilityProjectSeed() {
  return JSON.parse(await readFile(source, 'utf8'));
}
