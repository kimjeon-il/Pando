/* PandoLab application entry point. Feature implementations live in modules. */
const revision = new URL(import.meta.url).searchParams.get('v')
  || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const compositionUrl = new URL('./modules/app-composition.js', import.meta.url);
const platformRuntimeUrl = new URL('./modules/platform-runtime.js', import.meta.url);
compositionUrl.searchParams.set('v', revision);
platformRuntimeUrl.searchParams.set('v', revision);
const [{ composeApplication }, { resolveRuntimePlatform }] = await Promise.all([import(compositionUrl.href), import(platformRuntimeUrl.href)]);
const platform = resolveRuntimePlatform({ productMode: 'editor' });
const application = await composeApplication({ productMode: 'editor', revision, platform });
void application.start();
