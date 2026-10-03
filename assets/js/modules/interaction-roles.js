import { resolveInteractionEntries } from './map-interaction-style.js';
import { normalizeObjectRef } from './object-selection-controller.js';

/** A read-only projection of the existing selection and tool session. */
export function mapInteractionEntries(snapshot, state, {
  visible = () => true,
  territorialEntityById,
} = {}) {
  const rows = snapshot.selection.items.filter(visible).map(ref => ({ key: ref.key, ref,
    role: ref.key === snapshot.selection.primaryKey ? 'primary' : 'secondary' }));
  if (snapshot.hover && visible(snapshot.hover)) rows.push({ key: snapshot.hover.key, ref: snapshot.hover, role: 'hover' });
  const add = (domain, type, id, role) => {
    if (!id) return;
    const ref = normalizeObjectRef({ domain, type, id });
    const key = ref.key;
    if (visible(ref)) rows.push({ key, ref, role });
  };
  const entity = (id, role) => add('territorial', 'entity', id, role);
  const session = state.territorySelectionSession?.tool === state.tool ? state.territorySelectionSession : null;
  if (session) {
    if (session.kind === 'entity' && !!session.parentId) {
      entity(session.parentId, 'reference');
    }
    if (session.targetHighlightRole) entity(session.targetCountryId, 'edit-target');
    for (const id of session.sourceCountryIds || []) entity(id, session.sourceHighlightRole || 'reference');
  }
  if (state.tool === 'country-coast') entity(state.coastEditCountryId, 'edit-target');
  // The shared boundary and its handles are the edit target. Keep each
  // participating country's existing primary/secondary selection role so the
  // country on the other side is not promoted to the same full-area fill.
  if (state.tool === 'territorial-border') {
    const selectedKeys = new Set(rows.map(row => row.key));
    for (const id of state.boundaryEditEntityIds || []) {
      const ref = normalizeObjectRef({ domain: 'territorial', type: 'entity', id });
      if (!selectedKeys.has(ref.key)) rows.push({ key: ref.key, ref, role: 'secondary' });
    }
  }
  if (state.tool === 'merge-country') {
    entity(state.mergeSourceCountryId, 'edit-target');
    for (const id of state.mergeTargetCountryIds || []) entity(id, 'selected-provider');
  }
  if (state.tool === 'merge-territorial-unit' && state.territorialUnitMergeSourceId) {
    entity(state.territorialUnitMergeSourceId, 'edit-target');
    for (const id of state.territorialUnitMergeTargetIds || []) entity(id, 'selected-provider');
  }
  if (state.tool === 'redraw-territorial-unit') entity(state.territorialUnitRedrawSourceId, 'edit-target');
  if (state.tool === 'split-territorial-unit') entity(state.territorialUnitSplitSourceId, 'edit-target');
  if (state.tool === 'split-generic-feature') add('generic', 'feature', state.genericFeatureSplitSourceId, 'edit-target');
  if (state.tool === 'merge-generic-feature') {
    add('generic', 'feature', state.genericFeatureMergeSourceId, 'edit-target');
    for (const id of state.genericFeatureMergeTargetIds || []) add('generic', 'feature', id, 'selected-provider');
  }
  if (rows.some(row => row.ref.domain === 'territorial') && typeof territorialEntityById !== 'function') {
    throw new TypeError('객체 강조에는 공통 Repository 조회가 필요합니다.');
  }
  for (const row of rows) {
    const seen = new Set();
    let id = row.ref.domain === 'territorial' ? row.ref.id : '';
    row.depth = 0; row.ancestorKeys = [];
    while (id) {
      if (seen.has(id)) throw new Error(`객체 강조 관계가 순환합니다: ${id}`);
      seen.add(id);
      const parentId = String(territorialEntityById(id)?.properties.parentId || '');
      if (!parentId) break;
      row.depth++;
      row.ancestorKeys.push(normalizeObjectRef({ domain: 'territorial', type: 'entity', id: parentId }).key);
      id = parentId;
    }
  }
  for (const row of rows) Object.freeze(row.ancestorKeys);
  return resolveInteractionEntries(rows);
}

export function interactionChannel(entry) {
  return entry.priority >= 4 ? 'primary' : entry.priority === 3 ? 'secondary' : entry.priority === 2 ? 'hover' : 'candidate';
}
