import { createRuntimeProfile } from './runtime-profile.js';
import { createNativePlatformAdapter } from './native-platform-adapter.js';
import { installNetworkGuard } from './network-guard.js';
// Replaced by the staging owner only for verification builds.
const verification = null;
const native = createNativePlatformAdapter();
const verificationRuntime = verification ? verification.createVerificationRuntime({
  invoke: native.invoke,
  auto: native.runtime.autoVerification,
  probeHoldMs: native.runtime.probeHoldMs,
}) : null;

async function start() {
  if (document.readyState === 'loading' && (!globalThis.PANDOLAB_BUILD_META || !window.d3)) {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const meta = globalThis.PANDOLAB_BUILD_META;
  if (!meta?.assetRevision || !window.d3) throw new Error('The bundled application dependencies are unavailable.');
  const profileMeta = await fetch(new URL('./stage-profile.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('The bundled shell profile is missing.');
    return response.json();
  });
  if (profileMeta.mode !== 'map-data' && !verification) throw new Error('Ordinary startup requires the map-data profile.');
  native.assertVerification(profileMeta.verification, !!verification);
  const physicalAssets = [meta.physicalLand?.url, ...(meta.physicalWaterObjects?.geometries || [])
    .flatMap(row => [row.land?.url, row.asset?.url])].filter(Boolean);
  installNetworkGuard(globalThis, { allowBundledData: profileMeta.mode === 'map-data', physicalAssets });
  const assetBase = new URL('../assets/js/', import.meta.url);
  const runtimeModuleUrl = new URL('../assets/js/modules/runtime-context.js', import.meta.url);
  runtimeModuleUrl.searchParams.set('v', meta.assetRevision);
  const { validateBuildMetadata, versionedAssetUrl } = await import(runtimeModuleUrl.href);
  validateBuildMetadata(meta);
  const versionedAsset = relative => versionedAssetUrl(relative, assetBase, meta.assetRevision);
  const profile = profileMeta.mode === 'map-data'
    ? await createRuntimeProfile(profileMeta, meta)
    : await verification.createFixtureProfile(profileMeta);
  const platform = await native.preparePlatform({
    profile,
    meta,
    versionedAsset,
    install: profile.mode === 'map-data',
  });
  if (profile.mode === 'map-data') {
    window.addEventListener('pandolab:ready', () => {
      window.__PANDOLAB_SHELL_READY__ = true;
    }, { once: true });
    if (verification && !platform.library.geometryContext) verification.installWorld(profileMeta, { runtime: verificationRuntime });
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = versionedAsset('./bootstrap.js').href;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Canonical Web bootstrap unavailable in the shell.'));
      document.body.appendChild(script);
    });
    return;
  }
  await verification.startFixture({
    profile,
    meta,
    assetBase,
    versionedAsset,
    platform,
    nativeStorage: native.storage,
    verificationRuntime,
  });
}

start().catch(async error => {
  console.error('[PANDOEDITOR-SHELL-STARTUP]', error);
  const message = document.getElementById('bootstrapLoadingText');
  if (message) message.textContent = error.message;
  const overlay = document.getElementById('bootstrapLoading');
  if (overlay) overlay.hidden = false;
  const report = { schema: 'pandolab-web-shell-diagnostics', ok: false, stage: 'startup',
    error: { name: String(error.name || 'Error'), code: String(error.code || ''), message: String(error.message || error), stack: String(error.stack || '') },
  };
  try {
    if (verificationRuntime?.auto) await verificationRuntime.finishDiagnostics(report);
    else await native.writeDiagnosticReport(report);
  }
  catch (reportError) { console.error('[PANDOEDITOR-SHELL-REPORT]', reportError); }
});
