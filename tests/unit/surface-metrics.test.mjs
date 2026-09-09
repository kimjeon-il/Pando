import test from 'node:test';
import assert from 'node:assert/strict';
import { installSurfaceMetrics } from '../../assets/js/modules/surface-metrics.js';

test('surface metrics measures header sizes and tracks layout resize', () => {
  const node = (classes, width, clientWidth, height) => {
    const values = new Map();
    return {
      isConnected: true, offsetWidth: width, clientWidth,
      classList: { contains: name => classes.includes(name) },
      getClientRects: () => [{}], getBoundingClientRect: () => ({ height }),
      style: { getPropertyValue: key => values.get(key), setProperty: (key, value) => values.set(key, value) },
    };
  };
  const root = node([], 1000, 1000, 800);
  const panel = node([], 320, 320, 600);
  const header = node(['surface-header'], 320, 318, 104);
  header.parentElement = panel;
  const topbar = node(['topbar'], 1000, 998, 60);
  const scroll = node(['surface-body'], 320, 301, 400);
  let resizeCallback;
  let disconnected = 0;
  const documentRef = {
    documentElement: root, body: {}, querySelectorAll: () => [header, topbar, scroll],
    defaultView: {
      ResizeObserver: class {
        constructor(callback) { resizeCallback = callback; }
        observe() {} unobserve() {} disconnect() { disconnected++; }
      },
      MutationObserver: class { observe() {} disconnect() { disconnected++; } },
      getComputedStyle: () => ({ borderLeftWidth: '1px', borderRightWidth: '1px' }),
      requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {},
      addEventListener() {}, removeEventListener() {},
    },
  };
  const dispose = installSurfaceMetrics(documentRef);
  assert.equal(root.style.getPropertyValue('--ui-topbar-measured'), '60px');
  assert.equal(panel.style.getPropertyValue('--ui-sheet-header-measured'), '104px');
  scroll.clientWidth = 318;
  resizeCallback();
  dispose();
  assert.equal(disconnected, 2);
});

test('surface metrics safely skips unsupported observers', () => {
  assert.doesNotThrow(() => installSurfaceMetrics({ defaultView: {} })());
});
