import { normalizeTemporalInterval, parseTemporal } from './temporal.js';

export const REVIEW_BUNDLE_SCHEMA_VERSION = 1;
export const REVIEW_DATA_REPOSITORY = 'kimjeon-il/PandoLab-library-data';

const kinds = Object.freeze(['geometry', 'name', 'flag', 'parent', 'lifetime']);
const checkNames = Object.freeze(['source-integrity', 'temporal', 'schema', 'geometry-topology', 'parent-graph']);
const outcomes = new Set(['passed', 'failed', 'not-run']);
const reportSubjects = new Set(['borders', 'hydro', 'places', 'terrain', 'map-analysis', 'development']);
const fields = Object.freeze({
  geometry: 'geometry',
  flag: 'metadata.flagHistory',
  parent: 'parentEntityId',
  lifetime: 'lifetime',
});
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const sourceIdPattern = /^[a-z]+:[A-Za-z0-9_-]+$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const nameField = /^names\.(ko|en)\.(common|formal)$/;

function fail(message, code = 'PL-REVIEW-SCHEMA') {
  throw Object.assign(new TypeError(message), { code });
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function shape(value, required, optional, location) {
  if (!plain(value)) fail(location + ' must be a plain object.');
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key))
    fail(location + ' requires ' + key);
  for (const key of Object.keys(value)) if (!allowed.has(key))
    fail(location + ' has unsupported field ' + key);
  return value;
}

function exactText(value, location, maximum = 4096) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum)
    fail(location + ' must be a nonblank, exact string.');
  return value;
}

