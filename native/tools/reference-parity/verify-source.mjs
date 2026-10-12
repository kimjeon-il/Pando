import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyReferenceManifest } from './source-manifest.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../../app/reference-web/manifest.json',import.meta.url)));
const runtime=readFileSync(new URL('../../app/reference-web/runtime.js',import.meta.url));
console.log(JSON.stringify(verifyReferenceManifest(root,manifest,runtime)));
