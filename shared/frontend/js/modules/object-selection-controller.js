const VALID_DOMAINS = new Set(['territorial', 'distribution', 'generic', 'hydro', 'label']);

export function normalizeObjectRef(value) {
  if (!value || typeof value !== 'object') return null;
  const domain = String(value.domain || '').trim();
  const type = String(value.type || '').trim();
  const id = String(value.id ?? '').trim();
  if (!VALID_DOMAINS.has(domain) || !type || !id || (domain === 'territorial' && type !== 'entity')) return null;
  return Object.freeze({ domain, type, id, key: `${domain}:${type}:${encodeURIComponent(id)}` });
}

export const objectRefKey = value => normalizeObjectRef(value)?.key || '';
