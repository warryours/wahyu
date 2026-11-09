/* Mengganti GANTI-DOMAIN.com di wrangler.jsonc dengan domain Anda.
   Contoh:  node scripts/set-domain.mjs wahyucatering.com
   Untuk subdomain tanpa www:  node scripts/set-domain.mjs catering.namadomain.com --no-www */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const domain = (process.argv[2] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) { console.error('Pemakaian: node scripts/set-domain.mjs namadomain.com [--no-www]'); process.exit(1); }
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc');
let s = fs.readFileSync(file, 'utf8');
if (!s.includes('GANTI-DOMAIN.com')) { console.error('Placeholder GANTI-DOMAIN.com tidak ditemukan (mungkin sudah diganti). Edit wrangler.jsonc manual bila perlu.'); process.exit(1); }
if (process.argv.includes('--no-www')) s = s.replace(/\n\s*,?\s*\{ "pattern": "www\.GANTI-DOMAIN\.com"[^\n]*\n/, '\n').replace('"custom_domain": true },\n', '"custom_domain": true }\n');
s = s.replace(/GANTI-DOMAIN\.com/g, domain);
fs.writeFileSync(file, s);
console.log('Domain diatur ke: ' + domain + (process.argv.includes('--no-www') ? '' : ' (+ www.' + domain + ')'));
