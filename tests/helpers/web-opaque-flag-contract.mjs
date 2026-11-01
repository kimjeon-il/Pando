import { readFileSync } from 'node:fs';
import { effectiveTerritorialFlagUrl } from '../../shared/frontend/js/modules/country-flags.js';
import { createCurrentFullDocumentFixture } from './web-full-document-fixture.mjs';

export async function captureWebOpaqueFlagContract() {
  const input = JSON.parse(readFileSync(new URL('../fixtures/portability/web-opaque-flag-input.json', import.meta.url),'utf8'));
  const template = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url),'utf8'));
  const rows = [];
  for (const operation of input.cases) {
    const initial = structuredClone(template);
    initial.territorialEntities.find(feature => feature.id === 'A').properties.metadata.flagDataUrl = input.initialFlag;
    const fixture = await createCurrentFullDocumentFixture(initial);
    const observe = (stage, result) => {
      const feature = fixture.repository.get('A'), state = fixture.client.state();
      rows.push({ id: operation.id, stage, result: result == null ? null : structuredClone(result),
        stateRevision: state.stateRevision, undo: state.canUndo, redo: state.canRedo,
        documentDirty: state.documentDirty, metadata: structuredClone(feature.properties.metadata),
        flagUrl: effectiveTerritorialFlagUrl(feature), project: fixture.fullSnapshot() });
    };
    try {
      observe('loaded', null);
      const value = operation.op === 'delete' ? undefined : operation.value;
      observe('edited', await fixture.service.updateMetadata('A','flagDataUrl',value));
      observe('noop', await fixture.service.updateMetadata('A','flagDataUrl',value));
      observe('undo', await fixture.project.undo());
      observe('redo', await fixture.project.redo());
    } finally { fixture.dispose(); }
  }
  return { baseline: input.baseline, cases: rows };
}
