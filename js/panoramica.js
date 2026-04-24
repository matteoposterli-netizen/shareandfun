/* ============================================================
   Panoramica Manager — KPI, flow, top-3 + tab Configurazioni/Stagione
   ============================================================
   Dipende da globals esposti da js/manager.js, js/state.js, js/utils.js:
     sb, currentStabilimento, ombrelloniList, clientiList,
     formatCoin, coinName, formatDate, toLocalDateStr, todayStr
   ============================================================ */

/* ---------- Range periodo (default: ultimi 30 giorni) ---------- */
let panoramicaRange = { fromISO: null, toISO: null, label: 'Ultimi 30 giorni' };

function panInitRange() {
  const today = todayStr();
  const from = new Date(today + 'T00:00:00');
  from.setDate(from.getDate() - 29);
  panoramicaRange.fromISO = toLocalDateStr(from);
  panoramicaRange.toISO = today;
  panoramicaRange.label = 'Ultimi 30 giorni';
  const pillLabel = document.getElementById('dash-range-label');
  if (pillLabel) pillLabel.textContent = panoramicaRange.label;
}

function panPrevRange() {
  // Stesso numero di giorni, finestra immediatamente precedente.
  const from = new Date(panoramicaRange.fromISO + 'T00:00:00');
  const to = new Date(panoramicaRange.toISO + 'T00:00:00');
  const days = Math.round((to - from) / 86400000) + 1;
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { fromISO: toLocalDateStr(prevFrom), toISO: toLocalDateStr(prevTo), days };
}

