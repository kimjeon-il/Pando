import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadTemporalParityFixture, createWasmAdapter } from '../helpers/temporal-parity-p5-7.mjs';

const fixture = await loadTemporalParityFixture();
const evidence = { schema: 'pando-p5-7-equivalence-v1', fixtureSha256: fixture.fingerprint,
  fixtureBytes: fixture.sourceBytes.byteLength, months: fixture.months,
  pairedCalls: 0, failureCodes: {}, cases: [], observations: [], teardownFailures: [] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wire = value => JSON.parse(JSON.stringify(value, (_, item) =>
  item instanceof Uint8Array ? [...item] : item));
const semantic = (op, value) => ['documentSnapshot', 'storageSnapshot'].includes(op)
  ? JSON.parse(value) : wire(value);

// A transport boundary only. Every operation is executed by the compiled Core.
function nativeAdapter() {
  const binary = resolve(process.env.PANDO_TEMPORAL_NATIVE || 'build-native/core/temporal-parity-probe');
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = [];
  let errors = '', closed = false;
  child.stderr.on('data', chunk => { errors += chunk; });
  const rejectAll = error => { while (pending.length) pending.shift().reject(error); };
  child.on('error', rejectAll);
  const ended = new Promise(resolveEnd => child.on('close', (code, signal) => {
    closed = true;
    rejectAll(new Error(`Native probe closed (${code ?? signal}): ${errors}`));
    resolveEnd(code);
  }));
  createInterface({ input: child.stdout }).on('line', line => {
    const next = pending.shift();
    if (!next) return;
    try { next.resolve(JSON.parse(line)); } catch (error) { next.reject(error); }
  });
  return {
    dispatch(request) {
      assert.equal(closed, false, 'native probe must remain alive');
      return new Promise((resolveResult, reject) => {
        pending.push({ resolve: resolveResult, reject });
        child.stdin.write(JSON.stringify(wire(request)) + '\n');
      });
    },
    async dispose() {
      child.stdin.end();
      assert.equal(await ended, 0, `native probe exit: ${errors}`);
    },
  };
}

async function pair(t) {
  const wasm = await createWasmAdapter();
  const native = nativeAdapter();
  t.after(async () => {
    try { wasm.dispose(); await native.dispose(); }
    catch (error) { evidence.teardownFailures.push(error.message); throw error; }
  });
  evidence.identity = wasm.identity;
  async function step(op, args = {}, expectedCode) {
    // Compare actual compiled runtimes, never native output with a JS oracle.
    const [n, w] = await Promise.all([native.dispatch({ op, args }), wasm.dispatch({ op, args })]);
    evidence.pairedCalls++;
    assert.equal(n.ok, w.ok, `${op}: native/WASM success status\n${JSON.stringify({ n, w })}`);
    if (!n.ok) {
      assert.equal(n.error.code, w.error.code, `${op}: failure code`);
      assert.ok(n.error.message && w.error.message, `${op}: diagnostic must survive`);
      assert.ok(expectedCode, `${op}: unexpected failure ${JSON.stringify({ n, w })}`);
      assert.equal(n.error.code, expectedCode, `${op}: expected failure`);
      evidence.failureCodes[expectedCode] = (evidence.failureCodes[expectedCode] || 0) + 1;
      return n.error;
    }
    assert.equal(expectedCode, undefined, `${op}: failure injection must reject`);
    assert.deepEqual(semantic(op, n.result), semantic(op, w.result), `${op}: native/WASM result`);
    return semantic(op, n.result);
  }
  async function baseline(source, setup) {
    const before = await step('projectState');
    const admitted = await step('storageBaselineLoad', { source, expectedEpoch: before.epoch });
    // WASM generates a fresh document ID. Feed that observed ID into the native
    // baseline and candidate paths; no identity fields are removed from equality.
    const wasmResult = wasm.dispatch({ op: 'documentLoadBaseline',
      args: { storageBaselineId: admitted.storageBaselineId, setup } });
    assert.equal(wasmResult.ok, true, JSON.stringify(wasmResult));
    const snapshot = wasm.dispatch({ op: 'documentSnapshot' });
    assert.equal(snapshot.ok, true);
    const documentId = JSON.parse(snapshot.result).documentId;
    const nativeResult = await native.dispatch({ op: 'documentLoadBaseline',
      args: { storageBaselineId: admitted.storageBaselineId, setup, documentId } });
    evidence.pairedCalls++;
    assert.equal(nativeResult.ok, true, JSON.stringify(nativeResult));
    assert.deepEqual(nativeResult.result, wire(wasmResult.result));
    await step('documentSnapshot');
    return documentId;
  }
  await step('documentLoad', { json: fixture.initialJson, month: '2026-10' });
  return { step, baseline, native, wasm };
}

async function capture(p) {
  const snapshot = {};
  for (const op of ['projectState', 'documentSnapshot', 'storageSnapshot', 'selectionSnapshot', 'draftSnapshot'])
    snapshot[op] = await p.step(op);
  return snapshot;
}
async function prepare(p, month, documentId = fixture.documentId) {
  const state = await p.step('projectState');
  const source = fixture.sourceFor(month);
  const admitted = await p.step('temporalSourcePrepare', {
    source, ...fixture.provenance, expectedEpoch: state.epoch });
  const receipt = await p.step('temporalCandidatePrepare', {
    sourceId: admitted.sourceId, targetMonth: month, sourceFingerprint: source.fingerprint,
    expectedEpoch: state.epoch, setup: fixture.setupFor(month), documentId });
  return receipt;
}
function adoptArgs(receipt, replacementId) {
  const { candidateId, sourceId, targetMonth, sourceFingerprint, worldSha256, expectedEpoch } = receipt;
  return { candidateId, sourceId, targetMonth, sourceFingerprint, worldSha256, replacementId, expectedEpoch };
}
function assertFixtureWorld(world, month) {
  assert.equal(world.month, month);
  const expected = fixture.expected[month], key = ref => `${ref.domain}:${ref.id}`;
  const rows = new Map(world.entities.map(row => [key(row.objectRef), row]));
  assert.equal(world.entities.length, expected.visible.length, 'no duplicate or extra resolved objects');
  assert.equal(rows.size, world.entities.length, 'resolved object identities are unique');
  assert.deepEqual([...rows.keys()].sort(), expected.visible.map(key).sort(), 'complete visible object set');
  for (const ref of expected.absent) assert.equal(rows.has(key(ref)), false, `${month}: ${key(ref)} absent`);
  for (const expectedRow of expected.rows) {
    const actual = rows.get(key(expectedRow.objectRef));
    for (const [field, expectedValue] of Object.entries(expectedRow))
      assert.deepEqual(actual[field], expectedValue, `${month}: ${key(expectedRow.objectRef)} ${field}`);
  }
}
function scenario(name, callback) {
  test(name, { timeout: 30_000 }, async t => {
    try { await callback(t); evidence.cases.push({ name, status: 'passed' }); }
    catch (error) { evidence.cases.push({ name, status: 'failed', message: error.message }); throw error; }
  });
}

scenario('P5-7 same-source native/WASM month endpoints, geometry, attributes and full-path oracle', async t => {
  const candidate = await pair(t), oracle = await pair(t);
  const manifest = JSON.parse(await readFile('shared/frontend/static/wasm/pandoeditor-core.manifest.json', 'utf8'));
  assert.equal(evidence.identity.sourceSha256, manifest.sourceSha256);
  assert.equal(evidence.identity.abiVersion, 1);
  assert.equal(evidence.identity.compilerVersion, '6.0.3');
  for (const month of fixture.months) {
    const documentId = await oracle.baseline(fixture.sourceFor(month), fixture.setupFor(month));
    const before = await capture(candidate);
    const receipt = await prepare(candidate, month, documentId);
    const inspected = await candidate.step('temporalCandidateInspect', {
      candidateId: receipt.candidateId, expectedEpoch: receipt.expectedEpoch });
    assertFixtureWorld(inspected.world, month);
    assert.deepEqual(await capture(candidate), before, 'source/candidate preparation is read-only');
    const capsule = await candidate.step('captureReplacement', { expectedEpoch: receipt.expectedEpoch });
    const adopted = await candidate.step('temporalCandidateAdopt', adoptArgs(receipt, capsule));
    assert.equal(adopted.timelineCursor, month);
    assert.equal(adopted.dirty, false); assert.equal(adopted.canUndo, false); assert.equal(adopted.canRedo, false);
    const projected = await candidate.step('documentSnapshot');
    assert.deepEqual(projected, await oracle.step('documentSnapshot'), 'candidate vs original full path');
    assert.deepEqual(await candidate.step('storageSnapshot'), await oracle.step('storageSnapshot'), 'stored geometry/properties');
    const shapeV2 = projected.geometries.find(row => row.id === 'shape' && row.version === 2);
    assert.ok(shapeV2, 'geometry version 2 archive retained');
    assert.equal(shapeV2.geojson.coordinates[0][2][0], fixture.preciseCoordinate, 'geometry coordinate precision retained');
    assert.equal((await candidate.step('temporalSourceStats')).entries, 0);
    assert.equal(await candidate.step('releaseReplacement', { id: capsule }), true);
    evidence.observations.push({ month, visible: inspected.world.entities.map(row => row.objectRef),
      worldSha256: receipt.worldSha256, projectSha256: digest(projected) });
  }
});

scenario('P5-7 invalid bytes, schema, source pins and candidate requests preserve active state', async t => {
  const p = await pair(t), original = await capture(p);
  const epoch = original.projectState.epoch, source = fixture.sourceFor('2026-10');
  const sourceArgs = { source, ...fixture.provenance, expectedEpoch: epoch };
  const admitted = await p.step('temporalSourcePrepare', sourceArgs);
  const receipt = await p.step('temporalCandidatePrepare', { sourceId: admitted.sourceId,
    targetMonth: '2026-10', sourceFingerprint: source.fingerprint, expectedEpoch: epoch,
    setup: fixture.setupFor('2026-10'), documentId: fixture.documentId });
  const badBytes = new Uint8Array(source.sourceBytes); badBytes[0] ^= 1;
  const invalidSchema = JSON.parse(fixture.sourceJson); invalidSchema.schemaVersion = 999;
  const invalidSchemaBytes = new Uint8Array(Buffer.from(JSON.stringify(invalidSchema)));
  const invalidSource = { ...source, sourceBytes: invalidSchemaBytes,
    fingerprint: createHash('sha256').update(invalidSchemaBytes).digest('hex'),
    compressedBytes: invalidSchemaBytes.length, decodedBytes: invalidSchemaBytes.length };
  for (const [args, code] of [
    [{ ...sourceArgs, source: { ...source, sourceBytes: badBytes } }, 'PL-SCHEMA-BASE'],
    [{ ...sourceArgs, source: { ...source, compressedBytes: source.compressedBytes + 1 } }, 'PL-SCHEMA-BASE'],
    [{ ...sourceArgs, source: { ...source, decodedBytes: source.decodedBytes + 1 } }, 'PL-SCHEMA-BASE'],
    [{ ...sourceArgs, manifestSha256: '0' }, 'CORE_TEMPORAL_SOURCE_PIN'],
    [{ ...sourceArgs, source: invalidSource }, 'UNSUPPORTED_VERSION'],
    [{ ...sourceArgs, source: { ...source, decodedBytes: 64 * 1024 * 1024 + 1 } }, 'CORE_TEMPORAL_SOURCE_BUDGET'],
  ]) {
    await p.step('temporalSourcePrepare', args, code);
    assert.deepEqual(await capture(p), original, `${code}: active document unchanged`);
  }
  const candidateArgs = { sourceId: admitted.sourceId, targetMonth: '2026-10',
    sourceFingerprint: source.fingerprint, expectedEpoch: epoch,
    setup: fixture.setupFor('2026-10'), documentId: fixture.documentId };
  for (const [changes, code] of [
    [{ sourceId: 123456 }, 'CORE_TEMPORAL_CANDIDATE_SOURCE'],
    [{ sourceFingerprint: '0'.repeat(64) }, 'CORE_TEMPORAL_CANDIDATE_PIN'],
    [{ targetMonth: '2026-09' }, 'CORE_TEMPORAL_CANDIDATE_MONTH'],
    [{ targetMonth: '2026-13' }, 'PL-TEMPORAL-001'],
    [{ setup: fixture.setupFor('2026-09') }, 'CORE_TEMPORAL_CANDIDATE_SETUP'],
    [{ expectedEpoch: epoch + 1 }, 'STALE_REVISION'],
  ]) {
    await p.step('temporalCandidatePrepare', { ...candidateArgs, ...changes }, code);
    assert.deepEqual(await capture(p), original, `${code}: active document unchanged`);
  }
  assert.ok(await p.step('temporalCandidateInspect', { candidateId: receipt.candidateId, expectedEpoch: epoch }));
  assert.equal((await p.step('temporalSourceStats')).entries, 1, 'failed inputs allocate no source');
});

scenario('P5-7 stale candidates, A-B-A, disposal and file-open epoch invalidation', async t => {
  const p = await pair(t), before = await capture(p);
  const first = await prepare(p, '2026-09'), second = await prepare(p, '2026-10'), latest = await prepare(p, '2026-09');
  assert.ok(first.candidateId < second.candidateId && second.candidateId < latest.candidateId);
  for (const old of [first, second]) assert.equal(await p.step('temporalCandidateInspect', {
    candidateId: old.candidateId, expectedEpoch: old.expectedEpoch }), null);
  const capsule = await p.step('captureReplacement', { expectedEpoch: latest.expectedEpoch });
  await p.step('temporalCandidateAdopt', adoptArgs(first, capsule), 'CORE_TEMPORAL_CANDIDATE_STALE');
  assert.deepEqual(await capture(p), before);
  assert.equal(await p.step('temporalCandidateDiscard', { candidateId: latest.candidateId,
    expectedEpoch: latest.expectedEpoch }), true);
  assert.equal(await p.step('temporalCandidateDiscard', { candidateId: latest.candidateId,
    expectedEpoch: latest.expectedEpoch }), false);
  const pending = await prepare(p, '2026-10');
  const opened = JSON.parse(fixture.initialJson); opened.documentId = 'p5-7-user-file';
  const state = await p.step('documentLoad', { json: JSON.stringify(opened), month: '2026-10' });
  const loaded = await capture(p);
  assert.equal(loaded.documentSnapshot.documentId, opened.documentId);
  await p.step('temporalCandidateAdopt', adoptArgs(pending, capsule), 'STALE_REVISION');
  assert.equal(await p.step('temporalCandidateInspect', { candidateId: pending.candidateId,
    expectedEpoch: state.epoch }), null);
  assert.equal((await p.step('temporalSourceStats')).entries, 0);
  assert.deepEqual(await capture(p), loaded);
  await p.step('dispose'); await p.step('dispose');
  await p.step('projectState', {}, 'PL-CORE-DISPOSED');
});

scenario('P5-7 adoption receipt failures and post-adopt rollback restore edits, selection, draft and history', async t => {
  const p = await pair(t);
  let state = await p.step('projectState');
  const edited = await p.step('command', { commandId: 'territorial.field',
    payload: { id: 'A', field: 'name', value: '저장 전 편집' },
    targets: [{ domain: 'territorial', id: 'A' }], expectedEpoch: state.epoch });
  assert.equal(edited.ok, true); assert.equal(edited.changed, true);
  state = await p.step('projectState');
  await p.step('selectionApply', { action: 'replace', ref: { domain: 'territorial', type: 'entity', id: 'A' },
    scope: 'p5-7', expectedEpoch: state.epoch });
  await p.step('selectionApply', { action: 'setHover', ref: { domain: 'territorial', type: 'entity', id: 'B' },
    source: 'map', expectedEpoch: state.epoch });
  await p.step('draftApply', { action: 'start', shape: 'line', coords: [[1, 2], [3, 4]],
    inputPhase: 'refine', expectedEpoch: state.epoch });
  await p.step('draftApply', { action: 'append', coordinate: [5, 6], expectedEpoch: state.epoch });
  const before = await capture(p);
  assert.equal(before.projectState.dirty, true); assert.equal(before.projectState.canUndo, true);
  const receipt = await prepare(p, '2026-09');
  const capsule = await p.step('captureReplacement', { expectedEpoch: receipt.expectedEpoch });
  const args = adoptArgs(receipt, capsule);
  for (const [changes, code] of [
    [{ replacementId: capsule + 1 }, 'CORE_TEMPORAL_CANDIDATE_CAPSULE'],
    [{ candidateId: receipt.candidateId + 1 }, 'CORE_TEMPORAL_CANDIDATE_STALE'],
    [{ sourceId: receipt.sourceId + 1 }, 'CORE_TEMPORAL_CANDIDATE_PIN'],
    [{ sourceFingerprint: '0'.repeat(64) }, 'CORE_TEMPORAL_CANDIDATE_PIN'],
    [{ worldSha256: '0'.repeat(64) }, 'CORE_TEMPORAL_CANDIDATE_PIN'],
  ]) {
    await p.step('temporalCandidateAdopt', { ...args, ...changes }, code);
    assert.deepEqual(await capture(p), before, `${code}: rejected adoption is atomic`);
  }
  const adopted = await p.step('temporalCandidateAdopt', args);
  assert.equal(adopted.dirty, false);
  assert.equal((await p.step('selectionSnapshot')).primary, null);
  assert.equal((await p.step('draftSnapshot')).active, false);
  await p.step('temporalCandidateAdopt', { ...args, expectedEpoch: adopted.epoch }, 'CORE_TEMPORAL_CANDIDATE_STALE');
  // Models a later renderer/platform failure by invoking the real retained capsule.
  const restored = await p.step('rollbackReplacement', { id: capsule, expectedEpoch: adopted.epoch });
  assert.ok(restored.epoch > adopted.epoch, 'restoration invalidates late acknowledgements');
  const after = await capture(p);
  assert.deepEqual(after, { ...before, projectState: { ...before.projectState, epoch: restored.epoch } },
    'restore entire logical state; only epoch advances');
  assert.equal(await p.step('releaseReplacement', { id: capsule }), false);
  assert.equal((await p.step('temporalSourceStats')).entries, 0);
  const undo = await p.step('undo', { expectedEpoch: restored.epoch });
  assert.equal(undo.changed, true);
  const redo = await p.step('redo', { expectedEpoch: undo.state.epoch });
  assert.equal(redo.changed, true);
  assert.deepEqual(await p.step('storageSnapshot'), before.storageSnapshot, 'restored undo/redo remains operational');
  const retry = await prepare(p, '2026-11');
  const retryCapsule = await p.step('captureReplacement', { expectedEpoch: retry.expectedEpoch });
  assert.equal((await p.step('temporalCandidateAdopt', adoptArgs(retry, retryCapsule))).timelineCursor, '2026-11');
  assert.equal(await p.step('releaseReplacement', { id: retryCapsule }), true);
});

scenario('P5-7 source cache identity, bounded eviction and owned-byte isolation', async t => {
  const p = await pair(t), before = await capture(p), epoch = before.projectState.epoch;
  const prepareSource = (month, overrides = {}) => p.step('temporalSourcePrepare', {
    source: fixture.sourceFor(month), ...fixture.provenance, expectedEpoch: epoch, ...overrides });
  const source = fixture.sourceFor('2026-10');
  const first = await p.step('temporalSourcePrepare', { source, ...fixture.provenance, expectedEpoch: epoch });
  const repeat = await prepareSource('2026-10');
  assert.equal(repeat.sourceId, first.sourceId); assert.equal(repeat.reused, true);
  const pinned = await p.step('temporalCandidatePrepare', { sourceId: first.sourceId, targetMonth: '2026-10',
    sourceFingerprint: fixture.fingerprint, expectedEpoch: epoch,
    setup: fixture.setupFor('2026-10'), documentId: fixture.documentId });
  const inspected = await p.step('temporalCandidateInspect', { candidateId: pinned.candidateId, expectedEpoch: epoch });
  source.sourceBytes.fill(0); // Both APIs must have detached ownership of admitted source bytes.
  assert.deepEqual(await p.step('temporalCandidateInspect', { candidateId: pinned.candidateId, expectedEpoch: epoch }), inspected);
  const revised = await prepareSource('2026-10', { dataRevision: 'p5-7-another-revision' });
  assert.notEqual(revised.sourceId, first.sourceId);
  const next = await prepareSource('2026-11');
  const stats = await p.step('temporalSourceStats');
  assert.equal(stats.entries, 2); assert.equal(stats.evictions, 1);
  assert.equal(stats.declaredDecodedBytes, 2 * fixture.sourceBytes.byteLength);
  assert.equal(await p.step('temporalCandidateInspect', { candidateId: pinned.candidateId, expectedEpoch: epoch }), null);
  assert.equal(await p.step('temporalSourceRelease', { sourceId: first.sourceId, expectedEpoch: epoch }), false);
  for (const receipt of [revised, next]) {
    assert.equal(await p.step('temporalSourceRelease', { sourceId: receipt.sourceId, expectedEpoch: epoch }), true);
    assert.equal(await p.step('temporalSourceRelease', { sourceId: receipt.sourceId, expectedEpoch: epoch }), false);
  }
  assert.equal((await p.step('temporalSourceStats')).declaredDecodedBytes, 0);
  assert.deepEqual(await capture(p), before);
});

after(async () => {
  const target = resolve(process.env.PANDO_P5_7_EVIDENCE || 'test-results/temporal-p5-7/summary.json');
  await mkdir(resolve(target, '..'), { recursive: true });
  evidence.passed = evidence.cases.length === 5 && evidence.cases.every(row => row.status === 'passed')
    && evidence.teardownFailures.length === 0;
  await writeFile(target, JSON.stringify(evidence, null, 2) + '\n');
  console.log('P5_7_SUMMARY=' + JSON.stringify(evidence));
});
