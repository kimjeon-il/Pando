// Local-only CORS server for Git-external DEM tiles. Never used by deployment.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const rootArg = option('--root');
if (!rootArg || !args.includes('--root')) throw new Error('Usage: node tools/serve-terrain-dem.mjs --root <artifact parent> [--port 4174]');
const root = path.resolve(rootArg);
const port = Number(args.includes('--port') ? option('--port') : 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');

http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !/\.(json|webp)$/.test(file)) {
      response.writeHead(403); response.end(); return;
    }
    const stats = statSync(file);
    if (!stats.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': file.endsWith('.webp') ? 'image/webp' : 'application/json',
      'Content-Length': stats.size,
    });
    createReadStream(file).pipe(response);
  } catch (_) { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`DEM tiles: http://127.0.0.1:${port}/terrain/v0.13.0/manifest.json\n`);
});
