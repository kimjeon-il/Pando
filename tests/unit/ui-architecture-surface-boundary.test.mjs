import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../../scripts/check-ui-architecture.mjs', import.meta.url));

function auditSurface(t, surface) {
  const root = mkdtempSync(join(tmpdir(), 'pando-ui-surface-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (relativePath, source) => {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  put('apps/editor/editor.html', `
    <button id="createMenuBtn" aria-haspopup="menu"></button>
    <section id="createMenu" class="workspace-surface surface-create ui-sheet" role="menu"></section>
    ${surface}
  `);
  put('docs/architecture/ui-architecture.md', '# Surface contract fixture\n');
  put('assets/css/components/surface.css', `
    .workspace-surface, .surface-header, .surface-tabs, .surface-body, .surface-content {}
  `);
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8', timeout: 5000 });
}

function editorSurface(body) {
  return `<aside id="editorSurface" class="workspace-surface surface-editor ui-sheet">
    <header class="surface-header"><button class="ui-button sheet-drag-handle"></button></header>
    <nav class="surface-tabs">
      <button class="ui-button ui-tab" data-surface-tab="properties"></button>
      <button class="ui-button ui-tab" data-surface-tab="tools"></button>
    </nav>
    <div class="surface-body">${body}</div>
  </aside>`;
}

test('UI architecture accepts surface content beyond the old fixed-length window', t => {
  const surface = editorSurface(`
    <aside data-note="nested > boundary"><p>${'editor detail '.repeat(1500)}</p></aside>
    <!-- A sample closing tag, </aside>, is not the surface boundary. -->
    <script type="application/json">{"sample":"</aside>"}</script>
    <div class="surface-content">The full editor content remains inside its surface.</div>
  `);
  const result = auditSurface(t, surface);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /UI architecture audit passed/);
});

test('UI architecture rejects content owned by a later sibling surface', t => {
  const surface = editorSurface('<aside><p>The editor has no content slot.</p></aside>')
    + '<section><div class="surface-content">Another surface owns this content.</div></section>';
  const result = auditSurface(t, surface);
  assert.equal(result.status, 1, result.stdout || result.error?.message);
  assert.match(result.stderr, /#editorSurface must contain surface-header → surface-tabs → surface-body → surface-content/);
});
