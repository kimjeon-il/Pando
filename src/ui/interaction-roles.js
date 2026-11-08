import { resolveInteractionEntries } from "../map/map-interaction-style.js";
import { normalizeObjectRef } from "./object-selection-controller.js";

/** A read-only projection of the existing selection and tool session. */
export function mapInteractionEntries(snapshot, {
  visible = () => true,
  territorialEntityById,
} = {}) {
  const rows = snapshot.selection.items.filter(visible).map(ref => ({ key: ref.key, ref,
    role: ref.key === snapshot.selection.primaryKey ? 'primary' : 'secondary' }));
  if (snapshot.hover && visible(snapshot.hover)) rows.push({ key: snapshot.hover.key, ref: snapshot.hover, role: 'hover' });
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
