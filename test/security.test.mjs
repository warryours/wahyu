/* Tes keamanan API: autentikasi, sesi, injeksi, manipulasi data, CSRF, rate limit, kebocoran informasi, nota & CSV. */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadWorker, makeEnv, makeApi, login, createOrder, validOrder, validPilihan, pkg0, CATALOG, newIp, pdfCheck, PASSWORD, SECRET } from './helpers.mjs';

let worker, env, call, cookie;
before(async () => { worker = await loadWorker(); env = makeEnv(); call = makeApi(worker, env); cookie = await login(call); await createOrder(call); });
const count = (t) => env.sqlite.prepare('select count(*) n from ' + t).get().n;
const hmac = (secret, v) => createHmac('sha256', secret).update(v).digest('hex');
const tables = () => env.sqlite.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name).sort();

describe('A. Autentikasi & otorisasi', () => {
  const protectedRoutes = [
    ['GET', '/api/admin/orders'], ['GET', '/api/admin/orders?status=baru&q=x'], ['GET', '/api/admin/orders/1'], ['PATCH', '/api/admin/orders/1', { status: 'batal' }],
    ['DELETE', '/api/admin/orders/1'], ['POST', '/api/admin/orders/1/nota', { type: 'dp' }], ['GET', '/api/admin/export.csv'], ['GET', '/api/admin/apa-saja'], ['PUT', '/api/admin/orders/1', {}],
  ];
  for (const [m, p, j] of protectedRoutes) test('tanpa login -> 401: ' + m + ' ' + p, async () => {
    const r = await call(p, { method: m, json: j }); assert.equal(r.status, 401);
    assert.doesNotMatch(await r.text(), /Budi|whatsapp|alamat/i, 'tidak boleh membocorkan data');
  });

  const real = async () => { const t = cookie.split('=')[1]; const [exp, sig] = t.split('.'); return { t, exp, sig }; };
  test('cookie palsu/rusak ditolak', async () => {
    const { exp, sig } = await real();
    const forged = [
      '', 'x', '.', 'a.b', exp + '.', '.' + sig, exp, 'abc.def.ghi',
      (Date.now() + 1e10) + '.' + sig,                               // exp diubah, tanda tangan lama
      (Date.now() + 1e10) + '.' + hmac('secret-lain-yang-salah-123456', String(Date.now() + 1e10)), // ditandatangani kunci lain
      (Date.now() - 1000) + '.' + hmac(SECRET, String(Date.now() - 1000)),                          // benar tapi kedaluwarsa
      'NaN.' + hmac(SECRET, 'NaN'), 'Infinity.' + hmac(SECRET, 'Infinity'), '1e99.' + hmac(SECRET, '1e99').replace(/./, 'z'),
      'A'.repeat(5000), exp + '.' + sig.toUpperCase(), exp + '.' + sig + '00', '%00.%00', '\u00e9' + exp + '.' + sig,
    ];
    for (const f of forged) { const r = await call('/api/admin/orders', { headers: { cookie: 'wc_admin=' + f } }); assert.equal(r.status, 401, 'cookie: ' + f.slice(0, 40)); }
  });
  test('token valid (kontrol positif): ditandatangani kunci yang benar & belum kedaluwarsa diterima', async () => {
    const exp = String(Date.now() + 3600e3);
    assert.equal((await call('/api/admin/orders', { headers: { cookie: 'wc_admin=' + exp + '.' + hmac(SECRET, exp) } })).status, 200);
  });
  test('cookie ganda: yang pertama (rusak) menentukan, tidak ada bypass', async () => {
    const r = await call('/api/admin/orders', { headers: { cookie: 'wc_admin=rusak; ' + cookie } }); assert.equal(r.status, 401);
  });
  test('flag cookie sesi: HttpOnly, Secure, SameSite=Strict, Path=/, Max-Age 12 jam', async () => {
    const r = await call('/api/admin/login', { json: { password: PASSWORD } }); const sc = r.headers.get('set-cookie');
    for (const f of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(sc.includes(f), f + ' hilang: ' + sc);
    assert.doesNotMatch(sc, /Domain=/i);
  });
  test('login: kata sandi salah/aneh tidak pernah menghasilkan 200 atau 500', async () => {
    const weird = [undefined, null, '', ' ', 0, 1, true, [], [PASSWORD], {}, { a: 1 }, PASSWORD + 'x', PASSWORD.slice(0, -1), PASSWORD.toUpperCase(), 'x'.repeat(10000), "' OR '1'='1", PASSWORD + '\0'];
    for (const w of weird) { const r = await call('/api/admin/login', { json: { password: w } }); assert.ok([401, 400].includes(r.status) || (Array.isArray(w) && w[0] === PASSWORD), JSON.stringify(w)?.slice(0, 30) + ' -> ' + r.status); assert.ok(!r.headers.get('set-cookie') || Array.isArray(w), 'tidak boleh ada cookie'); }
  });
  test('login: body bukan objek -> 400 (bukan 500)', async () => {
    for (const body of ['null', '[]', '123', '"teks"', 'bukan json', '']) {
      const r = await call('/api/admin/login', { body, headers: { 'content-type': 'application/json' } }); assert.ok(r.status === 400 || r.status === 401, body + ' -> ' + r.status);
    }
  });
  test('secret belum diatur -> ditolak total (tidak ada login dengan sandi kosong)', async () => {
    for (const [name, e] of [['ADMIN_PASSWORD kosong', { ADMIN_PASSWORD: '' }], ['ADMIN_PASSWORD hilang', { ADMIN_PASSWORD: undefined }], ['ADMIN_PASSWORD pendek', { ADMIN_PASSWORD: 'abc' }],
      ['SESSION_SECRET hilang', { SESSION_SECRET: undefined }], ['SESSION_SECRET kosong', { SESSION_SECRET: '' }], ['SESSION_SECRET pendek', { SESSION_SECRET: 'abc' }]]) {
      const en = makeEnv(e), c = makeApi(worker, en);
      for (const pw of ['', 'abc', undefined, PASSWORD]) { const r = await c('/api/admin/login', { json: { password: pw } }); assert.equal(r.status, 500, name + ' pw=' + pw); assert.ok(!r.headers.get('set-cookie')); }
      assert.equal((await c('/api/admin/orders', { headers: { cookie: 'wc_admin=1.' + hmac('', '1') } })).status, 500, name + ' (token dari kunci kosong)');
    }
  });
});

describe('B. Pembatas laju (rate limit)', () => {
  test('login: 5 percobaan/15 menit/IP, XFF tidak bisa dipakai menghindar, IP lain tidak terdampak', async () => {
    const ip = newIp(); const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await call('/api/admin/login', { json: { password: 'salah' + i }, ip, headers: { 'X-Forwarded-For': '10.9.8.' + i, 'X-Real-IP': '10.1.1.' + i } })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429, 429]);
    assert.equal((await call('/api/admin/login', { json: { password: PASSWORD }, ip })).status, 429, 'sandi benar pun diblokir saat limit');
    assert.equal((await call('/api/admin/login', { json: { password: PASSWORD }, ip: newIp() })).status, 200, 'IP lain tidak terdampak');
  });
  test('login: jendela waktu berakhir -> boleh lagi', async () => {
    const ip = newIp(); for (let i = 0; i < 6; i++) await call('/api/admin/login', { json: { password: 'x' }, ip });
    env.sqlite.prepare('update rate_hits set t = t - ? where k = ?').run(16 * 60e3, 'login:' + ip);
    assert.equal((await call('/api/admin/login', { json: { password: PASSWORD }, ip })).status, 200);
  });
  test('pesanan: 8 per 10 menit per IP, lalu 429', async () => {
    const ip = newIp(); const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await call('/api/orders', { json: validOrder(), ip })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 201, 201, 201, 429, 429]);
  });
  test('tabel rate_hits dibersihkan (tidak tumbuh tanpa batas untuk kunci yang sama)', async () => {
    const ip = newIp(); for (let i = 0; i < 3; i++) await call('/api/admin/login', { json: { password: 'x' }, ip });
    env.sqlite.prepare('update rate_hits set t = t - ? where k = ?').run(20 * 60e3, 'login:' + ip);
    await call('/api/admin/login', { json: { password: 'x' }, ip });
    assert.equal(env.sqlite.prepare('select count(*) n from rate_hits where k=?').get('login:' + ip).n, 1);
  });
});

