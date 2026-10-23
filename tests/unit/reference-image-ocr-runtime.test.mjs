import assert from 'node:assert/strict';
import test from 'node:test';
import { createReferenceOcrDetector, referenceOcrLanguagesForScript, referenceOcrBlocks, REFERENCE_OCR_LANGUAGES } from '../../assets/js/modules/reference-image-ocr-runtime.js';

test('Arabic script selects Arabic Persian and Urdu without reversing original Unicode text', async () => {
  assert.deepEqual(referenceOcrLanguagesForScript('Arabic'), ['ara', 'fas', 'urd']);
  const events = [], urls = [];
  const detector = await createReferenceOcrDetector(['ara', 'fas', 'urd'], {
    assetBase: 'https://local.test/assets/vendor/reference-analysis/',
    languageBase: 'https://local.test/assets/data/reference-analysis/v1/ocr/',
    createWorker: async (language, engine, options) => {
      assert.equal(engine, 1);
      assert.match(options.workerPath, /^blob:/u);
      urls.push(options.workerPath);
      assert.equal(await (await globalThis.fetch(options.workerPath)).text(), 'importScripts("https://local.test/assets/vendor/reference-analysis/worker.min.js");');
      assert.equal(options.workerBlobURL, false);
      assert.equal(options.langPath, 'https://local.test/assets/data/reference-analysis/v1/ocr/');
      return {
        recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [{ text: 'تهران ۱۲۳', confidence: 90, bbox: { x0: 10, y0: 20, x1: 90, y1: 40 } }] }] }] } }),
        terminate: async () => events.push(language),
      };
    },
  });
  const blocks = await detector.detect({ width: 100, height: 60 });
  assert.equal(blocks[0].rawValue, 'تهران ۱۲۳');
  assert.deepEqual(blocks[0].boundingBox, { x: 10, y: 20, width: 80, height: 20 });
  assert.equal(blocks[0].confidence, 0.9);
  assert.deepEqual(events, ['ara', 'fas', 'urd']);
  for (const url of urls) await assert.rejects(globalThis.fetch(url), /fetch failed/u);
});

test('OCR releases its bootstrap URL and reports language context when worker initialization fails', async () => {
  let url;
  const detector = await createReferenceOcrDetector(['eng'], { createWorker: async (_language, _engine, options) => {
    url = options.workerPath;throw new Error('native worker initialization failed');
  } });
  await assert.rejects(detector.detect({}), error => error.code === 'PL-REF-OCR-WORKER-INIT' && error.message.includes('eng') && error.cause.message === 'native worker initialization failed');
  await assert.rejects(globalThis.fetch(url), /fetch failed/u);
});

test('OCR releases its language worker when recognition fails', async () => {
  let terminated = false;
  const detector = await createReferenceOcrDetector(['eng'], {
    createWorker: async () => ({ recognize: async () => { throw new Error('decode failed'); }, terminate: async () => { terminated = true; } }),
  });
  await assert.rejects(detector.detect({}), /decode failed/);
  assert.equal(terminated, true);
});

