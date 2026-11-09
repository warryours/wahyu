/* Helper bersama untuk semua tes: memuat Worker apa adanya, dengan D1 tiruan (SQLite bawaan Node >= 22.5). */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOST = 'https://contoh.com';
export const PASSWORD = 'tes-password-kuat-123';
export const SECRET = 'tes-secret-sangat-panjang-0123456789';
export const CATALOG = JSON.parse(readFileSync(path.join(ROOT, 'public/data/packages.json'), 'utf8'));

/* Worker mengimpor packages.json langsung (didukung wrangler). Node butuh atribut JSON, jadi di salinan sementara baris itu diganti. */
export async function loadWorker() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'wc-test-'));
  cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
  const f = path.join(tmp, 'src', 'worker.js');
  const marker = "import CATALOG from '../public/data/packages.json';";
  let s = readFileSync(f, 'utf8');
  if (!s.includes(marker)) throw new Error('Baris import katalog di src/worker.js berubah; sesuaikan test/helpers.mjs');
  s = s.replace(marker, "import { readFileSync as __r } from 'node:fs'; const CATALOG = JSON.parse(__r(" + JSON.stringify(path.join(ROOT, 'public/data/packages.json')) + ", 'utf8'));");
  writeFileSync(f, s); writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  return (await import(pathToFileURL(f).href)).default;
}

/* D1 tiruan: antarmuka sama (prepare/bind/first/all/run/batch), isi SQLite in-memory dengan schema.sql asli. */
export function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  class Stmt {
    constructor(s) { this.s = s; this.a = []; }
    bind(...a) { this.a = a; return this; }
    async first() { const r = sqlite.prepare(this.s).get(...this.a); return r ? { ...r } : null; }
    async all() { return { results: sqlite.prepare(this.s).all(...this.a).map((r) => ({ ...r })), meta: {} }; }
    async run() { const r = sqlite.prepare(this.s).run(...this.a); return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }
  }
  const DB = { prepare: (s) => new Stmt(s),
    batch: async (st) => { const out = []; for (const s of st) out.push(/^\s*select/i.test(s.s) ? await s.all() : await s.run()); return out; } };
  return { DB, sqlite };
}

export function makeEnv(extra) {
  const { DB, sqlite } = makeDb();
  const env = { DB, ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET, PUBLIC_URL: HOST,
    ASSETS: { fetch: async () => new Response('Tidak ditemukan', { status: 404 }) }, ...extra };
  env.sqlite = sqlite; /* hanya untuk memeriksa isi database di tes */
  return env;
}

let ipCounter = 0;
export const newIp = () => '198.51.100.' + ((++ipCounter) % 250 + 1) + (ipCounter > 250 ? '.' + Math.floor(ipCounter / 250) : '');

export function makeApi(worker, env) {
  return function call(p, o = {}) {
    const headers = { 'CF-Connecting-IP': o.ip || newIp(), ...(o.headers || {}) };
    let body = o.body;
    if (o.json !== undefined) { if (!headers['content-type']) headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    if (o.cookie) headers.cookie = o.cookie;
    return worker.fetch(new Request((o.host || HOST) + p, { method: o.method || (body !== undefined ? 'POST' : 'GET'), headers, body }), env);
  };
}

export async function login(call, password = PASSWORD) {
  const r = await call('/api/admin/login', { json: { password } });
  if (r.status !== 200) throw new Error('login gagal: ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}

export const futureDate = (days = 30) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
export const pkg0 = CATALOG.prasmanan[0];
export function validOrder(extra) {
  return { nama: 'Budi Santoso', whatsapp: '0812-3456-7890', alamat: 'Jl. Contoh No. 5, Belopa', acara: 'Syukuran', paket: pkg0.id, jumlah: 150, tanggal: futureDate(), catatan: 'tanpa pedas', ...extra };
}
/* satu pilihan menu valid untuk paket pertama (jika ada) */
export function validPilihan(pkg = pkg0) {
  const menu = {}; CATALOG.menu.forEach((m) => { menu[m.key] = m.options; });
  for (const it of pkg.items) { const o = it.options || (it.menu && menu[it.menu]); if (o && o.length) return { [it.name]: [o[0]] }; }
  return null;
}
export async function createOrder(call, extra, ip) {
  const r = await call('/api/orders', { json: validOrder(extra), ip });
  return { status: r.status, body: await r.json() };
}

/* Pemeriksa struktur PDF: header, xref, offset objek, dan isi content stream hanya berisi operator yang diizinkan. */
export function pdfCheck(u8) {
  const s = Buffer.from(u8).toString('latin1'); const errs = [];
  if (!s.startsWith('%PDF-1.4')) errs.push('header PDF salah');
  if (!s.trimEnd().endsWith('%%EOF')) errs.push('tidak diakhiri %%EOF');
  const sx = s.match(/startxref\n(\d+)\n%%EOF/);
  if (!sx || s.slice(Number(sx[1]), Number(sx[1]) + 4) !== 'xref') errs.push('startxref tidak menunjuk ke xref');
  else {
    const n = Number(s.slice(Number(sx[1])).match(/^xref\n0 (\d+)\n/)[1]);
    const entries = s.slice(Number(sx[1])).split('\n').slice(2, 2 + n);
    for (let i = 1; i < n; i++) if (!s.slice(Number(entries[i].slice(0, 10))).startsWith(i + ' 0 obj')) errs.push('offset objek ' + i + ' salah');
  }
  const a = s.indexOf('stream\n') + 7, b = s.indexOf('\nendstream', a);
  const lines = s.slice(a, b).split('\n');
  const TEXT = /^BT \/F[123] [\d.]+ Tf [\d. ]+ rg -?[\d.]+ -?[\d.]+ Td \((?:[^\\()]|\\[\\()])*\) Tj ET$/;
  const OTHER = [/^[\d. ]+ rg [\d. \-]+ re f$/, /^[\d. ]+ RG [\d.]+ w [\d. \-]+ m [\d. \-]+ l S$/, /^[\d. ]+ RG [\d.]+ w [\d. \-]+ re S$/, /^q [\d. \-]+ cm \/Im1 Do Q$/];
  lines.forEach((l, i) => { if (!TEXT.test(l) && !OTHER.some((r) => r.test(l))) errs.push('baris content stream #' + i + ' tidak dikenali: ' + l.slice(0, 80)); });
  return { errs, lines, TEXT, OTHER, text: s };
}
