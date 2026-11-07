import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

// Source entrypoints, not generated runtime assets or arbitrary data files.
// A path must end in an executable-source extension (never .json, .js.map, etc.).
const ENTRYPOINT = /(?:\.\/)?(?:apps|scripts|tools|tests|shared|contracts|\.github)\/[\w.*\/-]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|ps1)(?![\w.])/g;
const DIRECT_ASSET_EXEC = /(?:^|[;&|\n])\s*(?:node|python3?|bash|sh|pwsh)\s+(?:--[\w=-]+\s+)*((?:\.\/)?assets\/[\w./-]+\.(?:mjs|cjs|js|py|sh|ps1))(?![\w.])/g;
const RETIRED_PRODUCT = /(?:^|[^a-zA-Z0-9_])apps\/(?:editor|android|windows)\//g;
const MATRIX = /\x24\{\{\s*matrix\.([a-zA-Z_]\w*)\s*\}\}/g;
const COPY = /\bcp\s+((?:\.\/)?(?:apps|scripts|tools|tests|shared|contracts)\/[\w./-]+)\s+((?:\.\/)?(?:apps|scripts|tools|tests|shared|contracts)\/[\w./-]+)/g;
const SOURCE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|ps1)$/;

const pathInRoot = (root, path) => {
  const target = resolve(root, path);
  const diff = relative(root, target);
  return diff !== '..' && !diff.startsWith('..' + sep) && !isAbsolute(diff);
};
const normalizeSource = file => file.replace(/^\.\//, '');
const issue = (file, location, reference, reason) => ({ file, location, reference, reason });

function sourceLines(run) {
  // Read shell commands and actual ESM imports inside heredocs, not arbitrary
  // JSON fixture strings or example paths inside inline JS diagnostics.
  const kept = [], lines = run.split(/\r?\n/);
  let heredoc = null;
  for (const line of lines) {
    const text = line.trim();
    if (heredoc) {
      if (text === heredoc) { heredoc = null; continue; }
      if (/\b(?:import\s*\(|import\s+.*?\bfrom\s*['"]|import\s*['"]|require\s*\()/.test(line))
        kept.push(line);
      continue;
    }
    if (text.startsWith('#')) continue;
    kept.push(line);
    const opening = line.match(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?/);
    if (opening) heredoc = opening[1];
  }
  return kept.join('\n');
}

function matrixVariants(command, job, errors, file, location) {
  // Only expand matrix expressions embedded in executable-source paths.
  // Other workflow expressions (titles, arguments, output labels) need not
  // have a statically enumerable matrix and must not block the path audit.
  const executableLines = command.split(/\r?\n/).filter(line =>
    /(?:apps|scripts|tools|tests|shared|contracts|\.github)\/[^\n]*\x24\{\{\s*matrix\./.test(line) &&
    /\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|ps1)\b/.test(line));
  const keys = [...new Set([...executableLines.join('\n').matchAll(MATRIX)].map(match => match[1]))];
  if (!keys.length) return [command];
  const matrix = job?.strategy?.matrix || {};
  const included = Array.isArray(matrix.include) ? matrix.include : [];
  let candidates = [{}];
  for (const key of keys) {
    const values = Array.isArray(matrix[key]) ? matrix[key] :
      included.map(item => item?.[key]).filter(value => value !== undefined);
    if (!values.length || values.some(value => !['string', 'number'].includes(typeof value))) {
      errors.push(issue(file, location, 'matrix.' + key, 'Cannot resolve executable path matrix value'));
      return [];
    }
    candidates = candidates.flatMap(entry => [...new Set(values)].map(value => ({ ...entry, [key]: value })));
    if (candidates.length > 100) {
      errors.push(issue(file, location, 'matrix.' + key, 'Too many executable-path variants'));
      return [];
    }
  }
  return candidates.map(values => command.replace(MATRIX, (original, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : original));
}

function executableReferences(command) {
  const refs = new Set();
  for (const match of command.matchAll(ENTRYPOINT)) refs.add(normalizeSource(match[0]));
  for (const match of command.matchAll(DIRECT_ASSET_EXEC)) refs.add(normalizeSource(match[1]));
  return [...refs];
}

function generatedCopies(command, root) {
  const created = new Set();
  for (const match of command.matchAll(COPY)) {
    const source = normalizeSource(match[1]), destination = normalizeSource(match[2]);
    if (pathInRoot(root, source) && existsSync(resolve(root, source)))
      created.add(destination);
  }
  return created;
}

function checkCommand({ root, file, location, command, job, cwd, errors }) {
  if (typeof command !== 'string') return;
  for (const variant of matrixVariants(command, job, errors, file, location)) {
    const source = sourceLines(variant), generated = generatedCopies(source, root);
    for (const ref of executableReferences(source)) {
      if (!SOURCE_EXT.test(ref) || ref.includes('**')) continue;
      const projectPath = relative(root, resolve(root, cwd || '.', ref)).replaceAll('\\', '/');
      if (!pathInRoot(root, projectPath)) {
        errors.push(issue(file, location, ref, 'Executable path escapes repository'));
        continue;
      }
      if (generated.has(ref)) continue;
      if (ref.includes('*')) {
        if (!globSync(projectPath, { cwd: root }).length)
          errors.push(issue(file, location, ref, 'Executable glob has no existing matches'));
      } else if (!existsSync(resolve(root, projectPath))) {
        errors.push(issue(file, location, ref, 'Missing executable source'));
      }
    }
  }
}

function checkLocalUses({ root, file, location, uses, errors }) {
  if (typeof uses !== 'string' || !uses.startsWith('./')) return;
  const path = uses.slice(2);
  if (!pathInRoot(root, path)) {
    errors.push(issue(file, location, path, 'Local action escapes repository'));
    return;
  }
  const action = resolve(root, path);
  if (existsSync(action) && statSync(action).isDirectory()) {
    if (!['action.yml', 'action.yaml', 'Dockerfile'].some(name => existsSync(resolve(action, name))))
      errors.push(issue(file, location, path, 'Local action directory has no manifest'));
  } else if (!existsSync(action)) {
    errors.push(issue(file, location, path, 'Missing local reusable workflow or action'));
  }
}

function inspectDocument({ root, file, parsed, errors, workflow = false }) {
  if (workflow) {
    for (const [jobName, job] of Object.entries(parsed?.jobs || {})) {
      checkLocalUses({ root, file, location: 'job:' + jobName, uses: job?.uses, errors });
      const baseDir = job?.defaults?.run?.['working-directory'] || '.';
      for (const [index, step] of (job?.steps || []).entries()) {
        const location = 'job:' + jobName + '/step:' + (step.name || index + 1);
        checkLocalUses({ root, file, location, uses: step.uses, errors });
        checkCommand({ root, file, location, command: step.run, job,
          cwd: step?.['working-directory'] || baseDir, errors });
      }
    }
  } else if (parsed?.runs?.using === 'composite') {
    for (const [index, step] of (parsed.runs.steps || []).entries()) {
      const location = 'action-step:' + (step.name || index + 1);
      checkLocalUses({ root, file, location, uses: step.uses, errors });
      checkCommand({ root, file, location, command: step.run,
        cwd: step?.['working-directory'] || '.', errors });
    }
  } else if (typeof parsed?.runs?.main === 'string') {
    const path = resolve(root, dirname(file), parsed.runs.main);
    if (!pathInRoot(root, path) || !existsSync(resolve(root, path)))
      errors.push(issue(file, 'action-entrypoint', parsed.runs.main, 'Missing local action entrypoint'));
  }
}

export function auditWorkflowReferences(root = process.cwd()) {
  root = resolve(root);
  const errors = [];
  const directories = [
    ['.github/workflows', true],
    ['.github/actions', false],
  ];
  for (const [directory, workflow] of directories) {
    if (!existsSync(resolve(root, directory))) continue;
    const paths = workflow ?
      readdirSync(resolve(root, directory)).filter(name => /\.ya?ml$/.test(name)).map(name => directory + '/' + name) :
      readdirSync(resolve(root, directory), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => ['action.yml', 'action.yaml']
          .map(name => directory + '/' + entry.name + '/' + name)
          .filter(path => existsSync(resolve(root, path))));
    for (const file of paths.sort()) {
      const source = readFileSync(resolve(root, file), 'utf8');
      for (const match of source.matchAll(RETIRED_PRODUCT))
        errors.push(issue(file, 'workflow-source', match[0].trim(), 'Retired product path in active automation'));
      try {
        inspectDocument({ root, file, parsed: parse(source), workflow, errors });
      } catch (error) {
        errors.push(issue(file, 'YAML', file, 'Invalid automation definition: ' + error.message));
      }
    }
  }
  return [...new Map(errors.map(row => [JSON.stringify(row), row])).values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = auditWorkflowReferences();
  if (errors.length) {
    for (const row of errors) console.error(row.file + ' [' + row.location + '] ' +
      row.reason + ': ' + row.reference);
    process.exitCode = 1;
  } else console.log('Workflow and local action executable references are present');
}
