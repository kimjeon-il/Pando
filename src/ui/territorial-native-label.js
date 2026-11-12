/** Optional verified native-name metadata; historical entries are date-scoped.
 * Do not infer a native endonym from the translated territorial display name.
 */
export const TERRITORIAL_NATIVE_MIN_ZOOM = 8;
const normalized = value => String(value || '').trim().normalize('NFKC').toLocaleLowerCase();
const fromEntry = entry => typeof entry === 'string' ? { text: entry } : entry && typeof entry === 'object' ? {
  text: entry.text || entry.name || '',
  from: entry.validFrom || entry.from || null,
  to: entry.validTo || entry.to || null,
} : null;
const isActive = (entry, month) => {
  if (!entry || !month) return !!entry;
  const date = month.slice(0, 7);
  return (!entry.from || date >= String(entry.from).slice(0, 7))
    && (!entry.to || date <= String(entry.to).slice(0, 7));
};
export function territorialNativeLabelRows(feature, month, { zoom = 0, enabled = false } = {}) {
  const primary = String(feature?.properties?.name || '').trim();
  const rows = primary ? [{ language: 'ko', text: primary }] : [];
  if (!primary || !enabled || zoom < TERRITORIAL_NATIVE_MIN_ZOOM) return rows;
  const metadata = feature?.properties?.metadata || {};
  const names = Array.isArray(metadata.nativeNames) ? metadata.nativeNames
    : metadata.nativeName != null ? [metadata.nativeName] : [];
  const entry = names.map(fromEntry).find(item => isActive(item, month) && String(item.text || '').trim());
  const native = String(entry?.text || '').trim();
  if (native && normalized(native) !== normalized(primary)) rows.push({ language: 'native', text: native });
  return rows;
}
