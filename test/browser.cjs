'use strict';
/* Tes browser (Chromium sungguhan): XSS di panel admin & nota, CSP, CSRF lintas situs, alur pelanggan, dan pemuatan halaman publik.
   Butuh: npm i -D playwright && npx playwright install chromium      Jalankan: npm run test:browser
   Mode kontrol negatif: WC_MUTATE=1 npm run test:browser  -> sengaja melemahkan esc() & CSP; tes HARUS mendeteksi XSS (membuktikan tes ini punya "gigi"). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright belum terpasang.\n  npm i -D playwright\n  npx playwright install chromium'); process.exit(1);
}
const MUTATE = process.env.WC_MUTATE === '1';
const ROOT = path.resolve(__dirname, '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/packages.json'), 'utf8'));
const results = [];
async function t(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✔ ' + name); }
  catch (e) { results.push({ name, ok: false, e }); console.log('  ✖ ' + name + '\n      ' + String(e.message).split('\n').slice(0, 3).join('\n      ')); }
}
const futureDate = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

(async () => {
  const { startLocalServer } = await import('./local-server.mjs');
  const mutateEsc = (s) => s.replace(/function esc\(s\) \{[^\n]*\}/, 'function esc(s) { return String(s == null ? "" : s) }');
  const srv = await startLocalServer(MUTATE ? { noCsp: true, overrides: { '/admin/admin.js': mutateEsc, '/admin/nota.js': mutateEsc } } : {});
  const evil = http.createServer((req, res) => {
    if (req.url === '/x.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.__ext=1'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>situs jahat</title><body>jahat</body>');
  });
  await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  const evilBase = 'http://127.0.0.1:' + evil.address().port;

  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const dialogs = []; const cspMsgs = [];
  ctx.on('page', (p) => { p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => { }); }); p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspMsgs.push(m.text()); }); });
  const db = srv.env.sqlite; const n = (tb) => db.prepare('select count(*) n from ' + tb).get().n;
  let ipn = 0; const api = (p, o = {}) => fetch(srv.base + p, { ...o, headers: { 'x-test-ip': '10.77.0.' + (++ipn), ...(o.headers || {}) } });
  const post = (p, json, extra = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(json) });

  /* ---------- data uji: pesanan dengan payload XSS di setiap kolom yang tampil di admin ---------- */
  const PAY = ['<img src=x onerror="window.__xss=1">', '"><svg/onload=window.__xss=2>', '</textarea></details><script>window.__xss=3</script>',
    '<details open ontoggle="window.__xss=4">x</details>', "'-window.__xss=5-'", '<a href="javascript:window.__xss=6">klik</a>', '{{constructor.constructor("window.__xss=7")()}}'];
  const menu = {}; CATALOG.menu.forEach((m) => { menu[m.key] = m.options; });
  const pkg = CATALOG.prasmanan[0]; let pilihan = {};
  for (const it of pkg.items) { const o = it.options || (it.menu && menu[it.menu]); if (o && o.length) { pilihan = { [it.name]: [o[0]] }; break; } }
  const adminCookie = (await post('/api/admin/login', { password: 'tes-password-kuat-123' })).headers.get('set-cookie');
  assert.ok(adminCookie, 'login admin lewat API gagal'); const ck = adminCookie.split(';')[0];
  for (const p of PAY) {
    const r = await post('/api/orders', { nama: p, whatsapp: '081234567890', alamat: p, acara: 'Syukuran', paket: pkg.id, jumlah: 100, tanggal: futureDate(20), catatan: p, pilihan });
    assert.equal(r.status, 201, 'seed pesanan gagal: ' + p);
  }
  for (let id = 1; id <= PAY.length; id++) {
    const r = await api('/api/admin/orders/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify({ catatan_admin: PAY[id - 1] }) });
    assert.equal(r.status, 200);
  }

  const page = await ctx.newPage();
  console.log(MUTATE ? '\n[MODE KONTROL NEGATIF] esc() & CSP sengaja dilemahkan; XSS HARUS terdeteksi\n' : '\nTes browser (Chromium) terhadap ' + srv.base + '\n');

  /* ========== 1. XSS di panel admin ========== */
  let xssDetected = false;
  await t('admin: payload XSS di nama/alamat/catatan/catatan_admin ditampilkan sebagai teks, tidak dieksekusi', async () => {
    await page.goto(srv.base + '/admin/');
    await page.waitForSelector('#login:not([hidden])');
    await page.fill('#pw', 'sandi-salah-sengaja'); await page.click('#login-form button[type=submit]');
    await page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0);
    assert.match(await page.textContent('#login-err'), /salah/i, 'login salah harus menampilkan pesan');
    await page.fill('#pw', 'tes-password-kuat-123'); await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#app:not([hidden])'); await page.waitForSelector('details.order');
    await page.$$eval('details.order', (els) => els.forEach((e) => { e.open = true; }));
    await page.waitForTimeout(600);
    const xss = await page.evaluate(() => window.__xss);
    const injected = await page.evaluate(() => document.querySelectorAll('#orders img, #orders svg, #orders script, #orders [onerror], #orders [onload], #orders [ontoggle], #orders a[href^="javascript:" i]').length);
    xssDetected = xss !== undefined || injected > 0 || dialogs.length > 0;
    if (MUTATE) return;
    assert.equal(xss, undefined, 'JavaScript payload dieksekusi: __xss=' + xss);
    assert.equal(injected, 0, 'elemen berbahaya muncul di DOM'); assert.deepEqual(dialogs, []);
    const txt = await page.textContent('#orders'); assert.ok(txt.includes('<img src=x onerror='), 'payload harus tampil sebagai teks biasa');
    const notes = await page.$$eval('textarea[data-f=note]', (els) => els.map((e) => e.value));
    assert.ok(notes.includes(PAY[2]), 'catatan admin (di dalam <textarea>) harus kembali persis sama, tidak keluar dari tag');
    assert.equal(await page.locator('details.order').count(), PAY.length);
    assert.deepEqual(cspMsgs, [], 'CSP tidak boleh memblokir fungsi admin yang sah: ' + cspMsgs.join(' | '));
  });
  if (MUTATE) {
    await browser.close(); evil.close(); await srv.close();
    if (xssDetected) { console.log('\nKONTROL NEGATIF BERHASIL: tes mendeteksi XSS pada versi yang sengaja dilemahkan, jadi tes normal bermakna.'); process.exit(0); }
    console.error('\nKONTROL NEGATIF GAGAL: XSS tidak terdeteksi walau esc() dimatikan. Tes browser tidak bisa dipercaya!'); process.exit(1);
  }

  await t('admin: pilihan menu (style inline) tetap tampil di bawah CSP', async () => {
    assert.ok((await page.locator('dd[style*="pre-line"]').count()) >= 1, 'elemen pilihan menu tidak muncul'); assert.deepEqual(cspMsgs, []);
  });

  /* ========== 2. CSP ========== */
  await t('CSP: header ada di halaman admin, nota, dan kode lain tidak diblokir', async () => {
    for (const p of ['/admin/', '/admin/nota.html?id=1&type=dp']) { const r = await ctx.request.get(srv.base + p, { maxRedirects: 5 }); const csp = r.headers()['content-security-policy'] || '';
      assert.match(csp, /script-src 'self'/, p); assert.equal(r.headers()['x-frame-options'], 'DENY', p); assert.match(r.headers()['x-robots-tag'] || '', /noindex/, p); }
  });
  await t('CSP: event handler inline & script dari situs lain DIBLOKIR browser (lapis pertahanan kedua)', async () => {
    await page.goto(srv.base + '/admin/'); await page.waitForSelector('#app:not([hidden])');
    const viol = await page.evaluate((evilBase) => new Promise((res) => {
      const seen = []; document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
      const d = document.createElement('div'); d.innerHTML = '<img src=x onerror="window.__csp=1">'; document.body.appendChild(d);
      const s = document.createElement('script'); s.src = evilBase + '/x.js'; document.body.appendChild(s);
      setTimeout(() => res(seen), 1200);
    }), evilBase);
    assert.ok(viol.some((v) => /^script-src/.test(v)), 'tidak ada pelanggaran CSP terdeteksi: ' + JSON.stringify(viol));
    assert.equal(await page.evaluate(() => window.__csp), undefined); assert.equal(await page.evaluate(() => window.__ext), undefined);
    assert.ok(viol.length >= 2, 'kedua injeksi harus diblokir: ' + JSON.stringify(viol));
  });
  await t('admin tidak bisa di-iframe (clickjacking)', async () => {
    const p = await ctx.newPage(); await p.goto(evilBase + '/');
    const blocked = await p.evaluate((u) => new Promise((res) => { const f = document.createElement('iframe'); f.src = u; f.onload = () => { try { res(f.contentDocument ? 'dimuat' : 'diblokir'); } catch (e) { res('diblokir'); } }; document.body.appendChild(f); setTimeout(() => res('diblokir'), 2500); }), srv.base + '/admin/');
    assert.equal(blocked, 'diblokir'); await p.close();
  });

  /* ========== 3. Halaman nota ========== */
  await t('nota: payload XSS di data pesanan & parameter URL tidak dieksekusi', async () => {
    const np = await ctx.newPage(); np.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => { }); });
    for (let id = 1; id <= PAY.length; id++) {
      await np.goto(srv.base + '/admin/nota.html?id=' + id + '&type=dp'); await np.waitForSelector('#nota:not([hidden])');
      assert.equal(await np.evaluate(() => window.__xss), undefined, 'XSS di nota #' + id);
      assert.equal(await np.evaluate(() => document.querySelectorAll('#nota img').length), 1, 'hanya logo yang boleh jadi <img> (#' + id + ')');
      assert.equal(await np.evaluate(() => document.querySelectorAll('#nota script, #nota svg, #nota [onerror], #nota [onload], #nota [ontoggle]').length), 0);
    }
    assert.ok((await np.textContent('#nota')).includes('window.__xss'), 'payload tampil sebagai teks');
    const q1 = encodeURIComponent('1<img src=x onerror=window.__xss=9>'), q2 = encodeURIComponent('"><script>window.__xss=10</script>');
    await np.goto(srv.base + '/admin/nota.html?id=' + q1 + '&type=' + q2); await np.waitForSelector('#nota:not([hidden])');
    assert.equal(await np.evaluate(() => window.__xss), undefined); assert.match(await np.textContent('#nota'), /INVOICE PEMBAYARAN DP/, 'type tak dikenal harus jatuh ke "dp"');
    await np.goto(srv.base + '/admin/nota.html?id=abc'); assert.match(await np.textContent('#msg'), /tidak valid/i);
    assert.deepEqual(dialogs, []); await np.close();
  });
  await t('admin → "Invoice DP" → pratinjau PDF: alur nyata menghasilkan PDF valid', async () => {
    await page.goto(srv.base + '/admin/'); await page.waitForSelector('details.order');
    const pdfs = []; ctx.on('response', (r) => { if (/\/n\/[\w-]+\.pdf$/.test(r.url())) pdfs.push(r); });
    await page.click('details.order >> nth=0 >> summary'); /* buka detail pesanan seperti pengguna sungguhan */
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('details.order[open] [data-nota=dp] >> nth=0')]);
    await popup.waitForSelector('#nota:not([hidden])', { timeout: 8000 });
    const [p2] = await Promise.all([ctx.waitForEvent('page'), popup.click('#preview')]).catch(() => [null]);
    await page.waitForTimeout(1500);
    const url = pdfs.length ? pdfs[0].url() : (p2 && p2.url());
    assert.match(url || '', /\/n\/[A-Za-z0-9_-]{32}\.pdf$/, 'URL nota PDF tidak terbentuk');
    const r = await ctx.request.get(url); assert.equal(r.status(), 200); assert.match(r.headers()['content-type'], /application\/pdf/);
    assert.equal((await r.body()).subarray(0, 5).toString(), '%PDF-');
    assert.equal(url.startsWith(srv.base + '/n/'), true, 'link nota harus memakai alamat situs ini');
  });

  /* ========== 4. CSRF lintas situs (penyerang di origin lain, korban sedang login admin) ========== */
  await t('CSRF: fetch JSON lintas origin diblokir (preflight tanpa izin CORS); data tidak berubah', async () => {
    const ev = await ctx.newPage(); await ev.goto(evilBase + '/');
    const before = { orders: n('orders'), notas: n('notas'), s1: db.prepare('select status from orders where id=1').get().status };
    const res = await ev.evaluate(async (base) => {
      const out = {};
      for (const [k, url, init] of [['patch', '/api/admin/orders/1', { method: 'PATCH', body: '{"status":"batal"}' }], ['delete', '/api/admin/orders/1', { method: 'DELETE' }],
        ['nota', '/api/admin/orders/1/nota', { method: 'POST', body: '{"type":"dp"}' }], ['order', '/api/orders', { method: 'POST', body: '{}' }]]) {
        try { await fetch(base + url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json' } }); out[k] = 'terkirim'; } catch (e) { out[k] = 'diblokir'; } }
      try { const r = await fetch(base + '/api/admin/orders', { credentials: 'include' }); out.read = 'terbaca ' + r.status; } catch (e) { out.read = 'diblokir'; }
      return out;
    }, srv.base);
    assert.deepEqual(res, { patch: 'diblokir', delete: 'diblokir', nota: 'diblokir', order: 'diblokir', read: 'diblokir' }, 'penyerang tidak boleh bisa mengirim/membaca: ' + JSON.stringify(res));
    assert.deepEqual({ orders: n('orders'), notas: n('notas'), s1: db.prepare('select status from orders where id=1').get().status }, before); await ev.close();
  });
  await t('CSRF: "simple request" (text/plain, no-cors) dan form-post lintas situs ditolak server; data tidak berubah', async () => {
    const ev = await ctx.newPage(); await ev.goto(evilBase + '/');
    const before = { orders: n('orders'), notas: n('notas'), dp: db.prepare('select dp from orders where id=1').get().dp };
    await ev.evaluate(async (base) => {
      await fetch(base + '/api/admin/orders/1/nota', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: '{"type":"dp"}' });
      await fetch(base + '/api/orders', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ nama: 'x' }) });
    }, srv.base);
    await ev.waitForTimeout(400);
    await ev.evaluate((base) => { const f = document.createElement('form'); f.method = 'POST'; f.action = base + '/api/admin/orders/1/nota'; f.enctype = 'text/plain';
      const i = document.createElement('input'); i.name = '{"type":"dp","x":"'; i.value = '"}'; f.appendChild(i); document.body.appendChild(f); f.submit(); }, srv.base);
    await ev.waitForURL(/\/api\/admin\/orders\/1\/nota/); const body = await ev.textContent('body');
    assert.match(body, /Asal permintaan tidak diizinkan/, 'server harus menolak berdasar Origin: ' + body.slice(0, 120));
    assert.deepEqual({ orders: n('orders'), notas: n('notas'), dp: db.prepare('select dp from orders where id=1').get().dp }, before); await ev.close();
  });

  /* ========== 5. Alur pelanggan sungguhan (form pesanan di website) ========== */
  await t('pelanggan: mengisi form pesanan di website → tersimpan di database (Origin sama diizinkan)', async () => {
    const cp = await (await browser.newContext()).newPage(); cp.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => { }); });
    await cp.goto(srv.base + '/'); await cp.waitForSelector('[data-order]'); const before = n('orders');
    await cp.click('[data-order] >> nth=0'); await cp.waitForSelector('#of-nama');
    await cp.fill('#of-nama', 'Pelanggan <b>Uji</b>'); await cp.fill('#of-wa', '0812 3456 7000'); await cp.fill('#of-alamat', 'Jl. Uji No. 1');
    await cp.selectOption('#of-acara', 'Syukuran'); await cp.selectOption('#of-paket', { index: 1 }); await cp.fill('#of-jumlah', '120'); await cp.fill('#of-tanggal', futureDate(25));
    await cp.click('form button[type=submit]'); await cp.waitForSelector('.pp', { timeout: 8000 });
    assert.match(await cp.textContent('.pp'), /^WC-\d{4}$/); assert.equal(n('orders'), before + 1);
    const row = db.prepare('select nama, jumlah, harga from orders order by id desc limit 1').get(); assert.equal(row.nama, 'Pelanggan <b>Uji</b>'); assert.equal(row.jumlah, 120);
    assert.equal(await cp.evaluate(() => document.querySelectorAll('.modal-box b').length), 0, 'HTML dari nama tidak boleh ter-render');
    assert.deepEqual(dialogs, []);
  });
  await t('pelanggan: validasi server (jumlah < 100) tampil sebagai pesan, bukan crash', async () => {
    const cp = await (await browser.newContext()).newPage(); const msgs = []; cp.on('dialog', (d) => { msgs.push(d.message()); d.dismiss().catch(() => { }); });
    await cp.goto(srv.base + '/'); await cp.waitForSelector('[data-order]'); await cp.click('[data-order] >> nth=0'); await cp.waitForSelector('#of-nama');
    await cp.fill('#of-nama', 'A'); await cp.fill('#of-wa', '081234567000'); await cp.fill('#of-alamat', 'B'); await cp.selectOption('#of-acara', 'Arisan'); await cp.selectOption('#of-paket', { index: 1 });
    await cp.fill('#of-jumlah', '100'); await cp.fill('#of-tanggal', futureDate(10));
    await cp.evaluate(() => { document.querySelector('#of-jumlah').removeAttribute('min'); document.querySelector('#of-jumlah').value = '5'; });
    await cp.click('form button[type=submit]'); await cp.waitForTimeout(800);
    assert.ok(msgs.some((m) => /minimal 100/i.test(m)), 'pesan galat dari server harus tampil: ' + JSON.stringify(msgs));
  });

  /* ========== 6. Halaman publik di bawah perilaku Cloudflare (html_handling, _headers) ========== */
  for (const [u, expectPath] of [['/', '/'], ['/layanan/arisan.html', '/layanan/arisan'], ['/layanan/pernikahan.html', '/layanan/pernikahan'], ['/layanan/syukuran.html', '/layanan/syukuran']]) {
    await t('halaman ' + u + ': termuat tanpa 404 lokal / error JS; paket & katalog termuat', async () => {
      const p = await (await browser.newContext()).newPage(); const bad = [], errs = [], ok = [];
      p.on('response', (r) => { const x = r.url(); if (!x.startsWith(srv.base)) return; if (r.status() >= 400 && !/favicon/.test(x)) bad.push(r.status() + ' ' + x.replace(srv.base, '')); else ok.push(x.replace(srv.base, '')); });
      p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss().catch(() => { }));
      await p.goto(srv.base + u, { waitUntil: 'load' });
      assert.equal(new URL(p.url()).pathname, expectPath, 'redirect html_handling');
      await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
      await p.waitForTimeout(1200);
      assert.deepEqual(bad, [], 'resource lokal gagal dimuat'); assert.deepEqual(errs, [], 'error JavaScript');
      assert.ok(ok.includes('/data/packages.json'), 'packages.json harus termuat dari ' + u);
      assert.equal(await p.locator('.price-note').filter({ hasText: /gagal dimuat/ }).count(), 0, 'ada pesan "gagal dimuat"');
      const broken = await p.evaluate((b) => [...document.images].filter((i) => i.src.startsWith(b) && i.complete && i.naturalWidth === 0).map((i) => i.src.replace(b, '')), srv.base);
      assert.deepEqual(broken, [], 'gambar rusak');
    });
  }
  await t('header file statis dari _headers terpasang di halaman publik', async () => {
    const r = await ctx.request.get(srv.base + '/', { maxRedirects: 5 }); const h = r.headers();
    assert.equal(h['x-content-type-options'], 'nosniff'); assert.equal(h['x-frame-options'], 'DENY'); assert.ok(h['strict-transport-security']);
    assert.match((await ctx.request.get(srv.base + '/assets/logo.png')).headers()['cache-control'] || '', /max-age=86400/);
    assert.equal((await ctx.request.get(srv.base + '/_headers', { failOnStatusCode: false })).status(), 404, '_headers tidak boleh bisa diunduh');
  });

  await browser.close(); evil.close(); await srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' tes browser lulus' + (failed.length ? ' — ' + failed.length + ' GAGAL' : ''));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
