import { loadWebOracle } from './web-oracle.mjs';

const { createCommandFixture } = await loadWebOracle('tools/parity/command-history.mjs');
const { prepareProjectForStorage } = await loadWebOracle('assets/js/modules/project-state.js');

/** Full seed observations use only the original Web state/store/service graph. */
export function createOriginalFullDocumentFixture(input) {
  const project = prepareProjectForStorage(structuredClone(input));
  const fixture = createCommandFixture();
  const otherFields = Object.fromEntries(Object.entries(project).filter(([key]) =>
    !['territorialEntities','timelineRecords','geometries'].includes(key)));
  Object.assign(fixture.state, structuredClone(otherFields));
  fixture.store.restoreProject(project);
  const fullSnapshot = () => ({ ...Object.fromEntries(Object.keys(project).map(key => [key,
    key === 'geometries' ? fixture.state.geometries.snapshot() : structuredClone(fixture.state[key])])),
  territorialEntities: fixture.store.identities() });
  return { ...fixture, project, fullSnapshot };
}
