import js from '@eslint/js';

const browserGlobals = {
  AbortController: 'readonly', Blob: 'readonly', CustomEvent: 'readonly', DOMParser: 'readonly', File: 'readonly', FileReader: 'readonly',
  DOMException: 'readonly', DecompressionStream: 'readonly', Image: 'readonly', ImageBitmap: 'readonly',
  ImageData: 'readonly', IndexedDB: 'readonly', HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', Option: 'readonly',
  Event: 'readonly', EventTarget: 'readonly', PageTransitionEvent: 'readonly',
  MessageChannel: 'readonly', MessageEvent: 'readonly', MutationObserver: 'readonly', OffscreenCanvas: 'readonly', Path2D: 'readonly',
  Response: 'readonly', ResizeObserver: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', TransformStream: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Worker: 'readonly',
  cancelAnimationFrame: 'readonly', clearInterval: 'readonly', clearTimeout: 'readonly', confirm: 'readonly',
  atob: 'readonly', btoa: 'readonly', caches: 'readonly', createImageBitmap: 'readonly', crypto: 'readonly',
  document: 'readonly', fetch: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
  matchMedia: 'readonly', visualViewport: 'readonly',
  getComputedStyle: 'readonly', indexedDB: 'readonly', localStorage: 'readonly', location: 'readonly',
  navigator: 'readonly', performance: 'readonly', prompt: 'readonly', queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly', requestIdleCallback: 'readonly', cancelIdleCallback: 'readonly',
  setInterval: 'readonly', setTimeout: 'readonly', structuredClone: 'readonly',
  window: 'readonly', XMLSerializer: 'readonly',
};

const nodeGlobals = {
  AbortController: 'readonly', CustomEvent: 'readonly', DOMException: 'readonly', Event: 'readonly', EventTarget: 'readonly',
  ReadableStream: 'readonly', URLSearchParams: 'readonly', queueMicrotask: 'readonly', setImmediate: 'readonly',
  Buffer: 'readonly', Response: 'readonly', TextDecoder: 'readonly', URL: 'readonly', console: 'readonly', process: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', WebSocket: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'assets/js-vendor/**', 'assets/vendor/**', 'assets/wasm/**', 'assets/**', 'apps/editor/src-tauri/**',
    // Immutable Git blob test inputs are admitted by web-oracle.mjs and its
    // provenance/import-closure tests; they are not active application source.
    'tests/fixtures/portability/web-9300609-oracle/**',
    'tests/fixtures/shared-core/web-m97/lifecycle-source/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'src/**/*.js', 'apps/editor/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browserGlobals, console: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },
  {
    files: ['src/rendering/gpu-stroke-renderer.js'],
    rules: {
      // Resource allocation is deliberately initialized before the guarded cleanup path.
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/**/workers/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...browserGlobals,
        importScripts: 'readonly', initSqlJs: 'readonly', module: 'readonly',
        onmessage: 'writable', postMessage: 'readonly', self: 'readonly',
      },
    },
  },
  {
    files: [
      'src/data/workers/data-loader-worker.js',
      'src/data/workers/place-worker.js',
      'src/rendering/workers/map-display-worker.js',
      'src/document/workers/core-viewer-session-worker.js',
      'src/rendering/workers/gpkg-read-core.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['tests/**/*.mjs', 'shared/tests/**/*.mjs', 'scripts/**/*.mjs', '.github/scripts/**/*.mjs', 'tools/**/*.mjs', 'native/tools/**/*.mjs', 'apps/editor/**/*.mjs', 'plugins/pando-map-tools/**/*.mjs', '*.config.js', '.pnpmfile.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['tests/browser/**/*.mjs', 'tests/integration/**/*.mjs', 'apps/editor/tests/**/*.mjs'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
  },
  {
    // These Node runners execute the callbacks in the inspected browser page.
    files: ['tools/w2-p2-run.mjs', 'tools/w2-p3-run.mjs', 'tools/w2-p3-browser-regression.mjs'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals,
      PerformanceObserver: 'readonly', devicePixelRatio: 'readonly',
      __PANDOLAB_VIEWER__: 'readonly', PANDOLAB_BUILD_META: 'readonly',
      __w2Long: 'readonly', __w2ReplayStale: 'readonly', __w3Long: 'writable',
      __w3ContextLost: 'writable', __w3ContextRestored: 'writable', __w3Loss: 'readonly', __W3_FORCE: 'readonly',
    } },
  },
];
