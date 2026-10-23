const ASSET_BASE = new URL('../../vendor/reference-analysis/', import.meta.url).href;
const LANGUAGE_BASE = new URL('../../data/reference-analysis/v1/ocr/', import.meta.url).href;
const GROUPS = Object.freeze({
  Latin: ['eng', 'deu', 'deu_latf', 'lat', 'fra', 'spa', 'ita', 'por', 'nld'],
  Hangul: ['kor', 'kor_vert'], Han: ['chi_tra', 'chi_sim', 'jpn', 'chi_tra_vert', 'chi_sim_vert', 'jpn_vert'], Japanese: ['jpn', 'jpn_vert', 'chi_tra', 'chi_tra_vert'],
  Arabic: ['ara', 'fas', 'urd'],
  Greek: ['ell', 'grc'],
  Cyrillic: ['rus', 'ukr'], Hebrew: ['heb'], Armenian: ['hye'], Georgian: ['kat'], Devanagari: ['hin'], Bengali: ['ben'],
});

export const REFERENCE_OCR_LANGUAGES = Object.freeze([...new Set(Object.values(GROUPS).flat())]);
export function referenceOcrLanguagesForScript(script) {
  return [...(GROUPS[script] || REFERENCE_OCR_LANGUAGES)];
}

export function referenceOcrBlocks(data) {
  const blocks = [];
  for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const text = String(line.text || '').trim();
    const b = line.bbox;
    if (!text || !b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
    blocks.push({ rawValue: text, confidence: Math.max(0, Math.min(1, Number(line.confidence || 0) / 100)),
      boundingBox: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } });
  }
  return blocks;
}

function originalBox(box, width, height, degrees) {
  const { x, y, width: w, height: h } = box;
  if (degrees === 90) return { x: y, y: height - x - w, width: h, height: w };
  if (degrees === 180) return { x: width - x - w, y: height - y - h, width: w, height: h };
  if (degrees === 270) return { x: width - y - h, y: x, width: h, height: w };
  return box;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height;return canvas;
}

