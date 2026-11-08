import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
const runtimePath = resolve(process.env.PANDOEDITOR_WASM_MODULE ?? fileURLToPath(new URL("../../../assets/wasm/pandoeditor-core.js",import.meta.url)));
const [jsBytes, wasmBytes, seedBytes] = await Promise.all([
  readFile(runtimePath), readFile(runtimePath.replace(/\.js$/, '.wasm')),
  readFile(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url)),
]);
const { default: createCore } = await import(pathToFileURL(runtimePath));
const core = await createCore({ wasmBinary: wasmBytes });
const seed = JSON.parse(seedBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { sourceSha256: core.coreSourceSha256, compilerVersion: core.coreCompilerVersion,
  jsSha256: hash(jsBytes), wasmSha256: hash(wasmBytes),
  fixtureSchema: 14 };
const cases = [
  ['existing ASCII ID', 'A', true],
  ['long ordinary emoji ID', `territory-${'x'.repeat(64)}😀-tail`, true],
  ['short high lone surrogate ID', 'n\ud800x', false],
  ['short low lone surrogate ID', 'n\udfff x', false],
  ['long high lone surrogate ID', `territory-${'x'.repeat(64)}\ud800-tail`, false],
  ['long low lone surrogate ID', `territory-${'x'.repeat(64)}\udfff-tail`, false],
];
const utf16 = text => Array.from({ length: text.length }, (_, index) =>
  text.charCodeAt(index).toString(16).padStart(4, '0'));

function seedWithIds(id) {
  const geometryId = id === 'A' ? 'shape' : `geometry:${id}`;
  const replacements = new Map([
    ['A', id], ['shape', geometryId], ['territorial:entity:A', `territorial:entity:${id}`],
    ['life:A', `life:${id}`], ['shape:A', `shape:${id}`], ['parent:A', `parent:${id}`],
  ]);
  const convert = value => {
    if (typeof value === 'string') return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [replacements.get(key) ?? key, convert(child)]));
    return value;
  };
  const input = convert(seed);
  // Renaming "shape" to "geometry:…" moves its versions ahead of "label".
  // This expected order is independent of the production geometry registry.
  input.geometries.sort((a,b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.version-b.version);
  return input;
}
const worldDto = world => ({ month: world.month, entities: world.entities.map(row => ({
  objectRef: structuredClone(row.objectRef), geometryRef: structuredClone(row.geometryRef), parentId: row.parentId,
  coverageMode: row.coverageMode, rootId: row.rootId, ancestors: [...row.ancestors],
  validFrom: row.validFrom, validTo: row.validTo, properties: structuredClone(row.properties), rendering: structuredClone(row.rendering),
})) });
function expectedWorld(id) {
  const geometryId = id === 'A' ? 'shape' : `geometry:${id}`;
  const row = (domain, entityId, geometry, parentId = '', ancestors = []) => ({
    objectRef: { domain, id: entityId }, geometryRef: { id: geometry, version: 1 },
    parentId, coverageMode: parentId ? 'partition' : 'explicit', rootId: parentId || entityId,
    ancestors, validFrom: null, validTo: null, properties: {}, rendering: {},
  });
  return { month: '2026-10', entities: [
    row('territorial', id, geometryId), row('territorial', 'B', geometryId, id, [id]),
    row('territorial', 'C', geometryId), row('territorial', 'R', geometryId),
    row('hydro', '22000000-0000-4000-8000-000000000005', 'fixture-water:22000000-0000-4000-8000-000000000005'),
  ] };
}

for (const [label, id, selectable] of cases) {
  test(`actual WASM preserves ${label} in snapshots and typed ID outputs`, async t => {
    const expected = seedWithIds(id);
    const document = new core.DocumentSession({ validateFlagDataUrl() {} });
    try {
      const state = document.documentLoad(JSON.stringify(expected), '2026-10');
      assert.equal(Object.hasOwn(core,'CoreSession'),false);
      const loadedTimeline = document.documentSnapshot().timelineRecords;
      const actualWorld = document.resolveWorld('2026-10', state.epoch);
      const ref = { domain: 'territorial', type: 'entity', id };
      let actualSelectionError = null, actualSelection = null;
      try { actualSelection = document.selectionApply({ action: 'replace', ref, expectedEpoch: state.epoch }).selection; }
      catch (error) { actualSelectionError = error; }
      const readSelection = document.selectionSnapshot();
      if (id === 'A') t.diagnostic(JSON.stringify(identity));
      t.diagnostic(JSON.stringify({ idUtf16Length: id.length, idUtf16Tail: utf16(id).slice(-8),
        selectable,
        actualSelectionError: actualSelectionError?.name ?? null,
        actualSelectedIdUtf16Tail: actualSelection?.primary ? utf16(actualSelection.primary.id).slice(-8) : null,
        readSelectedIdUtf16Tail: readSelection.primary ? utf16(readSelection.primary.id).slice(-8) : null }));

      await t.test('full storage and file export preserve exact UTF-16 IDs', () => {
        assert.deepEqual(JSON.parse(document.storageSnapshot()), expected);
        const context = { expectedEpoch: state.epoch, version: '0.99.0',
          savedAt: '2026-10-13T00:00:00.000Z', format: 'pandolab-project-state' };
        const exported = document.exportSnapshot(context);
        assert.deepEqual(JSON.parse(exported.storageJson), { ...expected,
          version: context.version, savedAt: context.savedAt, format: context.format });
      });
      await t.test('the whole-document projection preserves current typed timeline record IDs', () => {
        assert.deepEqual(loadedTimeline,expected.timelineRecords);
      });
      await t.test('typed resolveWorld preserves every territorial/hydro ID and relationship field', () => {
        assert.deepEqual(worldDto(actualWorld), expectedWorld(id));
      });
      await t.test('typed selection accepts Unicode scalars and rejects lone surrogates atomically', () => {
        if (!selectable) {
          assert.ok(actualSelectionError, 'Lone-surrogate selection keys must remain rejected.');
          assert.deepEqual(readSelection, { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null });
        } else {
          assert.equal(actualSelectionError, null);
          assert.deepEqual(actualSelection, { selectionRevision: 1, hoverRevision: 0, items: [ref], primary: ref, hover: null });
          assert.deepEqual(readSelection, actualSelection);
        }
      });
    } finally { document.delete(); }
  });
}
