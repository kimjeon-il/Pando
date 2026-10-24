import js from '@eslint/js';

const browserGlobals = {
  AbortController: 'readonly', Blob: 'readonly', CustomEvent: 'readonly', DOMParser: 'readonly', File: 'readonly', FileReader: 'readonly',
  DOMException: 'readonly', DecompressionStream: 'readonly', Image: 'readonly', ImageBitmap: 'readonly',
  ImageData: 'readonly', IndexedDB: 'readonly', HTMLElement: 'readonly', Option: 'readonly',
  MessageChannel: 'readonly', MessageEvent: 'readonly', MutationObserver: 'readonly', OffscreenCanvas: 'readonly', Path2D: 'readonly',
  Response: 'readonly', ResizeObserver: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', TransformStream: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Worker: 'readonly',
  cancelAnimationFrame: 'readonly', clearInterval: 'readonly', clearTimeout: 'readonly', confirm: 'readonly',
  atob: 'readonly', btoa: 'readonly', caches: 'readonly', createImageBitmap: 'readonly', crypto: 'readonly',
  document: 'readonly', fetch: 'readonly',
  getComputedStyle: 'readonly', indexedDB: 'readonly', localStorage: 'readonly', location: 'readonly',
  navigator: 'readonly', performance: 'readonly', prompt: 'readonly', queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly', requestIdleCallback: 'readonly', cancelIdleCallback: 'readonly',
  setInterval: 'readonly', setTimeout: 'readonly', structuredClone: 'readonly',
  window: 'readonly', XMLSerializer: 'readonly',
};

const nodeGlobals = {
  Buffer: 'readonly', Response: 'readonly', TextDecoder: 'readonly', URL: 'readonly', console: 'readonly', process: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'assets/js/vendor/**',
    // Immutable Git blob test inputs are admitted by web-oracle.mjs and its
    // provenance/import-closure tests; they are not active application source.
    'tests/fixtures/portability/web-9300609-oracle/**',
    'tests/fixtures/shared-core/web-m97/lifecycle-source/**'] },
  js.configs.recommended,
  {
    files: ['assets/js/**/*.js', 'apps/web-shell/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browserGlobals, console: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },
  {
    files: ['assets/js/modules/gpu-stroke-renderer.js'],
    rules: {
      // Resource allocation is deliberately initialized before the guarded cleanup path.
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['assets/js/workers/**/*.js'],
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
      'assets/js/workers/data-loader-worker.js',
      'assets/js/workers/place-worker.js',
      'assets/js/workers/map-display-worker.js',
      'assets/js/workers/river-territory-partition-worker.js',
      'assets/js/workers/core-session-worker.js',
      'assets/js/workers/core-viewer-session-worker.js',
      'assets/js/workers/gpkg-read-core.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'tools/**/*.mjs', 'native/tools/**/*.mjs', 'apps/web-shell/**/*.mjs', 'plugins/pando-map-tools/**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['tests/browser/**/*.mjs', 'apps/web-shell/tests/**/*.mjs'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
  },
];
