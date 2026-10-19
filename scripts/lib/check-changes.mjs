import { execFileSync } from 'node:child_process';

/** One comparison for local, push and PR. Missing history is never a clean diff. */
export function collectChanges({ root = process.cwd(), event = process.env.GITHUB_EVENT_NAME || 'local',
  base = process.env.BASE_SHA || 'origin/main', head = process.env.HEAD_SHA || 'HEAD' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (!base || /^0+$/.test(base)) base = 'origin/main';
  const revision = (ref, label) => {
    try { return git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').trim(); }
    catch {
      if (event !== 'local' && /^[a-f0-9]{40}$/i.test(ref)) {
        try { git('fetch', '--no-tags', '--depth=1', 'origin', ref); return git('rev-parse', '--verify', ref + '^{commit}').trim(); }
        catch { /* The error below preserves the failed comparison, not a fallback diff. */ }
      }
      throw Error(`CHECK_HISTORY: unavailable ${label} ${ref}; fetch the comparison history first.`);
    }
  };
  const baseCommit = revision(base, 'base'), headCommit = revision(head, 'head');
  let from = baseCommit;
  if (event !== 'push') {
    try { from = git('merge-base', baseCommit, headCommit).trim(); }
    catch { throw Error('CHECK_HISTORY: comparison base has no available common ancestor'); }
  }
  const paths = output => output.split('\0').filter(Boolean).map(path => path.replaceAll('\\', '/'));
  const files = paths(git('diff', '--no-renames', '--name-only', '-z', from, headCommit));
  if (event === 'local') {
    files.push(...paths(git('diff', '--cached', '--no-renames', '--name-only', '-z', headCommit)),
      ...paths(git('diff', '--no-renames', '--name-only', '-z')),
      ...paths(git('ls-files', '--others', '--exclude-standard', '-z')));
  }
  return { event, base: from, requestedBase: base, head: headCommit, workingTree: event === 'local', files: [...new Set(files)].sort() };
}
