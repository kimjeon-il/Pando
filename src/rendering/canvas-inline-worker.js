import '../geometry/workers/geographic-boundary-core.js';
import './workers/canvas-scene-composition-core.js';
import './workers/canvas-terrain-dem-core.js';
import './workers/terrain-tile-selection-core.js';
import * as resourcePolicy from '../runtime/resource-dependency-policy.js';
import './workers/canvas-render-core.js';

// @worker-transport dedicated: In-process Canvas2D fallback emulates the Canvas Worker frame channel; it is not RPC.
// The Canvas2D fallback uses the same scene, DEM and lifecycle implementation
// as the real Worker. Only message transport and canvas allocation differ.
export function createInlineCanvasWorker({ runtimeUrl }) {
  let live = true;
  const worker = { onmessage: null, onerror: null, postMessage, terminate };
  const report = error => worker.onerror?.({ error, message: error?.message || String(error), preventDefault() {} });
  function enqueue(callback) {
    queueMicrotask(() => { if (live) { try { callback(); } catch (error) { report(error); } } });
  }
  function HtmlCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.transferToImageBitmap = () => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      copy.close = () => { copy.width = 0; copy.height = 0; };
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      return copy;
    };
    return canvas;
  }
  const scope = {
    location: { href: String(runtimeUrl) }, d3: globalThis.d3,
    OffscreenCanvas: globalThis.OffscreenCanvas || HtmlCanvas,
    PandoLabGeographicBoundary: globalThis.PandoLabGeographicBoundary,
    PandoLabCanvasSceneComposition: globalThis.PandoLabCanvasSceneComposition,
    PandoLabCanvasTerrainDem: globalThis.PandoLabCanvasTerrainDem,
    PandoLabTerrainTileSelection: globalThis.PandoLabTerrainTileSelection,
    PandoLabResourceUpdatePolicy: resourcePolicy,
    // Inline transport runs in the main document. Import the same canonical
    // terrain module directly, not the Worker-relative public URL (which
    // cannot be imported as a Node URL by the deterministic inline harness).
    importTerrainManifestModule: () => import('../data/terrain-manifest.js'),
    postMessage(data) {
      if (!live) { data.bitmap?.close?.(); return; }
      queueMicrotask(() => {
        if (!live) { data.bitmap?.close?.(); return; }
        try { worker.onmessage?.({ data }); } catch (error) { report(error); }
      });
    },
  };
  const dispose = globalThis.PandoLabCanvasRenderer.install(scope);
  function postMessage(message, transfer = []) {
    if (!live) return;
    // Retained scene objects must remain isolated from the application's model.
    const data = structuredClone(message, { transfer });
    enqueue(() => scope.onmessage?.({ data }));
  }
  function terminate() {
    if (!live) return;
    live = false; dispose(); worker.onmessage = worker.onerror = null;
  }
  return worker;
}
