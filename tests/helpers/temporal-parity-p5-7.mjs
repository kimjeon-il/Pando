import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const territorial = id => ({ domain: 'territorial', id });
const hydroId = '22000000-0000-4000-8000-000000000005';
const successorName = 'B 후계 🌍 e\u0301';
const successorColor = 0x445566;
const successorFlag = {
  policy: 'none', embeddedDataUrl: '', defaultCountryId: '', defaultFlagDataUrl: null,
};

/** Small current-schema inputs only; no catalog, model factory or temporal resolver. */
export async function loadTemporalParityFixture() {
  const initial = JSON.parse(await readFile(new URL(
    '../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const source = structuredClone(initial);
  source.documentId = '32000000-0000-4000-8000-000000000007';
  source.projectSetup.sourceMode = 'builtin';
  const records = source.timelineRecords;
  const ownerRows = (rows, id) => rows.filter(row =>
    row.objectRef.domain === 'territorial' && row.objectRef.id === id);

  // September's first binding is visible before October's geometry/parent replacement.
  for (const row of ownerRows(records.lifetimes, 'B')) row.validFrom = '2026-09-15';
  for (const key of ['geometryBindings', 'parentRelations']) {
    const first = ownerRows(records[key], 'B')[0];
    first.validFrom = '2026-09-15';
    first.validTo = '2026-10-19';
    const next = { ...structuredClone(first), id: `${first.id}:successor`,
      validFrom: '2026-10-20', validTo: null };
    if (key === 'geometryBindings') next.geometryRef.version = 2;
    else { next.parentId = ''; next.coverageMode = 'explicit'; }
    records[key].push(next);
  }
  records.propertyBindings.push(...[
    ['name', { name: successorName, nameExplicit: true }],
    ['color', { color: successorColor, explicitColor: true }],
    ['flag', successorFlag],
  ].map(([property, value]) => ({
    id: `p5-7:${property}:B`, objectRef: territorial('B'),
    validFrom: '2026-10-20', validTo: null, property, value: structuredClone(value),
  })));
  // Give the successor a flag to clear, in addition to changing its name/color.
  source.territorialEntities.find(row => row.id === 'B').properties.metadata.flagDataUrl =
    source.territorialEntities.find(row => row.id === 'A').properties.metadata.flagDataUrl;

  // Month-end is inclusive: C remains in September; R exists only on October 31.
  for (const key of ['lifetimes', 'geometryBindings', 'parentRelations']) {
    for (const row of ownerRows(records[key], 'C')) row.validTo = '2026-09-30';
    for (const row of ownerRows(records[key], 'R')) {
      row.validFrom = '2026-10-31';
      row.validTo = '2026-10-31';
    }
  }
  for (const key of ['lifetimes', 'geometryBindings']) {
    for (const row of records[key].filter(row => row.objectRef.domain === 'hydro'))
      row.validTo = '2026-10-31';
  }

  const initialJson = JSON.stringify(initial);
  const sourceJson = JSON.stringify(source);
  const sourceBytes = new Uint8Array(Buffer.from(sourceJson, 'utf8'));
  const fingerprint = createHash('sha256').update(sourceBytes).digest('hex');
  const months = ['2026-08', '2026-09', '2026-10', '2026-11'];
  const sourceFor = month => ({
    kind: 'stored-asset', sourceBytes: new Uint8Array(sourceBytes), encoding: 'identity',
    compressedBytes: sourceBytes.byteLength, decodedBytes: sourceBytes.byteLength,
    baseDataset: source.baseDataset, sourceMonth: month, fingerprint,
  });
  const setupFor = month => ({
    initialMonth: month, timelineRange: null, initialMapBounds: null, sourceMode: 'builtin',
  });
  const successor = {
    objectRef: territorial('B'), geometryRef: { id: 'shape', version: 2 },
    parentId: '', coverageMode: 'explicit', rootId: 'B', ancestors: [],
    validFrom: '2026-09-15', validTo: null,
    properties: {
      name: { name: successorName, nameExplicit: true },
      color: { color: successorColor, explicitColor: true },
      flag: structuredClone(successorFlag),
    },
  };
  // These are explicit scenario facts, not a second implementation of resolution.
  const expected = {
    '2026-08': {
      visible: [territorial('A'), territorial('C'), { domain: 'hydro', id: hydroId }],
      absent: [territorial('B'), territorial('R')], rows: [],
    },
    '2026-09': {
      visible: [territorial('A'), territorial('B'), territorial('C'), { domain: 'hydro', id: hydroId }],
      absent: [territorial('R')],
      rows: [{ objectRef: territorial('C'), geometryRef: { id: 'shape', version: 1 },
        validFrom: null, validTo: '2026-09-30' },
        { objectRef: territorial('B'), geometryRef: { id: 'shape', version: 1 },
          parentId: 'A', coverageMode: 'partition', rootId: 'A', ancestors: ['A'],
          validFrom: '2026-09-15', validTo: null }],
    },
    '2026-10': {
      visible: [territorial('A'), territorial('B'), territorial('R'), { domain: 'hydro', id: hydroId }],
      absent: [territorial('C')],
      rows: [successor, { objectRef: territorial('R'),
        validFrom: '2026-10-31', validTo: '2026-10-31' }],
    },
    '2026-11': {
      visible: [territorial('A'), territorial('B')],
      absent: [territorial('C'), territorial('R'), { domain: 'hydro', id: hydroId }],
      rows: [structuredClone(successor)],
    },
  };
  return {
    initialJson, sourceJson, sourceBytes, fingerprint, months, sourceFor, setupFor, expected,
    documentId: '32000000-0000-4000-8000-000000000008',
    provenance: { dataRevision: 'p5-7-fixed-fixture', manifestSha256: '5'.repeat(64) },
    preciseCoordinate: 1.2345678901234567,
    shapeVersions: [1, 2], successorName, successorColor, successorFlag: structuredClone(successorFlag),
  };
}

const disposedError = () => Object.assign(
  new Error('PL-CORE-DISPOSED: The temporal parity session is disposed.'),
  { code: 'PL-CORE-DISPOSED' });
const typedSource = source => ({ ...source, sourceBytes:
  source.sourceBytes instanceof Uint8Array ? source.sourceBytes : new Uint8Array(source.sourceBytes) });

/** Test transport adapter only: all document behavior runs in the verified WASM. */
export async function createWasmAdapter(options = {}) {
  const { loadNodeCore } = await import("../../tools/build/load-node-core.mjs");
  const core = await loadNodeCore(options);
  const owner = new core.DocumentSession({ validateFlagDataUrl() {} });
  let disposed = false;
  function dispose() {
    if (!disposed) { disposed = true; owner.delete(); }
  }
  function dispatch({ op, args = {} }) {
    try {
      if (op === 'dispose') { dispose(); return { ok: true, result: null }; }
      if (disposed) throw disposedError();
      let result;
      switch (op) {
        case 'documentLoad': result = owner.documentLoad(args.json, args.month); break;
        case 'documentSnapshot': result = JSON.stringify(owner.documentSnapshot()); break;
        case 'projectState': case 'storageSnapshot': case 'temporalSourceStats':
        case 'selectionSnapshot': case 'draftSnapshot': result = owner[op](); break;
        case 'resolveWorld': case 'setTimelineCursor':
          result = owner[op](args.month, args.expectedEpoch); break;
        case 'captureReplacement': case 'undo': case 'redo': case 'markSaved':
          result = owner[op](args.expectedEpoch); break;
        case 'rollbackReplacement':
          result = owner.rollbackReplacement(args.id, args.expectedEpoch); break;
        case 'releaseReplacement': result = owner.releaseReplacement(args.id); break;
        case 'temporalSourcePrepare':
          result = owner.temporalSourcePrepare({ ...args, source: typedSource(args.source) }); break;
        case 'storageBaselineLoad':
          result = owner.storageBaselineLoad(typedSource(args.source), args.expectedEpoch); break;
        case 'documentLoadBaseline':
          result = owner.documentLoadBaseline(args.storageBaselineId, args.setup); break;
        case 'temporalSourceRelease': case 'temporalCandidatePrepare':
        case 'temporalCandidateInspect': case 'temporalCandidateDiscard':
        case 'temporalCandidateAdopt': case 'selectionApply': case 'draftApply':
          result = owner[op](args); break;
        case 'command': result = owner.executeCommand(args); break;
        default: throw Object.assign(new Error(`Unknown parity operation: ${op}`),
          { code: 'P5_7_UNKNOWN_OPERATION' });
      }
      return { ok: true, result: result ?? null };
    } catch (error) {
      return { ok: false, error: { code: error.code || 'CORE_SESSION_ERROR', message: error.message } };
    }
  }
  return {
    dispatch, dispose,
    identity: { abiVersion: core.coreAbiVersion, sourceSha256: core.coreSourceSha256,
      compilerVersion: core.coreCompilerVersion },
  };
}
