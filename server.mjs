// 零依赖转发服务：静态托管 web/，并把同源 /functions/v1/app 代理到与站点版同一份 handler。
// 用途：本地开发、自建转发（GitHub Pages 等静态托管没有服务端时指向这里）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handler } from './functions/handler.ts';

const WEB = resolve(fileURLToPath(new URL('./web', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

async function toWebRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else headers.set(k, v);
  }
  const method = req.method || 'GET';
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
  return new Request('http://' + (req.headers.host || '127.0.0.1:' + PORT) + req.url, init);
}

async function pipeResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) { res.end(); return; }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    if ((req.url || '').startsWith('/functions/v1/app')) {
      await pipeResponse(res, await handler(await toWebRequest(req)));
      return;
    }
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = normalize(path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
    if (rel.startsWith('..' + sep) || rel.includes('\0')) { res.writeHead(400); res.end('bad path'); return; }
    const file = join(WEB, rel);
    if (!file.startsWith(WEB + sep) && file !== WEB) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + ((err && err.message) || err));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('dev preview → http://127.0.0.1:' + PORT + '/'));
