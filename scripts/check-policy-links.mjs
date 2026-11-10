import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORY = new Set(['p0-overview.md', 'p1-reconciliation.md', 'p2-maintenance.md']);
const SKIP_CHECKS = new Set(['README.md', 'maintenance.md']);
const DOMAIN_SOURCE = /^(?:src|scripts|tools|config|contracts|projects)\/.+/u;
const MARKDOWN_LINK = /!?\[[^\]\r\n]+\]\(([^)\r\n]+)\)/gu;
const CHECK_GROUP = /\x60check-group:([a-z][a-z0-9-]*)\x60/gu;
const CHECK_SCRIPT = /\x60check-script:([a-z][a-z0-9:-]*)\x60/gu;

function stripCodeFences(markdown) {
  return markdown.replace(/^(\x60{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\1[^\r\n]*$/gmu, '');
}

function relativeTargets(text) {
  const links = [];
  for (const match of stripCodeFences(text).matchAll(MARKDOWN_LINK)) {
    const raw = match[1].trim().replace(/^<|>$/gu, '').split(/\s+"/u)[0];
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/iu.test(raw)) continue;
    let url;
    try { url = decodeURIComponent(raw.split(/[?#]/u)[0]); }
    catch { links.push({ raw, invalid: true }); continue; }
    if (url) links.push({ raw, url });
  }
  return links;
}

function inside(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

/** Policy navigation and one-hop linked source-doc paths, not a second rule engine. */
export function checkPolicyLinks(root = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  root = resolve(root);
  const errors = [];
  const error = (file, message) => errors.push(file + ': ' + message);
  const policyDir = join(root, 'docs/policies');
  if (!existsSync(policyDir)) return { ok: false, errors: ['docs/policies: missing directory'] };
  const pages = readdirSync(policyDir).filter(name => name.endsWith('.md')).sort();
  const index = 'docs/policies/README.md';
  if (!pages.includes('README.md')) error(index, 'missing central index');
  const catalog = JSON.parse(readFileSync(join(root, 'scripts/contracts/application-checks.json'), 'utf8'));
  const groupIds = new Set((catalog.groups || []).map(group => group.id));
  const npmScripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {};
  const checkFiles = [...pages.map(page => 'docs/policies/' + page), 'AGENTS.md', 'README.md', 'VERSIONING.md'];
  const scheduled = new Set(checkFiles);
  let links = 0, codeReferences = 0, groupReferences = 0, scriptReferences = 0;
  const listed = new Set();

  for (let cursor = 0; cursor < checkFiles.length; cursor++) {
    const path = checkFiles[cursor];
    const absolute = join(root, path);
    if (!existsSync(absolute)) { error(path, 'missing input document'); continue; }
    const markdown = readFileSync(absolute, 'utf8');
    const entries = relativeTargets(markdown);
    for (const link of entries) {
      if (link.invalid) { error(path, 'invalid percent encoding in link ' + link.raw); continue; }
      const target = resolve(dirname(absolute), link.url);
      if (!inside(root, target)) { error(path, 'link escapes repository: ' + link.raw); continue; }
      if (!existsSync(target)) { error(path, 'missing link target: ' + link.raw); continue; }
      links++;
      const source = relative(root, target).split(sep).join('/');
      if (path.startsWith('docs/policies/') && !HISTORY.has(path.split('/').at(-1)) &&
        source.startsWith('docs/') && source.endsWith('.md') &&
        !source.startsWith('docs/policies/') && !scheduled.has(source)) {
        scheduled.add(source); checkFiles.push(source);
      }
      if (DOMAIN_SOURCE.test(source)) codeReferences++;
      if (path === index) listed.add(source);
    }
    if (!path.startsWith('docs/policies/') || HISTORY.has(path.split('/').at(-1))) continue;
    const name = path.split('/').at(-1);
    if (!SKIP_CHECKS.has(name)) {
      const referencedCode = entries.filter(link => !link.invalid).some(link => {
        const target = resolve(dirname(absolute), link.url);
        return inside(root, target) && DOMAIN_SOURCE.test(relative(root, target).split(sep).join('/'));
      });
      if (!referencedCode) error(path, 'domain page needs a direct code or machine-contract link');
    }
    let groups = 0;
    for (const [, id] of markdown.matchAll(CHECK_GROUP)) {
      groupReferences++; groups++;
      if (!groupIds.has(id)) error(path, 'unknown application-check group: ' + id);
    }
    if (!SKIP_CHECKS.has(name) && groups === 0) error(path, 'no declared check-group contract');
    for (const [, name] of markdown.matchAll(CHECK_SCRIPT)) {
      scriptReferences++;
      if (!Object.hasOwn(npmScripts, name)) error(path, 'unknown npm script: ' + name);
    }
  }

  for (const page of pages) if (page !== 'README.md' && !listed.has('docs/policies/' + page))
    error(index, 'unlisted policy file: ' + page);
  if (!listed.has('docs/policies/maintenance.md')) error(index, 'missing maintenance navigation');
  return { ok: errors.length === 0, files: checkFiles.length, links,
    codeReferences, groupReferences, scriptReferences, errors };
}

const invokedAsScript = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const result = checkPolicyLinks();
  if (!result.ok) {
    for (const failure of result.errors) process.stderr.write('policy-links: ' + failure + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('policy-links: OK ' + JSON.stringify({
      files: result.files, links: result.links, codeReferences: result.codeReferences,
      groupReferences: result.groupReferences, scriptReferences: result.scriptReferences,
    }) + '\n');
  }
}
