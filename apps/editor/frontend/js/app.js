/* PandoLab application entry point. Feature implementations live in modules. */
const revision = new URL(import.meta.url).searchParams.get('v')
  || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const compositionUrl = new URL('./modules/app-composition.js', import.meta.url);
compositionUrl.searchParams.set('v', revision);
const { composeApplication } = await import(compositionUrl.href);
// The standalone shell supplies platform capabilities before the canonical Web bootstrap.
const platform = globalThis.__PANDOLAB_SHELL_PLATFORM__ || {};
const application = await composeApplication({ productMode: 'editor', revision, platform });
void application.start();
