import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, makeEnv, makeApi, login, createOrder, validOrder, validPilihan, pkg0, futureDate, pdfCheck, HOST, CATALOG } from './helpers.mjs';

let worker, env, call, cookie;
before(async () => { worker = await loadWorker(); env = makeEnv(); call = makeApi(worker, env); cookie = await login(call); });
const adminJson = (path, method, json) => call(path, { method, json, cookie });

describe('Pesanan publik', () => {
  test('pesanan valid tersimpan; harga & nama paket diambil dari server', async () => {
    const r = await createOrder(call, { pilihan: validPilihan() });
    assert.equal(r.status, 201); assert.match(r.body.code, /^WC-\d{4}$/);
    const row = env.sqlite.prepare('select * from orders where code=?').get(r.body.code);
    assert.equal(row.harga, pkg0.price); assert.equal(row.paket_nama, pkg0.name);
    assert.equal(row.whatsapp, '6281234567890'); assert.equal(row.status, 'baru'); assert.equal(row.dp, 1000000);
  });
  test('kode pesanan berurutan dan unik', async () => {
    const a = await createOrder(call), b = await createOrder(call);
    assert.notEqual(a.body.code, b.body.code);
    assert.equal(Number(b.body.code.slice(3)), Number(a.body.code.slice(3)) + 1);
  });
  test('format nomor WhatsApp dinormalisasi', async () => {
    for (const [inp, out] of [['08123456789', '628123456789'], ['+62 812-3456-789', '628123456789'], ['8123456789', '628123456789']]) {
      const r = await createOrder(call, { whatsapp: inp }); assert.equal(r.status, 201, inp);
      assert.equal(env.sqlite.prepare('select whatsapp from orders where code=?').get(r.body.code).whatsapp, out);
    }
  });
  const bad = [
    ['nama kosong', { nama: '  ' }], ['WA tidak valid', { whatsapp: 'abc' }], ['alamat kosong', { alamat: '' }], ['acara tidak dikenal', { acara: 'Hajatan' }],
    ['paket tidak ada', { paket: 'xx' }], ['jumlah < 100', { jumlah: 99 }], ['jumlah desimal', { jumlah: 150.5 }], ['jumlah negatif', { jumlah: -150 }],
    ['jumlah > batas', { jumlah: 100001 }], ['tanggal lampau', { tanggal: '2020-01-01' }], ['tanggal format salah', { tanggal: '20-01-2030' }],
    ['tanggal tidak ada di kalender (31 Feb)', { tanggal: '2030-02-31' }], ['bulan 13', { tanggal: '2030-13-01' }],
    ['pilihan menu bukan di katalog', { pilihan: { 'Ayam': ['Ayam Bohongan'] } }],
  ];
  for (const [name, patch] of bad) test('ditolak: ' + name, async () => {
    const before = env.sqlite.prepare('select count(*) n from orders').get().n;
    const r = await createOrder(call, patch); assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok(r.body.error);
    assert.equal(env.sqlite.prepare('select count(*) n from orders').get().n, before, 'tidak boleh ada baris tersimpan');
  });
  test('tanggal hari ini (WITA) diterima', async () => {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    assert.equal((await createOrder(call, { tanggal: today })).status, 201);
  });
  test('semua jenis acara pada form diterima', async () => {
    for (const a of ['Pengantin', 'Aqiqah', 'Syukuran', 'Arisan', 'Ulang Tahun', 'Acara Kantor', 'Lainnya']) assert.equal((await createOrder(call, { acara: a })).status, 201, a);
  });
  test('semua paket di katalog bisa dipesan', async () => {
    for (const p of CATALOG.prasmanan.concat(CATALOG.nasikotak)) assert.equal((await createOrder(call, { paket: p.id })).status, 201, p.id);
  });
});

