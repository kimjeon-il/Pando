// Owned, ephemeral test workspace. Never uses the Pando/library working tree.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export function isolatedTestWorkspace(t, prefix = 'pando-check-') {
  if (typeof t?.after !== 'function') throw new TypeError('Node test context required');
  if (typeof prefix !== 'string' || !/^pando-[a-z0-9-]+-$/.test(prefix))
    throw new TypeError('Invalid isolated test workspace prefix');
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}