/* ---------- Helpers ---------- */
function panPct(curr, prev) {
  if (!prev) return curr > 0 ? '+∞%' : '';
  const diff = ((curr - prev) / prev) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}%`;
}

function panSetDelta(id, curr, prev) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!prev && !curr) { el.textContent = ''; el.className = 'kpi-delta'; return; }
  const pct = panPct(curr, prev);
  const cls = curr >= prev ? 'kpi-delta up' : 'kpi-delta down';
  el.className = cls;
  el.textContent = `${pct} vs periodo prec.`;
}

function panDrawSparkline(svgId, values, color) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';
  if (!values || !values.length) return;
  const W = 160, H = 40, PAD = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', color);
  poly.setAttribute('stroke-width', '1.5');
  poly.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(poly);
  // Area riempita
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('points', `${PAD},${H} ${pts} ${W - PAD},${H}`);
  area.setAttribute('fill', color);
  area.setAttribute('opacity', '0.12');
  svg.appendChild(area);
}

/* Raggruppa N valori in buckets giornalieri; ritorna array di somme */
function panBucketByDay(rows, fromISO, toISO, getDateFn, getValFn) {
  const buckets = {};
  const d = new Date(fromISO + 'T00:00:00');
  const end = new Date(toISO + 'T00:00:00');
  while (d <= end) {
    buckets[toLocalDateStr(d)] = 0;
    d.setDate(d.getDate() + 1);
  }
  (rows || []).forEach(r => {
    const k = getDateFn(r);
    if (k in buckets) buckets[k] += getValFn(r);
  });
  return Object.values(buckets);
}

/* ---------- Caricamento dati + rendering ---------- */
async function loadPanoramicaKpis() {
  if (!panoramicaRange.fromISO) panInitRange();
  if (!currentStabilimento) return;

  const { fromISO, toISO } = panoramicaRange;
  const prev = panPrevRange();

  // Refresh label unità coin
  document.querySelectorAll('.flow-coin-label').forEach(el => el.textContent = coinName(currentStabilimento) || 'Coin');
  const setCoinLbl = (id) => { const el = document.getElementById(id); if (el) el.textContent = coinName(currentStabilimento) || 'Coin'; };
  setCoinLbl('kpi-distr-coin-label');
  setCoinLbl('kpi-spent-coin-label');

  const ombIds = ombrelloniList.map(o => o.id);
  const hasOmb = ombIds.length > 0;

  // 1. Disponibilità — periodo corrente
  const { data: dispCurr } = hasOmb ? await sb.from('disponibilita')
    .select('ombrellone_id,data,stato,cliente_id')
    .in('ombrellone_id', ombIds)
    .gte('data', fromISO).lte('data', toISO) : { data: [] };
  // 2. Disponibilità — periodo precedente
  const { data: dispPrev } = hasOmb ? await sb.from('disponibilita')
    .select('ombrellone_id,data,stato')
    .in('ombrellone_id', ombIds)
    .gte('data', prev.fromISO).lte('data', prev.toISO) : { data: [] };
  // 3. Transazioni — periodo corrente
  const { data: txCurr } = await sb.from('transazioni')
    .select('tipo,importo,created_at,cliente_id,ombrellone_id,data_riferimento')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('tipo', ['credito_ricevuto', 'credito_usato'])
    .gte('created_at', fromISO + 'T00:00:00')
    .lte('created_at', toISO + 'T23:59:59.999');
  // 4. Transazioni — periodo precedente
  const { data: txPrev } = await sb.from('transazioni')
    .select('tipo,importo,created_at')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('tipo', ['credito_ricevuto', 'credito_usato'])
    .gte('created_at', prev.fromISO + 'T00:00:00')
    .lte('created_at', prev.toISO + 'T23:59:59.999');

  // --- Aggregazioni ---
  const curr = dispCurr || [];
  const prvD = dispPrev || [];

  const dichCurr = curr.filter(d => d.stato === 'libero' || d.stato === 'sub_affittato').length;
  const prenCurr = curr.filter(d => d.stato === 'sub_affittato').length;
  const dichPrev = prvD.filter(d => d.stato === 'libero' || d.stato === 'sub_affittato').length;
  const prenPrev = prvD.filter(d => d.stato === 'sub_affittato').length;

  let distrCurr = 0, spentCurr = 0;
  (txCurr || []).forEach(t => {
    const v = parseFloat(t.importo || 0);
    if (t.tipo === 'credito_ricevuto') distrCurr += v;
    else if (t.tipo === 'credito_usato') spentCurr += v;
  });
  let distrPrev = 0, spentPrev = 0;
  (txPrev || []).forEach(t => {
    const v = parseFloat(t.importo || 0);
    if (t.tipo === 'credito_ricevuto') distrPrev += v;
    else if (t.tipo === 'credito_usato') spentPrev += v;
  });

  // --- KPI numbers ---
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-dich-value', dichCurr);
  set('kpi-pren-value', prenCurr);
  set('kpi-distr-value', formatCoin(distrCurr));
  set('kpi-spent-value', formatCoin(spentCurr));

  panSetDelta('kpi-dich-delta', dichCurr, dichPrev);
  panSetDelta('kpi-pren-delta', prenCurr, prenPrev);
  panSetDelta('kpi-distr-delta', distrCurr, distrPrev);
  panSetDelta('kpi-spent-delta', spentCurr, spentPrev);

  // --- Sparklines ---
  const sparkDich = panBucketByDay(
    curr.filter(d => d.stato === 'libero' || d.stato === 'sub_affittato'),
    fromISO, toISO, r => r.data, _ => 1
  );
  const sparkPren = panBucketByDay(
    curr.filter(d => d.stato === 'sub_affittato'),
    fromISO, toISO, r => r.data, _ => 1
  );
  const sparkDistr = panBucketByDay(
    (txCurr || []).filter(t => t.tipo === 'credito_ricevuto'),
    fromISO, toISO, r => (r.created_at || '').slice(0, 10), r => parseFloat(r.importo || 0)
  );
  const sparkSpent = panBucketByDay(
    (txCurr || []).filter(t => t.tipo === 'credito_usato'),
    fromISO, toISO, r => (r.created_at || '').slice(0, 10), r => parseFloat(r.importo || 0)
  );
  panDrawSparkline('kpi-dich-spark', sparkDich, '#4EA66E');
  panDrawSparkline('kpi-pren-spark', sparkPren, '#E3B04B');
  panDrawSparkline('kpi-distr-spark', sparkDistr, 'var(--ocean, #1B6CA8)');
  panDrawSparkline('kpi-spent-spark', sparkSpent, 'var(--coral, #E07B54)');

  // --- Flow diagram ---
  set('flow-dich', dichCurr);
  set('flow-pren', prenCurr);
  set('flow-distr', formatCoin(distrCurr));
  set('flow-spent', formatCoin(spentCurr));
  const convRate = dichCurr ? Math.round((prenCurr / dichCurr) * 100) : 0;
  set('flow-pren-sub', `${convRate}% delle dichiarate`);
  const spentRate = distrCurr ? Math.round((spentCurr / distrCurr) * 100) : 0;
  set('flow-spent-sub', distrCurr ? `${spentRate}% dei distribuiti` : 'nessun coin distribuito');

  // --- Top 3 stagionali per credito maturato (credito_ricevuto) ---
  const byCliente = new Map();
  (txCurr || []).filter(t => t.tipo === 'credito_ricevuto' && t.cliente_id).forEach(t => {
    byCliente.set(t.cliente_id, (byCliente.get(t.cliente_id) || 0) + parseFloat(t.importo || 0));
  });
  const topClienti = [...byCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const cliById = Object.fromEntries(clientiList.map(c => [c.id, c]));
  const elCliList = document.getElementById('top-clienti-list');
  if (elCliList) {
    if (!topClienti.length) {
      elCliList.innerHTML = '<div class="top-empty">Nessun credito maturato nel periodo.</div>';
    } else {
      elCliList.innerHTML = topClienti.map(([id, imp], i) => {
        const c = cliById[id];
        const nome = c ? `${c.nome || ''} ${c.cognome || ''}`.trim() : 'Cliente rimosso';
        return `<div class="top-item">
          <div class="top-rank">${i + 1}</div>
          <div class="top-name">${escapeHtml(nome)}</div>
          <div class="top-value">${formatCoin(imp)}</div>
        </div>`;
      }).join('');
    }
  }

  // --- Top 3 ombrelloni più prenotati ---
  const byOmb = new Map();
  curr.filter(d => d.stato === 'sub_affittato').forEach(d => {
    byOmb.set(d.ombrellone_id, (byOmb.get(d.ombrellone_id) || 0) + 1);
  });
  const topOmb = [...byOmb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ombById = Object.fromEntries(ombrelloniList.map(o => [o.id, o]));
  const elOmbList = document.getElementById('top-ombrelloni-list');
  if (elOmbList) {
    if (!topOmb.length) {
      elOmbList.innerHTML = '<div class="top-empty">Nessuna prenotazione nel periodo.</div>';
    } else {
      elOmbList.innerHTML = topOmb.map(([id, count], i) => {
        const o = ombById[id];
        const label = o ? `${o.fila}${o.numero}` : '—';
        return `<div class="top-item">
          <div class="top-rank">${i + 1}</div>
          <div class="top-name">Ombrellone <strong>${escapeHtml(label)}</strong></div>
          <div class="top-value">${count} ${count === 1 ? 'giorno' : 'giorni'}</div>
        </div>`;
      }).join('');
    }
  }
}

/* ---------- Configurazioni → subtab switcher ---------- */
function switchConfigSubtab(sub, btn) {
  document.querySelectorAll('.config-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('config-sub-' + sub);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.config-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'stagione') loadStagione();
}

/* ---------- Stagione: load/save ---------- */
function loadStagione() {
  if (!currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione || '';
  const fine = currentStabilimento.data_fine_stagione || '';
  const elI = document.getElementById('stagione-inizio');
  const elF = document.getElementById('stagione-fine');
  if (elI) elI.value = inizio;
  if (elF) elF.value = fine;
  renderStagioneSummary(inizio, fine);
  const alert = document.getElementById('stagione-save-alert');
  if (alert) alert.innerHTML = '';
}

function renderStagioneSummary(inizio, fine) {
  const el = document.getElementById('stagione-summary');
  if (!el) return;
  if (!inizio || !fine) {
    el.innerHTML = '<span style="color:var(--text-light)">Imposta entrambe le date per vedere la progressione.</span>';
    return;
  }
  const from = new Date(inizio + 'T00:00:00');
  const to = new Date(fine + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');
  const totale = Math.round((to - from) / 86400000) + 1;
  if (totale <= 0) {
    el.innerHTML = '<span style="color:var(--coral)">La data di fine deve essere successiva a quella di inizio.</span>';
    return;
  }
  let progress = 0, statoTxt = '';
  if (today < from) {
    const gg = Math.round((from - today) / 86400000);
    statoTxt = `La stagione inizia fra <strong>${gg}</strong> ${gg === 1 ? 'giorno' : 'giorni'}`;
    progress = 0;
  } else if (today > to) {
    statoTxt = `Stagione conclusa · durata totale <strong>${totale}</strong> giorni`;
    progress = 100;
  } else {
    const fatti = Math.round((today - from) / 86400000) + 1;
    const rest = totale - fatti;
    statoTxt = `Giorno <strong>${fatti}</strong> di <strong>${totale}</strong> · mancano <strong>${rest}</strong> ${rest === 1 ? 'giorno' : 'giorni'}`;
    progress = Math.round((fatti / totale) * 100);
  }
  el.innerHTML = `
    <div style="font-size:13px;color:var(--text-mid);margin-bottom:10px">${statoTxt}</div>
    <div style="background:#EEE9DF;border-radius:999px;height:10px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#4EA66E 0%,#E3B04B 100%);height:100%;width:${progress}%;transition:width .4s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);margin-top:6px">
      <span>${formatDate(inizio)}</span>
      <span>${formatDate(fine)}</span>
    </div>`;
}

async function saveStagione() {
  if (!currentStabilimento) return;
  const alert = document.getElementById('stagione-save-alert');
  const elI = document.getElementById('stagione-inizio');
  const elF = document.getElementById('stagione-fine');
  const inizio = elI ? elI.value : '';
  const fine = elF ? elF.value : '';
  if (!inizio || !fine) {
    if (alert) alert.innerHTML = '<div class="alert alert-coral">Inserisci entrambe le date.</div>';
    return;
  }
  if (fine < inizio) {
    if (alert) alert.innerHTML = '<div class="alert alert-coral">La fine deve essere uguale o successiva all\'inizio.</div>';
    return;
  }
  const { error } = await sb.from('stabilimenti')
    .update({ data_inizio_stagione: inizio, data_fine_stagione: fine })
    .eq('id', currentStabilimento.id);
  if (error) {
    if (alert) alert.innerHTML = `<div class="alert alert-coral">Errore: ${escapeHtml(error.message)}</div>`;
    return;
  }
  currentStabilimento.data_inizio_stagione = inizio;
  currentStabilimento.data_fine_stagione = fine;
  if (alert) alert.innerHTML = '<div class="alert alert-info">✓ Date stagione salvate.</div>';
  renderStagioneSummary(inizio, fine);
  setTimeout(() => { if (alert) alert.innerHTML = ''; }, 3000);
}

/* ---------- Hook nel tab switcher ---------- */
/* Monkey-patch di managerTab: quando l'utente torna su "panoramica", ricarica i KPI. */
(function hookManagerTab() {
  if (typeof window.managerTab !== 'function') {
    // manager.js non ancora caricato: ritenta al prossimo tick.
    setTimeout(hookManagerTab, 50);
    return;
  }
  if (window.__panoramicaHooked) return;
  window.__panoramicaHooked = true;
  const orig = window.managerTab;
  window.managerTab = function (tab, btn) {
    orig(tab, btn);
    if (tab === 'panoramica') {
      loadPanoramicaKpis().catch(console.error);
    }
  };
})();

/* Esponi funzioni globali usate dall'HTML */
window.loadPanoramicaKpis = loadPanoramicaKpis;
window.switchConfigSubtab = switchConfigSubtab;
window.loadStagione = loadStagione;
window.saveStagione = saveStagione;
