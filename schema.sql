-- Skema database D1 Wahyu Catering. Aman dijalankan berulang (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  nama TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  alamat TEXT NOT NULL,
  acara TEXT NOT NULL,
  paket_id TEXT NOT NULL,
  paket_nama TEXT NOT NULL,
  harga INTEGER NOT NULL,
  jumlah INTEGER NOT NULL,
  tanggal_acara TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'baru',
  catatan_admin TEXT NOT NULL DEFAULT '',
  pilihan_menu TEXT NOT NULL DEFAULT '',
  dp INTEGER NOT NULL DEFAULT 1000000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notas_order ON notas(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
-- pembatas laju (anti spam pesanan & brute-force login)
CREATE TABLE IF NOT EXISTS rate_hits (
  k TEXT NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_k ON rate_hits(k, t);
