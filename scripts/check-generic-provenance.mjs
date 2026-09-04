import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  normalizeGenericFeatureCollection,
} from '../assets/js/modules/generic-feature-service.js';
import {
  SOURCE_PROVENANCE_SCHEMA_VERSION,
} from '../assets/js/modules/source-provenance.js';
import { MAP_OBJECT_TYPES } from '../assets/js/modules/map-object-categories.js';
import { objectActionApplies } from '../assets/js/modules/object-action-registry.js';

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

const legacy = {
  type: 'Feature',
  id: 'legacy-generic',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: {
    schemaVersion: 1,
    name: 'legacy',
    role: 'territory',
    ownerId: 'country-a',
    landBinding: 'hard',
    category: 'custom',
    source: { format: 'geojson', provider: 'old-provider' },
  },
};
const [normalized] = normalizeGenericFeatureCollection([legacy]);
if (normalized.properties.schemaVersion !== GENERIC_FEATURE_SCHEMA_VERSION) fail('legacy Generic Feature does not normalize to v2');
const canonicalKeys = [...GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS].sort();
if (JSON.stringify(Object.keys(normalized.properties).sort()) !== JSON.stringify(canonicalKeys)) {
  fail('Generic Feature v2 leaked non-canonical top-level properties');
}
if (normalized.properties.source?.details?.legacyGenericSemantics?.ownerId !== 'country-a') {
  fail('legacy Generic territorial semantics were not preserved in provenance details');
}
if (normalized.properties.source?.details?.legacyProperties?.category !== 'custom') {
  fail('legacy Generic extension properties were not preserved in provenance details');
}
if (normalized.properties.source?.details?.unmappedSourceFields?.provider !== 'old-provider') {
  fail('legacy source metadata was not preserved in provenance details');
}

const staticUiSource = read('index.html');
for (const marker of ['constrainGenericFallbackUi', 'genericFeatureLandRelationSection', 'genericFeatureLandActionsSection']) {
  if (!staticUiSource.includes(marker)) fail(`canonical Generic fallback UI is missing marker: ${marker}`);
}
const projectStateSource = read('assets/js/modules/project-state.js');
for (const marker of ['validateSourceProvenance', 'GENERIC_PROPERTY_KEYS', 'migrateProjectInPlace(project)']) {
  if (!projectStateSource.includes(marker)) fail(`project schema is missing Generic/provenance migration marker: ${marker}`);
}
const migrationSource = read('assets/js/modules/project-migrations.js');
for (const marker of ['normalizeGenericFeatureCollection', 'legacyDrawings', "purpose: 'lossless-fallback'"]) {
  if (!migrationSource.includes(marker)) fail(`project migration is missing Generic lossless marker: ${marker}`);
}
const serializerSource = read('assets/js/modules/project-serializer.js');
for (const marker of ["purpose: 'lossless-fallback'", 'directCreation: false', 'sourceProvenanceSchemaVersion']) {
  if (!serializerSource.includes(marker)) fail(`serializer is missing Generic fallback contract marker: ${marker}`);
}
const invariantsSource = read('assets/js/modules/project-invariants.js');
if (!invariantsSource.includes('PL-INV-GENERIC-SOURCE')) fail('runtime project invariants do not validate Generic source provenance');

if (failures.length) {
  console.error(`Generic/provenance architecture audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('Generic/provenance audit passed: Generic Feature is a lossless fallback with canonical source provenance.');
}
