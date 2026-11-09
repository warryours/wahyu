/* Membuat src/logo-data.js dari public/assets/logo.png (jalankan ulang jika logo diganti: npm run build:logo).
   Logo diperkecil ke 192x192 dan disimpan siap-pakai untuk PDF, supaya Worker tidak perlu mendekode PNG besar. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = fs.readFileSync(path.join(root, 'public', 'assets', 'logo.png'));
let p = 8, w = 0, h = 0, ct = 0, bd = 0; const idat = [];
while (p < d.length) {
  const len = d.readUInt32BE(p), type = d.toString('latin1', p + 4, p + 8), body = d.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); bd = body[8]; ct = body[9]; }
  if (type === 'IDAT') idat.push(body);
  p += 12 + len;
}
if (bd !== 8 || ct !== 6) throw new Error('logo.png harus PNG RGBA 8-bit');
const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
for (let y = 0; y < h; y++) {
  const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[dst - stride + x] : 0, c = (x >= bpp && y > 0) ? px[dst - stride + x - bpp] : 0;
    let v = raw[src + x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
    px[dst + x] = v & 255;
  }
}
const S = 192, rgb = Buffer.alloc(S * S * 3), al = Buffer.alloc(S * S);
for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
  const x0 = Math.floor(tx * w / S), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / S));
  const y0 = Math.floor(ty * h / S), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / S));
  let sa = 0, sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * stride + x * 4, a = px[i + 3]; sa += a; sr += px[i] * a; sg += px[i + 1] * a; sb += px[i + 2] * a; n++; }
  const o = ty * S + tx; al[o] = Math.round(sa / n);
  if (sa > 0) { rgb[o * 3] = Math.round(sr / sa); rgb[o * 3 + 1] = Math.round(sg / sa); rgb[o * 3 + 2] = Math.round(sb / sa); }
}
const out = '/* DIHASILKAN OTOMATIS oleh scripts/build-logo.mjs - jangan diedit manual */\n' +
  'export const LOGO = { w: ' + S + ', h: ' + S + ',\n  rgb: "' + zlib.deflateSync(rgb).toString('base64') + '",\n  alpha: "' + zlib.deflateSync(al).toString('base64') + '" };\n';
fs.writeFileSync(path.join(root, 'src', 'logo-data.js'), out);
console.log('src/logo-data.js dibuat (' + Math.round(out.length / 1024) + ' KB)');
