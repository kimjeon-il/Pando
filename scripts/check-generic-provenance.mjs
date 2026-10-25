import {renderProductHtml} from './lib/product-html.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  normalizeGenericFeatureCollection,
} from "../apps/editor/frontend/js/modules/generic-feature-service.js";
import {
  SOURCE_PROVENANCE_SCHEMA_VERSION,
} from "../shared/frontend/js/modules/source-provenance.js";
import { MAP_OBJECT_TYPES } from "../shared/frontend/js/modules/map-object-categories.js";
import { objectActionApplies } from "../apps/editor/frontend/js/modules/object-action-registry.js";

const root = process.cwd();
const failures = [];
const fail = message => failures.push(message);
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

if (GENERIC_FEATURE_SCHEMA_VERSION !== 2) fail('Generic Feature canonical schema must be v2');
if (SOURCE_PROVENANCE_SCHEMA_VERSION !== 1) fail('Source provenance canonical schema must be v1');
if (MAP_OBJECT_TYPES.generic.creatable !== false || MAP_OBJECT_TYPES.generic.fallbackOnly !== true) {
  fail('Generic Feature must remain non-creatable and fallbackOnly');
}
const allowedActions = MAP_OBJECT_TYPES.generic.allowedActions || [];
if (JSON.stringify(allowedActions) !== JSON.stringify(['focus', 'lock', 'delete'])) {
  fail('Generic Feature allowed actions must stay limited to focus/lock/delete');
}
if (objectActionApplies('coast-reconcile', { domain: 'generic', type: 'feature' })) {
  fail('Generic Feature may not participate in territorial coast reconciliation');
}

const current = {
  type: 'Feature', id: 'current-generic', geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { schemaVersion: 2, name: 'current', source: {
    kind: 'gis', sourceFormat: 'geojson', details: { attributes: { category: 'custom' } },
  } },
};
const [normalized] = normalizeGenericFeatureCollection([current]);
const canonicalKeys = [...GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS].sort();
if (JSON.stringify(Object.keys(normalized.properties).sort()) !== JSON.stringify(canonicalKeys))
  fail('Generic Feature v2 leaked non-canonical top-level properties');
if (normalized.properties.source.details.attributes.category !== 'custom') fail('GIS source attributes were not preserved');
for (const properties of [{ schemaVersion: 1 }, { schemaVersion: 2, role: 'territory' }]) {
  let rejected = false;
  try { normalizeGenericFeatureCollection([{ ...current, properties }]); } catch { rejected = true; }
  if (!rejected) fail('Retired Generic schema/fields were accepted');
}

const staticUiSource = renderProductHtml(read).editor;
for (const marker of ['genericFeatureConversionSection', 'convertGenericFeatureBtn']) {
  if (!staticUiSource.includes(marker)) fail(`canonical Generic fallback UI is missing marker: ${marker}`);
}
const projectStateSource = read('shared/frontend/js/modules/project-state.js');
for (const marker of ['validateSourceProvenance', 'GENERIC_PROPERTY_KEYS']) {
  if (!projectStateSource.includes(marker)) fail(`project schema is missing Generic/provenance validation marker: ${marker}`);
}
const serializerSource = read('apps/editor/frontend/js/modules/project-serializer.js');
for (const marker of ["purpose: 'lossless-fallback'", 'directCreation: false', 'sourceProvenanceSchemaVersion']) {
  if (!serializerSource.includes(marker)) fail(`serializer is missing Generic fallback contract marker: ${marker}`);
}
const invariantsSource = read('shared/frontend/js/modules/project-invariants.js');
if (!invariantsSource.includes('PL-INV-GENERIC-SOURCE')) fail('runtime project invariants do not validate Generic source provenance');

if (failures.length) {
  console.error(`Generic/provenance architecture audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('Generic/provenance audit passed: Generic Feature is a lossless fallback with canonical source provenance.');
}