describe('C. Injeksi', () => {
  const SQLI = ["' OR '1'='1", "'; DROP TABLE orders;--", '" OR ""="', "Robert'); DROP TABLE notas;--", "1; DELETE FROM orders", "' UNION SELECT token,1,1,1,1,1,1,1,1,1,1,1,1 FROM notas--", '\\', "%' OR '%'='", '${7*7}', '{{7*7}}'];
  test('SQL injection di semua kolom teks pesanan: tersimpan sebagai teks biasa, tabel utuh', async () => {
    const t0 = tables();
    for (const p of SQLI) {
      const r = await call('/api/orders', { json: validOrder({ nama: p, alamat: p, catatan: p }), ip: newIp() });
      assert.equal(r.status, 201, p); const code = (await r.json()).code;
      const row = env.sqlite.prepare('select nama, alamat, catatan from orders where code=?').get(code);
      assert.equal(row.nama, p.trim().slice(0, 100)); assert.equal(row.catatan, p.trim().slice(0, 300));
    }
    assert.deepEqual(tables(), t0); assert.ok(count('orders') > 0);
  });
  test('SQL injection di field enum/angka (acara, paket, whatsapp, jumlah, tanggal) -> ditolak', async () => {
    for (const p of SQLI) for (const f of ['acara', 'paket', 'jumlah', 'tanggal']) {
      const r = await call('/api/orders', { json: validOrder({ [f]: p }), ip: newIp() }); assert.equal(r.status, 400, f + ': ' + p);
    }
    for (const p of SQLI) { /* WhatsApp: hanya digit yang diambil; sisa payload dibuang, jadi yang tersimpan selalu angka murni */
      const r = await call('/api/orders', { json: validOrder({ whatsapp: p }), ip: newIp() });
      if (r.status === 201) assert.match(env.sqlite.prepare('select whatsapp from orders where code=?').get((await r.json()).code).whatsapp, /^\d{9,15}$/, p); else assert.equal(r.status, 400);
    }
    assert.ok(tables().includes('orders') && tables().includes('notas'));
  });
  test('pencarian admin (q, status) tidak bisa disuntik', async () => {
    const e2 = makeEnv(), c2 = makeApi(worker, e2), ck2 = await login(c2); await createOrder(c2, { nama: 'Siti Rahma' });
    assert.equal((await (await c2('/api/admin/orders?q=siti', { cookie: ck2 })).json()).orders.length, 1, 'kontrol positif: pencarian normal jalan');
    for (const q of ["' OR '1'='1", "siti' --", "x' UNION SELECT * FROM notas --", "'; DROP TABLE orders; --", '") OR 1=1 --']) {
      const d = await (await c2('/api/admin/orders?q=' + encodeURIComponent(q), { cookie: ck2 })).json(); assert.equal(d.orders.length, 0, q);
    }
    const all = (await (await c2('/api/admin/orders', { cookie: ck2 })).json()).orders.length;
    const inj = (await (await c2('/api/admin/orders?status=' + encodeURIComponent("baru' OR '1'='1"), { cookie: ck2 })).json()).orders.length;
    assert.equal(inj, all, 'status bukan enum diabaikan, bukan dieksekusi');
    assert.deepEqual(e2.sqlite.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name).sort(), tables());
  });
  test('id di path bukan angka -> tidak cocok route / tidak disuntik', async () => {
    for (const id of ['1 OR 1=1', "1'", '1;DROP TABLE orders', '-1', '1.5', '0x1', '%00', '../orders', '99999999999999999999999']) {
      const r = await call('/api/admin/orders/' + encodeURIComponent(id), { cookie }); assert.ok([404, 400].includes(r.status), id + ' -> ' + r.status);
    }
    assert.ok(tables().includes('orders'));
  });
  test('PATCH admin: catatan_admin disimpan literal; status/dp disuntik ditolak', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    const p = (j) => call('/api/admin/orders/' + id, { method: 'PATCH', json: j, cookie });
    assert.equal((await p({ catatan_admin: "'; DROP TABLE orders;--" })).status, 200);
    assert.equal(env.sqlite.prepare('select catatan_admin from orders where id=?').get(id).catatan_admin, "'; DROP TABLE orders;--");
    for (const j of [{ status: "batal'; --" }, { status: 'admin' }, { status: null }, { status: ['baru'] }, { dp: '1; DROP TABLE orders' }, { dp: '5000' }, { dp: null }, { dp: -1 }, { dp: 1.5 }, { dp: 1e15 }, { dp: NaN }, { dp: [100] }]) {
      assert.equal((await p(j)).status, 400, JSON.stringify(j));
    }
    assert.ok(tables().includes('orders'));
  });
  test('token nota di URL tidak bisa disuntik / traversal', async () => {
    const nasty = ["' OR '1'='1", '..%2f..%2fetc%2fpasswd', '%2e%2e/%2e%2e/schema', 'a'.repeat(200), 'abc', '%00', '*', "x'--"];
    for (const t of nasty) { const r = await call('/n/' + t + '.pdf'); assert.notEqual(r.status, 200, t); assert.notEqual(r.headers.get('content-type'), 'application/pdf'); }
  });
});