export async function createReferenceOcrDetector(languages = null, {
  assetBase = ASSET_BASE, languageBase = LANGUAGE_BASE, signal = null, createWorker = null, canvasFactory = makeCanvas,
} = {}) {
  const runtimeUrl = new URL('tesseract.mjs', assetBase);
  const factory = createWorker || (await import(runtimeUrl.href)).default.createWorker;
  if (typeof factory !== 'function') throw new TypeError('The bundled Tesseract createWorker is required.');
  const options = { workerPath: new URL('worker.min.js', assetBase).href, corePath: new URL('core/', assetBase).href,
    langPath: languageBase, workerBlobURL: false, gzip: true, cacheMethod: 'none' };
  const check = () => signal?.throwIfAborted();
  async function withWorker(language, engine, run, extra = {}) {
    check();
    // WebView2 aborts a nested HTTP Worker load on the app protocol. A local
    // blob bootstrap imports the same pinned script and is released per use.
    const bootstrap = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(options.workerPath)});`], { type: 'text/javascript' }));
    let worker, rawWorker, closed = false, rejectInterrupted;
    const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
    const abort = () => rejectInterrupted(signal.reason || new DOMException('OCR cancelled', 'AbortError'));
    const workerError = event => {
      event.preventDefault();
      rejectInterrupted(Object.assign(new Error(event.message || 'OCR Worker crashed'), { code: 'PL-REF-OCR-WORKER' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      check();
      try {
        const initializing = Promise.resolve(factory(language, engine, { ...options, ...extra, workerPath: bootstrap,
          onWorker: spawned => { rawWorker = spawned;spawned.addEventListener('error', workerError);if (closed) spawned.terminate(); },
          errorHandler: cause => rejectInterrupted(cause instanceof Error ? cause : new Error(String(cause))),
        })).then(async initialized => {
          if (closed) await initialized.terminate();
          return initialized;
        });
        worker = await Promise.race([initializing, interrupted]);
      }
      catch (cause) {
        if (signal?.aborted) throw signal.reason || cause;
        throw Object.assign(new Error(`OCR Worker 초기화 실패 (${language}): ${cause?.message || cause || 'worker script load failed'}`, { cause }), { code: 'PL-REF-OCR-WORKER-INIT' });
      }
      check();return await Promise.race([run(worker), interrupted]);
    } finally {
      closed = true;signal?.removeEventListener('abort', abort);
      rawWorker?.removeEventListener('error', workerError);
      try { if (worker) await worker.terminate();else rawWorker?.terminate(); }
      finally { URL.revokeObjectURL(bootstrap); }
    }
  }
  async function withInput(input, degrees, read) {
    let bitmap = null;
    try {
      if (!degrees) return await read(input);
      const image = input instanceof Blob ? (bitmap = await createImageBitmap(input)) : input;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      const swapped = degrees === 90 || degrees === 270;
      const canvas = canvasFactory(swapped ? height : width, swapped ? width : height), drawing = canvas.getContext('2d');
      drawing.translate(degrees === 90 || degrees === 180 ? canvas.width : 0, degrees === 180 || degrees === 270 ? canvas.height : 0);
      drawing.rotate(degrees * Math.PI / 180);drawing.drawImage(image, 0, 0);
      return await read(canvas, width, height);
    } finally { bitmap?.close(); }
  }
  const recognize = (worker, canvas, language) => worker.recognize(canvas, { tessedit_pageseg_mode: language.endsWith('_vert') ? '5' : '11' }, { blocks: true });
  let selectedLanguages = languages, orientation = null;
  async function analyze(input) {
    check();
    if (orientation) return orientation;
    const result = await withWorker('osd', 0, worker => worker.detect(input), { legacyCore: true, legacyLang: true });
    const data = result.data || {};
    if (!selectedLanguages?.length) selectedLanguages = referenceOcrLanguagesForScript(data.script);
    let degrees = [0, 90, 180, 270].includes(data.orientation_degrees) ? data.orientation_degrees : 0;
    let script = data.script || 'Unknown', orientationSource = 'osd';
    const confidence = Number(data.orientation_confidence) || 0, scriptConfidence = Number(data.script_confidence) || 0;
    if (confidence < 15) {
      const scores = [];
      const probes = languages?.length ? [languages[0]] : [...new Set([selectedLanguages[0], 'eng'])];
      for (const language of probes) await withWorker(language, 1, async worker => {
        for (const angle of [0, 90, 180, 270]) {
          check();
          const result = await withInput(input, angle, canvas => recognize(worker, canvas, language));
          const score = referenceOcrBlocks(result.data).reduce((sum, row) => sum + Math.max(0, row.confidence - .45) * Math.min(40, [...row.rawValue.replace(/[^\p{L}]/gu, '')].length), 0);
          scores.push({ degrees: angle, language, score });
        }
      });
      scores.sort((a, b) => b.score - a.score);
      if (scores[0]?.score > 0) {
        degrees = scores[0].degrees;orientationSource = 'ocr-comparison';
        if (!languages?.length && scores[0].language === 'eng' && script !== 'Latin' && scriptConfidence < 2) {
          script = 'Latin';selectedLanguages = referenceOcrLanguagesForScript(script);
        }
      }
    }
    orientation = Object.freeze({ script, clockwiseDegrees: degrees, orientationSource,
      confidence, scriptConfidence, languages: [...selectedLanguages] });
    return orientation;
  }
  return {
    analyze,
    async detect(input) {
      check();
      if (!selectedLanguages?.length) await analyze(input);
      const selected = selectedLanguages;
      if (selected.some(language => !REFERENCE_OCR_LANGUAGES.includes(language))) {
        throw Object.assign(new Error('Unsupported reference OCR language.'), { code: 'PL-REF-OCR-LANGUAGE' });
      }
      const degrees = orientation?.clockwiseDegrees || 0;
      return withInput(input, degrees, async (canvas, width, height) => {
        const blocks = [];
        for (const language of selected) {
          const result = await withWorker(language, 1, worker => recognize(worker, canvas, language));
          check();
          blocks.push(...referenceOcrBlocks(result.data).map(row => ({ ...row,
            boundingBox: degrees ? originalBox(row.boundingBox, width, height, degrees) : row.boundingBox, language })));
        }
        return blocks;
      });
    },
  };
}
