import { resolveInteractionEntries } from './map-interaction-style.js';
import { normalizeObjectRef } from './object-selection-controller.js';

/** A read-only projection of the existing selection and tool session. */
export function mapInteractionEntries(snapshot, state, { countryType = 'country', visible = () => true } = {}) {
  const rows = snapshot.selection.items.filter(visible).map(ref => ({ key: ref.key, ref,
    role: ref.key === snapshot.selection.primaryKey ? 'primary' : 'secondary' }));
  if (snapshot.hover && visible(snapshot.hover)) rows.push({ key: snapshot.hover.key, ref: snapshot.hover, role: 'hover' });
  const add = (domain, type, id, role) => {
    if (!id) return;
    const ref = normalizeObjectRef({ domain, type, id });
    const key = ref.key;
    if (visible(ref)) rows.push({ key, ref, role });
  };
  const country = (id, role) => add('territorial', countryType, id, role);
  const unit = (id, role) => {
    const feature = (state.territorialUnits || []).find(item => String(item.id) === String(id));
    if (feature) add('territorial', feature.properties.unitType, id, role);
  };
  const session = state.territorySelectionSession?.tool === state.tool ? state.territorySelectionSession : null;
  if (session) {
    if (session.kind === 'subunit') {
      if (session.parentId && session.parentId !== session.sovereignId) unit(session.parentId, 'reference');
      else country(session.sovereignId, 'reference');
    }
    if (session.targetHighlightRole) country(session.targetCountryId, 'edit-target');
    for (const id of session.sourceCountryIds || []) country(id, session.sourceHighlightRole || 'reference');
  }
  if (state.tool === 'country-coast') country(state.coastEditCountryId, 'edit-target');
  // The shared boundary and its handles are the edit target. Keep each
  // participating country's existing primary/secondary selection role so the
  // country on the other side is not promoted to the same full-area fill.
  if (state.tool === 'country-border') {
    const selectedKeys = new Set(rows.map(row => row.key));
    for (const id of state.boundaryEditCountryIds || []) {
      const ref = normalizeObjectRef({ domain: 'territorial', type: countryType, id });
      if (!selectedKeys.has(ref.key)) rows.push({ key: ref.key, ref, role: 'secondary' });
    }
  }
  if (state.tool === 'merge-country') {
    country(state.mergeSourceCountryId, 'edit-target');
    for (const id of state.mergeTargetCountryIds || []) country(id, 'selected-provider');
  }
  if (state.tool === 'merge-territorial-unit' && state.territorialUnitMergeSourceId) {
    unit(state.territorialUnitMergeSourceId, 'edit-target');
    for (const id of state.territorialUnitMergeTargetIds || []) unit(id, 'selected-provider');
  }
  if (state.tool === 'redraw-territorial-unit') unit(state.territorialUnitRedrawSourceId, 'edit-target');
  if (state.tool === 'split-territorial-unit') unit(state.territorialUnitSplitSourceId, 'edit-target');
  if (state.tool === 'split-generic-feature') add('generic', 'feature', state.genericFeatureSplitSourceId, 'edit-target');
  if (state.tool === 'merge-generic-feature') {
    add('generic', 'feature', state.genericFeatureMergeSourceId, 'edit-target');
    for (const id of state.genericFeatureMergeTargetIds || []) add('generic', 'feature', id, 'selected-provider');
  }
  const parents = new Map((state.territorialUnits || []).map(feature => [String(feature.id), feature.properties]));
  for (const row of rows) {
    const seen = new Set();
    let id = row.ref.domain === 'territorial' && row.ref.type !== countryType ? row.ref.id : '';
    row.depth = 0; row.ancestorKeys = [];
    while (id && parents.has(id) && !seen.has(id)) {
      seen.add(id); row.depth++;
      const parent = parents.get(id); id = String(parent.parentId || parent.sovereignId || '');
      if (id) row.ancestorKeys.push(normalizeObjectRef({ domain: 'territorial', type: parents.get(id)?.unitType || countryType, id }).key);
    }
  }
  for (const row of rows) Object.freeze(row.ancestorKeys);
  return resolveInteractionEntries(rows);
}

export function interactionChannel(entry) {
  return entry.priority >= 4 ? 'primary' : entry.priority === 3 ? 'secondary' : entry.priority === 2 ? 'hover' : 'candidate';
}
