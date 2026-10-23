export const EXCHANGE_TARGETS = Object.freeze({
  PROJECT: 'project',
  GENERAL: 'general',
  REGIONAL: 'regional',
  DISTRIBUTION: 'distribution',
  GENERIC: 'generic',
});

const text = value => String(value ?? '').trim();

export const EXCHANGE_TARGET_DESCRIPTORS = Object.freeze({
  general: Object.freeze({ target: 'general', domain: 'territorial', replaceOnly: false, fallback: false }),
  regional: Object.freeze({ target: 'regional', domain: 'territorial', replaceOnly: false, fallback: false }),
  [EXCHANGE_TARGETS.PROJECT]: Object.freeze({ target: EXCHANGE_TARGETS.PROJECT, domain: 'project', replaceOnly: true, fallback: false }),
  [EXCHANGE_TARGETS.DISTRIBUTION]: Object.freeze({ target: EXCHANGE_TARGETS.DISTRIBUTION, domain: 'distribution', replaceOnly: false, fallback: false }),
  [EXCHANGE_TARGETS.GENERIC]: Object.freeze({ target: EXCHANGE_TARGETS.GENERIC, domain: 'generic', replaceOnly: false, fallback: true }),
});

export function normalizeExchangeTarget(value, fallback = EXCHANGE_TARGETS.GENERIC) {
  const raw = text(value);
  const target = raw;
  return EXCHANGE_TARGET_DESCRIPTORS[target] ? target : fallback;
}

export function exchangeTargetDescriptor(value) {
  return EXCHANGE_TARGET_DESCRIPTORS[normalizeExchangeTarget(value)] || null;
}
