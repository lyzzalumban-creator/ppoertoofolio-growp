// Menu utama: bilah bawah di HP (tombol + di tengah), bilah atas yang menempel di desktop.
const ITEMS = [
  ['beranda', 'Beranda', '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>'],
  ['analisis', 'Analisis', '<path d="M5 20v-8M12 20V5M19 20v-5"/>'],
  null, // tombol tambah aset
  ['aktivitas', 'Aktivitas', '<path d="M4 12h4l3 7 4-14 3 7h2"/>'],
  ['profil', 'Profil', '<path d="M19 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 5 19.5V21"/><circle cx="12" cy="8" r="4"/>'],
];

/** Pasang menu di bawah header. */
export function mountNav() {
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.className = 'nav';
  nav.setAttribute('aria-label', 'Menu utama');
  nav.innerHTML = ITEMS.map((it) => (it
    ? `<a id="nav-${it[0]}" href="#/${it[0]}"><svg viewBox="0 0 24 24" aria-hidden="true">${it[2]}</svg><span>${it[1]}</span></a>`
    : '<button type="button" id="nav-add" class="nav-add" data-add aria-label="Tambah aset"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Tambah</span></button>')).join('');
  document.querySelector('.top').after(nav);
  return nav;
}

/** Tandai item aktif (satu-satunya yang aria-current). Halaman aset termasuk Beranda. */
export function setActive(view) {
  const key = view === 'aset' ? 'beranda' : view;
  for (const it of ITEMS) {
    if (!it) continue;
    const a = document.getElementById(`nav-${it[0]}`);
    if (it[0] === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
