import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const port = 4173;
const mime = {
  '.bin': 'application/octet-stream', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    const stream = createReadStream(file);
    response.on('close', () => stream.destroy());
    response.on('error', () => stream.destroy());
    stream.on('error', () => {
      if (!response.headersSent) response.writeHead(500).end('Read error');
      else response.destroy();
    });
    stream.pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`PandoLab test server: http://127.0.0.1:${port}`));
