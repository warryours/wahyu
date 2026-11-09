/* Pembuat PDF nota tanpa dependency (jalan di Cloudflare Workers). Ukuran A5, font Helvetica bawaan PDF.
   Logo sudah diperkecil saat build (scripts/build-logo.mjs -> src/logo-data.js). */
import { LOGO as LOGO_DATA } from './logo-data.js';

/* ===== DATA PEMBAYARAN INVOICE (samakan dengan PEMBAYARAN & WA_BUKTI di public/admin/nota.js) ===== */
const PEMBAYARAN = { bank: 'Bank Rakyat Indonesia (BRI)', rekening: '499801073287539', atasNama: 'Muhammad Wahyu Kusairi' };
const WA_BUKTI = '0895325916029';
/* ================================================================================================== */

/* ---------- Lebar huruf Helvetica (AFM), kode 32..126 ---------- */
const HV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584];
const HB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584];
const FONTS = { F1: HV, F2: HB, F3: HV }; // F1 Helvetica, F2 Bold, F3 Oblique

function norm(s) {
  return String(s == null ? '' : s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...').replace(/[^\u0020-\u00ff]/g, '?');
}
function width(s, f, size) {
  const t = FONTS[f]; let w = 0;
  for (const ch of norm(s)) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126) ? t[c - 32] : (c === 0xb7 ? 278 : 556); }
  return w * size / 1000;
}
function esc(s) { return norm(s).replace(/([\\()])/g, '\\$1'); }
function wrap(s, f, size, maxW) {
  const out = [];
  String(s).split('\n').forEach((para) => {
    let line = '';
    para.split(/\s+/).filter(Boolean).forEach((word) => {
      const t = line ? line + ' ' + word : word;
      if (width(t, f, size) <= maxW || !line) line = t; else { out.push(line); line = word; }
    });
    out.push(line);
  });
  return out;
}

