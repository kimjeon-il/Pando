const { execFileSync } = require('node:child_process');
const git = args => execFileSync('git', ['-c', 'core.safecrlf=false', ...args], { encoding: 'utf8' });
const excluded = new Set([
  'docs/place-candidate-review.md',
  'reports/places/candidate-review-summary.json',
  'reports/places/candidate-reviews.json',
]);
const names = output => output.split('\0').filter(Boolean);
const existingStaged = names(git(['diff', '--cached', '--name-only', '-z']));
if (existingStaged.length) throw new Error('Unexpected pre-existing staged files: ' + existingStaged.join(', '));
const tracked = names(git(['diff', '--name-only', '-z'])).filter(path => !excluded.has(path));
const untracked = names(git(['ls-files', '--others', '--exclude-standard', '-z'])).filter(path => path.startsWith('tests/'));
const files = [...tracked, ...untracked];
if (!files.length) throw new Error('No release-owned changes found');
git(['add', '--', ...files]);
const staged = names(git(['diff', '--cached', '--name-only', '-z']));
if (staged.some(path => excluded.has(path) || path.startsWith('.superpowers/'))) {
  throw new Error('Unrelated files staged');
}
process.stdout.write(JSON.stringify({ stagedFiles: staged.length, newTests: untracked.length, preserved: [...excluded] }) + '\n');
process.stdout.write(git(['diff', '--cached', '--shortstat']));
