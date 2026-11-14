const browserGlobals = {
  WebAssembly: 'readonly', AbortController: 'readonly', Blob: 'readonly', CustomEvent: 'readonly', DOMParser: 'readonly', File: 'readonly', FileReader: 'readonly',
  DOMException: 'readonly', DecompressionStream: 'readonly', Image: 'readonly', ImageBitmap: 'readonly',
  ImageData: 'readonly', IndexedDB: 'readonly', HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', Option: 'readonly',
  Event: 'readonly', EventTarget: 'readonly', PageTransitionEvent: 'readonly',
  MessageChannel: 'readonly', MessageEvent: 'readonly', MutationObserver: 'readonly', OffscreenCanvas: 'readonly', Path2D: 'readonly',
  Request: 'readonly', Headers: 'readonly', Response: 'readonly', ResizeObserver: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', TransformStream: 'readonly',
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
  TextEncoder: 'readonly', Buffer: 'readonly', Response: 'readonly', TextDecoder: 'readonly', URL: 'readonly', console: 'readonly', process: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', WebSocket: 'readonly',
};

export default [
 {ignores:['node_modules/**','assets/**','test-results/**','playwright-report/**']},
 {files:['**/*.{js,mjs}'],languageOptions:{ecmaVersion:'latest',sourceType:'module'},rules:{"no-undef":"error","no-unreachable":"error","no-dupe-args":"error","no-dupe-keys":"error","no-dupe-class-members":"error","no-const-assign":"error","no-import-assign":"error","no-class-assign":"error","valid-typeof":"error","constructor-super":"error","no-obj-calls":"error","no-invalid-regexp":"error"}},
 {files:['src/**/*.js'],languageOptions:{globals:{...browserGlobals,console:'readonly'}}},
 {files:['src/**/workers/**/*.js'],languageOptions:{sourceType:'script',globals:{...browserGlobals,console:'readonly',importScripts:'readonly',initSqlJs:'readonly',module:'readonly',onmessage:'writable',postMessage:'readonly',self:'readonly'}}},
 {files:['src/data/workers/data-loader-worker.js','src/data/workers/place-worker.js','src/rendering/workers/map-display-worker.js','src/document/workers/core-viewer-session-worker.js'],languageOptions:{sourceType:'module'}},
 {files:['scripts/**/*.mjs','tools/**/*.{js,mjs}','tests/**/*.mjs','*.config.js','.pnpmfile.mjs'],languageOptions:{globals:nodeGlobals}},
 {files:['tools/gis/gis-geometry-worker.js'],languageOptions:{sourceType:'script',globals:{...browserGlobals,self:'readonly',importScripts:'readonly'}}},
 {files:['tests/browser/**/*.mjs'],languageOptions:{globals:{...nodeGlobals,...browserGlobals}}}
];
