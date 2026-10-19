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
const [{ createHydroSettings }, { genericFeatureGeometryKind }, { prepareProjectForStorage }, { normalizeColorValue }] = await Promise.all([
  loadWebOracle('assets/js/modules/physical-settings.js'),
  loadWebOracle('assets/js/modules/generic-feature-service.js'),
  loadWebOracle('assets/js/modules/project-state.js'),
  import(new URL('assets/js/modules/color-adapter.js', root)),
]);
const environment = await readFile(new URL('assets/js/modules/app-environment.js', root), 'utf8');
export const originalHydroToolConfig = Object.fromEntries(['river', 'lake'].map(category => {
  const color = new RegExp(`${category}: Object\\.freeze\\(\\{[^\\n]+color: '(#[a-f0-9]{6})'`).exec(environment)?.[1];
  if (!color) throw new Error(`Missing original hydro tool color: ${category}`);
  return [category, { color }];
}));

export function originalHydroCreate(input, seed) {
  const owner = createHydroSettings();
  owner.connect({ objectPresentation: { genericFeatureGeometryKind }, colorModel: { normalizeEditorColor: normalizeColorValue },
    hydroPresentation: { HYDRO_TOOL_CONFIG: originalHydroToolConfig } });
  const normalized = owner.normalizeHydroEdit(structuredClone(input));
  const project = structuredClone(seed);
  project.hydroEdits = [normalized];
  // The detached input retains every other seed field; only old hydro-specific view keys refer to absent objects.
  project.layerPresentation.objectStyles = Object.fromEntries(Object.entries(project.layerPresentation.objectStyles).filter(([key]) => !key.startsWith('hydro:')));
  project.layerPresentation.objectOrder = project.layerPresentation.objectOrder.filter(key => !key.startsWith('hydro:'));
  project.itemVisibility = Object.fromEntries(Object.entries(project.itemVisibility).filter(([key]) => !key.startsWith('hydro:')));
  return { normalized, saved: prepareProjectForStorage(project).hydroEdits[0] };
}
