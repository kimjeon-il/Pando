import { loadWebOracle } from './web-oracle.mjs';
const { createCommandFixture } = await loadWebOracle('tools/parity/command-history.mjs');
const { runProjectTransaction } = await loadWebOracle('assets/js/modules/project-transaction.js');

/** Exact current territorial state, geometry versions and operation outcomes. */
export async function webCoreContractTrace() {
  const fixture = createCommandFixture({ id: 'A', name: 'Alpha' });
  const rows = [];
  const observe = (id, result) => {
    rows.push({ id, result: JSON.parse(JSON.stringify(result, (key, value) => value instanceof Error
      ? { name: value.name, code: value.code, message: value.message } : value)),
    stateRevision: fixture.state.stateRevision, undo: fixture.domain.canUndo(), redo: fixture.domain.canRedo(),
    dirty: fixture.saveState.snapshot().documentDirty, snapshot: JSON.parse(JSON.stringify(fixture.snapshot())),
    views: JSON.parse(JSON.stringify(fixture.store.snapshot())) });
  };
  observe('initial', null);
  observe('normal', fixture.service.updateMetadata('A', 'name', 'Beta'));
  observe('noop', fixture.service.updateMetadata('A', 'name', 'Beta'));
  observe('error', fixture.service.updateMetadata('missing', 'name', 'Other'));
  const before = fixture.snapshot();
  const cancelled = await runProjectTransaction({ operationType: 'fixture-cancel', snapshot: before,
    applyCanonical: async () => {
      fixture.store.setField('A', 'notes', 'must roll back');
      throw Object.assign(new Error('User cancelled'), { name: 'AbortError', code: 'PL-FIXTURE-CANCELLED' });
    }, restore: () => fixture.store.restoreProject(before),
  });
  observe('cancel', cancelled);
  observe('undo', fixture.domain.undo());
  observe('redo', fixture.domain.redo());
  return rows;
}
