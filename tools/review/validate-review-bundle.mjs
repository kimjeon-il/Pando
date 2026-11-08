import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexReviewHistory, normalizeReviewBundle, reviewState } from "../../src/document/review-change-records.js";

/** Validate a supplied review sidecar without modifying GIS or reports. */
export function inspectReviewFile(filename) {
  if (typeof filename !== 'string' || !filename) throw new TypeError('A review JSON filename is required.');
  const file = resolve(filename);
  const metadata = statSync(file);
  if (!metadata.isFile() || metadata.size > 4 * 1024 * 1024)
    throw new Error('Review bundle must be a regular JSON file no larger than 4 MiB.');
  const bundle = normalizeReviewBundle(JSON.parse(readFileSync(file, 'utf8')));
  const state = reviewState(bundle);
  return Object.freeze({
    schemaVersion: bundle.schemaVersion,
    proposalId: bundle.proposal.proposalId,
    dataset: bundle.proposal.dataset.repository,
    baseRevision: bundle.proposal.dataset.baseRevision,
    candidateRevision: bundle.proposal.dataset.candidateRevision,
    subjects: Object.freeze([...new Set(indexReviewHistory([bundle]).map(row=>row.sourceEntityId))]),
    changeCount: bundle.proposal.changes.length,
    eventCount: bundle.events.length,
    status: state.status,
    appliedRevision: state.appliedRevision,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node tools/review/validate-review-bundle.mjs path/to/review.json');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(inspectReviewFile(process.argv[2]), null, 2)); }
    catch (error) {
      console.error((error?.code || 'PL-REVIEW-INPUT') + ': ' + error.message);
      process.exitCode = 1;
    }
  }
}
