// Klien untuk Apps Script web app. Dipakai browser (dasbor, Kelola) dan Node (robot harian).

export async function call(url, token, action, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    // text/plain = "simple request": browser tidak mengirim preflight, yang tidak dilayani Apps Script.
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token, action }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    // Biasanya halaman login/error Google: URL salah, atau deploy belum "Who has access: Anyone".
    throw new Error('Respons bukan JSON. Periksa URL, dan pastikan deploy memakai "Who has access: Anyone".');
  }
  if (data.error) throw new Error(data.error);
  return data;
}