function id(value, location) {
  if (!idPattern.test(exactText(value, location, 128))) fail(location + ' is not a canonical ID.');
  return value;
}
function sourceId(value) {
  if (!sourceIdPattern.test(exactText(value, 'sourceEntityId', 160)))
    fail('sourceEntityId must be the external catalog entity ID, not an app object/geometry ID.');
  return value;
}
function sha(value, location) {
  if (typeof value !== 'string' || !shaPattern.test(value)) fail(location + ' must be a 40-character Git commit SHA.');
  return value;
}
function digest(value, location) {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail(location + ' must be a 64-character SHA-256.');
  return value;
}
function list(value, location, maximum = 200) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum)
    fail(location + ' must be a nonempty bounded list.');
  return value;
}
function unique(values, location) {
  if (new Set(values).size !== values.length) fail(location + ' has duplicate identities.');
}
function utc(value, location) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail(location + ' must be a valid UTC ISO timestamp with milliseconds.');
  return value;
}
function reportPath(value) {
  exactText(value, 'reportPath', 1000);
  const parts = value.split('/');
  if (parts[0] !== 'reports' || !reportSubjects.has(parts[1]) || parts.length < 4
    || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.')
      || (/[\\?#%]/.test(part) || [...part].some(char => char.codePointAt(0) < 32)))
    || !/\.(?:md|json)$/.test(parts.at(-1)))
    fail('Evidence must point to a canonical, safe report/verification file in the external library.');
  return value;
}
const interval = (source, location) => {
  shape(source, ['validFrom', 'validTo'], [], location);
  for (const endpoint of ['validFrom', 'validTo'])
    if (source[endpoint] !== null) exactText(source[endpoint], location + '.' + endpoint, 32);
  try {
    const result = normalizeTemporalInterval(source.validFrom, source.validTo);
    return { validFrom: result.validFrom, validTo: result.validTo };
  } catch (error) { fail(location + ' has invalid temporal endpoints: ' + error.message); }
};

function changeValue(kind, value) {
  if (value === null) return null;
  if (kind === 'name') return exactText(value, 'name value', 600);
  if (kind === 'parent') return sourceId(value);
  if (kind === 'lifetime') return interval(value, 'lifetime');
  if (kind === 'geometry') {
    shape(value, ['versionId', 'sha256'], [], 'geometry reference');
    return { versionId: exactText(value.versionId, 'geometry versionId', 200),
      sha256: digest(value.sha256, 'geometry sha256') };
  }
  if (kind === 'flag') {
    shape(value, ['sha256'], [], 'flag fingerprint');
    return { sha256: digest(value.sha256, 'flag sha256') };
  }
  fail('Unsupported review change kind: ' + kind);
}

function evidence(source) {
  shape(source, ['id', 'reportPath', 'revision'], [], 'evidence');
  return { id: id(source.id, 'evidence ID'), reportPath: reportPath(source.reportPath),
    revision: sha(source.revision, 'evidence revision') };
}

function change(source, evidenceIds) {
  shape(source, ['sourceEntityId', 'kind', 'field', 'validFrom', 'validTo', 'before', 'after', 'evidenceIds'], [], 'change');
  if (!kinds.includes(source.kind)) fail('Unsupported change kind: ' + source.kind);
  const field = source.kind === 'name'
    ? (nameField.test(source.field) ? source.field : fail('Name change requires an explicit common/formal language field.'))
    : fields[source.kind];
  if (source.field !== field) fail('Change kind and logical property field do not match.');
  const dates = interval({ validFrom: source.validFrom, validTo: source.validTo }, 'change validity');
  const refs = list(source.evidenceIds, 'change.evidenceIds', 30).map(value => id(value, 'evidence ID'));
  unique(refs, 'change.evidenceIds');
  if (refs.some(value => !evidenceIds.has(value))) fail('Change references an unknown evidence ID.');
  const before = changeValue(source.kind, source.before), after = changeValue(source.kind, source.after);
  if (JSON.stringify(before) === JSON.stringify(after))
    fail('Review changes must contain a real before/after difference.');
  return { sourceEntityId: sourceId(source.sourceEntityId), kind: source.kind, field,
    ...dates, before, after, evidenceIds: refs };
}

function proposal(source) {
  shape(source, ['proposalId', 'createdAt', 'createdBy', 'dataset', 'comparisonMonth', 'evidence', 'changes'],
    ['supersedesProposalId'], 'proposal');
  const proposalId = id(source.proposalId, 'proposalId');
  shape(source.dataset, ['repository', 'baseRevision', 'candidateRevision'], [], 'dataset');
  if (source.dataset.repository !== REVIEW_DATA_REPOSITORY)
    fail('Review dataset must use the established external library owner.');
  const baseRevision = sha(source.dataset.baseRevision, 'baseRevision');
  const candidateRevision = sha(source.dataset.candidateRevision, 'candidateRevision');
  if (baseRevision === candidateRevision) fail('Review requires two distinct immutable data revisions.');
  if (!['ai', 'human'].includes(source.createdBy)) fail('Proposal creator must be ai or human.');
  let comparisonMonth = null;
  if (source.comparisonMonth !== null) {
    if (typeof source.comparisonMonth !== 'string') fail('comparisonMonth must be a month or explicit null.');
    exactText(source.comparisonMonth, 'comparisonMonth', 32);
    try {
      const temporal = parseTemporal(source.comparisonMonth, { nullable: false });
      if (temporal.precision !== 'month') fail('comparisonMonth must have calendar-month precision.');
      comparisonMonth = temporal.canonical;
    } catch (error) { if (error.code === 'PL-REVIEW-SCHEMA') throw error;
      fail('comparisonMonth has invalid temporal precision/date: ' + error.message); }
  }
  const reports = list(source.evidence, 'proposal.evidence', 60).map(evidence);
  unique(reports.map(row => row.id), 'proposal evidence');
  const ids = new Set(reports.map(row => row.id));
  const changes = list(source.changes, 'proposal.changes', 500).map(row => change(row, ids));
  unique(changes.map(row => JSON.stringify([row.sourceEntityId, row.kind, row.field, row.validFrom, row.validTo])),
    'proposal change keys');
  const supersedes = source.supersedesProposalId == null ? null : id(source.supersedesProposalId, 'supersedesProposalId');
  if (supersedes === proposalId) fail('A review proposal cannot supersede itself.');
  return {
    proposalId, createdAt: utc(source.createdAt, 'createdAt'), createdBy: source.createdBy,
    dataset: { repository: REVIEW_DATA_REPOSITORY, baseRevision, candidateRevision },
    comparisonMonth, supersedesProposalId: supersedes, evidence: reports, changes,
  };
}

function actor(value) {
  shape(value, ['kind', 'id'], [], 'actor');
  if (!['ci', 'human'].includes(value.kind)) fail('Event actor must be ci or human.');
  return { kind: value.kind, id: id(value.id, 'actor ID') };
}
function checks(value, required) {
  const items = list(value, 'validation.checks', 20).map(row => {
    shape(row, ['name', 'outcome'], [], 'validation check');
    if (!checkNames.includes(row.name) || !outcomes.has(row.outcome))
      fail('Unsupported validation check/outcome.');
    return { name: row.name, outcome: row.outcome };
  });
  unique(items.map(row => row.name), 'validation checks');
  for (const name of required) if (!items.some(row => row.name === name))
    fail('Validation is missing mandatory check ' + name);
  return items;
}
function requiredChecks(proposal) {
  const required = new Set(['schema', 'temporal', 'source-integrity']);
  for (const row of proposal.changes) {
    if (row.kind === 'geometry') required.add('geometry-topology');
    if (row.kind === 'parent') required.add('parent-graph');
  }
  return [...required];
}
function reviewEvent(source, required) {
  shape(source, ['eventId', 'type', 'at', 'actor'], ['checks', 'codeRevision', 'reportPath', 'reason', 'appliedRevision'], 'event');
  const type = source.type;
  if (!['validated', 'changes-requested', 'approved', 'rejected', 'applied'].includes(type))
    fail('Unsupported review event type.');
  const normalized = { eventId: id(source.eventId, 'eventId'), type, at: utc(source.at, 'event.at'),
    actor: actor(source.actor) };
  if ((type === 'validated' || type === 'applied') !== (source.actor.kind === 'ci'))
    fail('Validation/adoption events require a CI actor; review decisions require a human actor.');
  if (type === 'validated') {
    if (source.reason !== undefined || source.appliedRevision !== undefined)
      fail('Validation events cannot include decision/adoption fields.');
    normalized.checks = checks(source.checks, required);
    normalized.codeRevision = sha(source.codeRevision, 'validation codeRevision');
    normalized.reportPath = reportPath(source.reportPath);
  } else if (type === 'applied') {
    if (source.reason !== undefined || source.checks !== undefined || source.codeRevision !== undefined)
      fail('Adoption events cannot include review/validation fields.');
    normalized.appliedRevision = sha(source.appliedRevision, 'appliedRevision');
    normalized.reportPath = reportPath(source.reportPath);
  } else {
    if (source.checks !== undefined || source.codeRevision !== undefined || source.reportPath !== undefined
      || source.appliedRevision !== undefined) fail('Review decision may not forge CI validation/adoption fields.');
    if (type !== 'approved' || source.reason !== undefined)
      normalized.reason = exactText(source.reason, 'review decision reason', 4000);
  }
  return normalized;
}
const transitions = new Set(['pending', 'validated', 'blocked']);
function replay(proposal, events) {
  const required = requiredChecks(proposal);
  let status = 'pending', validation = null, appliedRevision = null, lastAt = proposal.createdAt;
  const seen = new Set(), normalized = [];
  for (const raw of events) {
    const row = reviewEvent(raw, required);
    if (seen.has(row.eventId)) fail('Duplicate review event ID.');
    seen.add(row.eventId);
    if (row.at < lastAt) fail('Review event chronology must be nondecreasing.', 'PL-REVIEW-TRANSITION');
    lastAt = row.at;
    if (row.type === 'validated') {
      if (!transitions.has(status)) fail('A terminal or approved review cannot be revalidated.', 'PL-REVIEW-TRANSITION');
      validation = row.checks;
      status = validation.every(check => check.outcome === 'passed') ? 'validated' : 'blocked';
    } else if (row.type === 'changes-requested') {
      if (!transitions.has(status)) fail('Changes cannot be requested after a final review decision.', 'PL-REVIEW-TRANSITION');
      status = 'needs-revision';
    } else if (row.type === 'approved') {
      if (status !== 'validated') fail('Approval requires a fully passing CI validation.', 'PL-REVIEW-TRANSITION');
      status = 'approved';
    } else if (row.type === 'rejected') {
      if (!transitions.has(status)) fail('Only a pending or checked proposal can be rejected.', 'PL-REVIEW-TRANSITION');
      status = 'rejected';
    } else {
      if (status !== 'approved') fail('Application must follow reviewer approval.', 'PL-REVIEW-TRANSITION');
      appliedRevision = row.appliedRevision;
      status = 'applied';
    }
    normalized.push(row);
  }
  return {events: normalized, status, validation, appliedRevision};
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Sidecar metadata only. Never mutates the Core project or any GIS data. */
export function normalizeReviewBundle(input) {
  shape(input, ['schemaVersion', 'proposal', 'events'], [], 'review bundle');
  if (input.schemaVersion !== REVIEW_BUNDLE_SCHEMA_VERSION) fail('Unsupported review bundle schemaVersion.');
  const proposed = proposal(input.proposal);
  if (!Array.isArray(input.events) || input.events.length > 2000)
    fail('Review events must be a bounded array.');
  const history = replay(proposed, input.events);
  return freeze({ schemaVersion: REVIEW_BUNDLE_SCHEMA_VERSION, proposal: proposed, events: history.events });
}

export function createReviewBundle(input) {
  return normalizeReviewBundle({schemaVersion: REVIEW_BUNDLE_SCHEMA_VERSION, proposal: input, events: []});
}

export function reviewState(input) {
  const bundle = normalizeReviewBundle(input);
  const history = replay(bundle.proposal, bundle.events);
  return freeze({ proposalId: bundle.proposal.proposalId, status: history.status,
    lastEventId: history.events.at(-1)?.eventId ?? null,
    validation: history.validation, appliedRevision: history.appliedRevision });
}

/** Append only; immutable proposal, ordered event log and prior records retained. */
export function appendReviewEvent(input, event) {
  const bundle = normalizeReviewBundle(input);
  return normalizeReviewBundle({schemaVersion: bundle.schemaVersion, proposal: bundle.proposal,
    events: [...bundle.events, event]});
}

export function serializeReviewBundle(input) {
  return JSON.stringify(normalizeReviewBundle(input), null, 2) + '\n';
}

/** Deterministic flat browse index; no world model, duplicated geometry or mutable Map. */
export function indexReviewHistory(values) {
  if (!Array.isArray(values) || values.length > 10000) fail('Review collection must be a bounded array.');
  const seen = new Set(), rows = [];
  for (const value of values) {
    const bundle = normalizeReviewBundle(value), proposal = bundle.proposal;
    if (seen.has(proposal.proposalId)) fail('Duplicate proposalId in review collection.');
    seen.add(proposal.proposalId);
    const snapshot = reviewState(bundle);
    for (const row of proposal.changes) rows.push({
      proposalId: proposal.proposalId, sourceEntityId: row.sourceEntityId, kind: row.kind, field: row.field,
      validFrom: row.validFrom, validTo: row.validTo, comparisonMonth: proposal.comparisonMonth,
      status: snapshot.status, createdAt: proposal.createdAt,
      baseRevision: proposal.dataset.baseRevision, candidateRevision: proposal.dataset.candidateRevision,
      appliedRevision: snapshot.appliedRevision, evidenceIds: row.evidenceIds,
    });
  }
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  rows.sort((a,b)=>cmp(a.sourceEntityId,b.sourceEntityId)||cmp(a.createdAt,b.createdAt)
    ||cmp(a.proposalId,b.proposalId)||cmp(a.kind,b.kind)||cmp(a.field,b.field)
    ||cmp(a.validFrom??'',b.validFrom??'')||cmp(a.validTo??'',b.validTo??''));
  return freeze(rows);
}
