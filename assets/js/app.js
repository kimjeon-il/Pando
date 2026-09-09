/* PandoLab application entry point. Feature implementations live in modules. */
const revision = new URL(import.meta.url).searchParams.get('v')
  || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const compositionUrl = new URL('./modules/app-composition.js', import.meta.url);
compositionUrl.searchParams.set('v', revision);
const { composeApplication } = await import(compositionUrl.href);
const application = await composeApplication({ revision });
void application.start();