describe('D. Manipulasi data & logika bisnis', () => {
  test('mass assignment: harga/dp/status/kode/id dari klien diabaikan', async () => {
    const r = await call('/api/orders', { json: validOrder({ harga: 1, price: 1, total: 1, dp: 0, status: 'selesai', code: 'HACK-1', id: 9999, paket_nama: 'Gratis', created_at: '2000-01-01', catatan_admin: 'lunas' }), ip: newIp() });
    assert.equal(r.status, 201); const code = (await r.json()).code; assert.match(code, /^WC-\d{4}$/);
    const row = env.sqlite.prepare('select * from orders where code=?').get(code);
    assert.equal(row.harga, pkg0.price); assert.equal(row.paket_nama, pkg0.name); assert.equal(row.status, 'baru'); assert.equal(row.dp, 1000000);
    assert.equal(row.catatan_admin, ''); assert.notEqual(row.id, 9999); assert.ok(row.created_at.startsWith(new Date().getFullYear().toString()));
  });
  test('pilihan menu: kunci/opsi di luar katalog, prototype pollution, tipe salah -> ditolak', async () => {
    const it = pkg0.items.find((x) => validPilihan() && x.name in validPilihan()) || pkg0.items[0], valid = validPilihan();
    const bads = [{ constructor: ['x'] }, { toString: ['x'] }, { 'Menu Gaib': ['x'] }, [valid], 'teks', 5, { [it.name]: 'Opor' }, { [it.name]: [{ a: 1 }] }, { [it.name]: ['A', 'B', 'C', 'D'] }, { [it.name]: ['Bukan Opsi'] }, { [it.name]: [['nested']] }];
    for (const b of bads) { const r = await call('/api/orders', { json: validOrder({ pilihan: b }), ip: newIp() }); assert.equal(r.status, 400, JSON.stringify(b)); }
    const raw = '{"nama":"A","whatsapp":"081234567890","alamat":"X","acara":"Lainnya","paket":"' + pkg0.id + '","jumlah":100,"tanggal":"2099-01-01","pilihan":{"__proto__":{"polluted":true}}}';
    assert.equal((await call('/api/orders', { body: raw, headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal({}.polluted, undefined, 'Object.prototype tidak boleh tercemar');
  });
  test('tipe data aneh di semua field tidak pernah menyebabkan 500 (fuzz deterministik)', async () => {
    const vals = [null, undefined, true, false, 0, -1, 1.5, NaN, 1e308, '', ' ', 'a', '9'.repeat(50), [], [1], {}, { a: 1 }, '\u0000\u0001', '😀'.repeat(60), '1e2', '0x64', ' 150 '];
    const fields = ['nama', 'whatsapp', 'alamat', 'acara', 'paket', 'jumlah', 'tanggal', 'catatan', 'pilihan'];
    let n = 0; for (const f of fields) for (const v of vals) { n++;
      const o = validOrder(); if (v === undefined) delete o[f]; else o[f] = typeof v === 'number' && !Number.isFinite(v) ? null : v;
      const r = await call('/api/orders', { json: o, ip: newIp() }); assert.ok(r.status === 201 || r.status === 400, f + '=' + JSON.stringify(v)?.slice(0, 20) + ' -> ' + r.status);
    }
    assert.ok(n > 150);
  });
  test('panjang input dibatasi (nama 100, alamat 300, catatan 300) dan karakter kontrol dibuang', async () => {
    const r = await createOrder(call, { nama: 'N'.repeat(500), alamat: 'A'.repeat(900), catatan: 'C'.repeat(900) });
    const row = env.sqlite.prepare('select * from orders where code=?').get(r.body.code); assert.deepEqual([row.nama.length, row.alamat.length, row.catatan.length], [100, 300, 300]);
    const r2 = await createOrder(call, { nama: 'Bu\u0000di\r\n\tS\u007f' }); assert.equal(env.sqlite.prepare('select nama from orders where code=?').get(r2.body.code).nama, 'Bu di S');
  });
  test('snapshot nota tidak berubah walau pesanan diedit setelah nota terbit', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3)); const a = (j) => call('/api/admin/orders/' + id, { method: 'PATCH', json: j, cookie });
    await a({ dp: 1000000 }); const n1 = await (await call('/api/admin/orders/' + id + '/nota', { method: 'POST', json: { type: 'dp' }, cookie })).json();
    const pdf1 = Buffer.from(await (await call(new URL(n1.url).pathname)).arrayBuffer());
    await a({ dp: 2500000 });
    assert.ok(pdf1.equals(Buffer.from(await (await call(new URL(n1.url).pathname)).arrayBuffer())), 'nota lama harus tetap sama');
    const n2 = await (await call('/api/admin/orders/' + id + '/nota', { method: 'POST', json: { type: 'dp' }, cookie })).json(); assert.notEqual(n2.token, n1.token);
  });
  test('admin tidak bisa mengatur DP melebihi total pesanan', async () => {
    const { body } = await createOrder(call, { jumlah: 100 }); const id = Number(body.code.slice(3));
    assert.equal((await call('/api/admin/orders/' + id, { method: 'PATCH', json: { dp: pkg0.price * 100 + 1 }, cookie })).status, 400);
    assert.equal((await call('/api/admin/orders/' + id, { method: 'PATCH', json: { dp: pkg0.price * 100 }, cookie })).status, 200);
  });
});

describe('E. Validasi request & CSRF', () => {
  test('Content-Type selain JSON -> 415 (mencegah form-post lintas situs)', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      const h = ct ? { 'content-type': ct } : {};
      assert.equal((await call('/api/orders', { body: JSON.stringify(validOrder()), headers: h })).status, 415, ct);
      assert.equal((await call('/api/admin/orders/1', { method: 'PATCH', body: '{"status":"batal"}', headers: h, cookie })).status, 415, 'PATCH ' + ct);
    }
  });
  test('body JSON bukan objek / rusak -> 400, bukan 500', async () => {
    for (const body of ['null', '[]', '123', '"x"', 'true', '{bukan json', '{"a":', '\u0000']) {
      const r = await call('/api/orders', { body, headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, body);
    }
  });
  test('body terlalu besar -> 413 (dengan & tanpa Content-Length)', async () => {
    const big = JSON.stringify({ nama: 'x'.repeat(25000) });
    assert.equal((await call('/api/orders', { body: big, headers: { 'content-type': 'application/json' } })).status, 413);
    assert.equal((await call('/api/orders', { body: '{}', headers: { 'content-type': 'application/json', 'content-length': '999999' } })).status, 413);
  });
  test('Origin lintas situs ditolak 403 untuk SEMUA permintaan pengubah data (publik & admin)', async () => {
    const evil = { origin: 'https://jahat.example' };
    for (const [m, p, j, ck] of [['POST', '/api/orders', validOrder()], ['POST', '/api/admin/login', { password: PASSWORD }], ['PATCH', '/api/admin/orders/1', { status: 'batal' }, cookie],
      ['DELETE', '/api/admin/orders/1', undefined, cookie], ['POST', '/api/admin/orders/1/nota', { type: 'dp' }, cookie], ['POST', '/api/admin/logout', undefined, cookie]]) {
      const r = await call(p, { method: m, json: j, headers: evil, cookie: ck }); assert.equal(r.status, 403, m + ' ' + p); }
    for (const o of ['null', 'http://contoh.com', 'https://contoh.com.jahat.example', 'https://sub.contoh.com', 'https://contoh.com:8443']) assert.equal((await call('/api/orders', { json: validOrder(), headers: { origin: o } })).status, 403, o);
    assert.ok(env.sqlite.prepare('select 1 from orders where id=1').get(), 'pesanan 1 tidak boleh terhapus oleh permintaan lintas situs');
  });
  test('Origin yang sama / tanpa Origin (curl) tetap diizinkan', async () => {
    assert.equal((await call('/api/orders', { json: validOrder(), headers: { origin: 'https://contoh.com' } })).status, 201);
    assert.equal((await call('/api/orders', { json: validOrder() })).status, 201);
  });
  test('tidak ada header CORS: preflight & respons tidak mengizinkan situs lain', async () => {
    for (const p of ['/api/orders', '/api/admin/orders']) {
      const r = await call(p, { method: 'OPTIONS', headers: { origin: 'https://jahat.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
      assert.equal(r.headers.get('access-control-allow-origin'), null); assert.ok(r.status >= 400 || r.status === 204 && false);
    }
    const r = await call('/api/orders', { json: validOrder(), headers: { origin: 'https://contoh.com' } }); assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  test('metode tak terduga tidak membuka jalan pintas', async () => {
    for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) assert.equal((await call('/api/orders', { method: m })).status, 404, m + ' /api/orders');
    for (const m of ['PUT', 'POST', 'OPTIONS']) { const r = await call('/api/admin/orders/1', { method: m, cookie, json: m === 'OPTIONS' ? undefined : {} }); assert.equal(r.status, 404, m); }
    assert.ok(env.sqlite.prepare('select 1 from orders where id=1').get());
  });
});

describe('F. Kebocoran informasi & header', () => {
  const SEC = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security'];
  test('semua jenis respons Worker membawa header keamanan', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    const n = await (await call('/api/admin/orders/' + id + '/nota', { method: 'POST', json: { type: 'dp' }, cookie })).json();
    const rs = [await call('/api/orders', { json: validOrder() }), await call('/api/orders', { json: {} }), await call('/api/admin/orders'), await call('/api/xx'), await call('/api/admin/orders', { cookie }),
      await call('/api/admin/export.csv', { cookie }), await call(new URL(n.url).pathname), await call('/n/' + 'z'.repeat(30) + '.pdf'), await call('/api/admin/login', { json: { password: 'x' } })];
    for (const r of rs) for (const h of SEC) assert.ok(r.headers.get(h), h + ' hilang pada ' + r.status + ' ' + r.url);
    assert.equal(rs[6].headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(rs[6].headers.get('cache-control'), /no-store/);
    assert.equal(rs[2].headers.get('cache-control'), 'no-store');
  });
  test('kesalahan internal -> pesan generik, tanpa detail/stack', async () => {
    const orig = console.error; console.error = () => {};
    try {
      const boom = makeEnv({}); boom.DB = { prepare() { throw new Error('RAHASIA: koneksi db://admin:pw@10.0.0.1 /srv/app/worker.js:42'); }, batch() { throw new Error('RAHASIA'); } };
      const c = makeApi(worker, boom); const r = await c('/api/orders', { json: validOrder() }); const t = await r.text();
      assert.equal(r.status, 500); assert.equal(JSON.parse(t).error, 'Terjadi kesalahan server.'); assert.doesNotMatch(t, /RAHASIA|10\.0\.0\.1|worker\.js|at /);
    } finally { console.error = orig; }
  });
  test('respons admin tidak memuat secret / hash', async () => {
    const t = await (await call('/api/admin/orders', { cookie })).text(); assert.ok(!t.includes(PASSWORD) && !t.includes(SECRET));
    const l = await (await call('/api/admin/login', { json: { password: 'salah' } })).text(); assert.ok(!l.includes(PASSWORD));
  });
  test('pesan error login sama untuk semua kasus (tidak membocorkan detail)', async () => {
    const e = new Set(); for (const p of ['', 'a', PASSWORD.slice(0, -1), 'x'.repeat(100)]) e.add((await (await call('/api/admin/login', { json: { password: p } })).json()).error); assert.equal(e.size, 1);
  });
});

describe('G. Nota PDF', () => {
  test('token acak 192-bit, URL-safe, tidak berulang', async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i++) { const { body } = await createOrder(call); const n = await (await call('/api/admin/orders/' + Number(body.code.slice(3)) + '/nota', { method: 'POST', json: { type: 'dp' }, cookie })).json(); assert.match(n.token, /^[A-Za-z0-9_-]{32}$/); seen.add(n.token); }
    assert.equal(seen.size, 5);
  });
  test('menebak token -> 404 seragam, tanpa perbedaan yang bisa dipakai menebak', async () => {
    const msgs = new Set(); for (const t of ['A'.repeat(32), 'a'.repeat(20), 'x'.repeat(64), 'valid_format_tapi_salah_1234567']) { const r = await call('/n/' + t + '.pdf'); assert.equal(r.status, 404); msgs.add(await r.text()); } assert.equal(msgs.size, 1);
  });
  test('injeksi operator PDF lewat nama/alamat/catatan: tanda kurung & backslash di-escape, struktur PDF tetap valid', async () => {
    const hostile = ['Budi) Tj ET 1 0 0 rg 0 0 999 999 re f BT /F1 90 Tf (HACK', 'A\\) Tj ET (', '))))((((\\\\\\', '(((' + 'x'.repeat(95), '/F1 9 Tf (a) Tj', '\\(\\)', '😀 é ñ — “kutip” … ·'];
    for (const h of hostile) {
      const { body } = await createOrder(call, { nama: h, alamat: h + ' ' + h, catatan: h, pilihan: validPilihan() });
      const n = await (await call('/api/admin/orders/' + Number(body.code.slice(3)) + '/nota', { method: 'POST', json: { type: 'dp' }, cookie })).json();
      const r = await call(new URL(n.url).pathname); assert.equal(r.status, 200, h);
      const c = pdfCheck(new Uint8Array(await r.arrayBuffer())); assert.deepEqual(c.errs, [], 'payload: ' + h);
    }
  });
  test('kontrol negatif: pemeriksa PDF memang menolak baris yang disuntik', () => {
    const { TEXT, OTHER } = pdfCheck(new Uint8Array(Buffer.from('%PDF-1.4\nstream\nx\nendstream')));
    const inj = 'BT /F1 9 Tf 0 0 0 rg 10 10 Td (Budi) Tj ET 1 0 0 rg 0 0 999 999 re f BT (x) Tj ET';
    assert.ok(!TEXT.test(inj) && !OTHER.some((r) => r.test(inj)), 'pemeriksa harus menolak injeksi');
  });
  test('nama sangat panjang tanpa spasi tidak membuat server gagal', async () => {
    const { body } = await createOrder(call, { nama: 'W'.repeat(100), alamat: 'J'.repeat(300), catatan: 'C'.repeat(300) });
    const n = await (await call('/api/admin/orders/' + Number(body.code.slice(3)) + '/nota', { method: 'POST', json: { type: 'lunas' }, cookie })).json();
    const r = await call(new URL(n.url).pathname); assert.equal(r.status, 200); assert.deepEqual(pdfCheck(new Uint8Array(await r.arrayBuffer())).errs, []);
  });
});

describe('H. Ekspor CSV (CSV/formula injection)', () => {
  const parse = (t) => { const rows = []; let row = [], cell = '', q = false; t = t.replace(/^\ufeff/, '');
    for (let i = 0; i < t.length; i++) { const ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && t[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += ch; }
    if (cell || row.length) { row.push(cell); rows.push(row); } return rows; };
  test('sel yang diawali = + - @ diberi awalan apostrof; koma, kutip, dan newline aman', async () => {
    const evil = ['=HYPERLINK("http://jahat.example","klik")', '+1+1', '-2+3', '@SUM(A1:A9)', '\t=cmd|\' /C calc\'!A0', '=1+1', 'A, "B", C'];
    for (const e of evil) await createOrder(call, { nama: e, alamat: e, catatan: e });
    const csv = await (await call('/api/admin/export.csv', { cookie })).text(); const rows = parse(csv); const head = rows[0];
    const idx = ['Nama', 'Alamat', 'Catatan'].map((h) => head.indexOf(h)); assert.ok(idx.every((i) => i >= 0));
    let checked = 0; for (const r of rows.slice(1)) for (const i of idx) { const v = r[i]; if (v === undefined) continue; checked++;
      assert.ok(!/^[=+\-@\t\r]/.test(v), 'sel berbahaya tidak diberi awalan: ' + v); }
    assert.ok(checked > 20);
    assert.ok(rows.slice(1).some((r) => r[idx[0]] === "'=1+1")); assert.ok(rows.slice(1).some((r) => r[idx[0]] === 'A, "B", C'));
    assert.ok(rows.every((r) => r.length === head.length), 'jumlah kolom konsisten di semua baris');
  });
});
