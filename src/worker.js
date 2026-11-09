/* Worker Wahyu Catering: API pesanan + admin + nota PDF.
   File statis (website, gambar, halaman admin) dilayani langsung oleh Workers Static Assets dari folder public/.
   Worker ini hanya dipanggil untuk /api/* dan /n/* (lihat run_worker_first di wrangler.jsonc).
   Database: Cloudflare D1 (binding DB).  Secret: ADMIN_PASSWORD, SESSION_SECRET.  Variabel: PUBLIC_URL. */
import { buildNotaPdf } from './pdf-nota.js';
import CATALOG from '../public/data/packages.json';

/* ---------- Katalog (sumber harga: server, bukan browser) ---------- */
const PACKAGES = {};
CATALOG.prasmanan.concat(CATALOG.nasikotak).forEach((p) => { PACKAGES[p.id] = p; });
const MENU = {}; CATALOG.menu.forEach((m) => { MENU[m.key] = m.options; });
function itemOptions(it) { return it.options || (it.menu && MENU[it.menu]) || null; }
/* Validasi pilihan menu dari pelanggan terhadap katalog; hasil berupa teks "Ayam: Opor, Rica-Rica" per baris */
function buildPilihan(pkg, input) {
  if (input == null || input === '') return '';
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const lines = [];
  for (const it of pkg.items) {
    const chosen = input[it.name]; const opts = itemOptions(it);
    if (chosen === undefined) continue;
    if (!opts || !Array.isArray(chosen) || chosen.length > 1) return null;
    const uniq = [...new Set(chosen.map(String))];
    if (!uniq.every((c) => opts.includes(c))) return null;
    if (uniq.length) lines.push(it.name + ': ' + uniq.join(', '));
  }
  for (const k of Object.keys(input)) if (!pkg.items.some((it) => it.name === k)) return null;
  return lines.join('\n');
}
const EVENTS = ['Pengantin', 'Aqiqah', 'Syukuran', 'Arisan', 'Ulang Tahun', 'Acara Kantor', 'Lainnya'];
const STATUSES = ['baru', 'dikonfirmasi', 'dp_dibayar', 'selesai', 'batal'];
const MIN_PORSI = 100;
const TZ_OFFSET_HOURS = 8; /* WITA (Luwu, Sulawesi Selatan). Worker berjalan di UTC, jadi "hari ini" dihitung manual. */

