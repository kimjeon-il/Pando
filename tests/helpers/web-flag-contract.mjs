import { readFileSync } from 'node:fs';
import { loadWebOracle } from './web-oracle.mjs';
const { createCommandFixture } = await loadWebOracle('tools/parity/command-history.mjs');
const { prepareProjectForStorage } = await loadWebOracle('assets/js/modules/project-state.js');
const { effectiveTerritorialFlagUrl } = await loadWebOracle('assets/js/modules/country-flags.js');
const { runProjectTransaction } = await loadWebOracle('assets/js/modules/project-transaction.js');

export async function webFlagContractTrace() {
  const fixture = createCommandFixture({ id: 'A', name: 'Alpha' });
  const rows = [];
  const observe = (id, result) => {
    const feature = fixture.repository.get('A');
    rows.push({ id, result: JSON.parse(JSON.stringify(result, (key, value) => value instanceof Error
      ? { name: value.name, code: value.code, message: value.message } : value)),
    stateRevision: fixture.state.stateRevision, undo: fixture.domain.canUndo(), redo: fixture.domain.canRedo(),
    dirty: fixture.saveState.snapshot().documentDirty, storedMetadata: structuredClone(feature.properties.metadata),
    flagUrl: effectiveTerritorialFlagUrl(feature), snapshot: JSON.parse(JSON.stringify(fixture.snapshot())) });
  };
  observe('initial', null);
  for (const [id, value] of [['garbage-string', 'not an image'], ['trim-noop', '  not an image  '],
    ['empty-error', ''], ['number-error', 42], ['none', null], ['delete', undefined], ['delete-noop', undefined]])
    observe(id, fixture.service.updateMetadata('A', 'flagDataUrl', value));
  const before = fixture.snapshot();
  observe('cancel', await runProjectTransaction({ operationType: 'fixture-flag-cancel', snapshot: before,
    applyCanonical: () => {
      fixture.store.setField('A', 'flagDataUrl', 'cancelled value');
      throw Object.assign(new Error('User cancelled'), { name: 'AbortError', code: 'PL-FIXTURE-CANCELLED' });
    }, restore: () => fixture.store.restoreProject(before),
  }));
  const template = JSON.parse(readFileSync(new URL('../fixtures/portability/content-project.json', import.meta.url), 'utf8'));
  for (const [id, value] of [['loaded-string', ' arbitrary stored value '], ['loaded-number', 42], ['loaded-null', null]]) {
    const project = structuredClone(template);
    project.territorialEntities.find(feature => feature.id === 'A').properties.metadata.flagDataUrl = value;
    const prepared = prepareProjectForStorage(project);
    fixture.store.restoreProject(prepared);
    observe(id, { ok: true });
  }
  return rows;
}
