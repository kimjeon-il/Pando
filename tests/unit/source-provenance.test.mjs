import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_KINDS,
  SOURCE_PROVENANCE_SCHEMA_VERSION,
  normalizeSourceProvenance,
  validateSourceProvenance,
} from "../../shared/frontend/js/modules/source-provenance.js";

test('source provenance uses canonical fields and preserves external source metadata', () => {
  const source = normalizeSourceProvenance({
    kind: 'gis', dataset: 'roads', sourceId: 'R1', sourceFormat: 'geojson', sourceType: 'road', provider: 'external',
  });
  assert.equal(source.schemaVersion, SOURCE_PROVENANCE_SCHEMA_VERSION);
  assert.equal(source.kind, SOURCE_KINDS.GIS);
  assert.equal(source.sourceId, 'R1');
  assert.equal(source.sourceFormat, 'geojson');
  assert.equal(source.sourceType, 'road');
  assert.equal(source.details.unmappedSourceFields.provider, 'external');
  assert.equal(validateSourceProvenance(source).ok, true);
});

test('unknown provenance kind becomes explicit unsupported fallback', () => {
  const source = normalizeSourceProvenance({ kind: 'mystery', dataset: 'legacy' });
  assert.equal(source.kind, SOURCE_KINDS.UNSUPPORTED);
  assert.equal(validateSourceProvenance(source).ok, true);
});

test('canonical provenance validation rejects ad-hoc top-level fields', () => {
  const source = { ...normalizeSourceProvenance({ kind: 'library' }), provider: 'bad-top-level' };
  const result = validateSourceProvenance(source);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes('unsupported source provenance field')));
});

test('retired provenance aliases and string input are rejected', () => {
  for (const input of ['old-dataset', { id: 'old' }, { format: 'geojson' }, { type: 'road' }])
    assert.throws(() => normalizeSourceProvenance(input));
});
