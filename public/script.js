/* Wahyu Catering — gabungan v1 (layout) + v2 (paket, form pesanan, nota) */
(function () {
  var WA = '62895325916029';
  var ROOT = document.body.getAttribute('data-root') || '';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
  function rp(n) { return 'Rp' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
  function getJSON(path) { return fetch(ROOT + path).then(function (r) { if (!r.ok) throw new Error(path); return r.json() }) }

  /* ===== Menu navigasi (mobile) ===== */
  (function () {
    var h = document.querySelector('header'), b = h && h.querySelector('.menu-btn');
    if (!h || !b) return;
    function set(o) { h.classList.toggle('open', o); b.setAttribute('aria-expanded', o); b.setAttribute('aria-label', o ? 'Tutup menu' : 'Buka menu') }
    b.addEventListener('click', function () { set(!h.classList.contains('open')) });
    h.querySelectorAll('#menu a').forEach(function (a) { a.addEventListener('click', function () { set(false) }) });
    document.addEventListener('click', function (e) { if (!h.contains(e.target)) set(false) });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false) });
  })();
  var yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();

  /* ===== Data paket (sumber yang sama dengan server: data/packages.json) ===== */
  var PRASMANAN = [], NASIKOTAK = [], ALL = [], MENU = [], BONUS = [];
  var curCat = 'prasmanan';

  function menuOf(it) { return it.menu ? (MENU.filter(function (x) { return x.key === it.menu })[0] || null) : null }
  function groupsOf(it) { var m = menuOf(it); return m && m.groups ? m.groups : null }
  function optsOf(it) {
    if (it.options) return it.options;
    var m = menuOf(it); return m ? m.options : null;
  }
  function itemDesc(it) {
    if (it.note) return it.note;
    var o = optsOf(it);
    var g = groupsOf(it);
    if (g) return 'Pilih ' + g.map(function (x) { return x.label }).join(' atau ');
    return o ? 'Pilih: ' + o.join(' / ') : '';
  }

  function renderPackages() {
    var data = curCat === 'nasikotak' ? NASIKOTAK : PRASMANAN;
    document.querySelectorAll('[data-packages]').forEach(function (el) {
      var compact = el.getAttribute('data-packages') === 'compact';
      el.innerHTML = data.map(function (p) {
        var best = p.badge === 'Menu khas';
        var ul = '<ul>' + p.items.map(function (i) {
          var d = itemDesc(i);
          return '<li><b>' + esc(i.name) + '</b>' + (d ? '<span class="opt">' + esc(d) + '</span>' : '') + '</li>';
        }).join('') + '</ul>';
        var body = compact ? '<details><summary>Lihat isi paket</summary>' + ul + '</details>' : ul;
        return '<div class="pkg' + (best ? ' best' : '') + '">' +
          (p.badge ? '<span class="badge">' + esc(p.badge) + '</span>' : '') +
          '<h3>' + esc(p.name) + '</h3>' + (p.tag ? '<div class="tag-line">' + esc(p.tag) + '</div>' : '') +
          '<div class="price"><b>' + rp(p.price) + '</b><span>per porsi</span></div>' + body +
          '<button type="button" class="btn ' + (best ? 'btn-gold' : 'btn-out') + '" data-order data-package="' + esc(p.id) + '">Pesan Paket Ini</button></div>';
      }).join('');
      var sec = el.closest('section');
      if (sec) sec.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-cat') === curCat) });
    });
  }
  function renderTerms() {
    document.querySelectorAll('[data-terms]').forEach(function (el) {
      el.innerHTML = '<div class="terms"><h3>Ketentuan Pemesanan</h3><div class="terms-grid">' +
        '<div><small>Minimal order</small><b>100 porsi</b></div>' +
        '<div><small>DP simpan tanggal</small><b>Rp1.000.000</b></div>' +
        '<div><small>Pelunasan</small><b>Di hari H</b></div></div>' +
        '<button type="button" class="link-btn" data-bonus>Lihat bonus pemesanan</button></div>';
    });
  }
  document.querySelectorAll('.chips .chip').forEach(function (c) {
    c.addEventListener('click', function () { curCat = c.getAttribute('data-cat'); renderPackages() });
  });

  /* ===== Modal ===== */
  var modal, box, lastFocus;
  function ensure() {
    if (modal) return;
    modal = document.createElement('div'); modal.className = 'modal'; modal.hidden = true;
    modal.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true"><button type="button" class="modal-x" aria-label="Tutup">&times;</button><div class="body"></div></div>';
    document.body.appendChild(modal);
    box = modal.querySelector('.body');
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal() });
    modal.querySelector('.modal-x').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal() });
  }
  function show(html) {
    ensure(); if (modal.hidden) lastFocus = document.activeElement;
    box.innerHTML = html; modal.hidden = false; document.body.classList.add('modal-open');
    modal.querySelector('.modal-box').scrollTop = 0;
  }
  function closeModal() {
    modal.hidden = true; document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ===== Pilihan menu di dalam paket ===== */
  var sel = {}, selPkg = '';
  function resetSel(id) { if (selPkg !== id) { sel = {}; selPkg = id } }
  function optionsHtml(list, cur) {
    return '<option value="">Ketuk &amp; pilih</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>' }).join('');
  }
  function chipsHtml(it) {
    var o = optsOf(it); if (!o) return '';
    var cur = (sel[it.name] || [])[0] || '', g = groupsOf(it), nm = esc(it.name);
    if (!g) return '<select class="opt-select" data-item="' + nm + '" aria-label="Pilih ' + nm + '">' + optionsHtml(o, cur) + '</select>';
    var gi = -1; g.forEach(function (x, k) { if (x.options.indexOf(cur) > -1) gi = k });
    return '<select class="opt-select opt-group" data-item="' + nm + '" aria-label="Pilih jenis ' + nm + '"><option value="">Pilih ' + esc(g.map(function (x) { return x.label }).join(' atau ')) + '</option>' +
      g.map(function (x, k) { return '<option value="' + k + '"' + (k === gi ? ' selected' : '') + '>' + esc(x.label) + '</option>' }).join('') + '</select>' +
      '<select class="opt-select" data-item="' + nm + '" aria-label="Pilih nama masakan ' + nm + '"' + (gi < 0 ? ' disabled' : '') + '>' + optionsHtml(gi < 0 ? [] : g[gi].options, cur) + '</select>';
  }
  function hasChoices(p) { return p.items.some(function (i) { return !!optsOf(i) }) }
  function pickerHtml(p) {
    if (!hasChoices(p)) return '';
    return '<p class="sub">*Pilih satu menu per item (boleh dikosongkan dan dibahas lewat WhatsApp). Untuk item Telur / Udang atau Daging, pilih jenisnya dulu.</p>' +
      p.items.filter(function (i) { return optsOf(i) }).map(function (i) { return '<div class="mgroup"><h3>' + esc(i.name) + '</h3>' + chipsHtml(i) + '</div>' }).join('');
  }
  function pilihanOut(p) {
    var out = {}; p.items.forEach(function (i) { if (sel[i.name] && sel[i.name].length && optsOf(i)) out[i.name] = sel[i.name] }); return out;
  }
  function pilihanText(p) {
    var o = pilihanOut(p); return Object.keys(o).map(function (k) { return k + ': ' + o[k].join(', ') });
  }
  function setOpt(el) { var v = el.value; sel[el.getAttribute('data-item')] = v ? [v] : [] }

  function showBonus() {
    show('<h2>Bonus &amp; Ketentuan</h2><p class="sub">Berlaku untuk pemesanan di Luwu Raya dan Tanah Toraja.</p>' +
      '<div class="kv"><div><small>Minimal order</small><b>100 porsi</b></div><div><small>DP simpan tanggal</small><b>Rp1.000.000</b></div></div>' +
      '<p class="sub">DP untuk simpan tanggal; pelunasan di hari H.</p><ul class="bonus-list">' +
      BONUS.map(function (b) { return '<li>' + esc(b) + '</li>' }).join('') + '</ul>' +
      '<button type="button" class="btn btn-gold" data-order>Pesan Sekarang</button>');
  }

  /* ===== Form pemesanan (disimpan ke server, lalu lanjut ke WhatsApp) ===== */
  function done(d, p, code) {
    var tgl = new Date(d.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    var t = ['Halo Wahyu Catering, saya ingin memesan.', 'No. Pesanan: ' + code, '', 'Nama: ' + d.nama, 'WhatsApp: ' + d.whatsapp, 'Alamat: ' + d.alamat,
      'Jenis acara: ' + d.acara, 'Paket: ' + p.name + (p.tag ? ' (' + p.tag + ')' : '') + ' - ' + rp(p.price) + ' per porsi',
      'Jumlah pesanan: ' + d.jumlah + ' porsi', 'Tanggal acara: ' + tgl];
    var pt = pilihanText(p); if (pt.length) { t.push('Pilihan menu:'); pt.forEach(function (x) { t.push('- ' + x) }) }
    if (d.catatan) t.push('Catatan: ' + d.catatan);
    var url = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(t.join('\n'));
    show('<h2>Pesanan Tersimpan</h2><p class="sub">Nomor pesanan Anda:</p><div class="pp">' + esc(code) + '</div>' +
      '<p class="sub">Satu langkah lagi: kirim detail pesanan ke WhatsApp kami agar segera kami konfirmasi.</p>' +
      '<a class="btn btn-gold" href="' + url + '" target="_blank" rel="noopener">Lanjut ke WhatsApp</a>');
  }

  var EVENT_MAP = { Pernikahan: 'Pengantin' };
  function showForm(pkg) {
    if (!ALL.length) { window.open('https://wa.me/' + WA, '_blank', 'noopener'); return }
    function opts(arr) { return arr.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' - ' + rp(p.price) + '</option>' }).join('') }
    show('<h2>Form Pemesanan</h2><p class="sub">Isi data berikut, lalu kirim ke WhatsApp kami.</p><form novalidate>' +
      '<div class="field"><label for="of-nama">Nama</label><input id="of-nama" name="nama" type="text" autocomplete="name" required></div>' +
      '<div class="field"><label for="of-wa">Nomor WhatsApp</label><input id="of-wa" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx" required></div>' +
      '<div class="field"><label for="of-alamat">Alamat</label><textarea id="of-alamat" name="alamat" autocomplete="street-address" required></textarea></div>' +
      '<div class="field"><label for="of-acara">Jenis acara</label><select id="of-acara" name="acara" required><option value="">Pilih acara</option><option>Pengantin</option><option>Aqiqah</option><option>Syukuran</option><option>Arisan</option><option>Ulang Tahun</option><option>Acara Kantor</option><option>Lainnya</option></select></div>' +
      '<div class="field"><label for="of-paket">Paket yang dipilih</label><select id="of-paket" name="paket" required><option value="">Pilih paket</option><optgroup label="Prasmanan">' + opts(PRASMANAN) + '</optgroup><optgroup label="Nasi Kotak">' + opts(NASIKOTAK) + '</optgroup></select></div>' +
      '<div id="of-pick"></div>' +
      '<div class="field"><label for="of-jumlah">Jumlah pesanan (porsi, min. 100)</label><input id="of-jumlah" name="jumlah" type="number" inputmode="numeric" min="100" step="1" placeholder="Contoh: 100" required></div>' +
      '<div class="field"><label for="of-tanggal">Tanggal acara</label><div class="date-wrap"><input id="of-tanggal" name="tanggal" type="date" required><span class="ph">Pilih tanggal</span><svg class="cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></div></div>' +
      '<div class="field"><label for="of-catatan">Catatan (opsional)</label><textarea id="of-catatan" name="catatan" maxlength="300" placeholder="Contoh: menu pilihan, jam antar"></textarea></div>' +
      '<button type="submit" class="btn btn-gold">Kirim Pesanan</button>' +
      '<p class="modal-note">Pesanan disimpan, lalu Anda lanjutkan ke WhatsApp kami. DP Rp1.000.000 untuk simpan tanggal, pelunasan di hari H.</p></form>');
    var form = box.querySelector('form'), dw = box.querySelector('.date-wrap'), di = form.elements.tanggal;
    var n = new Date(), pad = function (x) { return ('0' + x).slice(-2) };
    di.min = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    form.elements.paket.value = pkg || '';
    var ev = document.body.getAttribute('data-event');
    if (ev) form.elements.acara.value = EVENT_MAP[ev] || ev;
    var pick = box.querySelector('#of-pick');
    function drawPick() {
      var id = form.elements.paket.value, p = ALL.filter(function (x) { return x.id === id })[0];
      if (!p) { pick.innerHTML = ''; return }
      resetSel(id); pick.innerHTML = pickerHtml(p);
    }
    form.elements.paket.addEventListener('change', drawPick); drawPick();
    function sync() { dw.classList.toggle('has-value', !!di.value) }
    di.addEventListener('input', sync); di.addEventListener('change', sync);
    di.addEventListener('click', function () { try { if (di.showPicker) di.showPicker() } catch (x) { } });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return }
      var f = form.elements, p = ALL.filter(function (x) { return x.id === f.paket.value })[0];
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Menyimpan...';
      var data = {
        nama: f.nama.value.trim(), whatsapp: f.whatsapp.value.trim(), alamat: f.alamat.value.trim(), acara: f.acara.value,
        paket: p.id, jumlah: parseInt(f.jumlah.value, 10), tanggal: f.tanggal.value, catatan: f.catatan.value.trim(), pilihan: pilihanOut(p)
      };
      fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (res) {
          if (!res.ok) { btn.disabled = false; btn.textContent = 'Kirim Pesanan'; alert(res.j.error || 'Pesanan gagal disimpan, coba lagi.'); return }
          done(data, p, res.j.code);
        })
        .catch(function () { btn.disabled = false; btn.textContent = 'Kirim Pesanan'; alert('Koneksi bermasalah. Coba lagi sebentar lagi.') });
    });
    var nama = form.elements.nama;

    // Perbaiki kursor yang bergeser di Safari iPhone
    nama.addEventListener('focus', function () {
      nama.style.transform = 'translateZ(0)';
      requestAnimationFrame(function () { nama.style.transform = ''; });
    });

    // Fokus otomatis hanya di desktop
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      setTimeout(function () { nama.focus() }, 50);
    }
  }

  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.classList || !t.classList.contains('opt-select')) return;
    if (t.classList.contains('opt-group')) {
      var name = t.getAttribute('data-item'), p = ALL.filter(function (x) { return x.id === selPkg })[0];
      var it = p && p.items.filter(function (i) { return i.name === name })[0], g = it && groupsOf(it);
      var second = t.nextElementSibling; sel[name] = [];
      if (g && t.value !== '') { second.innerHTML = optionsHtml(g[+t.value].options, ''); second.disabled = false }
      else { second.innerHTML = optionsHtml([], ''); second.disabled = true }
      return;
    }
    setOpt(t);
  });
  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-order]'))) { e.preventDefault(); showForm(t.getAttribute('data-package') || ''); return }
    if (e.target.closest('[data-bonus]')) { showBonus(); return }
  });

  var hasPk = document.querySelector('[data-packages]');
  if (hasPk) {
    getJSON('data/packages.json').then(function (d) {
      PRASMANAN = d.prasmanan; NASIKOTAK = d.nasikotak; MENU = d.menu; BONUS = d.bonus;
      ALL = PRASMANAN.concat(NASIKOTAK);
      renderPackages(); renderTerms();
    }).catch(function () {
      document.querySelectorAll('[data-packages]').forEach(function (el) {
        el.innerHTML = '<p class="price-note">Daftar paket gagal dimuat. Muat ulang halaman atau hubungi kami lewat WhatsApp.</p>';
      });
    });
  }

  /* ===== Katalog menu bergambar ===== */
  var catTabs = document.getElementById('cat-tabs'), catGrid = document.getElementById('cat-grid');
  if (catTabs && catGrid) {
    getJSON('data/catalog.json').then(function (d) {
      var cats = d.categories, cur = cats[0].id;
      function draw() {
        catTabs.innerHTML = cats.map(function (c) {
          return '<button type="button" class="chip" data-id="' + esc(c.id) + '" aria-pressed="' + (c.id === cur) + '">' + esc(c.name.replace(/^Aneka /, '')) + '</button>';
        }).join('');
        var c = cats.filter(function (x) { return x.id === cur })[0];
        catGrid.innerHTML = c.items.map(function (i) {
          return '<article class="cat-card"><div class="cat-img"><span aria-hidden="true">' + esc(i.name.charAt(0)) + '</span>' +
            '<img src="' + esc(ROOT + i.image) + '" alt="' + esc(i.name) + '" loading="lazy" onerror="this.remove()"></div>' +
            '<h3>' + esc(i.name) + '</h3></article>';
        }).join('');
      }
      catTabs.addEventListener('click', function (e) {
        var b = e.target.closest('.chip'); if (!b) return;
        cur = b.getAttribute('data-id'); draw();
        var on = catTabs.querySelector('[aria-pressed="true"]');
        if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
      });
      draw();
    }).catch(function () { catGrid.innerHTML = '<p class="price-note">Katalog gagal dimuat.</p>'; });
  }

  /* ===== Slider ulasan ala Google Maps ===== */
  var rv = document.getElementById('rv');
  if (rv) {
    var track = document.getElementById('rv-track'), dots = document.getElementById('rv-dots');
    var prev = rv.querySelector('.rv-prev'), next = rv.querySelector('.rv-next');
    var COLORS = ['#c5221f', '#188038', '#1a73e8', '#a142f4', '#e8710a', '#00796b', '#b31412'];
    var G = '<svg class="rv-g" viewBox="0 0 48 48" aria-label="Google"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
    var STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5L9 8.9z"/></svg>';
    function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length] }
    function cleanName(n) { return n.replace(/^Contoh:\s*/, '') }
    function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? STAR : STAR.replace('<svg', '<svg class="off"'); return '<span class="rv-stars" role="img" aria-label="' + n + ' dari 5 bintang">' + s + '</span>' }

    getJSON('data/reviews.json').then(function (d) {
      var link = document.getElementById('rv-link');
      if (link && d.mapsUrl) link.href = d.mapsUrl;
      var list = (d.reviews || []).slice(0, 5);
      if (!list.length) return;
      track.innerHTML = list.map(function (r) {
        var nm = r.name || '';
        return '<article class="rv-card"><div class="rv-head">' +
          '<span class="rv-av" style="background:' + hue(nm) + '" aria-hidden="true">' + esc(cleanName(nm).charAt(0).toUpperCase()) + '</span>' +
          '<div class="rv-who"><b>' + esc(nm) + '</b><small>' + esc(r.info || '') + '</small></div>' + G + '</div>' +
          '<div class="rv-meta">' + stars(r.stars || 5) + '<span>' + esc(r.time || '') + '</span></div>' +
          '<p class="rv-text">' + esc(r.text || '') + '</p>' +
          ((r.text || '').length > 150 ? '<button type="button" class="rv-expand">Selengkapnya</button>' : '') + '</article>';
      }).join('');
      dots.innerHTML = list.map(function () { return '<i></i>' }).join('');
      rv.hidden = false;
      var cards = track.children;
      function step() { return cards[0].getBoundingClientRect().width + 16 }
      function upd() {
        var i = Math.round(track.scrollLeft / step());
        for (var k = 0; k < dots.children.length; k++) dots.children[k].classList.toggle('on', k === i);
        prev.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
      }
      prev.addEventListener('click', function () { track.scrollBy({ left: -step() }) });
      next.addEventListener('click', function () { track.scrollBy({ left: step() }) });
      track.addEventListener('scroll', function () { window.requestAnimationFrame(upd) });
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); track.scrollBy({ left: step() }) }
        if (e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: -step() }) }
      });
      track.addEventListener('click', function (e) {
        var b = e.target.closest('.rv-expand'); if (!b) return;
        var t = b.previousElementSibling; var open = t.classList.toggle('open');
        b.textContent = open ? 'Lebih sedikit' : 'Selengkapnya';
      });
      window.addEventListener('resize', upd); upd();
    }).catch(function () { /* slider tetap tersembunyi; tautan ulasan tetap tampil */ });
  }
})();
