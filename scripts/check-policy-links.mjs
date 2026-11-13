import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_CHECKS = new Set(['README.md', 'maintenance.md']);
const DOMAIN_SOURCE = /^(?:src|scripts|tools|config|projects)\/.+/u;
const MARKDOWN_LINK = /!?\[[^\]\r\n]+\]\(([^)\r\n]+)\)/gu;
const CHECK_GROUP = /\x60check-group:([a-z][a-z0-9-]*)\x60/gu;
const CHECK_SCRIPT = /\x60check-script:([a-z][a-z0-9:-]*)\x60/gu;
const RULE_LANGUAGE = /(?:반드시|금지|정본|규칙|정책|소유권|\bmust\b|\bnever\b|\bshall\b|\binvariant\b|\bdo\s+not\b)/iu;
const SOURCE_PATH = /\x60((?:src|scripts|tools|config|projects|apps|shared)\/[\w./-]+\.(?:mjs|cjs|js|json|md|yml|yaml|cpp|h))\x60/gu;

function stripCodeFences(markdown) {
  return markdown.replace(/^(\x60{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\1[^\r\n]*$/gmu, '');
}

function relativeTargets(text) {
  const links = [];
  for (const match of stripCodeFences(text).matchAll(MARKDOWN_LINK)) {
    const raw = match[1].trim().replace(/^<|>$/gu, '').split(/\s+"/u)[0];
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/iu.test(raw) || /^[A-Za-z]:[\\/]/u.test(raw)) continue;
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

function markdownDocuments(root) {
  const results = [];
  const walk = directory => {
    if (!existsSync(resolve(root, directory))) return;
    for (const item of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = directory + '/' + item.name;
      if (item.isDirectory()) walk(path);
      else if (item.isFile() && path.endsWith('.md')) results.push(path);
    }
  };
  walk('docs');
  return [...results, ...['AGENTS.md', 'README.md', 'VERSIONING.md']
    .filter(path => existsSync(resolve(root, path)))].sort();
}

/** Canonical policy routes are strict; unlinked archival documents are audited without historical rewrites. */
export function checkPolicyLinks(root = resolve(fileURLToPath(new URL('..', import.meta.url))), { strictAll = false } = {}) {
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
      if (path.startsWith('docs/policies/') &&
        source.startsWith('docs/') && source.endsWith('.md') &&
        !source.startsWith('docs/policies/') && !scheduled.has(source)) {
        scheduled.add(source); checkFiles.push(source);
      }
      if (DOMAIN_SOURCE.test(source)) codeReferences++;
      if (path === index) listed.add(source);
    }
    if (!path.startsWith('docs/policies/')) continue;
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

  // Examine every repository documentation file, not only those reachable from
  // the central index. Historical examples can name removed binaries, tests or
  // local files; these are reported, not silently rewritten or treated as
  // violations of the present-day runtime contract.
  const allDocuments = markdownDocuments(root);
  const current = new Set(checkFiles);
  const unresolved = [], staleSourceMentions = [], unindexedRuleDocs = [];
  let auditedLinks = 0;
  for (const path of allDocuments) {
    if (current.has(path)) continue; // already checked strictly above
    const absolute = resolve(root, path);
    const markdown = readFileSync(absolute, 'utf8');
    for (const link of relativeTargets(markdown)) {
      auditedLinks++;
      if (link.invalid) { unresolved.push({ file: path, target: link.raw, reason: 'invalid-encoding' }); continue; }
      const target = resolve(dirname(absolute), link.url);
      if (!inside(root, target)) { unresolved.push({ file: path, target: link.raw, reason: 'outside-repository' }); continue; }
      if (!existsSync(target)) unresolved.push({ file: path, target: link.raw, reason: 'missing-file' });
    }
    const candidateText = stripCodeFences(markdown);
    if (RULE_LANGUAGE.test(candidateText) && !path.startsWith('docs/superpowers/'))
      unindexedRuleDocs.push(path);
    for (const [, mention] of candidateText.matchAll(SOURCE_PATH)) {
      if (!existsSync(resolve(root, mention)))
        staleSourceMentions.push({ file: path, path: mention });
    }
  }
  if (strictAll && (unresolved.length || staleSourceMentions.length)) {
    error('docs/', 'all-doc audit detected ' + unresolved.length + ' unresolved Markdown links and ' +
      staleSourceMentions.length + ' missing inline source paths (see audit diagnostics)');
  }
  return { ok: errors.length === 0, files: checkFiles.length, links,
    codeReferences, groupReferences, scriptReferences, errors,
    audit: { totalMarkdown: allDocuments.length, strictFiles: checkFiles.length,
      otherFiles: allDocuments.length - checkFiles.length, otherLinks: auditedLinks,
      unresolvedLinks: unresolved, staleSourceMentions, unindexedRuleDocs } };
}

const invokedAsScript = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const result = checkPolicyLinks(undefined, { strictAll: process.argv.includes('--strict-all') });
  if (!result.ok) {
    for (const failure of result.errors) process.stderr.write('policy-links: ' + failure + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('policy-links: OK ' + JSON.stringify({
      files: result.files, links: result.links, codeReferences: result.codeReferences,
      groupReferences: result.groupReferences, scriptReferences: result.scriptReferences,
      auditedMarkdown: result.audit.totalMarkdown,
      unindexedLinkWarnings: result.audit.unresolvedLinks.length,
      staleSourceMentions: result.audit.staleSourceMentions.length,
      unindexedRuleCandidates: result.audit.unindexedRuleDocs.length,
    }) + '\n');
    for (const finding of result.audit.unresolvedLinks.slice(0, 12))
      process.stdout.write('policy-audit: unindexed document link review ' + JSON.stringify(finding) + '\n');
    if (result.audit.unresolvedLinks.length > 12)
      process.stdout.write('policy-audit: additional historic link findings ' +
        (result.audit.unresolvedLinks.length - 12) + '\n');
  }
}
