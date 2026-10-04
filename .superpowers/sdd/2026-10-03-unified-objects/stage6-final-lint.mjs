import { spawnSync } from 'node:child_process';
const files = [
  'assets/js/gis-io.js',
  'assets/js/modules/project-state.js',
  'assets/js/modules/project-serializer.js',
  ...['gis-coast-cancellation', 'gis-interchange', 'runtime', 'territorial-hierarchy', 'territorial-child-fill-comparison',
    'workflow-v17', 'territorial-common-commands', 'shell-file-save', 'russia-edit-preparation',
    'generic-feature-independent-geometry', 'hydro-metadata-edit', 'storage-protection'].map(name => `tests/browser/${name}.spec.mjs`),
  ...['gis-import-presentation', 'ui-entrypoint-cleanup', 'gis-current-target', 'territorial-gis-export',
    'generic-provenance', 'project-serializer', 'project-state'].map(name => `tests/unit/${name}.test.mjs`),
];
const result = spawnSync(process.execPath, ['node_modules/eslint/bin/eslint.js', ...files], { encoding: 'utf8' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
console.log(`Final changed-file ESLint: ${files.length} files; exit ${result.status}`);
process.exit(result.status ?? 1);
