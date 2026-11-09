(function () {
  var $ = function (id) { return document.getElementById(id) };
  var STATUS = { baru: 'Baru', dikonfirmasi: 'Dikonfirmasi', dp_dibayar: 'DP dibayar', selesai: 'Selesai', batal: 'Batal' };
  var filter = '', term = '', timer, orders = [];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  function rp(n) { return 'Rp' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function api(path, opt) {
    opt = opt || {}; opt.credentials = 'same-origin';
    if (opt.body && typeof opt.body !== 'string') { opt.body = JSON.stringify(opt.body); opt.headers = { 'Content-Type': 'application/json' } }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) {
        if (r.status === 401 && path.indexOf('login') < 0) { showLogin(); throw new Error('login') }
        if (!r.ok) throw new Error(j.error || 'Gagal');
        return j;
      });
    });
  }
  function toast(t) { var e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.appendChild(e); setTimeout(function () { e.remove() }, 2200) }
  function showLogin() { clearInterval(timer); $('app').hidden = true; $('login').hidden = false; $('pw').focus() }
  function showApp() { $('login').hidden = true; $('app').hidden = false; load(); clearInterval(timer); timer = setInterval(function () { if (!document.querySelector('.order[open]')) load() }, 30000) }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault(); $('login-err').textContent = '';
    api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } })
      .then(function () { $('pw').value = ''; showApp() })
      .catch(function (x) { $('login-err').textContent = x.message });
  });
  $('logout').addEventListener('click', function () { api('/api/admin/logout', { method: 'POST' }).then(showLogin) });

  function qs() { var p = []; if (filter) p.push('status=' + encodeURIComponent(filter)); if (term) p.push('q=' + encodeURIComponent(term)); return p.length ? '?' + p.join('&') : '' }
  function load() {
    api('/api/admin/orders' + qs()).then(function (d) { orders = d.orders; renderStats(d.counts); renderOrders() }).catch(function () { });
    $('csv').href = '/api/admin/export.csv' + qs();
  }
  function renderStats(c) {
    var total = 0; Object.keys(c).forEach(function (k) { total += c[k] });
    $('stats').innerHTML = '<div class="stat"><small>Semua</small><b>' + total + '</b></div>' +
      Object.keys(STATUS).map(function (k) { return '<div class="stat"><small>' + STATUS[k] + '</small><b>' + (c[k] || 0) + '</b></div>' }).join('');
    $('tabs').innerHTML = [['', 'Semua']].concat(Object.keys(STATUS).map(function (k) { return [k, STATUS[k]] })).map(function (t) {
      return '<button type="button" class="tab" data-s="' + t[0] + '" aria-pressed="' + (filter === t[0]) + '">' + t[1] + '</button>';
    }).join('');
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (!b) return; filter = b.getAttribute('data-s'); load() });
  var st; $('search').addEventListener('input', function (e) { clearTimeout(st); st = setTimeout(function () { term = e.target.value.trim(); load() }, 300) });

  function fmtDate(iso) { return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  function fmtDay(d) { return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }
  function waLink(o) {
    var t = 'Halo ' + o.nama + ', kami dari Wahyu Catering. Terima kasih sudah memesan (' + o.code + '): ' + o.paket_nama + ', ' + o.jumlah + ' porsi untuk ' + fmtDay(o.tanggal_acara) + '. ';
    return 'https://wa.me/' + o.whatsapp + '?text=' + encodeURIComponent(t);
  }
  function renderOrders() {
    $('empty').hidden = orders.length > 0;
    $('orders').innerHTML = orders.map(function (o) {
      return '<details class="order" data-id="' + o.id + '"><summary><div class="row"><span class="code">' + esc(o.code) + ' · ' + esc(o.nama) + '</span><span class="pill ' + o.status + '">' + STATUS[o.status] + '</span></div>' +
        '<div class="sub">' + esc(o.acara) + ' · ' + esc(fmtDay(o.tanggal_acara)) + '</div>' +
        '<div class="sub">' + esc(o.paket_nama) + ' × ' + o.jumlah + ' = <b>' + rp(o.harga * o.jumlah) + '</b></div></summary>' +
        '<div class="detail"><dl class="dl"><dt>Masuk</dt><dd>' + esc(fmtDate(o.created_at)) + '</dd><dt>WhatsApp</dt><dd>' + esc(o.whatsapp) + '</dd><dt>Alamat</dt><dd>' + esc(o.alamat) + '</dd>' +
        '<dt>Harga</dt><dd>' + rp(o.harga) + ' / porsi</dd><dt>Total</dt><dd><b>' + rp(o.harga * o.jumlah) + '</b> · DP ' + rp(o.dp) + ' · Sisa <b>' + rp(o.harga * o.jumlah - o.dp) + '</b></dd>' +
        (o.pilihan_menu ? '<dt>Pilihan menu</dt><dd style="white-space:pre-line">' + esc(o.pilihan_menu) + '</dd>' : '') +
        (o.catatan ? '<dt>Catatan</dt><dd>' + esc(o.catatan) + '</dd>' : '') + '</dl>' +
        '<div class="edit"><label>Status<select data-f="status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === o.status ? ' selected' : '') + '>' + STATUS[k] + '</option>' }).join('') + '</select></label>' +
        '<label>Nominal DP (Rp)<input type="number" min="0" step="1000" data-f="dp" value="' + o.dp + '"></label><label>Catatan admin<textarea data-f="note" maxlength="500">' + esc(o.catatan_admin) + '</textarea></label></div>' +
        '<div class="acts"><button class="btn sm" data-save="' + o.id + '">Simpan</button><button class="btn sm ghost" data-nota="dp" data-id="' + o.id + '">Invoice DP</button><button class="btn sm ghost" data-nota="lunas" data-id="' + o.id + '">Invoice Pelunasan</button><a class="btn sm wa" href="' + esc(waLink(o)) + '" target="_blank" rel="noopener">Chat pelanggan</a><button class="btn sm danger" data-del="' + o.id + '">Hapus</button></div></div></details>';
    }).join('');
  }
  function saveOrder(id, box) {
    return api('/api/admin/orders/' + id, { method: 'PATCH', body: { status: box.querySelector('[data-f=status]').value, catatan_admin: box.querySelector('[data-f=note]').value, dp: parseInt(box.querySelector('[data-f=dp]').value, 10) } });
  }
  $('orders').addEventListener('click', function (e) {
    var s = e.target.closest('[data-save]'), d = e.target.closest('[data-del]'), n = e.target.closest('[data-nota]');
    if (s) { saveOrder(s.getAttribute('data-save'), s.closest('.order')).then(function () { toast('Tersimpan'); load() }).catch(function (x) { toast(x.message) }) }
    if (n) {
      /* simpan dulu (agar nominal DP terbaru dipakai), lalu buka nota di tab baru */
      var w = window.open('', '_blank'), url = '/admin/nota.html?id=' + n.getAttribute('data-id') + '&type=' + n.getAttribute('data-nota');
      saveOrder(n.getAttribute('data-id'), n.closest('.order')).then(function () { if (w) w.location = url; else location.href = url; load() })
        .catch(function (x) { if (w) w.close(); toast(x.message) });
    }
    if (d && confirm('Hapus pesanan ini secara permanen?')) {
      api('/api/admin/orders/' + d.getAttribute('data-del'), { method: 'DELETE' }).then(function () { toast('Dihapus'); load() }).catch(function (x) { toast(x.message) });
    }
  });

  api('/api/admin/orders?status=__cek').then(showApp).catch(function (x) { if (x.message !== 'login') showLogin() });
})();
