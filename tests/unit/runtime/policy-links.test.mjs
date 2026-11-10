import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkPolicyLinks } from '../../../scripts/check-policy-links.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-policy-links-'));
  const write = (path, value) => {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  };
  const tick = String.fromCharCode(96);
  write('docs/policies/README.md', '# Index\n[Places](places.md)\n[Maintenance](maintenance.md)\n');
  write('docs/policies/places.md', '# Places\n[Code](../../src/place.js)\n' +
    tick + 'check-group:places-runtime' + tick + ' ' + tick + 'check-script:check:places' + tick + '\n');
  write('docs/policies/maintenance.md', '# Rules\n');
  write('src/place.js', 'export const source = true;\n');
  write('AGENTS.md', '# Rules\n');
  write('README.md', '[Policy](docs/policies/README.md)\n');
  write('VERSIONING.md', '# Versions\n');
  write('package.json', JSON.stringify({ scripts: { 'check:places': 'node test.mjs' } }));
  write('scripts/contracts/application-checks.json', JSON.stringify({
    groups: [{ id: 'places-runtime', kind: 'command', argv: ['node', 'script.mjs'] }],
  }));
  return { root, write, tick };
}

test('checks the policy index and linked source/registered validation contracts', () => {
  const f = fixture();
  try {
    const result = checkPolicyLinks(f.root);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.groupReferences, 1);
    assert.equal(result.scriptReferences, 1);
    assert.ok(result.codeReferences >= 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects broken links, unknown check groups and scripts', () => {
  const f = fixture();
  try {
    f.write('docs/policies/places.md', '# Places\n[Missing](../../src/removed.js)\n' +
      f.tick + 'check-group:removed' + f.tick + ' ' +
      f.tick + 'check-script:check:removed' + f.tick + '\n');
    const result = checkPolicyLinks(f.root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(line => line.includes('missing link target')));
    assert.ok(result.errors.some(line => line.includes('unknown application-check group')));
    assert.ok(result.errors.some(line => line.includes('unknown npm script')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('checks one-hop canonical policy document links without rewriting history', () => {
  const f = fixture();
  try {
    f.write('docs/policies/places.md', '# Places\n[Code](../../src/place.js)\n' +
      '[Source contract](../original.md)\n' +
      f.tick + 'check-group:places-runtime' + f.tick + '\n');
    f.write('docs/original.md', '# Original\n[Missing legacy file](../src/removed.js)\n');
    const result = checkPolicyLinks(f.root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(line => line.includes('docs/original.md') &&
      line.includes('missing link target')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('surveys unlinked historical documents without accepting them as current rules', () => {
  const f = fixture();
  try {
    f.write('docs/archive.md', '# Old notes\nDo not reintroduce the retired editor.\n' +
      '[Old implementation](old-module.js)\n' +
      f.tick + 'apps/editor/old.js' + f.tick + '\n');
    const result = checkPolicyLinks(f.root);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(result.audit.totalMarkdown >= 4);
    assert.ok(result.audit.unresolvedLinks.some(x => x.file === 'docs/archive.md'));
    assert.ok(result.audit.staleSourceMentions.some(x => x.path === 'apps/editor/old.js'));
    assert.ok(result.audit.unindexedRuleDocs.includes('docs/archive.md'));
    const strict = checkPolicyLinks(f.root, { strictAll: true });
    assert.equal(strict.ok, false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
