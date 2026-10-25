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
  setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', WebSocket: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'shared/frontend/js/vendor/**', 'shared/frontend/static/vendor/**', 'shared/frontend/static/wasm/**', 'assets/**', 'apps/editor/src-tauri/**',
    // Immutable Git blob test inputs are admitted by web-oracle.mjs and its
    // provenance/import-closure tests; they are not active application source.
    'tests/fixtures/portability/web-9300609-oracle/**',
    'tests/fixtures/shared-core/web-m97/lifecycle-source/**'] },
  js.configs.recommended,
  {
    files: ['shared/frontend/js/**/*.js', 'apps/editor/frontend/js/**/*.js', 'apps/viewer/js/**/*.js', 'apps/editor/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browserGlobals, console: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },
  {
    files: ['shared/frontend/js/modules/gpu-stroke-renderer.js'],
    rules: {
      // Resource allocation is deliberately initialized before the guarded cleanup path.
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['shared/frontend/js/workers/**/*.js', 'apps/editor/frontend/js/workers/**/*.js'],
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
      'shared/frontend/js/workers/data-loader-worker.js',
      'shared/frontend/js/workers/place-worker.js',
      'shared/frontend/js/workers/map-display-worker.js',
      'apps/editor/frontend/js/workers/river-territory-partition-worker.js',
      'apps/editor/frontend/js/workers/core-session-worker.js',
      'shared/frontend/js/workers/core-viewer-session-worker.js',
      'shared/frontend/js/workers/gpkg-read-core.js',
    ],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '.github/scripts/**/*.mjs', 'tools/**/*.mjs', 'native/tools/**/*.mjs', 'apps/editor/**/*.mjs', 'plugins/pando-map-tools/**/*.mjs', '*.config.js', '.pnpmfile.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['tests/browser/**/*.mjs', 'apps/editor/tests/**/*.mjs'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
  },
];
