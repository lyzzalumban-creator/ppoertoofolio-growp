// Skrip biasa (bukan module) di <head>: pasang pilihan tema sebelum halaman digambar, supaya tidak berkedip.
// 'auto' (bawaan) mengikuti pengaturan perangkat; 'light' / 'dark' memaksa.
try {
  var t = localStorage.getItem('pf-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* abaikan */ }
