// Skrip biasa (bukan module): browser memblokir module dari file://, jadi app tidak akan jalan.
// Beri petunjuk, bukan halaman diam.
if (location.protocol === 'file:') {
  var b = document.getElementById('banner');
  b.hidden = false;
  b.className = 'banner error';
  b.innerHTML = '<strong>Halaman ini tidak bisa dibuka langsung dari file.</strong><br>Jalankan <code>npm run serve</code> lalu buka <code>http://localhost:8080</code>, atau buka lewat GitHub Pages.';
}
