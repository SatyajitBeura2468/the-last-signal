import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

function makeResponse(res) {
  return {
    status(code) { res.statusCode = code; return this; },
    setHeader(name, value) { res.setHeader(name, value); return this; },
    json(value) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.split('/').filter(Boolean)[1];
      if (!['signals', 'decode', 'session'].includes(name)) { res.statusCode = 404; return res.end('Not found'); }
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      let body = {};
      if (req.method !== 'GET') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      }
      req.body = body;
      req.query = Object.fromEntries(url.searchParams.entries());
      return mod.default(req, makeResponse(res));
    }
    let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    pathname = normalize(pathname).replace(/^([.][.][/\\])+/, '');
    const filePath = join(root, pathname);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    res.setHeader('Content-Type', mime[extname(filePath)] || 'application/octet-stream');
    res.end(await readFile(filePath));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`The Last Signal listening at http://127.0.0.1:${port}`));
