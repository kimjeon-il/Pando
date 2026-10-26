import { saveProjectFile, openProjectFile, writeDiagnosticReport } from './native-storage.js';
import { writeProbeFile, readProbeFile, finishDiagnostics } from './probe-storage.js';
import { assertSmallProject } from './fixture-limits.js';

const COUNTRY = 'shell-country-a';
const PROBE_NAME = '시험 국가 A · 저장 검증';
const PHASE_KEY = 'pandoeditor-shell-probe-phase';
const DATABASE = 'pandoeditor-web-shell-prototype-v1';
const LIMIT_MS = 15_000;
const assert = (value, message) => { if (!value) throw new Error(message); };
const errorInfo = error => ({
  name: String(error?.name || 'Error'),
  code: String(error?.code || ''),
  message: String(error?.message || error),
  ...(error?.snapshotDifference ? { snapshotDifference: error.snapshotDifference } : {}),
});

function bounded(label, action) {
  let timer;
  return Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: ${LIMIT_MS} ms timeout`)), LIMIT_MS);
  })]).finally(() => clearTimeout(timer));
}

function awaitFrameCondition(predicate) {
  return new Promise((resolve, reject) => {
    let frame;
    const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('Rendered frame timeout')); }, LIMIT_MS);
    const poll = () => {
      try {
        const value = predicate();
        if (value) { clearTimeout(timer); resolve(value); }
        else frame = requestAnimationFrame(poll);
      } catch (error) { clearTimeout(timer); reject(error); }
    };
    poll();
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
function comparableSnapshot(snapshot) {
  // The current Core codec creates savedAt on export. All content and geometry
  // fields remain in this comparison, including identity and timeline records.
  const copy = structuredClone(snapshot);
  delete copy.savedAt;
  return copy;
}

/** Report only bounded, path-specific evidence; never serialize a whole document into a failure report. */
export function describeSnapshotDifference(reopened, saved, { limit = 48 } = {}) {
  const current = comparableSnapshot(reopened);
  const expected = comparableSnapshot(saved);
  const entries = [];
  let truncated = false;

  const description = (value, exists) => {
    if (!exists) return { type: 'missing' };
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    if (typeof value === 'object') return { type: 'object', keyCount: Object.keys(value).length };
    if (typeof value === 'string') return {
      type: 'string', length: value.length,
      preview: value.length > 100 ? value.slice(0, 100) + '…' : value,
    };
    return { type: typeof value, value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value };
  };
  const append = (path, left, right, leftExists = true, rightExists = true) => {
    if (entries.length >= limit) { truncated = true; return; }
    entries.push({
      path: path || '/',
      reopened: description(left, leftExists),
      saved: description(right, rightExists),
    });
  };
  const segment = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  function compare(left, right, path = '', depth = 0) {
    if (entries.length >= limit) { truncated = true; return; }
    if (Object.is(left, right)) return;
    if (depth > 64) { append(path, left, right); return; }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) append(path + '/length', left.length, right.length);
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length && entries.length < limit; index += 1) {
        if (index >= left.length || index >= right.length) append(path + '/' + index, left[index], right[index], index < left.length, index < right.length);
        else compare(left[index], right[index], path + '/' + index, depth + 1);
      }
      if (length > limit && entries.length >= limit) truncated = true;
      return;
    }
    const leftObject = left !== null && typeof left === 'object' && !Array.isArray(left);
    const rightObject = right !== null && typeof right === 'object' && !Array.isArray(right);
    if (leftObject && rightObject) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        const leftHas = Object.hasOwn(left, key), rightHas = Object.hasOwn(right, key);
        const next = path + '/' + segment(key);
        if (!leftHas || !rightHas) append(next, left[key], right[key], leftHas, rightHas);
        else compare(left[key], right[key], next, depth + 1);
        if (entries.length >= limit) { if (key !== keys.at(-1)) truncated = true; break; }
      }
      return;
    }
    if (!same(left, right)) append(path, left, right);
  }
  compare(current, expected);
  return { entries, shown: entries.length, truncated };
}

/** A full autosave is self-contained; C++ intentionally replaces builtin source identity. */
export function expectedReopenedSnapshot(savedSnapshot, autosave) {
  assert(autosave?.format === 'pandolab-autosave-full',
    'The restart probe requires a self-contained full autosave.');
  assert(autosave.baseDataset === 'external-territorial-entities',
    'A self-contained full autosave must carry external dataset provenance.');
  const expected = comparableSnapshot(savedSnapshot);
  expected.baseDataset = autosave.baseDataset;
  return expected;
}

async function readAutosaveRecord() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('The application autosave database does not exist.')); };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('active-project');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

function encodeBytes(bytes) {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
function decodeBytes(text) {
  const binary = atob(text);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function readPackage(blob) {
  const buffer = await blob.arrayBuffer();
  const url = new URL('../assets/js/workers/gis-gpkg-worker.js', import.meta.url);
  url.searchParams.set('v', window.PANDOLAB_ASSET_REVISION);
  const worker = new Worker(url, { name: 'pandolab-shell-gpkg-reader' });
  try {
    return await bounded('GeoPackage codec', () => new Promise((resolve, reject) => {
      worker.onmessage = event => {
        if (event.data?.id !== 1) return;
        if (!event.data.ok) reject(new Error(event.data.error || 'GeoPackage read failed'));
        else if (!event.data.metadata?.projectState) reject(new Error('The file contains no current project state.'));
        else resolve(event.data.metadata.projectState);
      };
      worker.onerror = event => reject(new Error(event.message || 'GeoPackage Worker failed'));
      worker.postMessage({ id: 1, action: 'read', buffer }, [buffer]);
    }));
  } finally { worker.terminate(); }
}

/** Diagnostics consume canonical application APIs; they own no editor state. */
export function installDiagnostics(runtime) {
  const { projectDomain, entityRepository, gpuMapRenderer, navigation } = runtime;
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('./diagnostics.css', import.meta.url).href;
  document.head.append(sheet);
  const panel = document.createElement('aside');
  panel.id = 'shellDiagnostics';
  panel.setAttribute('aria-label', '데스크톱 시제품 검증');
  panel.innerHTML = '<details open><summary>데스크톱 시제품 검증</summary><strong>실제 웹 엔진 · 소형 지도</strong><p class="shell-scope">국가 2개 · 하위 객체 1개 · 원본 세계 자료 제외</p><dl></dl><div class="shell-actions"></div><p class="shell-result" role="status" aria-live="polite">검증 대기</p></details>';
  document.body.append(panel);
  const list = panel.querySelector('dl');
  const detail = panel.querySelector('.shell-result');
  const rows = new Map();
  let running = null;
  let report = null;
  const labels = { webgl: 'WebGL 실제 그리기', worker: 'Core Worker', wasm: 'WASM 명령·실행취소', autosave: '자동저장·재실행', nativeFile: '네이티브 파일·현재 코덱', filePickerSave: 'Windows 저장 대화상자', filePickerOpen: 'Windows 열기 대화상자', network: '자료 요청 제한' };
  const results = Object.fromEntries(Object.keys(labels).map(key => [key, { status: 'NOT_RUN' }]));
  for (const [key, label] of Object.entries(labels)) {
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.textContent = 'NOT_RUN'; value.dataset.status = 'NOT_RUN';
    list.append(term, value); rows.set(key, value);
  }
  function status(key, value, evidence = null) {
    results[key] = { status: value, ...(evidence ? { evidence } : {}) };
    const row = rows.get(key); row.textContent = value; row.dataset.status = value;
  }
  async function check(key, action) {
    status(key, 'RUNNING');
    try { const evidence = await bounded(labels[key], action); status(key, 'PASS', evidence); return evidence; }
    catch (error) { status(key, 'FAIL', errorInfo(error)); throw error; }
  }
  function makeReport(phase) {
    const required = ['webgl', 'worker', 'wasm', 'autosave', 'nativeFile', 'network'];
    return { schema: 'pandolab-web-shell-diagnostics', version: 1, phase, at: new Date().toISOString(),
      ok: required.every(key => results[key].status === 'PASS'), checks: structuredClone(results),
      coreState: projectDomain.state(), renderer: gpuMapRenderer.getStats(),
      network: structuredClone(window.__PANDOLAB_SHELL_NETWORK__ || null),
      comparison: { omittedSnapshotFields: ['savedAt'], reason: 'Core export timestamp; all document content and geometry are compared.' },
    };
  }
  async function verifyAutosave(name) {
    await projectDomain.flushAutosave();
    const stored = await readAutosaveRecord();
    assert(stored && typeof stored === 'object', 'IndexedDB has no committed project record.');
    const projection = await projectDomain.inspectImport(stored, { baselineId: projectDomain.state().storageBaselineId || null });
    assert(projection.territorialViews.find(row => row.id === COUNTRY)?.properties.name === name, 'Stored Core project does not contain the accepted name.');
    return { database: DATABASE, store: 'projects', key: 'active-project', format: stored.format, acceptedName: name };
  }
  async function verifyNativeFile(name) {
    let written, envelope;
    const saved = await projectDomain.save(async blob => {
      const gpkg = new Uint8Array(await blob.arrayBuffer());
      assert(gpkg.length > 100 && gpkg.length < 700_000, 'Unexpected tiny GeoPackage size.');
      envelope = { schema: 'pandolab-shell-probe-v1', phase: 'written', name,
        savedSnapshot: projectDomain.snapshot(), gpkgBase64: encodeBytes(gpkg) };
      const contents = JSON.stringify(envelope);
      written = await writeProbeFile(contents);
      const read = await readProbeFile();
      assert(read.contents === contents, 'Native atomic write/read bytes differ.');
      const metadata = await readPackage(new Blob([decodeBytes(JSON.parse(read.contents).gpkgBase64)]));
      const projection = await projectDomain.inspectImport(metadata);
      assert(same(projection.territorialViews.map(row => [row.id, row.geometry]), entityRepository.list().map(row => [row.id, row.geometry])), 'GeoPackage geometry roundtrip differs.');
      assert(projection.territorialViews.find(row => row.id === COUNTRY)?.properties.name === name, 'GeoPackage name differs.');
      return written;
    });
    assert(saved && written?.path, 'Native file save did not complete.');
    return { path: written.path, sha256: written.sha256, codec: 'production gis-gpkg-worker', exactNativeBytes: true, exactGeometry: true, envelope };
  }
  async function execute() {
    const phase = localStorage.getItem(PHASE_KEY) === 'await-reopen' ? 'reopen' : 'write';
    let writtenName = PROBE_NAME;
    try {
      // Focus is a presentation command on the production camera owner.
      navigation.focusCoordinate([0, 8], 4.5);
      await check('webgl', async () => {
        const value = await awaitFrameCondition(() => {
          const stats = gpuMapRenderer.getStats();
          return /^webgl[12]$/.test(stats.renderer) && stats.activeWebGlContextCount === 1
            && stats.triangleCount > 0 && stats.sceneCacheFullDrawCount > 0 && stats.countryBaseIndexCount > 0 ? stats : null;
        });
        const before = runtime.getView();
        navigation.zoomBy(1.05, false, { persist: false });
        await awaitFrameCondition(() => runtime.getView().zoom !== before.zoom || runtime.getView().globeZoom !== before.globeZoom || runtime.getView().flatZoom !== before.flatZoom);
        return { renderer: value.renderer, contexts: value.activeWebGlContextCount, triangleCount: value.triangleCount,
          countryBaseIndexCount: value.countryBaseIndexCount, sceneCacheFullDrawCount: value.sceneCacheFullDrawCount };
      });
      await check('worker', async () => {
        const workers = window.__PANDOLAB_SHELL_NETWORK__?.workers || [];
        assert(JSON.stringify(workers).includes('core-session-worker.js'), 'No actual Core session Worker creation was recorded.');
        const state = projectDomain.state();
        assert(Number.isSafeInteger(state.epoch) && state.epoch > 0, 'No accepted C++ document epoch.');
        return { transport: 'production core-session-worker.js', epoch: state.epoch, workers };
      });
      if (phase === 'reopen') {
        await check('autosave', async () => {
          const read = await readProbeFile(), previous = JSON.parse(read.contents);
          assert(previous.schema === 'pandolab-shell-probe-v1', 'The previous process probe is unavailable.');
          assert(entityRepository.get(COUNTRY)?.properties.name === previous.name, 'The reopened process did not restore the accepted edit.');
          const storedAutosave = await readAutosaveRecord();
          const expectedSnapshot = expectedReopenedSnapshot(previous.savedSnapshot, storedAutosave);
          const reopenedSnapshot = projectDomain.snapshot();
          assert(reopenedSnapshot.baseDataset === storedAutosave.baseDataset,
            'The reopened document did not retain the self-contained autosave provenance.');
          if (!same(comparableSnapshot(reopenedSnapshot), expectedSnapshot)) {
            const error = new Error('The reopened canonical document differs from the saved snapshot.');
            error.code = 'PL-NATIVE-REOPEN-SNAPSHOT';
            error.snapshotDifference = describeSnapshotDifference(reopenedSnapshot, expectedSnapshot);
            throw error;
          }
          return {
            processRestart: true, exactDocument: true, name: previous.name, path: read.path,
            originalDataset: previous.savedSnapshot.baseDataset,
            restoredDataset: reopenedSnapshot.baseDataset,
            normalizedFromFullAutosave: true,
          };
        });
        await check('nativeFile', async () => {
          const read = await readProbeFile(), previous = JSON.parse(read.contents);
          const project = await readPackage(new Blob([decodeBytes(previous.gpkgBase64)]));
          const projection = await projectDomain.inspectImport(project);
          assert(same(projection.territorialViews.map(row => [row.id, row.geometry]), entityRepository.list().map(row => [row.id, row.geometry])), 'Reopened native package geometry differs.');
          return { path: read.path, processRestart: true, exactGeometry: true, codec: 'production gis-gpkg-worker' };
        });
      }
      await check('wasm', async () => {
        const original = entityRepository.get(COUNTRY)?.properties.name;
        assert(typeof original === 'string', 'Fixture country is missing.');
        const initialEpoch = projectDomain.state().epoch;
        const name = phase === 'reopen' ? `${PROBE_NAME} · 재실행 확인`
          : original === PROBE_NAME ? `${PROBE_NAME} · 새 검증` : PROBE_NAME;
        if (phase === 'write') writtenName = name;
        const changed = await window.PANDOLAB_TERRITORIAL.setName(COUNTRY, name);
        assert(changed.changed && entityRepository.get(COUNTRY).properties.name === name, 'Core metadata command was not accepted.');
        assert(await projectDomain.undo(), 'Core undo was not accepted.');
        assert(entityRepository.get(COUNTRY).properties.name === original, 'Core undo did not restore the original name.');
        assert(await projectDomain.redo(), 'Core redo was not accepted.');
        assert(entityRepository.get(COUNTRY).properties.name === name, 'Core redo did not restore the accepted edit.');
        if (phase === 'reopen') await projectDomain.undo();
        const epoch = projectDomain.state().epoch;
        assert(epoch > initialEpoch, 'No C++ Worker acknowledgement advanced the epoch.');
        return { initialEpoch, acknowledgedEpoch: epoch, command: 'territorial.metadata', undo: true, redo: true,
          wasm: 'verified production Core loader in the persistent Core Worker' };
      });
      if (phase === 'write') {
        await check('autosave', () => verifyAutosave(writtenName));
        await check('nativeFile', async () => {
          const { envelope, ...evidence } = await verifyNativeFile(writtenName);
          assert(envelope.name === writtenName, 'Probe envelope mismatch.');
          return evidence;
        });
      }
      await check('network', async () => {
        const network = window.__PANDOLAB_SHELL_NETWORK__;
        assert(network && network.blocked.length === 0, 'A forbidden data/network request was attempted.');
        return { blockedRequests: 0, allowedRequests: network.requests.length, workers: network.workers.length };
      });
      report = makeReport(phase);
      if (phase === 'write' && report.ok) {
        localStorage.setItem(PHASE_KEY, 'await-reopen');
        report.relaunchRequired = true;
        detail.textContent = '쓰기 검증 완료 · 앱 재실행으로 복원 검증 필요';
      } else if (phase === 'reopen' && report.ok) {
        localStorage.removeItem(PHASE_KEY);
        detail.textContent = '재실행·복원·현재 코덱 검증 완료';
      }
    } catch (error) {
      report = { ...makeReport(phase), ok: false, error: errorInfo(error) };
      detail.textContent = `검증 실패: ${error.message}`;
      console.error('[PANDOEDITOR-SHELL-DIAGNOSTIC]', error);
    }
    window.__PANDOLAB_SHELL_REPORT__ = report;
    await finishDiagnostics(report);
    return report;
  }
  const run = () => running ||= execute().finally(() => { running = null; });
  function button(label, action) {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'ui-button btn'; element.textContent = label;
    element.addEventListener('click', async () => {
      element.disabled = true;
      try { await action(); }
      catch (error) { detail.textContent = error.name === 'AbortError' ? '파일 선택 취소' : `작업 실패: ${error.message}`; }
      finally { element.disabled = false; }
    });
    panel.querySelector('.shell-actions').append(element);
  }
  button('검증 실행', run);
  button('GPKG 저장', async () => {
    try {
      await projectDomain.save(async blob => {
        const result = await saveProjectFile(blob);
        if (result.cancelled) throw Object.assign(new Error('파일 저장 취소'), { name: 'AbortError' });
        status('filePickerSave', 'PASS', { path: result.path });
        detail.textContent = `저장 완료: ${result.path}`;
        return result;
      });
    } catch (error) { status('filePickerSave', error.name === 'AbortError' ? 'CANCELLED' : 'FAIL', errorInfo(error)); throw error; }
  });
  button('GPKG 열기', async () => {
    try {
      const file = await openProjectFile();
      if (file.cancelled) throw Object.assign(new Error('파일 열기 취소'), { name: 'AbortError' });
      const project = await bounded('GeoPackage open', () => readPackage(file.blob));
      assertSmallProject(project);
      await bounded('Core project load', () => projectDomain.load(project));
      status('filePickerOpen', 'PASS', { path: file.path, acceptedEpoch: projectDomain.state().epoch });
      detail.textContent = `열기 완료: ${file.path}`;
    } catch (error) { status('filePickerOpen', error.name === 'AbortError' ? 'CANCELLED' : 'FAIL', errorInfo(error)); throw error; }
  });
  button('보고서 저장', async () => {
    const output = await writeDiagnosticReport(makeReport(report?.phase || 'manual'));
    detail.textContent = output?.path ? `보고서: ${output.path}` : '보고서를 브라우저 진단 변수에 기록했습니다.';
  });
  const controller = Object.freeze({ run, snapshot: () => ({ report, checks: structuredClone(results), renderer: gpuMapRenderer.getStats(), core: projectDomain.state() }) });
  window.__PANDOLAB_SHELL_DIAGNOSTICS__ = controller;
  return controller;
}