/* Isi tetap tiap paket. "cari" = potongan nama paket (huruf kecil, tanpa spasi/simbol). */
var PAKET_ISI = [
  /* ===== PRASMANAN (menu pilihan pelanggan tampil di pilihan_menu) ===== */
  { cari: ['paket1', 'paket27'], isi: ['Nasi Putih', 'Air', 'Es Buah', 'Service'] },
  { cari: ['paket2', 'paket30kpax'], isi: ['Nasi Putih', 'Kerupuk', 'Air', 'Es Buah', 'Service'] },
  { cari: ['paket3'], isi: ['Nasi Putih', 'Daging (Sambal Goreng)', 'Air', 'Es Buah', 'Service'] },
  { cari: ['paket4'], isi: ['Nasi Putih', 'Kerupuk', 'Air', 'Es Buah', 'Service'] },
  { cari: ['paket5'], isi: ['Nasi Putih', 'Kerupuk', 'Air', 'Es Buah', 'Service'] },
  { cari: ['paket6', 'kapurung'], isi: ['Nasi Putih', 'Ikan Bakar', 'Paredi Ikan/Ayam', 'Lawa Pakis/Jantung', 'Cobe-Cobe', 'Dange', 'Es Buah', 'Air'] },
  { cari: ['paket7', 'bakso'], isi: ['Buras', 'Telur', 'Pentolan', 'Air'] },
  /* ===== NASI KOTAK ===== */
  { cari: ['18000', '18rb', '18k'], isi: ['Nasi', 'Sayur', 'Ayam', 'Tempe', 'Air Mineral'] },
  { cari: ['20000', '20rb', '20k'], isi: ['Nasi', 'Ayam', 'Sayur', 'Telur', 'Gorengan', 'Air Mineral'] },
  { cari: ['25000', '25rb', '25k'], isi: ['Nasi', 'Pilihan Ayam', 'Sayur', 'Kerupuk', 'Buah/Air'] },
  { cari: ['28000', '28rb', '28k'], isi: ['Pilihan Utama: Olahan Daging atau Udang', 'Nasi', 'Sayur', 'Gorengan', 'Kerupuk', 'Air Mineral'] },
  { cari: ['30000', '30rb', '30k'], isi: ['Spesial: Isian Kue', 'Nasi', 'Pilihan Daging/Ayam', 'Sayur', 'Kerupuk', 'Buah', 'Air'] }
];
function isiPaket(nama) {
  var n = String(nama || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (var i = 0; i < PAKET_ISI.length; i++)
    for (var j = 0; j < PAKET_ISI[i].cari.length; j++)
      if (n.indexOf(PAKET_ISI[i].cari[j]) >= 0) return PAKET_ISI[i].isi;
  return [];
}

/* ---------- Terbilang & format ---------- */
function terbilang(n) {
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']; n = Math.floor(n);
  if (n === 0) return 'nol';
  if (n < 12) return s[n];
  if (n < 20) return terbilang(n - 10) + ' belas';
  if (n < 100) return terbilang(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilang(n % 10) : '');
  if (n < 200) return 'seratus' + (n - 100 ? ' ' + terbilang(n - 100) : '');
  if (n < 1000) return terbilang(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + terbilang(n - 1000) : '');
  if (n < 1e6) return terbilang(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilang(n % 1e6) : '');
  return terbilang(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilang(n % 1e9) : '');
}
const rp = (n) => 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function tgl(iso) { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? parseInt(m[3], 10) + ' ' + BULAN[parseInt(m[2], 10) - 1] + ' ' + m[1] : String(iso); }
const phone = (w) => (String(w).startsWith('62') ? '0' + String(w).slice(2) : String(w));

/* ---------- Util byte (pengganti Buffer) ---------- */
function latin1(s) { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
function concat(arrs) {
  let n = 0; arrs.forEach((a) => { n += a.length; });
  const o = new Uint8Array(n); let p = 0; arrs.forEach((a) => { o.set(a, p); p += a.length; }); return o;
}
function b64(s) { const bin = atob(s), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }

/* ---------- Logo (sudah RGB + SMask terkompresi) ---------- */
let LOGO;
function loadLogo() {
  if (LOGO === undefined) LOGO = LOGO_DATA ? { w: LOGO_DATA.w, h: LOGO_DATA.h, rgb: b64(LOGO_DATA.rgb), alpha: b64(LOGO_DATA.alpha) } : null;
  return LOGO;
}

/* ---------- Tata letak ---------- */
const col = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const BURG = '#800f19', GOLD = '#c9a45c', IVORY = '#f7f1e6', CREAM = '#f5ede2', LINE = '#d9c7b8', INK = '#2a1d19', GRAY = '#555555', GREEN = '#1b7a2d';
const PW = 419.53, M = 28, CW = PW - 2 * M;

function render(s, H, hasLogo) {
  const ops = [], Y = (y) => (H - y).toFixed(2);
  const isDp = s.type === 'dp', total = s.harga * s.jumlah, dp = Math.min(s.dp, total), sisa = total - dp;
  const rect = (x, y, w, h, fill) => ops.push(col(fill) + ' rg ' + x.toFixed(2) + ' ' + (H - y - h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
  const line = (x1, y1, x2, y2, color, lw) => ops.push(col(color).replace(/ /g, ' ') + ' RG ' + lw + ' w ' + x1.toFixed(2) + ' ' + Y(y1) + ' m ' + x2.toFixed(2) + ' ' + Y(y2) + ' l S');
  const text = (x, y, str, o) => {
    o = o || {}; const f = o.f || 'F1', size = o.size || 9; let px = x;
    if (o.align === 'r') px = x - width(str, f, size); else if (o.align === 'c') px = x - width(str, f, size) / 2;
    ops.push('BT /' + f + ' ' + size + ' Tf ' + col(o.color || INK) + ' rg ' + px.toFixed(2) + ' ' + Y(y) + ' Td (' + esc(str) + ') Tj ET');
  };

  /* header */
  rect(0, 0, PW, 84, BURG);
  if (hasLogo) ops.push('q 60 0 0 60 ' + M + ' ' + (H - 72).toFixed(2) + ' cm /Im1 Do Q');
  const hx = M + (hasLogo ? 74 : 0);
  text(hx, 33, 'WAHYU CATERING', { f: 'F2', size: 17, color: GOLD });
  text(hx, 46, 'Cita Rasa Istimewa', { size: 8.5, color: IVORY });
  text(hx, 57, 'Kompleks Pasar Baru Padang Sappa, Kec. Ponrang, Kab. Luwu', { size: 7, color: IVORY });
  text(hx, 67, 'WA 0895-3259-16029 \u00b7 IG @cateringwahyu_', { size: 7, color: IVORY });

  /* judul */
  text(PW / 2, 112, isDp ? 'INVOICE PEMBAYARAN DP' : 'INVOICE PELUNASAN', { f: 'F2', size: 13, color: BURG, align: 'c' });
  text(PW / 2, 126, 'No. ' + (isDp ? 'INV-DP-' : 'INV-LN-') + s.code + ' \u00b7 ' + tgl(s.issued), { size: 8.5, align: 'c' });
  /* pemesan & acara */
  let y = 150; const half = CW / 2 - 8, x2 = M + CW / 2 + 8;
  text(M, y, 'PEMESAN', { f: 'F2', size: 7, color: BURG }); text(x2, y, 'ACARA', { f: 'F2', size: 7, color: BURG });
  let y1 = y + 13, y2 = y + 13;
  wrap(s.nama, 'F2', 9.5, half).forEach((l) => { text(M, y1, l, { f: 'F2', size: 9.5 }); y1 += 12; });
  text(M, y1, phone(s.whatsapp), { size: 9 }); y1 += 12;
  wrap(s.alamat, 'F1', 9, half).forEach((l) => { text(M, y1, l, { size: 9 }); y1 += 11.5; });
  wrap(s.acara, 'F2', 9.5, half).forEach((l) => { text(x2, y2, l, { f: 'F2', size: 9.5 }); y2 += 12; });
  text(x2, y2, tgl(s.tanggal_acara), { size: 9 }); y2 += 12;
  text(x2, y2, 'Pesanan: ' + s.code, { size: 9 }); y2 += 12;
  y = Math.max(y1, y2) + 6;

  /* tabel */
  rect(M, y, CW, 18, CREAM);
  text(M + 6, y + 12, 'DESKRIPSI', { f: 'F2', size: 7.5 }); text(M + 210, y + 12, 'QTY', { f: 'F2', size: 7.5, align: 'r' });
  text(M + 272, y + 12, 'HARGA', { f: 'F2', size: 7.5, align: 'r' }); text(PW - M - 6, y + 12, 'JUMLAH', { f: 'F2', size: 7.5, align: 'r' });
  line(M, y + 18, PW - M, y + 18, BURG, 1.2);
  let ry = y + 18 + 14;
  text(M + 6, ry, s.paket_nama, { f: 'F2', size: 9 });
  text(M + 210, ry, s.jumlah + ' porsi', { size: 9, align: 'r' }); text(M + 272, ry, rp(s.harga), { size: 9, align: 'r' }); text(PW - M - 6, ry, rp(total), { f: 'F2', size: 9, align: 'r' });
  if (s.pilihan_menu) wrap(s.pilihan_menu, 'F1', 7.5, 165).forEach((l) => { ry += 10.5; text(M + 6, ry, l, { size: 7.5, color: GRAY }); });
  const isi = isiPaket(s.paket_nama);
  
  if (isi.length) {
    ry += 12; text(M + 6, ry, 'Sudah termasuk:', { f: 'F2', size: 7.5, color: GRAY });
    wrap(isi.join(', '), 'F1', 7.5, 190).forEach((l) => { ry += 10.5; text(M + 6, ry, l, { size: 7.5, color: GRAY }); });
  }
  ry += 9; line(M, ry, PW - M, ry, LINE, 0.8);

  /* ringkasan */
  y = ry + 16; const sx = PW - M - 250, sr = PW - M;
  const row = (label, val, big) => {
    if (big) { line(sx, y - 11, sr, y - 11, BURG, 1.2); y += 3; text(sx, y, label, { f: 'F2', size: 10.5, color: BURG }); text(sr, y, val, { f: 'F2', size: 10.5, color: BURG, align: 'r' }); y += 16; }
    else { text(sx, y, label, { size: 9 }); text(sr, y, val, { f: 'F2', size: 9, align: 'r' }); y += 15; }
  };
  if (isDp) { row('Total Pesanan', rp(total)); row('DP yang Harus Dibayar', rp(dp), true); row('Sisa (pelunasan hari H)', rp(sisa)); }
  else { row('Total Pesanan', rp(total)); row('DP sudah dibayar', '- ' + rp(dp)); row('Pelunasan yang Harus Dibayar', rp(sisa), true); }

  /* terbilang */
  y += 2;
  let tb = 'Terbilang: ' + terbilang(isDp ? dp : sisa) + ' rupiah'; tb = tb.charAt(0).toUpperCase() + tb.slice(1);
  const tl = wrap(tb, 'F3', 8.5, CW - 22), th = tl.length * 11 + 10;
  rect(M, y, CW, th, CREAM); rect(M, y, 3, th, GOLD);
  tl.forEach((l, i) => text(M + 12, y + 14 + i * 11, l, { f: 'F3', size: 8.5 }));
  y += th + 12;

  /* informasi pembayaran */
  const prow = [['Bank', PEMBAYARAN.bank], ['No. Rekening', PEMBAYARAN.rekening], ['Atas Nama', PEMBAYARAN.atasNama]];
  const plines = prow.map((r) => wrap(r[1], 'F2', 9, CW - 24 - 80));
  let ph = 14 + 8; plines.forEach((l) => { ph += l.length * 12 + 1; }); ph += 4;
  ops.push(col(LINE) + ' RG 0.8 w ' + M.toFixed(2) + ' ' + (H - y - ph).toFixed(2) + ' ' + CW.toFixed(2) + ' ' + ph.toFixed(2) + ' re S');
  text(M + 12, y + 14, 'INFORMASI PEMBAYARAN', { f: 'F2', size: 7, color: BURG });
  let py = y + 14 + 14;
  prow.forEach((r, i) => {
    text(M + 12, py, r[0], { size: 9, color: GRAY });
    plines[i].forEach((l, j) => text(M + 12 + 80, py + j * 12, l, { f: 'F2', size: 9 }));
    py += plines[i].length * 12 + 1;
  });
  y += ph + 12;

  /* catatan */
  const note = isDp ? 'DP untuk menyimpan tanggal acara. Pelunasan dilakukan pada hari H.' : 'Mohon lakukan pelunasan sesuai jumlah tagihan di atas. Terima kasih atas kepercayaan Anda.';
  wrap(note, 'F1', 8, CW).forEach((l) => { text(M, y, l, { size: 8, color: GRAY }); y += 11; });

  /* tanda tangan */
  y += 8; const c1 = M + CW * 0.25, c2 = M + CW * 0.75, ly = y + 52;
  line(c1 - 62, ly, c1 + 62, ly, INK, 0.7); line(c2 - 62, ly, c2 + 62, ly, INK, 0.7);
  text(c1, ly + 11, 'Pemesan', { size: 8.5, align: 'c' }); text(c2, ly + 11, 'Wahyu Catering', { size: 8.5, align: 'c' });
  const by = ly + 26, bt = 'Catatan: Mohon kirim bukti pembayaran melalui WhatsApp ke ';
  rect(M, by, CW, 22, CREAM); rect(M, by, 3, 22, BURG);
  text(M + 12, by + 14, bt, { size: 8 }); text(M + 12 + width(bt, 'F1', 8), by + 14, WA_BUKTI, { f: 'F2', size: 8 });
  y = by + 22 + 16;
  text(PW / 2, y, 'Terima kasih \u00b7 Cita Rasa Istimewa', { f: 'F2', size: 8.5, color: BURG, align: 'c' });
  return { stream: ops.join('\n'), endY: y };
}

/* ---------- Perakit PDF ---------- */
function buildNotaPdf(snap) {
  const logo = loadLogo(); let H = 595.28, r = render(snap, H, !!logo);
  if (r.endY > H - 22) { H = Math.ceil(r.endY + 22); r = render(snap, H, !!logo); }
  const objs = [];
  const add = (b) => { objs.push(b instanceof Uint8Array ? b : latin1(b)); return objs.length; };
  const stream = (dict, data) => concat([latin1('<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n'), data, latin1('\nendstream')]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + H + '] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >>' + (logo ? ' /XObject << /Im1 8 0 R >>' : '') + ' >> /Contents 4 0 R >>');
  add(stream('', latin1(r.stream)));
  ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'].forEach((n) => add('<< /Type /Font /Subtype /Type1 /BaseFont /' + n + ' /Encoding /WinAnsiEncoding >>'));
  if (logo) {
    add(stream('/Type /XObject /Subtype /Image /Width ' + logo.w + ' /Height ' + logo.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 9 0 R', logo.rgb));
    add(stream('/Type /XObject /Subtype /Image /Width ' + logo.w + ' /Height ' + logo.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', logo.alpha));
  }
  const parts = [latin1('%PDF-1.4\n')], offs = []; let pos = parts[0].length;
  objs.forEach((o, i) => {
    offs.push(pos); const b = concat([latin1((i + 1) + ' 0 obj\n'), o, latin1('\nendobj\n')]);
    parts.push(b); pos += b.length;
  });
  let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offs.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
  parts.push(latin1(xref));
  return concat(parts);
}

export { buildNotaPdf, terbilang };
