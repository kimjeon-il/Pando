/* PandoLab application entry point. Feature implementations live in modules. */
const revision = new URL(import.meta.url).searchParams.get('v')
  || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const compositionUrl = new URL('./modules/app-composition.js', import.meta.url);
const platformPortsUrl = new URL('./modules/platform-ports.js', import.meta.url);
compositionUrl.searchParams.set('v', revision);
platformPortsUrl.searchParams.set('v', revision);
const [{ composeApplication }, { createPlatformPorts }] = await Promise.all([import(compositionUrl.href), import(platformPortsUrl.href)]);
// The standalone shell supplies native platform ports; browser editing uses the explicit browser contract.
const platform = globalThis.__PANDOLAB_SHELL_PLATFORM__ || createPlatformPorts({ kind: 'browser' });
const application = await composeApplication({ productMode: 'editor', revision, platform });
void application.start();
