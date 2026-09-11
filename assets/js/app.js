/* PandoLab application entry point. Feature implementations live in modules. */
const revision = new URL(import.meta.url).searchParams.get('v')
  || globalThis.PANDOLAB_BUILD_META?.assetRevision || '';
const compositionUrl = new URL('./modules/app-composition.js', import.meta.url);
compositionUrl.searchParams.set('v', revision);
const { composeApplication } = await import(compositionUrl.href);
const application = await composeApplication({ revision });
const started = await application.start();
if (started) {
  const referenceImageUrl = new URL('./modules/reference-image-bootstrap.js', import.meta.url);
  referenceImageUrl.searchParams.set('v', revision);
  const { installReferenceImageFeature } = await import(referenceImageUrl.href);
  await installReferenceImageFeature({ revision });
}
