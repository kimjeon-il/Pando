import { writeProbeFile, readProbeFile, finishDiagnostics, saveProjectFile, openProjectFile, writeDiagnosticReport } from './native-storage.js';
import { assertSmallProject } from './fixture-limits.js';

const COUNTRY = 'shell-country-a';
const PROBE_NAME = '시험 국가 A · 저장 검증';
const PHASE_KEY = 'pandoeditor-shell-probe-phase';
const DATABASE = 'pandoeditor-web-shell-prototype-v1';
const LIMIT_MS = 15_000;
const assert = (value, message) => { if (!value) throw new Error(message); };
const errorInfo = error => ({ name: String(error?.name || 'Error'), code: String(error?.code || ''), message: String(error?.message || error) });

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
          assert(same(comparableSnapshot(projectDomain.snapshot()), comparableSnapshot(previous.savedSnapshot)), 'The reopened canonical document differs from the saved snapshot.');
          return { processRestart: true, exactDocument: true, name: previous.name, path: read.path };
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
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
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
