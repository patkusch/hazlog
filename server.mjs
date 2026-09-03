// `make demo`: a static server with no dependencies. Serves the UI, the
// committed out/*.json, the corpus (read-only, for the two-pane view) and the
// risk matrix. Binds to localhost only. Nothing here talks to the network.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const ALLOWED_DIRS = ['ui', 'out', 'corpus', 'shared'];

async function send(res, path) {
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '') return send(res, join(ROOT, 'ui', 'index.html'));
  const top = p.split('/')[1];
  if (!ALLOWED_DIRS.includes(top) || p.includes('..')) { res.writeHead(403); return res.end('forbidden'); }
  return send(res, join(ROOT, p));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`HAZLOG demo: http://127.0.0.1:${PORT}  (fixtures from out/, corpus read-only, no network)`);
});
