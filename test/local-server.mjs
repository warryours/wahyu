/* Server lokal untuk tes browser: meniru Cloudflare (Static Assets + _headers + html_handling + run_worker_first) di depan Worker asli. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadWorker, makeEnv, ROOT } from './helpers.mjs';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function parseHeaders(txt) {
  const rules = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] }; rules.push(cur); }
    else { const i = line.indexOf(':'); cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
  return rules;
}

export async function startLocalServer({ noCsp = false, overrides = {} } = {}) {
  const worker = await loadWorker(); const env = makeEnv({ PUBLIC_URL: undefined });
  const rules = parseHeaders(fs.readFileSync(path.join(PUBLIC, '_headers'), 'utf8'));
  const exists = (f) => { try { return fs.statSync(f); } catch (e) { return null; } };

  function asset(pathname) { /* html_handling "auto-trailing-slash" */
    const rel = decodeURIComponent(pathname), file = path.join(PUBLIC, path.normalize(rel));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return { status: 403 };
    if (path.basename(file) === '_headers') return { status: 404 };
    const st = exists(file);
    if (rel.endsWith('/')) { const i = path.join(file, 'index.html'); return exists(i) ? { file: i } : { status: 404 }; }
    if (st && st.isFile()) {
      if (rel.endsWith('/index.html')) return { redirect: rel.slice(0, -'index.html'.length) };
      if (rel.endsWith('.html')) return { redirect: rel.slice(0, -5) };
      return { file };
    }
    if (exists(file + '.html')) return { file: file + '.html' };
    if (st && st.isDirectory() && exists(path.join(file, 'index.html'))) return { redirect: rel + '/' };
    return { status: 404 };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      const chunks = []; for await (const c of req) chunks.push(c);
      let out;
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/n/')) {
        const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        headers.set('CF-Connecting-IP', req.headers['x-test-ip'] || req.socket.remoteAddress || '?');
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
        out = await worker.fetch(new Request(url.href, { method: req.method, headers, body }), env);
        const h = {}; out.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
        const sc = out.headers.getSetCookie(); if (sc.length) h['set-cookie'] = sc;
        res.writeHead(out.status, h); return res.end(Buffer.from(await out.arrayBuffer()));
      }
      const a = asset(url.pathname);
      if (a.redirect !== undefined) { res.writeHead(307, { Location: a.redirect + url.search }); return res.end(); }
      if (!a.file) { res.writeHead(a.status || 404, { 'Content-Type': 'text/plain' }); return res.end('Tidak ditemukan'); }
      const h = { 'Content-Type': MIME[path.extname(a.file)] || 'application/octet-stream' };
      for (const r of rules) if (r.re.test(url.pathname)) for (const [k, v] of r.headers) { if (noCsp && /content-security-policy/i.test(k)) continue; h[k] = v; }
      let data = fs.readFileSync(a.file);
      const ov = overrides[url.pathname]; if (ov) data = Buffer.from(ov(data.toString('utf8')));
      res.writeHead(200, h); res.end(data);
    } catch (e) { console.error(e); res.writeHead(500); res.end('error'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, base: 'http://127.0.0.1:' + port, env, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
