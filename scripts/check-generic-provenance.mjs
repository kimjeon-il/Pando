import {renderProductHtml} from './lib/product-html.mjs';
import {createInitialDocument} from '../src/document/initial-document.js';
import {assertCurrentProjectSchema} from '../src/document/project-state.js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  GENERIC_FEATURE_CANONICAL_PROPERTY_KEYS,
  GENERIC_FEATURE_SCHEMA_VERSION,
  normalizeGenericFeatureCollection,
} from "../src/document/generic-feature-normalization.js";
import {
  SOURCE_PROVENANCE_SCHEMA_VERSION,
} from "../src/document/source-provenance.js";

const root = process.cwd();
const failures = [];
const fail = message => failures.push(message);
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

if (GENERIC_FEATURE_SCHEMA_VERSION !== 2) fail('Generic Feature canonical schema must be v2');
if (SOURCE_PROVENANCE_SCHEMA_VERSION !== 1) fail('Source provenance canonical schema must be v1');
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

const staticUiSource = renderProductHtml(read).web;
if (!staticUiSource.includes('id="reviewPanel"') || !staticUiSource.includes('id="reviewSourceLinks"'))
  fail('Canonical Viewer is missing the read-only review and provenance interface');
for (const retired of ['genericFeatureConversionSection', 'convertGenericFeatureBtn', 'editorSurface']) {
  if (staticUiSource.includes('id="'+retired+'"'))
    fail('Retired GIS editing UI entered the Viewer: '+retired);
}
// The documented project header is emitted and validated by production
// factories. Renaming internal validator helpers cannot invalidate this gate.
const project=createInitialDocument({appVersion:'provenance-contract'});
try{
  const validated=assertCurrentProjectSchema(project);
  if(validated.landObjectModel?.purpose!=='lossless-fallback'
     ||validated.landObjectModel.directCreation!==false
     ||validated.landObjectModel.sourceProvenanceSchemaVersion!==SOURCE_PROVENANCE_SCHEMA_VERSION)
    fail('Current serialized document no longer admits Generic Feature provenance as a lossless fallback');
}catch(error){fail('Current project provenance schema rejected its own generated document: '+error.message);}

if (failures.length) {
  console.error(`Generic/provenance architecture audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('Generic/provenance audit passed: Generic Feature is a lossless fallback with canonical source provenance.');
}
