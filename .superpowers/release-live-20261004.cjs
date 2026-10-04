const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const defaultPaths = [
  'index.html',
  'assets/js/build-meta.js',
  'assets/css/ui.bundle.css',
  'assets/js/modules/territorial-scope.js',
  'assets/js/modules/gis-import-transaction.js',
  'assets/js/workers/map-edit-worker.js',
];
const buildId = process.argv[2] || '0.34.0-build-9393298d1902';
const paths = process.argv.length > 3 ? process.argv.slice(3) : defaultPaths;
const hash = data => createHash('sha256').update(data).digest('hex');
async function main() {
  const results = await Promise.all(paths.map(async path => {
    const url = new URL(path, 'https://kimjeon-il.github.io/world-map/');
    url.searchParams.set('v', buildId);
    url.searchParams.set('release-check', String(Date.now()));
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
    const actual = Buffer.from(await response.arrayBuffer());
    const expected = execFileSync('git', ['show', 'HEAD:' + path], { maxBuffer: 64 * 1024 * 1024 });
    if (hash(actual) !== hash(expected)) throw new Error(path + ': served content differs from pushed commit');
    if ((path === 'index.html' || path === 'assets/js/build-meta.js') && !actual.toString('utf8').includes(buildId)) {
      throw new Error(path + ': expected build ID missing');
    }
    return { path, status: response.status, bytes: actual.length, matchesCommit: true };
  }));
  process.stdout.write(JSON.stringify({ buildId, assets: results }, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
