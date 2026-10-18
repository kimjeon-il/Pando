import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (root, args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
export function sourceIdentity(root) {
  // Identify the complete Web, shared-core and WebView checkout.
  root = git(root, ['rev-parse', '--show-toplevel']).toString().trim();
  const head = git(root, ['rev-parse', 'HEAD']).toString().trim();
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString();
  const patch = git(root, ['diff', '--no-ext-diff', '--binary', 'HEAD']);
  const changedPaths = git(root, ['diff', '--name-only', '-z', 'HEAD']).toString().split('\0').filter(Boolean);
  const changed = changedPaths.map(path => ({ path, sha256: existsSync(resolve(root, path)) ? sha256(readFileSync(resolve(root, path))) : null }));
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
  const files = untracked.map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) }));
  return { sourceRoot: root, head, clean: status.length === 0, status, diffSha256: sha256(patch), changed, untracked: files,
    fingerprint: sha256(JSON.stringify({ head, patch: sha256(patch), changed, files })) };
}
