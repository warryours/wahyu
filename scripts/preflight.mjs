/* Pemeriksaan sebelum deploy: memastikan placeholder di wrangler.jsonc sudah diganti. Dijalankan otomatis oleh `npm run deploy`. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const errs = [];
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) errs.push('Node.js ' + process.versions.node + ' terlalu lama. Pasang Node.js 20 atau lebih baru.');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch (e) { errs.push('wrangler.jsonc tidak bisa dibaca: ' + e.message); }
const raw = fs.existsSync(path.join(root, 'wrangler.jsonc')) ? fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8') : '';
if (/GANTI-DOMAIN\.com/.test(raw)) errs.push('Domain belum diatur. Jalankan: node scripts/set-domain.mjs namadomain.com');
const db = (cfg.d1_databases || [])[0];
if (!db || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id || '')) errs.push('database_id D1 belum diisi (hasil dari: npx wrangler d1 create wahyucatering-db --location apac).');
const hosts = (cfg.routes || []).map((r) => r.pattern);
const pub = (cfg.vars || {}).PUBLIC_URL || '';
if (!/^https:\/\/[a-z0-9.-]+$/i.test(pub)) errs.push('PUBLIC_URL harus berbentuk https://namadomain.com (tanpa garis miring di akhir).');
else if (hosts.length && !hosts.includes(pub.replace('https://', ''))) errs.push('PUBLIC_URL (' + pub + ') tidak sama dengan domain di "routes" (' + hosts.join(', ') + ').');
if (errs.length) { console.error('\nBELUM SIAP DEPLOY:\n' + errs.map((e) => ' - ' + e).join('\n') + '\n'); process.exit(1); }
console.log('Pemeriksaan sebelum deploy: OK (' + hosts.join(', ') + ')');