for (const failure of ['loadLanguage', 'initialize', 'abort', 'load-error', 'recognize-error']) test(`bundled OCR terminates its raw worker after ${failure}`, async t => {
  const controller = new globalThis.AbortController();
  let spawned;
  class StartupWorker {
    constructor(url) { this.url = url;this.terminated = false;this.listeners = new Set();spawned = this; }
    addEventListener(type, listener) { assert.equal(type, 'error');this.listeners.add(listener); }
    removeEventListener(type, listener) { assert.equal(type, 'error');this.listeners.delete(listener); }
    postMessage(packet) {
      globalThis.queueMicrotask(() => {
        if (failure === 'abort') { controller.abort(new globalThis.DOMException('startup cancelled', 'AbortError'));return; }
        if (`${packet.action}-error` === failure) {
          const event = { message: 'native OCR crashed', preventDefault() { this.prevented = true; } };
          this.onerror(event);
          for (const listener of this.listeners) listener(event);
          assert.equal(event.prevented, true);return;
        }
        this.onmessage({ data: { ...packet, status: packet.action === failure ? 'reject' : 'resolve', data: packet.action === failure ? 'damaged local language pack' : {} } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'Worker', { value: StartupWorker, configurable: true });
  Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);else delete globalThis.Worker;
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);else delete globalThis.self;
  });
  const factory = (await import('../../assets/vendor/reference-analysis/tesseract.mjs')).default.createWorker;
  const detector = await createReferenceOcrDetector(['eng'], { signal: controller.signal, createWorker: factory });
  await assert.rejects(detector.detect(new Uint8Array([1])), error => {
    if (failure === 'abort') return error.name === 'AbortError';
    if (failure.endsWith('-error')) return error.code === (failure === 'load-error' ? 'PL-REF-OCR-WORKER-INIT' : 'PL-REF-OCR-WORKER') && error.message.includes('native OCR crashed');
    return error.code === 'PL-REF-OCR-WORKER-INIT' && error.message.includes('damaged local language pack');
  });
  assert.equal(spawned.terminated, true);
  assert.equal(spawned.listeners.size, 0);
  await assert.rejects(globalThis.fetch(spawned.url), /fetch failed/u);
});

test('Greek script includes separate modern and ancient Greek recognition models', () => {
  assert.deepEqual(referenceOcrLanguagesForScript('Greek'), ['ell', 'grc']);
});

test('recommended historical and regional packs are routed by script instead of loading every script', () => {
  for (const code of ['lat', 'deu_latf', 'rus', 'ukr', 'jpn_vert', 'chi_tra_vert', 'heb', 'hye', 'kat', 'hin', 'ben']) assert.ok(REFERENCE_OCR_LANGUAGES.includes(code), code);
  assert.deepEqual(referenceOcrLanguagesForScript('Cyrillic'), ['rus', 'ukr']);
  assert.deepEqual(referenceOcrLanguagesForScript('Hebrew'), ['heb']);
  assert.deepEqual(referenceOcrLanguagesForScript('Armenian'), ['hye']);
  assert.deepEqual(referenceOcrLanguagesForScript('Georgian'), ['kat']);
  assert.deepEqual(referenceOcrLanguagesForScript('Devanagari'), ['hin']);
  assert.deepEqual(referenceOcrLanguagesForScript('Bengali'), ['ben']);
});

test('OSD runs once on the overview and restores rotated OCR boxes to original tile pixels', async () => {
  const events = [], transforms = [];
  const detector = await createReferenceOcrDetector(['eng'], {
    canvasFactory: (width, height) => ({ width, height, getContext: () => ({ translate: (...args) => transforms.push(args), rotate() {}, drawImage() {} }) }),
    createWorker: async language => ({
      detect: async () => { events.push('osd'); return { data: { script: 'Latin', orientation_degrees: 90, orientation_confidence: 20 } }; },
      recognize: async (input, options) => {
        events.push(language); assert.equal(input.width, 60); assert.equal(input.height, 100);
        assert.equal(options.tessedit_pageseg_mode, '11');
        return { data: { blocks: [{ paragraphs: [{ lines: [{ text: 'Rome', confidence: 90, bbox: { x0: 10, y0: 20, x1: 30, y1: 50 } }] }] }] } };
      }, terminate: async () => {},
    }),
  });
  const orientation = await detector.analyze({ width: 200, height: 100 });
  assert.equal(orientation.clockwiseDegrees, 90);
  const blocks = await detector.detect({ width: 100, height: 60 });
  assert.deepEqual(blocks[0].boundingBox, { x: 20, y: 30, width: 30, height: 20 });
  assert.deepEqual(events, ['osd', 'eng']);
  assert.deepEqual(transforms, [[60, 0]]);
});

test('vertical language packs use vertical page segmentation and release each worker', async () => {
  const events = [];
  const detector = await createReferenceOcrDetector(['jpn_vert', 'chi_tra_vert'], { createWorker: async language => ({
    recognize: async (_input, options) => { assert.equal(options.tessedit_pageseg_mode, '5'); events.push(language);return { data: {} }; },
    terminate: async () => events.push('released'),
  }) });
  assert.deepEqual(await detector.detect({ width: 100, height: 100 }), []);
  assert.deepEqual(events, ['jpn_vert', 'released', 'chi_tra_vert', 'released']);
});

test('weak OSD orientation is compared with OCR evidence before rotating a map', async () => {
  const detector = await createReferenceOcrDetector(['eng'], {
    canvasFactory: (width, height) => { const canvas = { width, height, degrees: 0 };canvas.getContext = () => ({ translate() {}, rotate: angle => { canvas.degrees = Math.round(angle * 180 / Math.PI); }, drawImage() {} });return canvas; },
    createWorker: async () => ({ detect: async () => ({ data: { script: 'Latin', orientation_degrees: 90, orientation_confidence: .2 } }),
      recognize: async input => ({ data: { blocks: [{ paragraphs: [{ lines: [{ text: 'Rome', confidence: input.degrees === 270 ? 95 : 20,
        bbox: { x0: 1, y0: 1, x1: 10, y1: 10 } }] }] }] } }), terminate: async () => {},
    }),
  });
  const result = await detector.analyze({ width: 100, height: 60 });
  assert.equal(result.clockwiseDegrees, 270);
  assert.equal(result.orientationSource, 'ocr-comparison');
});

test('Tesseract line normalization keeps empty or malformed boxes out of GCP proposals', () => {
  assert.deepEqual(referenceOcrBlocks({ blocks: [{ paragraphs: [{ lines: [{ text: '  ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }, { text: 'Ribe', bbox: { x0: 5, y0: 3, x1: 4, y1: 9 } }] }] }] }), []);
});