describe('Admin', () => {
  test('daftar, filter status, pencarian, dan hitungan', async () => {
    await createOrder(call, { nama: 'Siti Aminah' });
    let d = await (await call('/api/admin/orders', { cookie })).json();
    assert.ok(d.orders.length > 0); assert.equal(Object.values(d.counts).reduce((a, b) => a + b, 0), d.orders.length);
    d = await (await call('/api/admin/orders?q=siti', { cookie })).json(); assert.ok(d.orders.length >= 1 && d.orders.every((o) => /siti/i.test(o.nama)));
    d = await (await call('/api/admin/orders?status=selesai', { cookie })).json(); assert.equal(d.orders.length, 0);
  });
  test('ubah status, DP, catatan admin', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    const r = await adminJson('/api/admin/orders/' + id, 'PATCH', { status: 'dp_dibayar', dp: 2000000, catatan_admin: 'DP sudah masuk' });
    assert.equal(r.status, 200); const o = (await r.json()).order;
    assert.deepEqual([o.status, o.dp, o.catatan_admin], ['dp_dibayar', 2000000, 'DP sudah masuk']);
  });
  test('ekspor CSV berisi pesanan dan BOM UTF-8', async () => {
    const r = await call('/api/admin/export.csv', { cookie }); const buf = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 agar Excel membaca huruf dengan benar');
    assert.ok(buf.subarray(3).toString('utf8').startsWith('"Kode"')); assert.match(r.headers.get('content-disposition'), /attachment/);
  });
  test('hapus pesanan ikut menghapus nota-nya', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    await adminJson('/api/admin/orders/' + id + '/nota', 'POST', { type: 'dp' });
    assert.equal(env.sqlite.prepare('select count(*) n from notas where order_id=?').get(id).n, 1);
    assert.equal((await call('/api/admin/orders/' + id, { method: 'DELETE', cookie })).status, 200);
    assert.equal(env.sqlite.prepare('select count(*) n from notas where order_id=?').get(id).n, 0);
    assert.equal((await call('/api/admin/orders/' + id, { cookie })).status, 404);
  });
  test('logout menghapus cookie', async () => {
    const r = await call('/api/admin/logout', { method: 'POST', cookie }); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });
});

describe('Nota PDF', () => {
  test('terbit, idempoten, link memakai PUBLIC_URL, PDF valid', async () => {
    const { body } = await createOrder(call, { pilihan: validPilihan() }); const id = Number(body.code.slice(3));
    const n1 = await (await adminJson('/api/admin/orders/' + id + '/nota', 'POST', { type: 'dp' })).json();
    const n2 = await (await adminJson('/api/admin/orders/' + id + '/nota', 'POST', { type: 'dp' })).json();
    assert.equal(n1.token, n2.token); assert.equal(n1.number, 'INV-DP-' + body.code);
    assert.ok(n1.url.startsWith(HOST + '/n/') && n1.url.endsWith('.pdf'));
    const r = await call(new URL(n1.url).pathname); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf');
    const buf = new Uint8Array(await r.arrayBuffer()); assert.equal(buf.length, Number(r.headers.get('content-length')));
    const c = pdfCheck(buf); assert.deepEqual(c.errs, []);
    assert.match(c.text, /INVOICE PEMBAYARAN DP/);
  });
  test('tanpa PUBLIC_URL, link memakai alamat permintaan', async () => {
    const e2 = makeEnv({ PUBLIC_URL: undefined }), c2 = makeApi(worker, e2), ck = await login(c2);
    const { body } = await createOrder(c2); const id = Number(body.code.slice(3));
    const n = await (await c2('/api/admin/orders/' + id + '/nota', { method: 'POST', json: { type: 'lunas' }, cookie: ck })).json();
    assert.ok(n.url.startsWith(HOST + '/n/'), n.url);
  });
  test('invoice pelunasan: PDF valid dan berisi judul yang benar', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    const n = await (await adminJson('/api/admin/orders/' + id + '/nota', 'POST', { type: 'lunas' })).json();
    const buf = new Uint8Array(await (await call(new URL(n.url).pathname)).arrayBuffer()); const c = pdfCheck(buf);
    assert.deepEqual(c.errs, []); assert.match(c.text, /INVOICE PELUNASAN/);
  });
  test('HEAD ke nota diizinkan', async () => {
    const { body } = await createOrder(call); const id = Number(body.code.slice(3));
    const n = await (await adminJson('/api/admin/orders/' + id + '/nota', 'POST', { type: 'dp' })).json();
    assert.equal((await call(new URL(n.url).pathname, { method: 'HEAD' })).status, 200);
  });
  test('jenis nota tidak valid ditolak', async () => {
    assert.equal((await adminJson('/api/admin/orders/1/nota', 'POST', { type: 'gratis' })).status, 400);
  });
});

describe('Router', () => {
  test('permintaan non-API diteruskan ke Static Assets', async () => {
    let hit = 0; const e2 = makeEnv({ ASSETS: { fetch: async () => { hit++; return new Response('ok'); } } });
    await makeApi(worker, e2)('/index.html'); assert.equal(hit, 1);
  });
  test('API tak dikenal -> 404 JSON', async () => {
    const r = await call('/api/tidak-ada'); assert.equal(r.status, 404); assert.ok((await r.json()).error);
  });
});
