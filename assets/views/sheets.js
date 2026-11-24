// Lembar (dialog) pengubah data: tambah/ubah/hapus aset, beli/jual, dan rincian transaksi.
// Validasi aset memakai modul yang sama dengan robot (salah isi ketahuan sekarang, bukan besok pagi).
import { currencyOf, validateHoldings } from '../../scripts/lib/portfolio.mjs';
import { buy, cashAccounts, checkConvert, checkFx, checkTrade, convert, convertRecord, fxRecord, sell, txRecord, withCash } from '../../scripts/lib/trade.mjs';
import { $, MASK, TYPE, arrow, assetHref, assetName, canFx, canTrade, esc, fIdr, fNum, fUsd, keyOf, latest, longDate, money, pct, state, symDisp, toast, todayWib, tone, typeOf } from '../lib.js';
import { deleteTx, newId, saveAssets, trade } from '../data.js';

const FORM = {
  idx: { symbol: 'Kode saham (mis. BBCA)', qty: 'Jumlah (lembar, BUKAN lot; 1 lot = 100 lembar)', cost: 'Harga beli rata-rata per lembar (Rp)' },
  us: { symbol: 'Ticker (mis. AAPL)', qty: 'Jumlah saham (boleh pecahan)', cost: 'Harga beli rata-rata per saham (US$)' },
  crypto: { symbol: 'Simbol (mis. BTC)', qty: 'Jumlah koin', cost: 'Harga beli rata-rata per koin (Rp)' },
  cash: { symbol: 'Label (mis. BCA, TUNAI, DOLAR)', qty: 'Saldo (dalam mata uang yang dipilih)', cost: '' },
  manual: { symbol: 'Label (mis. RDPU, DEPO)', qty: 'Jumlah unit (mis. 1 untuk deposito)', cost: 'Modal per unit' },
};
const NUM = ['qty', 'avgCost', 'price', 'costIdr'];
const TXT = ['symbol', 'name', 'coingeckoId', 'currency', 'yahoo', 'buyDate'];
const oldScript = () => !(state.meta.version >= 2); // skrip Apps Script lama belum menyimpan tanggal beli
const failText = (ex) => (ex.message === 'unauthorized' ? 'Kata sandi tidak cocok lagi. Buka Profil > Keluar, lalu sambungkan ulang.' : ex.message.replace(/^holdings tidak valid:\n/, ''));
const fmtCur = (a) => (currencyOf(a) === 'USD' ? fUsd : fIdr);
const showErr = (id, m) => { $(id).hidden = !m; $(id).textContent = m || ''; };
const curName = (c) => (c === 'USD' ? 'dolar' : 'rupiah');
const fmtC = (c) => (c === 'USD' ? fUsd : fIdr);

/** <option> untuk kas bermata uang tertentu dengan saldonya (tersamar saat nominal disembunyikan). */
function cashOpts(cur, { orNew = false } = {}) {
  const list = cashAccounts(state.assets, cur);
  if (!list.length) return orNew ? '<option value="">Kas baru (otomatis)</option>' : `<option value="" disabled selected>Belum ada kas ${curName(cur)}</option>`;
  return list.map((a, i) => `<option value="${esc(keyOf(a))}"${i ? '' : ' selected'}>${esc(assetName(a))} · ${state.hidden ? MASK : esc(fmtC(cur).format(a.qty))}</option>`).join('');
}
const cashBal = (key) => (state.assets.find((a) => keyOf(a) === key) || {}).qty;

// ---------- tambah / ubah / hapus aset ----------

let editing = null; // kunci aset yang diubah, atau null = tambah
let addId = null;

function syncType() {
  const type = $('f-type').value;
  const t = FORM[type];
  $('l-symbol').textContent = t.symbol;
  $('l-qty').textContent = t.qty;
  $('l-cost').textContent = t.cost;
  for (const el of document.querySelectorAll('#asset-form [data-for]')) el.hidden = !el.dataset.for.split(' ').includes(type);
  for (const el of document.querySelectorAll('#asset-form [data-not]')) el.hidden = el.dataset.not.split(' ').includes(type);
  $('buy-field').hidden = oldScript() || type === 'cash'; // kas tidak punya tanggal beli
  $('pay-field').hidden = editing != null || type === 'cash'; // aset baru dibeli dari kas
  if (!$('pay-field').hidden) $('f-pay').innerHTML = cashOpts(formCur());
}
const formCur = () => currencyOf({ type: $('f-type').value, currency: $('f-currency').value });

