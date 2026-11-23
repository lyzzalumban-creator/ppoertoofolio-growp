// URL Apps Script + kata sandi, hanya disimpan di browser ini (localStorage), tidak pernah di repo.

const KEY = 'pf-api';
let mem = null; // cadangan bila localStorage diblokir (mode pribadi): bertahan selama tab terbuka

export function readCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.url && c.token) return c;
  } catch { /* kosong atau diblokir */ }
  return mem;
}

export function saveCreds(c) {
  mem = c;
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* tetap jalan lewat mem */ }
}

export function clearCreds() {
  mem = null;
  try { localStorage.removeItem(KEY); } catch { /* abaikan */ }
}

// Kata sandi hanya boleh dikirim ke Google. Mencegah salah tempel URL (atau URL jebakan) membocorkannya.
export function scriptUrlOk(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'script.google.com';
  } catch {
    return false;
  }
}
