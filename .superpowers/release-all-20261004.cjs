const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const git = args => execFileSync('git', ['-c', 'core.safecrlf=false', ...args], { encoding: 'utf8' }).trim();
const ledgerPath = 'reports/places/candidate-reviews.json';
const summaryPath = 'reports/places/candidate-review-summary.json';
const ledgerBytes = fs.readFileSync(ledgerPath);
const ledger = JSON.parse(ledgerBytes);
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const ledgerSha = createHash('sha256').update(ledgerBytes).digest('hex');
if (ledgerSha !== summary.reviewLedgerSha256) throw new Error('Review ledger and generated summary do not match');
if (ledger.decisions.length !== summary.reviewCount) throw new Error('Review count mismatch');
if (new Set(ledger.decisions.map(row => row.geonameId)).size !== ledger.decisions.length) throw new Error('Duplicate review IDs');
const actions = {};
for (const row of ledger.decisions) actions[row.action] = (actions[row.action] || 0) + 1;
for (const [action, count] of Object.entries(summary.actions)) {
  if (actions[action] !== count) throw new Error('Review action count mismatch: ' + action);
}
const stashEntry = git(['stash', 'list', '--format=%gd|%H|%s']).split('\n')
  .find(entry => entry.endsWith(': release-20261004-already-committed-terrain'));
if (stashEntry) {
  const [ref, sha] = stashEntry.split('|');
  for (const path of ['assets/js/modules/terrain-dem-shaders.js', 'tests/browser/terrain-dem-shader.spec.mjs']) {
    if (git(['rev-parse', sha + ':' + path]) !== git(['rev-parse', 'HEAD:' + path])) {
      throw new Error('Saved terrain changes differ from committed main');
    }
  }
  if (git(['rev-parse', ref]) !== sha) throw new Error('Stash reference changed');
  git(['stash', 'drop', ref]);
}
process.stdout.write(JSON.stringify({reviewCount: summary.reviewCount, actions, ledgerSha, terrainAlreadyCommitted: true}) + '\n');