export function openAssetForm(asset, preset) {
  // Jenis yang belum dikenal halaman ini (web lama di cache): jangan dibuka di form, nanti tersimpan rusak.
  if (asset && !TYPE[asset.type]) return toast(`Jenis "${asset.type}" belum dikenal halaman ini. Muat ulang halaman, lalu coba lagi.`);
  editing = asset ? keyOf(asset) : null;
  const a = asset || { type: preset || (cashAccounts(state.assets, 'IDR').length || cashAccounts(state.assets, 'USD').length ? 'idx' : 'cash'), currency: 'IDR' };
  addId = newId(); // dibuat saat lembar dibuka: simpan ulang setelah gagal memakai id yang sama
  $('f-h').textContent = asset ? `Ubah ${assetName(asset)}` : a.type === 'cash' ? 'Tambah kas' : 'Beli aset';
  $('f-type').value = a.type;
  for (const k of [...TXT, ...NUM]) $(`f-${k}`).value = a[k] ?? '';
  if (!$('f-currency').value) $('f-currency').value = 'IDR';
  showErr('f-err', '');
  $('f-save').disabled = false;
  $('f-del').hidden = !asset;
  $('f-old').hidden = !oldScript();
  $('f-buyDate').max = todayWib(); // pemilih tanggal tidak menawarkan masa depan
  $('asset-form').querySelector('.adv').open = a.costIdr != null || !!a.yahoo;
  syncType();
  $('asset-dlg').showModal();
  $('f-symbol').focus();
}

function readForm() {
  const a = { type: $('f-type').value };
  for (const k of TXT) { const v = $(`f-${k}`).value.trim(); if (v) a[k] = v; }
  for (const k of NUM) { const v = $(`f-${k}`).valueAsNumber; if (Number.isFinite(v)) a[k] = v; }
  // Kolom yang tidak relevan untuk jenis ini tidak ikut disimpan.
  if (a.type !== 'crypto') delete a.coingeckoId;
  if (a.type !== 'manual' && a.type !== 'cash') { delete a.price; delete a.currency; }
  // Kas hanya label, saldo (qty), dan mata uang: kolom lain tidak ikut disimpan walau sempat terisi.
  if (a.type === 'cash') for (const k of ['avgCost', 'price', 'costIdr', 'yahoo', 'buyDate', 'coingeckoId']) delete a[k];
  // Kode pasar selalu huruf besar ("panw" -> PANW); label manual/kas dibiarkan; ID CoinGecko huruf kecil.
  if (a.type !== 'manual' && a.type !== 'cash' && a.symbol) a.symbol = a.symbol.toUpperCase();
  if (a.yahoo) a.yahoo = a.yahoo.toUpperCase();
  if (a.coingeckoId) a.coingeckoId = a.coingeckoId.toLowerCase();
  if (oldScript()) delete a.buyDate; // skrip lama membuang kolom ini diam-diam; jangan berpura-pura menyimpannya
  return a;
}

$('f-type').addEventListener('change', syncType);
$('f-currency').addEventListener('change', syncType);
$('asset-form').addEventListener('input', () => showErr('f-err', '')); // galat hilang begitu isiannya dibetulkan
$('f-cancel').addEventListener('click', () => $('asset-dlg').close());

