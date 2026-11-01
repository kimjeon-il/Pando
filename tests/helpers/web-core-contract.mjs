import { readFileSync } from 'node:fs';
import { createCurrentFullDocumentFixture } from './web-full-document-fixture.mjs';

/** Actual current service results, complete storage, projected views and Core checkpoints. */
export async function webCoreContractTrace() {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const fixture = await createCurrentFullDocumentFixture(seed), rows = [];
  const observe = (id, result) => {
    const state = fixture.client.state();
    rows.push({ id, result: structuredClone(result), stateRevision: state.stateRevision,
      checkpoint: state.checkpoint, undo: state.canUndo, redo: state.canRedo, dirty: state.documentDirty,
      snapshot: fixture.fullSnapshot(), views: structuredClone(fixture.store.snapshot()) });
  };
  try {
    observe('initial', null);
    observe('normal', await fixture.service.updateMetadata('A', 'name', 'Beta'));
    observe('noop', await fixture.service.updateMetadata('A', 'name', 'Beta'));
    observe('error', await fixture.service.updateMetadata('missing', 'name', 'Other'));
    const candidate = await fixture.project.prepareCommand({ commandId: 'territorial.field',
      targets: [{ domain: 'territorial', id: 'A' }], payload: { id: 'A', field: 'notes', value: 'must not be published' } });
    if (!candidate.ok || !candidate.candidateId) throw new Error('Expected a retained cancellation candidate.');
    observe('cancel', await fixture.project.cancelCandidate(candidate.candidateId));
    observe('undo', await fixture.project.undo());
    observe('redo', await fixture.project.redo());
    return rows;
  } finally { fixture.dispose(); }
}
