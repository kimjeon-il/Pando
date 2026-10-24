import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadWebOracle } from './web-oracle.mjs';

const root = new URL('../fixtures/portability/web-9300609-hydro-create/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
if (manifest.schema !== 'pandoeditor-web-supplemental-oracle'
  || manifest.baseline !== '930060923889d17134e36e152c29f4adbb2e60a9') throw new Error('Invalid hydro oracle provenance.');
for (const row of manifest.files) {
  const bytes = await readFile(new URL(row.path, root));
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256
    || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== row.blob)
    throw new Error(`Frozen supplemental Git blob changed: ${row.path}`);
}
const [{ createHydroSettings }, { genericFeatureGeometryKind }, { normalizeColorValue }] = await Promise.all([
  loadWebOracle('assets/js/modules/app-hydro-settings.js'),
  loadWebOracle('assets/js/modules/generic-feature-service.js'),
  import(new URL('assets/js/modules/color-adapter.js', root)),
]);
const environment = await readFile(new URL('assets/js/modules/app-environment.js', root), 'utf8');
export const originalHydroToolConfig = Object.fromEntries(['river', 'lake'].map(category => {
  const color = new RegExp(`${category}: Object\\.freeze\\(\\{[^\\n]+color: '(#[a-f0-9]{6})'`).exec(environment)?.[1];
  if (!color) throw new Error(`Missing original hydro tool color: ${category}`);
  return [category, { color }];
}));

export function originalNormalizedHydro(input) {
  const owner = createHydroSettings();
  owner.connect({ objectPresentation: { genericFeatureGeometryKind }, colorModel: { normalizeEditorColor: normalizeColorValue },
    hydroPresentation: { HYDRO_TOOL_CONFIG: originalHydroToolConfig } });
  // The frozen serializer preserves normalized hydro bytes unchanged. Compare
  // that value directly; the current Core still exercises storage and Undo/Redo,
  // without feeding a current project into an obsolete project-schema reader.
  return owner.normalizeHydroEdit(structuredClone(input));
}