$('asset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = readForm();
  if (item.buyDate && item.buyDate > todayWib()) return showErr('f-err', 'Tanggal beli tidak boleh di masa depan.');
  const isBuy = editing == null && item.type !== 'cash'; // aset baru = pembelian dari kas
  if (isBuy && !canTrade()) return showErr('f-err', 'Membeli aset butuh kode Apps Script versi 3. Lihat Profil > Data.');
  let next = editing == null ? [...state.assets, item] : state.assets.map((a) => (keyOf(a) === editing ? item : a));
  $('f-save').disabled = true; // cegah kirim dobel
  try {
    validateHoldings({ assets: next }); // melempar error berisi semua masalah
    const wasDetail = state.route.view === 'aset';
    if (isBuy) {
      next = withCash(next, currencyOf(item), $('f-pay').value || null, -(item.qty * item.avgCost));
      validateHoldings({ assets: next });
      const t = { kind: 'buy', qty: item.qty, price: item.avgCost, fx: latest() && latest().fx, date: item.buyDate || todayWib() };
      await trade(next, txRecord(item, t, {}, addId, new Date().toISOString()));
    } else await saveAssets(next);
    $('asset-dlg').close();
    toast(isBuy ? 'Dibeli dari kas. Harga muncul setelah pembaruan berikutnya.' : editing == null ? 'Kas tersimpan.' : 'Perubahan tersimpan.');
    if (editing == null || wasDetail) location.hash = assetHref(item);
  } catch (ex) {
    $('f-save').disabled = false;
    showErr('f-err', failText(ex));
  }
});

/** Hapus satu aset setelah konfirmasi. Mengembalikan true bila terhapus. */
export async function removeAsset(a) {
  if (!a || !confirm(`Hapus ${assetName(a)}? Bila asetnya terjual, pakai Jual agar keuntungannya tercatat.`)) return false;
  const next = state.assets.filter((x) => x !== a);
  if (next.length) validateHoldings({ assets: next });
  await saveAssets(next);
  toast(`${assetName(a)} dihapus.`);
  location.hash = '#/beranda';
  return true;
}

$('f-del').addEventListener('click', async () => {
  $('f-del').disabled = true;
  try {
    if (await removeAsset(state.assets.find((x) => keyOf(x) === editing))) $('asset-dlg').close();
  } catch (ex) {
    showErr('f-err', failText(ex));
  } finally {
    $('f-del').disabled = false;
  }
});

// ---------- beli / jual ----------

let tradeKey = null;
let cashKind = null; // jenis transaksi yang daftar kas di lembar ini dibuat untuknya
let tradeId = null; // dibuat saat lembar dibuka: simpan ulang setelah gagal memakai id yang sama (tidak dobel)

const lastPrice = (a) => {
  if (a.type === 'manual') return a.price;
  const p = ((latest() && latest().positions) || []).find((x) => keyOf(x) === keyOf(a));
  return p ? p.price : undefined;
};

function tradeInput() {
  return {
    kind: $('trade-form').querySelector('input[name="kind"]:checked')?.value,
    qty: $('t-qty').valueAsNumber,
    price: $('t-price').valueAsNumber,
    fx: $('t-fx').valueAsNumber,
    date: $('t-date').value,
  };
}

