const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digestSyntax = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Opens only the manifest-pinned JS/WASM pair for this compiled C++ source. */
export async function loadVerifiedCore({ baseUrl, fetchAsset = globalThis.fetch,
  importModule = url => import(url), subtle = null,
  createModuleUrl = bytes => {
    if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function')
      fail('PL-CORE-WASM-DEPENDENCY', 'Verified JavaScript Blob module support is required.');
    return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  },
  revokeModuleUrl = url => URL.revokeObjectURL(url),
} = {}) {
  const hashing = subtle ?? (typeof globalThis.crypto === 'object' ? globalThis.crypto.subtle : null);
  if (!hashing || typeof hashing.digest !== 'function' || typeof fetchAsset !== 'function'
    || typeof importModule !== 'function' || typeof createModuleUrl !== 'function' || typeof revokeModuleUrl !== 'function')
    fail('PL-CORE-WASM-DEPENDENCY', 'Required verified WASM loader dependencies are missing.');
  const manifestUrl = new URL('pandoeditor-core.manifest.json', baseUrl);
  const read = async url => {
    const response = await fetchAsset(url.href, { cache: 'no-store' });
    if (!response.ok) fail('PL-CORE-WASM-UNAVAILABLE', `공통 C++ 엔진 파일을 읽지 못했습니다: ${url.pathname} (HTTP ${response.status})`);
    return response;
  };
  const manifest = await (await read(manifestUrl)).json();
  if (manifest?.schema !== 'pandoeditor-core-wasm' || manifest.abiVersion !== 1
    || manifest.compiler?.name !== 'emscripten' || manifest.compiler.version !== '4.0.20'
    || !digestSyntax(manifest.sourceSha256) || manifest.assets?.js?.file !== 'pandoeditor-core.js'
    || manifest.assets?.wasm?.file !== 'pandoeditor-core.wasm'
    || !digestSyntax(manifest.assets.js.sha256) || !digestSyntax(manifest.assets.wasm.sha256))
    fail('PL-CORE-WASM-MANIFEST', '공통 C++ 엔진 manifest가 현재 계약과 일치하지 않습니다.');
  const assetUrl = asset => {
    const url = new URL(asset.file, baseUrl);
    url.searchParams.set('sha256', asset.sha256);
    return url;
  };
  const jsUrl = assetUrl(manifest.assets.js), wasmUrl = assetUrl(manifest.assets.wasm);
  const [jsBytes, wasmBytes] = await Promise.all([read(jsUrl).then(response => response.arrayBuffer()),
    read(wasmUrl).then(response => response.arrayBuffer())]);
  const [jsHash, wasmHash] = await Promise.all([hashing.digest('SHA-256', jsBytes).then(hex), hashing.digest('SHA-256', wasmBytes).then(hex)]);
  if (jsHash !== manifest.assets.js.sha256 || wasmHash !== manifest.assets.wasm.sha256)
    fail('PL-CORE-WASM-INTEGRITY', '공통 C++ 엔진 JS/WASM 파일의 SHA-256이 manifest와 다릅니다.');
  const verifiedModuleUrl = createModuleUrl(jsBytes);
  try {
    const { default: createCore } = await importModule(verifiedModuleUrl);
    const core = await createCore({ wasmBinary: wasmBytes, locateFile: name => new URL(name, baseUrl).href });
    if (core.coreAbiVersion !== manifest.abiVersion || core.coreSourceSha256 !== manifest.sourceSha256
      || core.coreCompilerVersion !== manifest.compiler.version)
      fail('PL-CORE-WASM-ABI', '공통 C++ 엔진 ABI, compiler 또는 원본 digest가 manifest와 다릅니다.');
    return core;
  } finally { revokeModuleUrl(verifiedModuleUrl); }
}
