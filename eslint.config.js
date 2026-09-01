import js from '@eslint/js';

const browserGlobals = {
  AbortController: 'readonly', Blob: 'readonly', CustomEvent: 'readonly', DOMParser: 'readonly', File: 'readonly', FileReader: 'readonly',
  DOMException: 'readonly', DecompressionStream: 'readonly', Image: 'readonly', ImageBitmap: 'readonly',
  ImageData: 'readonly', IndexedDB: 'readonly', HTMLElement: 'readonly', Option: 'readonly',
  MessageChannel: 'readonly', MutationObserver: 'readonly', OffscreenCanvas: 'readonly', Path2D: 'readonly',
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
  Buffer: 'readonly', Response: 'readonly', URL: 'readonly', console: 'readonly', process: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'assets/js/vendor/**'] },
  js.configs.recommended,
  {
    files: ['assets/js/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browserGlobals, console: 'readonly' } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
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
    files: ['assets/js/workers/data-loader-worker.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'tools/**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['tests/browser/**/*.mjs'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
  },
];