function preview() {
  const a = state.assets.find((x) => keyOf(x) === tradeKey);
  if (!a) return;
  const t = tradeInput();
  const sellMode = t.kind === 'sell';
  $('t-h').textContent = `${sellMode ? 'Jual' : 'Beli'} ${symDisp(a)}`;
  $('t-save').textContent = sellMode ? 'Jual' : 'Beli';
  $('t-all').hidden = !sellMode;
  if (cashKind !== t.kind) {
    $('t-cash-l').textContent = sellMode ? 'Masuk ke kas' : 'Bayar dari kas';
    $('t-cash').innerHTML = cashOpts(currencyOf(a), { orNew: sellMode });
    cashKind = t.kind;
  }
  $('t-all').textContent = `Jual semua (${fNum.format(a.qty)})`;
  $('t-own').textContent = `Dimiliki ${fNum.format(a.qty)}${typeOf(a.type).unit ? ` ${typeOf(a.type).unit}` : ''} · rata-rata ${fmtCur(a).format(a.avgCost)} per unit`;
  const ok = Number.isFinite(t.qty) && t.qty > 0 && Number.isFinite(t.price) && (currencyOf(a) !== 'USD' || t.fx > 0);
  if (!ok) { $('t-preview').innerHTML = '<p class="muted">Isi jumlah dan harga untuk melihat hasilnya.</p>'; return; }
  if (sellMode) {
    if (t.qty > a.qty) { $('t-preview').innerHTML = `<p class="neg">Melebihi yang dimiliki (${fNum.format(a.qty)}).</p>`; return; }
    const r = sell(a, t);
    const p = r.costIdr > 0 ? r.pnlIdr / r.costIdr : null;
    $('t-preview').innerHTML = `<dl class="pv">
      <div><dt>Hasil jual</dt><dd>${fIdr.format(r.proceedsIdr)}</dd></div>
      <div><dt>Modal porsi ini</dt><dd>${fIdr.format(r.costIdr)}</dd></div>
      <div class="big"><dt>Keuntungan terealisasi</dt><dd class="${tone(r.pnlIdr)}">${arrow(r.pnlIdr)}${r.pnlIdr > 0 ? '+' : r.pnlIdr < 0 ? '−' : ''}${fIdr.format(Math.abs(r.pnlIdr))}${p == null ? '' : ` (${pct(p)})`}</dd></div>
      <div><dt>Sisa</dt><dd>${r.asset ? fNum.format(r.asset.qty) : 'habis (aset dihapus dari daftar)'}</dd></div></dl>`;
  } else {
    const r = buy(a, t).asset;
    const cost = t.qty * t.price;
    const bal = cashBal($('t-cash').value);
    const short = bal === undefined ? `Belum ada kas ${curName(currencyOf(a))}. Tambah kas dulu.` : bal < cost ? `Saldo kas kurang ${state.hidden ? '' : fmtCur(a).format(cost - bal)}` : '';
    $('t-preview').innerHTML = `<dl class="pv">
      <div><dt>Total beli</dt><dd>${fmtCur(a).format(cost)}${currencyOf(a) === 'USD' ? ` (${fIdr.format(cost * t.fx)})` : ''}</dd></div>
      <div><dt>Jumlah jadi</dt><dd>${fNum.format(r.qty)}</dd></div>
      <div class="big"><dt>Harga rata-rata baru</dt><dd>${fmtCur(a).format(r.avgCost)}</dd></div></dl>${short ? `<p class="neg">${esc(short)}</p>` : ''}`;
  }
}

export function openTrade(asset, kind) {
  if (!canTrade()) return toast('Jual-beli butuh kode Apps Script versi 3. Lihat Profil > Data.');
  tradeKey = keyOf(asset);
  tradeId = newId();
  cashKind = null;
  $('trade-form').querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
  $('t-qty').value = '';
  const lp = lastPrice(asset);
  $('t-price').value = Number.isFinite(lp) ? String(lp) : '';
  $('t-price-l').textContent = `Harga per unit (${currencyOf(asset) === 'USD' ? 'US$' : 'Rp'})`;
  const usd = currencyOf(asset) === 'USD';
  $('t-fx-f').hidden = !usd;
  $('t-fx').value = usd && latest() && latest().fx ? String(latest().fx) : '';
  $('t-date').value = todayWib();
  $('t-date').max = todayWib();
  showErr('t-err', '');
  $('t-save').disabled = false;
  preview();
  $('trade-dlg').showModal();
  $('t-qty').focus();
}

$('trade-form').addEventListener('input', () => { showErr('t-err', ''); preview(); });
$('t-all').addEventListener('click', () => {
  const a = state.assets.find((x) => keyOf(x) === tradeKey);
  if (a) { $('t-qty').value = String(a.qty); preview(); }
});
$('t-cancel').addEventListener('click', () => $('trade-dlg').close());

