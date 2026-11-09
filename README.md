# Wahyu Catering (versi Cloudflare Workers)

Website + form pesanan + admin + nota PDF, berjalan di Cloudflare Workers dengan database D1.
**Cara deploy: lihat [DEPLOY.md](DEPLOY.md).**

## Struktur
- `public/`            website statis, halaman `/admin/`, gambar, data JSON (`packages.json`, `catalog.json`, `reviews.json`)
- `src/worker.js`      API pesanan, admin, nota PDF (menggantikan `server.js` lama)
- `src/pdf-nota.js`    pembuat PDF nota; data rekening ada di bagian atas file (samakan dengan `public/admin/nota.js`)
- `src/logo-data.js`   logo untuk PDF (dihasilkan `npm run build:logo`)
- `schema.sql`         skema database D1
- `wrangler.jsonc`     konfigurasi Cloudflare (domain, database, routing)

## Pengujian
`npm test` (tes fungsional, keamanan, konfigurasi), `npm run test:browser` (Chromium, opsional), `npm run smoke -- https://domain` (setelah deploy). Detail di [DEPLOY.md](DEPLOY.md#pengujian--keamanan).
