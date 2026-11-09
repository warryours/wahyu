/* Tes konfigurasi & kebersihan paket: salah setting di sini bisa membuka celah, jadi diperiksa otomatis. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? (e.name !== 'node_modules' && e.name !== '.wrangler' && walk(p, out)) : out.push(p); } return out; };
const cfg = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));

describe('wrangler.jsonc', () => {
  test('API dan nota selalu lewat Worker (tidak pernah dilayani sebagai file statis)', () => {
    assert.ok(cfg.assets.run_worker_first.includes('/api/*') && cfg.assets.run_worker_first.includes('/n/*'));
    assert.equal(cfg.assets.directory, './public'); assert.equal(cfg.assets.binding, 'ASSETS');
  });
  test('binding D1 bernama DB; tidak ada secret di vars', () => {
    assert.equal(cfg.d1_databases[0].binding, 'DB');
    assert.deepEqual(Object.keys(cfg.vars), ['PUBLIC_URL']);
    assert.doesNotMatch(read('wrangler.jsonc'), /ADMIN_PASSWORD\s*"?\s*:|SESSION_SECRET\s*"?\s*:/);
  });
  test('routes memakai custom_domain dan PUBLIC_URL sejalan dengan domain (setelah set-domain)', () => {
    assert.ok(cfg.routes.every((r) => r.custom_domain === true && !/^https?:|\//.test(r.pattern)), 'pattern harus nama host saja');
    assert.ok(cfg.routes.some((r) => cfg.vars.PUBLIC_URL === 'https://' + r.pattern));
  });
});

describe('Header keamanan file statis (_headers)', () => {
  const h = read('public/_headers'); const admin = h.split(/^\/admin\/\*\s*$/m)[1] || '';
  test('header dasar untuk semua halaman', () => { for (const x of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy:', 'Strict-Transport-Security:']) assert.ok(h.includes(x), x); });
  test('CSP admin ketat: script hanya dari situs sendiri, tanpa unsafe-inline/eval pada script', () => {
    const csp = admin.match(/Content-Security-Policy:\s*(.+)/)[1]; const scriptSrc = csp.match(/script-src ([^;]+)/)[1];
    assert.equal(scriptSrc.trim(), "'self'"); assert.match(csp, /object-src 'none'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /base-uri 'none'/); assert.match(csp, /connect-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-eval|\*|https?:/);
  });
  test('halaman admin tidak diindeks mesin pencari', () => { assert.match(admin, /X-Robots-Tag: noindex/); });
  test('halaman admin tidak memakai script/style inline (agar CSP ketat bisa dipakai)', () => {
    for (const f of ['public/admin/index.html', 'public/admin/nota.html']) { const t = read(f); assert.doesNotMatch(t, /<script(?![^>]*\ssrc=)[^>]*>/i, f + ': script inline'); assert.doesNotMatch(t, /\son[a-z]+\s*=/i, f + ': event handler inline'); assert.doesNotMatch(t, /<script[^>]+src=["']https?:/i, f + ': script eksternal'); }
  });
});

describe('Kebersihan paket (tidak ada rahasia / file berbahaya ikut ter-deploy)', () => {
  test('folder public/ tidak berisi file sensitif', () => {
    const bad = walk(path.join(ROOT, 'public')).filter((f) => /\.(db|sqlite3?|sql|env|map|bak|log|pem|key)$|(^|\/)\.(git|env)|dev\.vars|wrangler|package(-lock)?\.json|\.mjs$/i.test(f));
    assert.deepEqual(bad.map((f) => path.relative(ROOT, f)), []);
  });
  test('tidak ada .env, .dev.vars, atau database lokal di dalam paket', () => {
    const bad = walk(ROOT).filter((f) => /(^|\/)(\.env|\.dev\.vars|[^/]+\.db)$/.test(f)); assert.deepEqual(bad.map((f) => path.relative(ROOT, f)), []);
  });
  test('.gitignore melindungi file rahasia', () => { const g = read('.gitignore'); for (const x of ['.dev.vars', '.env', 'node_modules', '.wrangler']) assert.ok(g.includes(x), x); });
  test('tidak ada nilai password/secret/token tertulis di kode atau konfigurasi', () => {
    const files = walk(ROOT).filter((f) => /\.(js|mjs|json|jsonc|html|md|sql)$/.test(f) && !f.includes('/test/') && !/logo-data|DEPLOY|README/.test(f));
    for (const f of files) { const t = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(t, /(ADMIN_PASSWORD|SESSION_SECRET)\s*[=:]\s*['"][^'"\s]{6,}['"]/, f);
      assert.doesNotMatch(t, /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|CLOUDFLARE_API_TOKEN\s*=\s*\S{10,}/, f); }
  });
  test('.dev.vars.example hanya berisi nilai contoh', () => { assert.match(read('.dev.vars.example'), /ganti-dengan/); });
});

describe('Kode', () => {
  test('Worker tidak membuka CORS dan tidak memakai eval/Function', () => {
    const w = read('src/worker.js'); assert.doesNotMatch(w, /Access-Control-Allow/i); assert.doesNotMatch(w, /\beval\s*\(|new Function\s*\(/);
  });
  test('Worker memakai query berparameter: tidak ada nilai pengguna yang digabung ke SQL', () => {
    const w = read('src/worker.js');
    const sqlStrings = [...w.matchAll(/prepare\(([^)]*)\)/g)].map((m) => m[1]);
    for (const s of sqlStrings) assert.doesNotMatch(s, /\$\{|\+\s*(nama|b\.|url\.|input|term|status|q\b)/, 'SQL dengan interpolasi: ' + s);
  });
  test('JavaScript situs publik & admin: tanpa eval/document.write; sink innerHTML hanya berisi data lewat esc()', () => {
    for (const f of ['public/script.js', 'public/admin/admin.js', 'public/admin/nota.js']) { const t = read(f); assert.doesNotMatch(t, /\beval\s*\(|new Function\s*\(|document\.write\s*\(|location\.hash/, f + ' memakai API berisiko'); }
    for (const f of ['public/script.js', 'public/admin/admin.js']) assert.doesNotMatch(read(f), /location\.search/, f);
    /* nota.js membaca ?id=&type= dari URL: aman hanya jika id dipaksa angka dan type dibatasi daftar putih */
    const n = read('public/admin/nota.js'); assert.match(n, /id = parseInt\(params\.get\('id'\), 10\)/); assert.match(n, /type = params\.get\('type'\) === 'lunas' \? 'lunas' : 'dp'/);
    assert.equal((n.match(/params\.get\(/g) || []).length, 2, 'tidak boleh ada parameter URL lain yang dibaca');
    for (const f of ['public/admin/admin.js', 'public/admin/nota.js']) assert.match(read(f), /function esc\(s\)/, f + ' harus punya esc()');
  });
  test('schema.sql punya tabel & indeks yang dipakai Worker', () => {
    const s = read('schema.sql'); for (const t of ['orders', 'notas', 'rate_hits']) assert.match(s, new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b'));
    assert.match(s, /idx_rate_k/); assert.match(s, /UNIQUE/);
  });
  test('data pembayaran di PDF dan di halaman nota admin sama (tidak ada rekening ganda yang berbeda)', () => {
    const a = read('src/pdf-nota.js'), b = read('public/admin/nota.js');
    for (const v of [a.match(/rekening: '(\d+)'/)[1], a.match(/atasNama: '([^']+)'/)[1], a.match(/WA_BUKTI = '(\d+)'/)[1]]) assert.ok(b.includes(v), 'tidak sinkron: ' + v);
  });
});
