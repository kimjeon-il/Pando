import { readFileSync } from 'node:fs';

export const appVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const worldAssets = JSON.parse(readFileSync(
  new URL('../../assets/data/world/current.json', import.meta.url), 'utf8',
)).assets;
export const canonicalVertexCount = worldAssets.canonicalMesh.header[3];
