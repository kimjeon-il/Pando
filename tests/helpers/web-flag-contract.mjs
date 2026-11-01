import { readFileSync } from 'node:fs';
import { effectiveTerritorialFlagUrl } from '../../shared/frontend/js/modules/country-flags.js';
import { createCurrentFullDocumentFixture } from './web-full-document-fixture.mjs';

export async function webFlagContractTrace() {
  const template = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const seed = structuredClone(template);
  delete seed.territorialEntities.find(row => row.id === 'A').properties.metadata.flagDataUrl;
  const fixture = await createCurrentFullDocumentFixture(seed), rows = [];
  const observe = (id, result) => {
    const feature = fixture.repository.get('A'), state = fixture.client.state();
    rows.push({ id, result: structuredClone(result), stateRevision: state.stateRevision,
      checkpoint: state.checkpoint, undo: state.canUndo, redo: state.canRedo, dirty: state.documentDirty,
      storedMetadata: structuredClone(feature.properties.metadata), flagUrl: effectiveTerritorialFlagUrl(feature),
      snapshot: fixture.fullSnapshot() });
  };
  try {
    observe('initial', null);
    for (const [id, value] of [['garbage-string', 'not an image'], ['trim-noop', '  not an image  '],
      ['empty-error', ''], ['number-error', 42], ['none', null], ['delete', undefined], ['delete-noop', undefined]])
      observe(id, await fixture.service.updateMetadata('A', 'flagDataUrl', value));
    const candidate = await fixture.project.prepareCommand({ commandId: 'territorial.metadata',
      targets: [{ domain: 'territorial', id: 'A' }],
      payload: { id: 'A', field: 'flagDataUrl', valuePresent: true, value: 'cancelled value' } });
    if (!candidate.ok || !candidate.candidateId) throw new Error('Expected a retained flag cancellation candidate.');
    observe('cancel', await fixture.project.cancelCandidate(candidate.candidateId));
    for (const [id, value] of [['loaded-string', ' arbitrary stored value '], ['loaded-number', 42], ['loaded-null', null]]) {
      const project = structuredClone(template);
      project.territorialEntities.find(feature => feature.id === 'A').properties.metadata.flagDataUrl = value;
      await fixture.client.load(JSON.stringify(project));
      observe(id, { ok: true });
    }
    return rows;
  } finally { fixture.dispose(); }
}
