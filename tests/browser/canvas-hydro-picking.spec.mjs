import { test, expect } from '@playwright/test';

test('Canvas lake picking matches drawn holes, dateline parts, polar caps, and visibility', async ({ page }) => {
  await page.route('**/canvas-hydro-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canvas hydro fixture</title>' }));
  await page.goto('/canvas-hydro-fixture');
  const result = await page.evaluate(async () => {
    const worker = new Worker('/assets/js/workers/canvas-render-worker.js?v=hydro-regression');
    const wait = type => new Promise((resolve, reject) => {
      const error = event => reject(new Error(event.message));
      worker.addEventListener('error', error, { once: true });
      const listen = event => {
        if (event.data.type !== type) return;
        worker.removeEventListener('message', listen); worker.removeEventListener('error', error); resolve(event.data);
      };
      worker.addEventListener('message', listen);
    });
    const channel = new MessageChannel();
    try {
      let pending = wait('ready');
      worker.postMessage({ type: 'init', width: 400, height: 300, projectGeneration: 1, features: [],
        projection: 'flat', view: { flatCenter: [0, 0] }, renderProjection: { scale: 180 / Math.PI, translate: [200, 150] },
        physicalSettings: {}, theme: {}, visible: false, lakesVisible: true, visualOrder: { base: [], hydro: [] } });
      await pending;
      worker.postMessage({ type: 'hydro-port', port: channel.port2 }, [channel.port2]);
      const lake = (fid, coordinates) => ({ type: 'Feature', properties: { category: 'lake', __fid: fid }, geometry: { type: 'Polygon', coordinates } });
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 1, viewRevision: 1 }); await pending;
      channel.port1.postMessage({ type: 'pack', packId: 1, features: [
        lake(7, [[[-4,-4],[-4,4],[4,4],[4,-4],[-4,-4]], [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]),
        lake(8, [[[179,-3],[179,3],[-179,3],[-179,-3],[179,-3]]]),
        lake(9, [[[-180,85],[180,85],[90,85],[0,85],[-90,85],[-180,85]]]),
      ] });
      pending = wait('frame'); channel.port1.postMessage({ type: 'active', packIds: [1] }); await pending;
      const pick = async point => { const reply = wait('hydro-pick'); worker.postMessage({ type: 'hydro-pick', requestId: 1, point }); return (await reply).fid; };
      const hits = [];
      for (const point of [[202,150],[200,150],[206,150],[204,150],[379.5,150],[20.5,150]]) hits.push(await pick(point));
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 2, viewRevision: 2, lakesVisible: false }); await pending;
      hits.push(await pick([202,150]));
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 3, viewRevision: 3, lakesVisible: true,
        projection: 'globe', view: { globeRotation: [0, -90, 0] }, renderProjection: { scale: 100, translate: [200,150] } }); await pending;
      hits.push(await pick([200,150]));
      hits.push(await pick([230,150]));
      return hits;
    } finally { channel.port1.close(); worker.terminate(); }
  });
  expect(result).toEqual([7, null, null, 7, 8, 8, null, 9, null]);
});
