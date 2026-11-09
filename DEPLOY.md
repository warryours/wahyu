# Deploy Wahyu Catering ke Cloudflare Workers

Website (halaman, gambar, admin) dilayani dari **Workers Static Assets**, API pesanan + nota PDF berjalan di **Worker**, database pesanan di **Cloudflare D1**.

## Prasyarat
1. Akun Cloudflare (gratis cukup).
2. Domain Anda sudah **Active** di Cloudflare (Dashboard → Add a site → ganti nameserver di tempat beli domain → tunggu status Active).
3. Node.js 20 atau lebih baru (disarankan 22 LTS) → https://nodejs.org

## Langkah deploy (sekali saja)

Buka terminal di folder project ini, lalu:

```bash
# 1. Pasang wrangler (CLI Cloudflare)
npm install

# 2. Pasang domain Anda ke konfigurasi (otomatis mengisi wrangler.jsonc)
node scripts/set-domain.mjs namadomain.com
#    subdomain tanpa www:  node scripts/set-domain.mjs catering.namadomain.com --no-www

# 3. Login ke Cloudflare (membuka browser)
npx wrangler login

# 4. Buat database D1
npx wrangler d1 create wahyucatering-db --location apac
```
Perintah ke-4 menampilkan `database_id`. Jika ditanya *"Would you like Wrangler to add it to your config?"* jawab **No**, lalu salin `database_id` itu ke `wrangler.jsonc` (menggantikan `GANTI-DENGAN-DATABASE-ID`).

```bash
# 5. Buat tabel di database
npm run db:init

# 6. Atur password admin & kunci sesi (disimpan terenkripsi di Cloudflare, bukan di file)
npx wrangler secret put ADMIN_PASSWORD     # ketik password admin BARU, minimal 8 karakter
npx wrangler secret put SESSION_SECRET     # tempel string acak, lihat perintah di bawah
#    Jika ditanya "create a new Worker?" jawab Y.

# 7. Deploy (otomatis menjalankan pemeriksaan placeholder dulu)
npm run deploy
```

Membuat `SESSION_SECRET` acak:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Selesai. Buka `https://namadomain.com` dan `https://namadomain.com/admin/`.
Sertifikat HTTPS dibuat otomatis; jika baru aktif bisa butuh beberapa menit.

## Checklist setelah deploy
- [ ] Jalankan `npm run smoke -- https://namadomain.com` (pemeriksaan keamanan otomatis di server asli, aman dijalankan kapan saja)
- [ ] Halaman utama dan foto menu tampil
- [ ] Kirim pesanan uji lewat form → muncul kode `WC-0001`
- [ ] Login `/admin/` → pesanan tampil → buat Invoice DP → link PDF terbuka dan alamatnya `https://namadomain.com/n/...`
- [ ] Hapus pesanan uji dari admin

## Mengubah isi website
Edit file di `public/` (mis. `public/data/packages.json`, `catalog.json`, `reviews.json`, foto di `public/assets/menu/`), lalu:
```bash
npm run deploy
```
`packages.json` juga dipakai server untuk validasi harga, jadi perubahan harga/paket baru aktif setelah deploy.

Jika logo `public/assets/logo.png` diganti: jalankan `npm run build:logo` sebelum deploy (logo di nota PDF dibuat ulang dari file ini).

## Menjalankan di komputer sendiri (opsional)
```bash
cp .dev.vars.example .dev.vars     # isi password uji
npm run db:init:local
npm run dev                        # http://localhost:8787
```

## Backup data pesanan
```bash
npx wrangler d1 export wahyucatering-db --remote --output=backup.sql
```
Admin juga punya tombol Export CSV. D1 menyimpan riwayat 30 hari (Time Travel) untuk pemulihan.

## Troubleshooting
| Gejala | Penyebab / solusi |
|---|---|
| `BELUM SIAP DEPLOY: ...` | Pemeriksaan otomatis menemukan domain / `database_id` / `PUBLIC_URL` yang belum diisi. Ikuti pesan yang tampil. |
| `Hostname ... already has externally managed DNS records` saat deploy | Ada record DNS lama (mis. A/CNAME untuk domain atau `www`). Hapus record itu di Cloudflare → DNS, lalu deploy ulang. |
| Domain belum bisa dibuka setelah deploy | Tunggu 2–5 menit (sertifikat). Pastikan domain berstatus Active di Cloudflare. |
| Login admin: "Server belum dikonfigurasi" | Secret belum diatur → ulangi langkah 6, lalu `npm run deploy`. |
| Error `database_id` / `D1_ERROR no such table` | `database_id` belum diisi, atau lupa `npm run db:init` (langkah 5). |
| Link nota memakai alamat `*.workers.dev` | `PUBLIC_URL` di `wrangler.jsonc` belum berisi domain Anda. |