/* ---------- Util ---------- */
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Strict-Transport-Security': 'max-age=31536000' };
const enc = new TextEncoder();

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status: status || 200,
    headers: Object.assign({}, SEC, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers) });
}
function plain(body, status, headers) {
  return new Response(body, { status, headers: Object.assign({}, SEC, { 'Content-Type': 'text/plain; charset=utf-8' }, headers) });
}
async function readJson(request) {
  if (!/^application\/json/i.test(request.headers.get('content-type') || '')) throw { status: 415, error: 'Content-Type harus application/json.' };
  if (Number(request.headers.get('content-length') || 0) > 20000) throw { status: 413, error: 'Data terlalu besar.' };
  const t = await request.text();
  if (t.length > 20000) throw { status: 413, error: 'Data terlalu besar.' };
  let v; try { v = JSON.parse(t || '{}'); } catch (e) { throw { status: 400, error: 'JSON tidak valid.' }; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw { status: 400, error: 'JSON harus berupa objek.' };
  return v;
}
function ip(request) { return request.headers.get('CF-Connecting-IP') || '?'; }

/* Pembatas laju disimpan di D1 (bukan memori) karena Worker berjalan di banyak instance sekaligus. */
async function limited(env, key, max, windowMs) {
  const now = Date.now();
  const stmts = [
    env.DB.prepare('DELETE FROM rate_hits WHERE k=? AND t<?').bind(key, now - windowMs),
    env.DB.prepare('INSERT INTO rate_hits (k,t) VALUES (?,?)').bind(key, now),
    env.DB.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE k=?').bind(key),
  ];
  if (Math.random() < 0.02) stmts.push(env.DB.prepare('DELETE FROM rate_hits WHERE t<?').bind(now - 24 * 3600e3)); /* bersih-bersih berkala */
  const res = await env.DB.batch(stmts);
  return res[2].results[0].n > max;
}

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))); }
async function safeEq(a, b) {
  const [A, B] = await Promise.all([sha256(a), sha256(b)]); let d = 0;
  for (let i = 0; i < A.length; i++) d |= A[i] ^ B[i];
  return d === 0;
}
async function sign(env, v) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(v))));
}
async function makeToken(env) { const exp = String(Date.now() + 12 * 3600e3); return exp + '.' + await sign(env, exp); }
async function validToken(env, t) {
  if (!t) return false; const [exp, sig] = t.split('.');
  const e = Number(exp), now = Date.now();
  /* exp harus angka hingga, belum lewat, dan tidak lebih dari 12 jam ke depan (+1 menit toleransi) */
  if (!sig || !Number.isFinite(e) || e <= now || e > now + 12 * 3600e3 + 60e3) return false;
  return await safeEq(sig, await sign(env, exp));
}
function cookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : '';
}
async function isAdmin(env, request) { return validToken(env, cookie(request, 'wc_admin')); }
function randomToken() {
  const u = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function normWA(v) {
  let d = String(v || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('0')) d = '62' + d.slice(1); else if (d.startsWith('8')) d = '62' + d;
  return /^\d{9,15}$/.test(d) ? d : '';
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function todayLocal() { return new Date(Date.now() + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10); }
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/* ---------- API publik ---------- */
async function createOrder(request, env) {
  if (await limited(env, 'order:' + ip(request), 8, 10 * 60e3)) return json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' }, 429);
  const b = await readJson(request); const err = (e) => json({ error: e }, 400);
  const nama = clean(b.nama, 100), alamat = clean(b.alamat, 300), catatan = clean(b.catatan, 300), wa = normWA(b.whatsapp);
  const pkg = PACKAGES[b.paket], jumlah = Number(b.jumlah), tanggal = String(b.tanggal || '');
  if (!nama) return err('Nama wajib diisi.');
  if (!wa) return err('Nomor WhatsApp tidak valid.');
  if (!alamat) return err('Alamat wajib diisi.');
  if (!EVENTS.includes(b.acara)) return err('Jenis acara tidak valid.');
  if (!pkg) return err('Paket tidak valid.');
  if (!Number.isInteger(jumlah) || jumlah < MIN_PORSI || jumlah > 100000) return err('Jumlah pesanan minimal ' + MIN_PORSI + ' porsi.');
  if (!validDate(tanggal) || tanggal < todayLocal()) return err('Tanggal acara tidak valid.');
  const pilihan = buildPilihan(pkg, b.pilihan);
  if (pilihan === null) return err('Pilihan menu tidak valid.');
  const now = new Date().toISOString();
  const r = await env.DB.prepare(`INSERT INTO orders (nama,whatsapp,alamat,acara,paket_id,paket_nama,harga,jumlah,tanggal_acara,catatan,pilihan_menu,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nama, wa, alamat, b.acara, pkg.id, pkg.name, pkg.price, jumlah, tanggal, catatan, pilihan, now, now).run();
  const id = r.meta.last_row_id; const code = 'WC-' + String(id).padStart(4, '0');
  await env.DB.prepare('UPDATE orders SET code=? WHERE id=?').bind(code, id).run();
  return json({ ok: true, code }, 201);
}

/* ---------- Nota PDF (link rahasia, tanpa API WhatsApp) ---------- */
function baseUrl(env, request) {
  if (env.PUBLIC_URL) return String(env.PUBLIC_URL).replace(/\/+$/, '');
  return new URL(request.url).origin;
}
/* Snapshot nota disimpan saat diterbitkan, jadi isi nota tidak berubah walau data pesanan diedit kemudian. */
async function issueNota(request, env, o, type) {
  const snap = { type, code: o.code, nama: o.nama, whatsapp: o.whatsapp, alamat: o.alamat, acara: o.acara, tanggal_acara: o.tanggal_acara,
    paket_nama: o.paket_nama, harga: o.harga, jumlah: o.jumlah, pilihan_menu: o.pilihan_menu, dp: o.dp, issued: todayLocal() };
  const data = JSON.stringify(snap);
  const found = await env.DB.prepare('SELECT token FROM notas WHERE order_id=? AND type=? AND data=?').bind(o.id, type, data).first();
  const token = found ? found.token : randomToken();
  if (!found) await env.DB.prepare('INSERT INTO notas (token,order_id,type,data,created_at) VALUES (?,?,?,?,?)').bind(token, o.id, type, data, new Date().toISOString()).run();
  return { token, url: baseUrl(env, request) + '/n/' + token + '.pdf', number: (type === 'dp' ? 'INV-DP-' : 'INV-LN-') + o.code };
}
async function servePdf(env, token) {
  /* token acak 192-bit, tidak bisa ditebak; jadi tidak perlu pembatas laju */
  const row = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await env.DB.prepare('SELECT * FROM notas WHERE token=?').bind(token).first() : null;
  if (!row) return plain('Invoice tidak ditemukan.', 404);
  const snap = JSON.parse(row.data), pdf = buildNotaPdf(snap);
  return new Response(pdf, { status: 200, headers: Object.assign({}, SEC, { 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length),
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Disposition': 'inline; filename="Invoice-' + (snap.type === 'dp' ? 'DP' : 'Pelunasan') + '-' + snap.code + '.pdf"' }) });
}

/* ---------- API admin ---------- */
async function listOrders(env, url) {
  const status = url.searchParams.get('status'), term = (url.searchParams.get('q') || '').trim().toLowerCase();
  const where = [], args = [];
  if (STATUSES.includes(status)) { where.push('status=?'); args.push(status); }
  if (term) { where.push('(lower(nama) LIKE ? OR lower(code) LIKE ? OR whatsapp LIKE ? OR lower(acara) LIKE ?)'); const l = '%' + term.replace(/[%_]/g, '') + '%'; args.push(l, l, l, l); }
  const sql = 'SELECT * FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT 500';
  return (await env.DB.prepare(sql).bind(...args).all()).results;
}
function csvEsc(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }

async function adminApi(request, env, url) {
  const p = url.pathname, m = request.method;
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
    console.error('Secret ADMIN_PASSWORD (min 8 karakter) / SESSION_SECRET (min 16 karakter) belum diatur. Jalankan: npx wrangler secret put ...');
    return json({ error: 'Server belum dikonfigurasi (secret admin belum diatur).' }, 500);
  }
  if (p === '/api/admin/login' && m === 'POST') {
    if (await limited(env, 'login:' + ip(request), 5, 15 * 60e3)) return json({ error: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.' }, 429);
    const b = await readJson(request);
    if (!(await safeEq(b.password || '', env.ADMIN_PASSWORD))) return json({ error: 'Password salah.' }, 401);
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return json({ ok: true }, 200, { 'Set-Cookie': 'wc_admin=' + await makeToken(env) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + secure });
  }
  if (p === '/api/admin/logout' && m === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': 'wc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  if (!(await isAdmin(env, request))) return json({ error: 'Belum login.' }, 401);

  if (p === '/api/admin/orders' && m === 'GET') {
    const counts = {}; STATUSES.forEach((s) => { counts[s] = 0; });
    (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()).results.forEach((r) => { counts[r.status] = r.n; });
    return json({ orders: await listOrders(env, url), counts });
  }
  if (p === '/api/admin/export.csv' && m === 'GET') {
    const rows = await listOrders(env, url);
    const head = ['Kode', 'Dibuat', 'Nama', 'WhatsApp', 'Alamat', 'Acara', 'Paket', 'Harga', 'Jumlah', 'Total', 'Tanggal Acara', 'Status', 'DP', 'Sisa', 'Pilihan Menu', 'Catatan', 'Catatan Admin'];
    const lines = [head.map(csvEsc).join(',')].concat(rows.map((o) => [o.code, o.created_at, o.nama, o.whatsapp, o.alamat, o.acara, o.paket_nama, o.harga, o.jumlah, o.harga * o.jumlah, o.tanggal_acara, o.status, o.dp, o.harga * o.jumlah - o.dp, o.pilihan_menu, o.catatan, o.catatan_admin].map(csvEsc).join(',')));
    return new Response('\ufeff' + lines.join('\r\n'), { status: 200, headers: Object.assign({}, SEC, { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pesanan-wahyu-catering.csv"', 'Cache-Control': 'no-store' }) });
  }
  const getOrder = (id) => env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  const mn = p.match(/^\/api\/admin\/orders\/(\d+)\/nota$/);
  if (mn && m === 'POST') {
    const o = await getOrder(Number(mn[1])); if (!o) return json({ error: 'Pesanan tidak ditemukan.' }, 404);
    const b = await readJson(request); if (b.type !== 'dp' && b.type !== 'lunas') return json({ error: 'Jenis invoice tidak valid.' }, 400);
    return json(await issueNota(request, env, o, b.type));
  }
  const mm = p.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (mm) {
    const id = Number(mm[1]), o = await getOrder(id); if (!o) return json({ error: 'Pesanan tidak ditemukan.' }, 404);
    if (m === 'GET') return json({ order: o });
    if (m === 'PATCH') {
      const b = await readJson(request);
      const status = b.status === undefined ? o.status : b.status, note = b.catatan_admin === undefined ? o.catatan_admin : clean(b.catatan_admin, 500);
      const dp = b.dp === undefined ? o.dp : b.dp;
      if (!STATUSES.includes(status)) return json({ error: 'Status tidak valid.' }, 400);
      if (!Number.isInteger(dp) || dp < 0 || dp > o.harga * o.jumlah) return json({ error: 'Nominal DP harus antara 0 dan total pesanan.' }, 400);
      await env.DB.prepare('UPDATE orders SET status=?, catatan_admin=?, dp=?, updated_at=? WHERE id=?').bind(status, note, dp, new Date().toISOString(), id).run();
      return json({ order: await getOrder(id) });
    }
    if (m === 'DELETE') {
      await env.DB.batch([env.DB.prepare('DELETE FROM notas WHERE order_id=?').bind(id), env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id)]);
      return json({ ok: true });
    }
  }
  return json({ error: 'Tidak ditemukan.' }, 404);
}

/* Pertahanan CSRF tambahan: permintaan yang mengubah data harus berasal dari situs ini sendiri (selain SameSite=Strict + wajib JSON). */
function crossOrigin(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return false;
  const o = request.headers.get('origin');
  return !!o && o !== url.origin;
}

/* ---------- Router ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') && crossOrigin(request, url)) return json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
      if (url.pathname === '/api/orders' && request.method === 'POST') return await createOrder(request, env);
      const pm = url.pathname.match(/^\/n\/([A-Za-z0-9_-]+)\.pdf$/);
      if (pm && (request.method === 'GET' || request.method === 'HEAD')) return await servePdf(env, pm[1]);
      if (url.pathname.startsWith('/api/admin/')) return await adminApi(request, env, url);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Tidak ditemukan.' }, 404);
      return env.ASSETS.fetch(request); /* cadangan: seharusnya sudah dilayani Static Assets */
    } catch (e) {
      if (e && e.status) return json({ error: e.error }, e.status);
      console.error(e); return json({ error: 'Terjadi kesalahan server.' }, 500);
    }
  },
};