$('trade-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = state.assets.find((x) => keyOf(x) === tradeKey);
  const t = tradeInput();
  const errs = checkTrade(a, t, todayWib());
  if (errs.length) return showErr('t-err', errs.join('\n'));
  const r = t.kind === 'sell' ? sell(a, t) : buy(a, t);
  let next = state.assets.flatMap((x) => (x === a ? (r.asset ? [r.asset] : []) : [x]));
  $('t-save').disabled = true;
  try {
    // Uang selalu lewat kas: beli memotong kas, jual menambah kas (dibuat otomatis bila belum ada).
    next = withCash(next, currencyOf(a), $('t-cash').value || null, t.kind === 'sell' ? r.proceeds : -(t.qty * t.price));
    validateHoldings({ assets: next });
    await trade(next, txRecord(a, t, r, tradeId, new Date().toISOString()));
    $('trade-dlg').close();
    if (t.kind === 'sell') {
      toast(`Terjual. Keuntungan terealisasi ${r.pnlIdr >= 0 ? '+' : '−'}${fIdr.format(Math.abs(r.pnlIdr))}.`);
      if (!r.asset) location.hash = '#/aktivitas';
    } else toast('Pembelian tercatat. Harga rata-rata diperbarui.');
  } catch (ex) {
    $('t-save').disabled = false;
    showErr('t-err', failText(ex));
  }
});

// ---------- rincian transaksi ----------

let txId = null;

export function openTx(id) {
  const t = state.txs.find((x) => x.id === id);
  if (!t) return;
  txId = id;
  if (t.kind === 'convert' || t.kind === 'fx') return openTx2(t);
  const sellTx = t.kind === 'sell';
  const fmt = t.currency === 'USD' ? fUsd : fIdr;
  const p = sellTx && t.costIdr > 0 ? t.pnlIdr / t.costIdr : null;
  $('x-h').textContent = sellTx ? 'Penjualan' : 'Pembelian';
  $('x-body').innerHTML = `
    <p class="x-asset"><b>${esc(t.name || t.symbol)}</b><span class="muted">${esc(t.symbol)} · ${esc(typeOf(t.type).label)}</span></p>
    <div class="x-card ${sellTx ? 'sell' : 'buy'}">
      <div class="x-top"><span>${sellTx ? 'Jual' : 'Beli'}</span><span>${esc(longDate(t.date))}</span></div>
      <dl class="pv">
        <div><dt>${sellTx ? 'Terjual' : 'Dibeli'}</dt><dd>${state.hidden ? MASK : fNum.format(t.qty)} × ${state.hidden && t.type === 'manual' ? MASK : esc(fmt.format(t.price))}</dd></div>
        ${t.fx ? `<div><dt>Kurs</dt><dd>${esc(fIdr.format(t.fx))}</dd></div>` : ''}
        ${sellTx ? `<div><dt>Modal porsi ini</dt><dd>${money(t.costIdr)}</dd></div>
        <div class="big"><dt>Keuntungan terealisasi</dt><dd class="${tone(t.pnlIdr)}">${arrow(t.pnlIdr)}${money(t.pnlIdr, { sign: true })}${p == null ? '' : ` (${pct(p)})`}</dd></div>` : ''}
      </dl>
    </div>
    ${sellTx ? '<p class="muted">Dasar modal: harga beli rata-rata saat dijual.</p>' : ''}`;
  $('x-del').disabled = false;
  $('tx-dlg').showModal();
}

$('x-close').addEventListener('click', () => $('tx-dlg').close());
$('x-del').addEventListener('click', async () => {
  if (!confirm('Hapus catatan ini? Saldo kas dan jumlah aset tidak ikut berubah.')) return;
  $('x-del').disabled = true;
  try {
    await deleteTx(txId);
    $('tx-dlg').close();
    toast('Catatan dihapus.');
  } catch (ex) {
    $('x-del').disabled = false;
    toast(failText(ex));
  }
});