## Pengujian & keamanan

| Perintah | Isi |
|---|---|
| `npm test` | Tes fungsional + keamanan API + konfigurasi (butuh Node 22.5+). Menguji autentikasi & sesi, rate limit, injeksi SQL, mass-assignment, CSRF/Origin, CSV injection, injeksi PDF, kebocoran informasi, header, dan kebersihan paket (tanpa rahasia). |
| `npm run test:browser` | Tes di Chromium sungguhan: XSS di panel admin & nota, CSP, CSRF lintas situs, alur form pelanggan, pemuatan semua halaman. Butuh `npm i -D playwright` lalu `npx playwright install chromium`. |
| `WC_MUTATE=1 npm run test:browser` | Kontrol negatif: sengaja mematikan `esc()` dan CSP; tes **harus** mendeteksi XSS (membuktikan tes ini bermakna). |
| `npm run smoke -- https://namadomain.com` | Pemeriksaan keamanan ringan terhadap situs yang sudah live. |

Jalankan `npm test` setiap selesai mengubah `src/worker.js`.

### Yang tidak bisa diuji otomatis (lakukan di dashboard Cloudflare)
1. **SSL/TLS → Edge Certificates → Always Use HTTPS: ON** (smoke test akan memberi tahu jika belum).
2. **Security → WAF → Rate limiting rules**: buat 1 aturan (paket gratis cukup) untuk `/api/orders` dan `/api/admin/login`, mis. 20 permintaan/10 detik/IP → Block. Pembatas di aplikasi melindungi per IP, aturan ini melindungi dari banjir permintaan (yang juga bisa menghabiskan kuota tulis D1 harian).
3. **Security → Bots → Bot Fight Mode: ON**.
4. Aktifkan **verifikasi 2 langkah (2FA)** di akun Cloudflare Anda, dan jangan membagikan API token.
5. Gunakan **password admin panjang** (disarankan 14+ karakter, acak). Satu password adalah satu-satunya penjaga panel admin.

### Batasan yang perlu diketahui
- **Sesi admin tanpa-state**: "Keluar" menghapus cookie di browser, tetapi cookie yang sudah dicuri tetap berlaku sampai kedaluwarsa (maks 12 jam). Untuk mencabut semua sesi sekaligus, ganti `SESSION_SECRET` (`npx wrangler secret put SESSION_SECRET`).
- **Rate limit per IP**: tidak menghentikan serangan terdistribusi; itu sebabnya password harus kuat dan aturan WAF di atas dianjurkan.
- **Tanpa 2FA untuk panel admin.** Opsi tambahan (gratis sampai 50 pengguna): lindungi `/admin/*` dan `/api/admin/*` dengan **Cloudflare Access** (Zero Trust) sehingga login lewat email/Google lebih dulu.
- **Nota PDF** bisa dibuka siapa saja yang memegang link (token acak 192-bit, tidak bisa ditebak). Perlakukan link seperti dokumen pribadi pelanggan.
- Dependensi aplikasi nol; satu-satunya paket adalah `wrangler` (alat deploy). Jalankan `npm audit` berkala di komputer Anda.

## Catatan teknis
- Jam "hari ini" untuk validasi tanggal acara memakai WITA (UTC+8); ubah `TZ_OFFSET_HOURS` di `src/worker.js` bila perlu.
- Pembatas laju (maks 8 pesanan/10 menit/IP, 5 login/15 menit/IP) kini disimpan di D1.
- Permintaan pengubah data (`POST/PATCH/DELETE`) dari origin lain ditolak (403), selain cookie `SameSite=Strict` dan kewajiban `Content-Type: application/json`. Sesi admin maksimal 12 jam.
- Halaman `/admin/*` memakai Content-Security-Policy ketat (script hanya dari situs sendiri) sebagai lapis kedua melawan XSS.
- Ingin mematikan alamat `wahyucatering.<akun>.workers.dev`? Tambahkan `"workers_dev": false` di `wrangler.jsonc`.
