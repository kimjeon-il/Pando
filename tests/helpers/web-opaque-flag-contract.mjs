import { readFileSync } from 'node:fs';
import { loadWebOracle } from './web-oracle.mjs';
import { createOriginalFullDocumentFixture } from './web-full-document-fixture.mjs';

const { effectiveTerritorialFlagUrl } = await loadWebOracle('assets/js/modules/country-flags.js');

export function captureWebOpaqueFlagContract() {
  const input = JSON.parse(readFileSync(new URL('../fixtures/portability/web-opaque-flag-input.json', import.meta.url),'utf8'));
  const template = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url),'utf8'));
  const rows = [];
  for (const operation of input.cases) {
    const original = structuredClone(template);
    original.territorialEntities.find(feature => feature.id === 'A').properties.metadata.flagDataUrl = input.initialFlag;
    const fixture = createOriginalFullDocumentFixture(original);
    const observe = (stage, result) => {
      const feature = fixture.repository.get('A');
      rows.push({ id: operation.id, stage, result: result == null ? null : structuredClone(result),
        stateRevision: fixture.state.stateRevision, undo: fixture.domain.canUndo(), redo: fixture.domain.canRedo(),
        documentDirty: fixture.saveState.snapshot().documentDirty, metadata: structuredClone(feature.properties.metadata),
        flagUrl: effectiveTerritorialFlagUrl(feature), project: fixture.fullSnapshot() });
    };
    observe('loaded', null);
    const value = operation.op === 'delete' ? undefined : operation.value;
    observe('edited', fixture.service.updateMetadata('A','flagDataUrl',value));
    observe('noop', fixture.service.updateMetadata('A','flagDataUrl',value));
    observe('undo', fixture.domain.undo());
    observe('redo', fixture.domain.redo());
  }
  return { baseline: input.baseline, cases: rows };
}