function openTx2(t) {
  const conv = t.kind === 'convert';
  $('x-h').textContent = conv ? 'Tukar mata uang' : 'Trade emas';
  const toCur = t.currency === 'IDR' ? 'USD' : 'IDR';
  $('x-body').innerHTML = conv
    ? `<div class="x-card buy"><div class="x-top"><span>Tukar</span><span>${esc(longDate(t.date))}</span></div><dl class="pv">
        <div><dt>Dari ${esc(t.symbol)}</dt><dd>${state.hidden ? MASK : esc(fmtC(t.currency).format(t.qty))}</dd></div>
        <div><dt>Ke ${esc(t.toSymbol || '')}</dt><dd>${state.hidden ? MASK : esc(fmtC(toCur).format(t.toQty))}</dd></div>
        <div><dt>Kurs</dt><dd>${esc(fIdr.format(t.price))}</dd></div></dl></div>`
    : `<div class="x-card ${t.pnl >= 0 ? 'buy' : 'sell'}"><div class="x-top"><span>${t.side === 'sell' ? 'Sell' : 'Buy'} ${esc(t.symbol)}</span><span>${esc(longDate(t.date))}</span></div><dl class="pv">
        <div><dt>Lot</dt><dd>${fNum.format(t.qty)}</dd></div>
        <div class="big"><dt>${t.pnl >= 0 ? 'Profit' : 'Rugi'}</dt><dd class="${tone(t.pnl)}">${arrow(t.pnl)}${state.hidden ? MASK : `${t.pnl > 0 ? '+' : '−'}${esc(fUsd.format(Math.abs(t.pnl)))}`}</dd></div></dl></div>`;
  $('x-del').disabled = false;
  $('tx-dlg').showModal();
}

// ---------- tukar mata uang ----------

let convId = null;

const allCashOpts = (sel) => state.assets.filter((a) => a.type === 'cash').map((a) => `<option value="${esc(keyOf(a))}"${keyOf(a) === sel ? ' selected' : ''}>${esc(assetName(a))} · ${state.hidden ? MASK : esc(fmtC(currencyOf(a)).format(a.qty))}</option>`).join('');
const convInput = () => ({ from: $('v-from').value, to: $('v-to').value, amount: $('v-amt').valueAsNumber, rate: $('v-rate').valueAsNumber, date: $('v-date').value });

function convView(fromChanged) {
  const from = state.assets.find((a) => keyOf(a) === $('v-from').value);
  const cur = from ? currencyOf(from) : 'IDR';
  if (fromChanged) $('v-to').innerHTML = cashOpts(cur === 'IDR' ? 'USD' : 'IDR', { orNew: true });
  $('v-amt-l').textContent = `Jumlah (${cur === 'USD' ? 'US$' : 'Rp'})`;
  const c = convInput();
  if (!(c.amount > 0 && c.rate > 0)) { $('v-preview').innerHTML = '<p class="muted">Isi jumlah dan kurs.</p>'; return; }
  try {
    const r = convert(state.assets, c);
    $('v-preview').innerHTML = `<dl class="pv"><div class="big"><dt>Diterima</dt><dd>${esc(fmtC(r.toCur).format(r.recv))}</dd></div></dl>`;
  } catch (ex) { $('v-preview').innerHTML = `<p class="neg">${esc(ex.message)}</p>`; }
}

export function openConvert(fromKey) {
  if (!canFx()) return toast('Tukar mata uang butuh kode Apps Script versi 4. Lihat Profil > Data.');
  if (!state.assets.some((a) => a.type === 'cash')) { toast('Tambah kas dulu.'); return openAssetForm(null, 'cash'); }
  convId = newId();
  const first = state.assets.find((a) => a.type === 'cash');
  $('v-from').innerHTML = allCashOpts(fromKey || keyOf(first));
  $('v-amt').value = '';
  $('v-rate').value = latest() && latest().fx ? String(Math.round(latest().fx)) : '';
  $('v-date').value = todayWib();
  $('v-date').max = todayWib();
  showErr('v-err', '');
  $('v-save').disabled = false;
  convView(true);
  $('conv-dlg').showModal();
  $('v-amt').focus();
}

