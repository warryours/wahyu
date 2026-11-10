(function () {
  /* ===== ISI DATA PEMBAYARAN DI SINI ===== */
  var PEMBAYARAN = {
    bank: 'Bank Rakyat Indonesia (BRI)',
    rekening: '499801073287539',
    atasNama: 'Muhammad Wahyu Kusairi'
  };
  var WA_BUKTI = '0895325916029'; /* nomor WhatsApp untuk kirim bukti bayar */
  /* ======================================= */

  /* Isi tetap tiap paket. "cari" = potongan nama paket (huruf kecil, tanpa spasi/simbol). */
  var PAKET_ISI = [
    /* ===== PRASMANAN (menu pilihan pelanggan tampil di pilihan_menu) ===== */
    { cari: ['paket1', 'paket27'], isi: ['Nasi Putih', 'Air Mineral', 'Service'] },
    { cari: ['paket2', 'paket30kpax'], isi: ['Nasi Putih', 'Kerupuk', 'Air Mineral', 'Service'] },
    { cari: ['paket3'], isi: ['Nasi Putih', 'Daging (Sambal Goreng)', 'Air Mineral', 'Service'] },
    { cari: ['paket4'], isi: ['Nasi Putih', 'Kerupuk', 'Air Mineral', 'Service'] },
    { cari: ['paket5'], isi: ['Nasi Putih', 'Kerupuk', 'Air Mineral', 'Service'] },
    { cari: ['paket6', 'kapurung'], isi: ['Nasi Putih', 'Ikan Bakar', 'Paredi Ikan/Ayam', 'Lawa Pakis/Jantung', 'Cobe-Cobe', 'Dange', 'Air Mineral'] },
    { cari: ['paket7', 'bakso'], isi: ['Buras', 'Telur', 'Pentolan', 'Air Mineral'] },
    /* ===== NASI KOTAK ===== */
    { cari: ['18000', '18rb', '18k'], isi: ['Nasi', 'Sayur', 'Ayam', 'Tempe', 'Air Mineral'] },
    { cari: ['20000', '20rb', '20k'], isi: ['Nasi', 'Ayam', 'Sayur', 'Telur', 'Gorengan', 'Air Mineral'] },
    { cari: ['25000', '25rb', '25k'], isi: ['Nasi', 'Pilihan Ayam', 'Sayur', 'Kerupuk', 'Buah/Air Mineral'] },
    { cari: ['28000', '28rb', '28k'], isi: ['Pilihan Utama: Olahan Daging atau Udang', 'Nasi', 'Sayur', 'Gorengan', 'Kerupuk', 'Air Mineral'] },
    { cari: ['30000', '30rb', '30k'], isi: ['Spesial: Isian Kue', 'Nasi', 'Pilihan Daging/Ayam', 'Sayur', 'Kerupuk', 'Buah', 'Air Mineral'] }
  ];
  function isiPaket(nama) {
    var n = String(nama || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var i = 0; i < PAKET_ISI.length; i++)
      for (var j = 0; j < PAKET_ISI[i].cari.length; j++)
        if (n.indexOf(PAKET_ISI[i].cari[j]) >= 0) return PAKET_ISI[i].isi;
    return [];
  }

  var params = new URLSearchParams(location.search), id = parseInt(params.get('id'), 10), type = params.get('type') === 'lunas' ? 'lunas' : 'dp';
  var $ = function (i) { return document.getElementById(i) };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  function rp(n) { return 'Rp' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function terbilang(n) {
    var s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas']; n = Math.floor(n);
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
  function day(d) { return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) }
  function phone(w) { return w.indexOf('62') === 0 ? '0' + w.slice(2) : w }
  var order = null;
  function nominal() {
    var total = order.harga * order.jumlah,
      dp = Math.min(order.dp, total),
      sisa = total - dp;
    return type === 'dp' ? dp : sisa;
  }
  function issue() {
    return fetch('/api/admin/orders/' + id + '/nota', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Gagal membuat nota'); return j }) });
  }
  function isLocal(u) { return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(u) }
  function busy(on) { $('send').disabled = on; $('preview').disabled = on }
  $('preview').addEventListener('click', function () {
    if (!order) return; var w = window.open('', '_blank'); busy(true);
    issue().then(function (n) { if (w) w.location = n.url; else location.href = n.url })
      .catch(function (e) { if (w) w.close(); alert(e.message) }).then(function () { busy(false) });
  });
  $('send').addEventListener('click', function () {
    if (!order) return; var w = window.open('', '_blank'); busy(true);
    issue().then(function (n) {
      if (isLocal(n.url) && !confirm('Link PDF memakai alamat lokal (' + n.url.split('/n/')[0] + ') sehingga TIDAK bisa dibuka pelanggan.\n\nSetelah website di-deploy (atau PUBLIC_URL diisi), link akan bisa dibuka. Tetap lanjut?')) { if (w) w.close(); return }
      var msg = 'Halo Kak ' + order.nama + ', terima kasih telah memesan di Wahyu Catering.\nBerikut ' + (type === 'dp' ? 'invoice pembayaran DP' : 'invoice pelunasan') + ' untuk pesanan ' + order.code + ':\n' + n.url + '\n\nSegera melakukan pembayaran ke ' + PEMBAYARAN.bank + ', No. Rekening ' + PEMBAYARAN.rekening + ' Atas Nama ' + PEMBAYARAN.atasNama + '. Sejumlah ' + rp(nominal()) + '. Terima kasih.';
      var url = 'https://wa.me/' + order.whatsapp + '?text=' + encodeURIComponent(msg);
      if (w) w.location = url; else location.href = url;
    }).catch(function (e) { if (w) w.close(); alert(e.message) }).then(function () { busy(false) });
  });

  if (!id) { $('msg').textContent = 'Nomor pesanan tidak valid.'; return }
  fetch('/api/admin/orders/' + id, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/admin/'; throw 0 }
    if (!r.ok) throw new Error(); return r.json();
  }).then(function (d) {
    var o = order = d.order, total = o.harga * o.jumlah, dp = Math.min(o.dp, total), sisa = total - dp;
    var isDp = type === 'dp', terima = isDp ? dp : sisa;
    var no = (isDp ? 'INV-DP-' : 'INV-LN-') + o.code, today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.title = (isDp ? 'Invoice DP ' : 'Invoice Pelunasan ') + o.code + ' - ' + o.nama;
    var rows = isDp
      ? '<div><span>Total Pesanan</span><b>' + rp(total) + '</b></div><div class="big"><span>DP yang Harus Dibayar</span><span>' + rp(dp) + '</span></div><div><span>Sisa (pelunasan hari H)</span><b>' + rp(sisa) + '</b></div>'
      : '<div><span>Total Pesanan</span><b>' + rp(total) + '</b></div><div><span>DP sudah dibayar</span><b>− ' + rp(dp) + '</b></div><div class="big"><span>Pelunasan yang Harus Dibayar</span><span>' + rp(sisa) + '</span></div>';
    $('nota').innerHTML =
      '<div class="head"><img src="../assets/logo.png" alt=""><div><h1>WAHYU CATERING</h1><p>Cita Rasa Istimewa</p><p>Kompleks Pasar Baru Padang Sappa, Kec. Ponrang, Kab. Luwu</p><p>WA 0895-3259-16029 · IG @cateringwahyu_</p></div></div>' +
      '<div class="title"><h2>' + (isDp ? 'INVOICE PEMBAYARAN DP' : 'INVOICE PELUNASAN') + '</h2><p>No. ' + esc(no) + ' · ' + today + '</p></div>' +
      '<div class="meta"><div><h3>Pemesan</h3><p><b>' + esc(o.nama) + '</b></p><p>' + esc(phone(o.whatsapp)) + '</p><p>' + esc(o.alamat) + '</p></div>' +
      '<div><h3>Acara</h3><p><b>' + esc(o.acara) + '</b></p><p>' + day(o.tanggal_acara) + '</p><p>Pesanan: ' + esc(o.code) + '</p></div></div>' +
      '<table><thead><tr><th>Deskripsi</th><th class="r">Qty</th><th class="r">Harga</th><th class="r">Jumlah</th></tr></thead><tbody><tr><td>' + esc(o.paket_nama) +
      (o.pilihan_menu ? '<span class="menu">' + esc(o.pilihan_menu) + '</span>' : '') +
      (isiPaket(o.paket_nama).length ? '<span class="menu"><b>Sudah termasuk:</b> ' + esc(isiPaket(o.paket_nama).join(', ')) + '</span>' : '') +
      '</td><td class="r">' + o.jumlah + ' porsi</td><td class="r">' + rp(o.harga) + '</td><td class="r">' + rp(total) + '</td></tr></tbody></table>' +
      '<div class="sum">' + rows + '</div>' +
      '<p class="terbilang">Terbilang: ' + esc(terbilang(terima)) + ' rupiah</p>' +
      '<div class="pay"><h3>Informasi Pembayaran</h3><div><span>Bank</span><b>' + esc(PEMBAYARAN.bank) + '</b></div><div><span>No. Rekening</span><b>' + esc(PEMBAYARAN.rekening) + '</b></div><div><span>Atas Nama</span><b>' + esc(PEMBAYARAN.atasNama) + '</b></div></div>' +
      '<p class="note">' + (isDp ? 'DP untuk menyimpan tanggal acara. Pelunasan dilakukan pada hari H.' : 'Mohon lakukan pelunasan sesuai jumlah tagihan di atas. Terima kasih atas kepercayaan Anda.') + '</p>' +
      '<div class="sign"><div><i></i><span>Pemesan</span></div><div><i></i><span>Wahyu Catering</span></div></div>' +
      '<p class="bukti">Catatan: Mohon kirim bukti pembayaran melalui WhatsApp ke <b>' + esc(WA_BUKTI) + '</b></p>' +
      '<p class="thanks">Terima kasih — Cita Rasa Istimewa</p>';
    $('msg').hidden = true; $('nota').hidden = false;
  }).catch(function (e) { if (e !== 0) $('msg').textContent = 'Pesanan tidak ditemukan.' });
})();
