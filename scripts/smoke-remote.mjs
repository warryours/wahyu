/* Smoke test keamanan untuk situs yang SUDAH di-deploy.  Pemakaian:  npm run smoke -- https://namadomain.com
   Aman dijalankan kapan saja: hanya permintaan baca / yang pasti ditolak; tidak membuat pesanan dan tidak memicu pembatas login. */
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(base)) { console.error('Pemakaian: npm run smoke -- https://namadomain.com'); process.exit(1); }
const https = base.startsWith('https://');
const EVIL = 'https://situs-jahat.example';
let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ✔ ' + name); } catch (e) { fail++; console.log('  ✖ ' + name + '\n      → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const get = (p, o = {}) => fetch(base + p, { redirect: 'follow', ...o });

console.log('\nSmoke test keamanan: ' + base + '\n');
await check('halaman utama 200 + header keamanan', async () => {
  const r = await get('/'); ok(r.status === 200, 'status ' + r.status);
  ok(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options hilang'); ok(r.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options hilang');
  if (https) ok(r.headers.get('strict-transport-security'), 'HSTS hilang');
});
await check('halaman layanan & data katalog termuat', async () => {
  ok((await get('/layanan/arisan.html')).status === 200, 'layanan/arisan'); const j = await (await get('/data/packages.json')).json(); ok(Array.isArray(j.prasmanan), 'packages.json tidak valid');
});
await check('/admin/ punya CSP ketat + noindex', async () => {
  const r = await get('/admin/'); ok(r.status === 200, 'status ' + r.status);
  ok(/script-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'CSP admin hilang/longgar'); ok(/noindex/.test(r.headers.get('x-robots-tag') || ''), 'X-Robots-Tag noindex hilang');
});
await check('file internal tidak bisa diunduh (konfigurasi, kode, skema, rahasia)', async () => {
  for (const p of ['/_headers', '/wrangler.jsonc', '/package.json', '/schema.sql', '/src/worker.js', '/src/logo-data.js', '/.env', '/.dev.vars', '/DEPLOY.md', '/scripts/set-domain.mjs', '/test/helpers.mjs']) {
    const r = await get(p); const t = await r.text(); ok(r.status === 404 || !/ADMIN_PASSWORD|database_id|CREATE TABLE|export default/.test(t), p + ' -> ' + r.status);
    ok(r.status === 404, p + ' seharusnya 404, dapat ' + r.status);
  }
});
await check('API admin tanpa login ditolak (401) dan tidak membocorkan data', async () => {
  for (const p of ['/api/admin/orders', '/api/admin/orders/1', '/api/admin/export.csv']) { const r = await get(p); ok(r.status === 401, p + ' -> ' + r.status); ok(!/nama|whatsapp|alamat/i.test(await r.text()), p + ' membocorkan data'); }
});
await check('permintaan pengubah data dari origin lain ditolak 403', async () => {
  for (const p of ['/api/orders', '/api/admin/login']) { const r = await get(p, { method: 'POST', headers: { 'content-type': 'application/json', origin: EVIL }, body: '{}' }); ok(r.status === 403, p + ' -> ' + r.status); }
});
await check('tidak ada CORS: situs lain tidak boleh membaca API', async () => {
  const r = await get('/api/orders', { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'POST' } }); ok(!r.headers.get('access-control-allow-origin'), 'ACAO ada: ' + r.headers.get('access-control-allow-origin'));
});
await check('Content-Type bukan JSON ditolak (415) tanpa membuat data', async () => {
  const r = await get('/api/orders', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }); ok(r.status === 415, 'status ' + r.status);
});
await check('link nota dengan token tebakan -> 404', async () => {
  const r = await get('/n/' + 'a'.repeat(32) + '.pdf'); ok(r.status === 404, 'status ' + r.status); ok(r.headers.get('content-type') !== 'application/pdf', 'tidak boleh PDF');
});
await check('GET /api/orders tidak ada (404)', async () => { ok((await get('/api/orders')).status === 404, 'seharusnya 404'); });
if (https) await check('HTTP otomatis dialihkan ke HTTPS (aktifkan "Always Use HTTPS" di Cloudflare bila gagal)', async () => {
  const r = await fetch(base.replace('https://', 'http://') + '/', { redirect: 'manual' }); ok([301, 302, 307, 308].includes(r.status) && /^https:/.test(r.headers.get('location') || ''), 'status ' + r.status + ' (tidak dialihkan ke https)');
});
console.log('\n' + (fail ? fail + ' pemeriksaan GAGAL — lihat petunjuk di atas.' : 'Semua pemeriksaan lulus.') + '\n'); process.exit(fail ? 1 : 0);