$('v-from').addEventListener('change', () => convView(true));
$('conv-form').addEventListener('input', () => { showErr('v-err', ''); convView(false); });
$('v-cancel').addEventListener('click', () => $('conv-dlg').close());
$('conv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = convInput();
  const errs = checkConvert(state.assets, c, todayWib());
  if (errs.length) return showErr('v-err', errs.join('\n'));
  $('v-save').disabled = true;
  try {
    const r = convert(state.assets, c);
    validateHoldings({ assets: r.assets });
    await trade(r.assets, convertRecord(state.assets, c, r, convId, new Date().toISOString()));
    $('conv-dlg').close();
    toast(`Ditukar. Diterima ${state.hidden ? '' : fmtC(r.toCur).format(r.recv)}`.trim());
  } catch (ex) {
    $('v-save').disabled = false;
    showErr('v-err', failText(ex));
  }
});

// ---------- trade emas (forex XAU/USD): profit atau rugi langsung ke kas dolar ----------

let fxId = null;

function fxInput() {
  const q = (n) => $('fx-form').querySelector(`input[name="${n}"]:checked`)?.value;
  const amt = $('z-amt').valueAsNumber;
  return { side: q('side'), lot: $('z-lot').valueAsNumber, pnl: q('res') === 'loss' ? -Math.abs(amt) : Math.abs(amt), date: $('z-date').value, cash: $('z-cash').value };
}

function fxView() {
  const t = fxInput();
  const bal = cashBal(t.cash) ?? 0;
  if (!Number.isFinite(t.pnl) || t.pnl === 0) { $('z-preview').innerHTML = '<p class="muted">Isi profit atau rugi.</p>'; return; }
  const after = bal + t.pnl;
  $('z-preview').innerHTML = after < 0
    ? `<p class="neg">Saldo kas kurang ${state.hidden ? '' : esc(fUsd.format(-after))}</p>`
    : `<dl class="pv"><div><dt>Kas dolar</dt><dd>${state.hidden ? MASK : `${esc(fUsd.format(bal))} → ${esc(fUsd.format(after))}`}</dd></div></dl>`;
}

export function openFx() {
  if (!canFx()) return toast('Trade emas butuh kode Apps Script versi 4. Lihat Profil > Data.');
  fxId = newId();
  $('fx-form').querySelector('input[name="side"][value="buy"]').checked = true;
  $('fx-form').querySelector('input[name="res"][value="profit"]').checked = true;
  $('z-lot').value = '';
  $('z-amt').value = '';
  $('z-date').value = todayWib();
  $('z-date').max = todayWib();
  $('z-cash').innerHTML = cashOpts('USD', { orNew: true });
  showErr('z-err', '');
  $('z-save').disabled = false;
  fxView();
  $('fx-dlg').showModal();
  $('z-lot').focus();
}

$('fx-form').addEventListener('input', () => { showErr('z-err', ''); fxView(); });
$('z-cancel').addEventListener('click', () => $('fx-dlg').close());
$('fx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = fxInput();
  const errs = checkFx(t, todayWib());
  if (errs.length) return showErr('z-err', errs.join('\n'));
  $('z-save').disabled = true;
  try {
    const next = withCash(state.assets, 'USD', t.cash || null, t.pnl);
    validateHoldings({ assets: next });
    await trade(next, fxRecord(t, fxId, new Date().toISOString()));
    $('fx-dlg').close();
    toast(`${t.pnl > 0 ? 'Profit' : 'Rugi'} tercatat${state.hidden ? '' : `: ${fUsd.format(Math.abs(t.pnl))}`}. Kas dolar diperbarui.`);
    location.hash = '#/aktivitas/trading';
  } catch (ex) {
    $('z-save').disabled = false;
    showErr('z-err', failText(ex));
  }
});

// ---------- menu + ----------

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-menu]')) return $('menu-dlg').showModal();
  const b = e.target.closest('[data-menu-act]');
  if (!b) return;
  $('menu-dlg').close();
  const act = b.dataset.menuAct;
  const hasCash = state.assets.some((a) => a.type === 'cash');
  if (act === 'cash') openAssetForm(null, 'cash');
  else if (act === 'asset') { if (hasCash) openAssetForm(null, 'idx'); else { toast('Tambah kas dulu, lalu beli aset darinya.'); openAssetForm(null, 'cash'); } }
  else if (act === 'fx') openFx();
  else if (act === 'convert') openConvert();
});
$('m-close').addEventListener('click', () => $('menu-dlg').close());
