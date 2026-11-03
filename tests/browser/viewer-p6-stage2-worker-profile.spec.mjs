import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off' });

test('P6 stage 2: actual dated Viewer records scoped Worker phases with stable document hashes', async ({ page }, info) => {
  test.setTimeout(360000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__P6_STAGE2_MESSAGES__ = [];
    globalThis.__P6_STAGE2_DECISIONS__ = [];
    const Native = globalThis.Worker;
    globalThis.Worker = class ProfiledCountryBoundaryWorker extends Native {
      constructor(url, options) {
        super(url, options);
        this.isCountryBoundary = options?.name === 'pandolab-country-shared-boundary';
        if (this.isCountryBoundary) this.addEventListener('message', event => {
          const packet = event.data;
          if (!packet || !['prepared', 'resync', 'error'].includes(packet.type)) return;
          globalThis.__P6_STAGE2_MESSAGES__.push({
            direction: 'received', type: packet.type, requestId: packet.requestId,
            generation: packet.projectGeneration, cacheHit: packet.packetCacheHit ?? null,
            packetMs: packet.packetPreparationMs ?? null, stages: packet.packetProfile ?? null,
            segmentCount: packet.packet?.segments?.length ?? null, at: performance.now(),
          });
        });
      }
      postMessage(message, transfer) {
        if (!this.isCountryBoundary || !['replace', 'delta', 'patch'].includes(message?.type)) {
          return super.postMessage(message, transfer);
        }
        const source = message.features || [];
        const included = source.filter(feature => Object.hasOwn(feature, 'geometry')).length;
        const started = performance.now();
        // A test-only flag asks the real Worker to return bounded phase timings;
        // never modify geometry, metadata, or transfer buffers.
        try {
          return super.postMessage({ ...message, profilePacket: true,
            // One fixed real transition compares all pruned contact outputs
            // with the original full C++ output, including source references.
            verifyContactParity: message.projectGeneration === 3 }, transfer);
        }
        finally {
          globalThis.__P6_STAGE2_MESSAGES__.push({
            direction: 'sent', type: message.type, requestId: message.requestId,
            generation: message.projectGeneration, included, total: source.length,
            omitted: source.length - included, removed: message.removedIds?.length ?? 0,
            transferMs: performance.now() - started, at: started,
          });
        }
      }
    };
  });

  // Instrument only the test-served renderer. Normal product bundles do not
  // install a transport diagnostic callback or add extra bytes to Worker RPC.
  await page.route('**/modules/gpu-map-renderer.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const countryBoundaryGeometryTransport = createCountryBoundaryGeometryTransport();';
    if (source.split(marker).length !== 2) throw Error('P6 transport diagnostics port changed');
    await route.fulfill({ response, body: source.replace(marker,
      'const countryBoundaryGeometryTransport = createCountryBoundaryGeometryTransport({onDecision: decision => globalThis.__P6_STAGE2_DECISIONS__.push({...decision,at:performance.now()})});') });
  });

  const ready = async month => {
    await expect.poll(() => page.evaluate(() => ({
      month: globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
      cursor: globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
      ready: document.querySelector('#viewerStatus')?.dataset.ready,
    })), { timeout: 150000 }).toEqual({ month, cursor: month, ready: 'true' });
    await expect.poll(() => page.evaluate(() =>
      globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.countrySharedBoundaryReady
    ), { timeout: 35000 }).toBe(true);
  };
  const signature = () => page.evaluate(async () => {
    const view = globalThis.__PANDOLAB_VIEWER__, snapshot = view.documentSnapshot();
    const fields = { entities: snapshot.territorialEntities, geometries: snapshot.geometries,
      timeline: snapshot.timelineRecords };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)));
    return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  });

  await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 150000 });
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineYearInput').fill('1991');
  await page.locator('#timelineGoBtn').click();
  await ready('1991-12');
  const hash1991 = await signature();
  const records = [];
  try {
    for (const [target, selector] of [
      ['1992-12', '#timelineNextYear'],
      ['1991-12', '#timelinePreviousYear'],
      ['1992-12', '#timelineNextYear'],
      ['1991-12', '#timelinePreviousYear'],
    ]) {
      const before = await page.evaluate(() => ({
        messages: globalThis.__P6_STAGE2_MESSAGES__.length,
        decisions: globalThis.__P6_STAGE2_DECISIONS__.length,
      }));
      await page.locator(selector).click();
      await ready(target);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const record = {
        target, hash: await signature(),
        events: await page.evaluate(index =>
          globalThis.__P6_STAGE2_MESSAGES__.slice(index), before.messages),
        decisions: await page.evaluate(index =>
          globalThis.__P6_STAGE2_DECISIONS__.slice(index), before.decisions),
      };
      records.push(record);
      if (target === '1991-12') expect(record.hash).toBe(hash1991);
      const worker = record.events.filter(event => event.direction === 'received' && event.type === 'prepared');
      for (const event of worker) {
        expect(event.packetMs).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(event.stages)).toBe(true);
        for (const span of event.stages) {
          expect(span.ms, span.stage).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(span.ms), span.stage).toBe(true);
        }
      }
    }
    const received = records.flatMap(record => record.events).filter(e =>
      e.direction === 'received' && e.type === 'prepared');
    expect(received.length, 'dated boundary Worker should emit timed packets').toBeGreaterThan(0);
    const actualParity = received.flatMap(e => e.stages || []).filter(e => e.stage === 'contact-parity-full');
    expect(actualParity.some(e => e.matched === true),
      'actual historical C++ source index reduction must match unpruned output').toBe(true);

    const sendModes = records.flatMap(r => r.events).filter(e => e.direction === 'sent');
    console.log('P6_STAGE2_HISTORY_PROFILE ' + JSON.stringify({
      source: 'Linux Playwright; not a verified discrete GPU timing',
      directions: records.map(r => ({
        target: r.target, hash: r.hash, decisions: r.decisions, events: r.events.map(e => ({
          ...e, stages: e.stages?.map(s => ({ ...s, ms: Number(s.ms.toFixed(3)) })),
        })),
      })), sendModes,
    }).slice(0, 60000));
    expect(errors).toEqual([]);
  } finally {
    await info.attach('p6-stage2-worker-phases', {
      body: JSON.stringify({ source: 'Linux Playwright; not discrete GPU', records, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
