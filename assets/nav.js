// Menu utama: bilah bawah di HP, bilah atas di desktop. Dipakai index.html (rute #/…) dan kelola.html.
const ITEMS = [
  ['beranda', 'Beranda', '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>'],
  ['analisis', 'Analisis', '<path d="M5 20v-8M12 20V5M19 20v-5"/>'],
  ['aset', 'Aset', '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'],
  ['kelola', 'Kelola', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'],
  ['profil', 'Profil', '<path d="M19 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 5 19.5V21"/><circle cx="12" cy="8" r="4"/>'],
];

/** Pasang menu di bawah header. `spa` = halaman ini index.html (tautan cukup #/…). */
export function mountNav(active, spa) {
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.className = 'nav';
  nav.setAttribute('aria-label', 'Menu utama');
  nav.innerHTML = ITEMS.map(([k, label, svg]) => {
    const href = k === 'kelola' ? 'kelola.html' : `${spa ? '' : 'index.html'}#/${k}`;
    return `<a id="nav-${k}" href="${href}"${k === active ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><span>${label}</span></a>`;
  }).join('');
  document.querySelector('.top').after(nav);
  return nav;
}

/** Tandai item aktif (satu-satunya yang aria-current). */
export function setActive(key) {
  for (const [k] of ITEMS) {
    const a = document.getElementById(`nav-${k}`);
    if (k === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
