// js/panoramica.js — Panoramica manager SpiaggiaMia (Consegna 1)
//
// Esporta globals: panoramicaInit, panoramicaLoad, setPanoramicaRange,
//                  openDeepDive, ddBack, ddLoadDisponibilita,
//                  ddLoadPrenotazioni, ddLoadCoinDistr, ddLoadCoinSpent
//
// Dipendenze globali attese (caricate PRIMA di questo file):
//   sb (Supabase client), currentStabilimento, ombrelloniList, clientiList,
//   formatCoin, coinName, toLocalDateStr, todayStr, formatDate, escapeHtml,
//   showLoading, hideLoading, flatpickr, XLSX,
//   dd-common.js (dateRangeQS, previousRange, computeDelta, formatDeltaHTML,
//     renderSparkline, groupByDay, fillSeries, dateRangeDays, exportXlsx,
//     labelRange)

// ============================================================
// STATO
// ============================================================

const panoramicaState = {
  from: null,
  to: null,
  preset: '7d',      // '7d'|'30d'|'90d'|'season'|'custom'
  compare: true,
  kpiData: null,     // {disp, pren, distr, spent} popolato da panoramicaLoad
};

const ddState = {
  current: null,     // 'disponibilita'|'prenotazioni'|'coin-distr'|'coin-spent'|null
  from: null,
  to: null,
  preset: '7d',
  compare: true,
  lastRows: [],      // per export Excel della vista attiva
  lastFilename: 'deep-dive',
};

// ============================================================
// TOOLBAR PERIODO (render + interaction)
// ============================================================

/**
 * Setta il range della panoramica su uno dei preset o custom.
 * preset: '7d'|'30d'|'90d'|'season'|'custom'
 */
function setPanoramicaRange(preset) {
  const today = new Date();
  const todayStrV = toLocalDateStr(today);
  let from = null, to = todayStrV;

  if (preset === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    from = toLocalDateStr(d);
  } else if (preset === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 29);
    from = toLocalDateStr(d);
  } else if (preset === '90d') {
    const d = new Date(today); d.setDate(d.getDate() - 89);
    from = toLocalDateStr(d);
  } else if (preset === 'season') {
    from = currentStabilimento?.data_inizio_stagione || (today.getFullYear() + '-06-01');
    const fine = currentStabilimento?.data_fine_stagione || (today.getFullYear() + '-09-15');
    // clampa a oggi se stagione non finita
    to = fine < todayStrV ? fine : todayStrV;
  } else {
    // custom: mantiene from/to correnti se presenti, altrimenti default 7d
    const fromEl = document.getElementById('pano-range-from');
    const toEl = document.getElementById('pano-range-to');
    if (fromEl?.value && toEl?.value) {
      from = fromEl.value;
      to = toEl.value;
    } else {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      from = toLocalDateStr(d);
    }
  }

  panoramicaState.from = from;
  panoramicaState.to = to;
  panoramicaState.preset = preset;
  syncPanoramicaToolbar();
  panoramicaLoad();
}

/** Aggiorna UI toolbar: pill attiva, input date, label range */
function syncPanoramicaToolbar() {
  const { from, to, preset, compare } = panoramicaState;
  document.querySelectorAll('.pano-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === preset);
  });
  const fromEl = document.getElementById('pano-range-from');
  const toEl = document.getElementById('pano-range-to');
  if (fromEl && fromEl.value !== from) fromEl.value = from;
  if (toEl && toEl.value !== to) toEl.value = to;
  const label = document.getElementById('pano-range-label');
  if (label) label.textContent = labelRange(from, to);
  const cmp = document.getElementById('pano-compare');
  if (cmp) cmp.checked = compare;
}

/** Called onchange dagli input custom date */
function onPanoramicaCustomRange() {
  const from = document.getElementById('pano-range-from').value;
  const to = document.getElementById('pano-range-to').value;
  if (!from || !to) return;
  if (from > to) return;
  panoramicaState.from = from;
  panoramicaState.to = to;
  panoramicaState.preset = 'custom';
  syncPanoramicaToolbar();
  panoramicaLoad();
}

function onPanoramicaCompareToggle() {
  panoramicaState.compare = document.getElementById('pano-compare').checked;
  panoramicaLoad();
}

// ============================================================
// LOAD KPI
// ============================================================

/**
 * Calcola i 4 KPI del range corrente + periodo di confronto + sparkline.
 * Ogni KPI è un oggetto {value, prev, delta, spark[]}.
 */
async function panoramicaLoad() {
  if (!currentStabilimento || !panoramicaState.from || !panoramicaState.to) return;
  if (!ombrelloniList || !ombrelloniList.length) {
    // Nessun ombrellone → azzera tutto
    ['pano-kpi-disp','pano-kpi-pren','pano-kpi-distr','pano-kpi-spent'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '0';
    });
    return;
  }

  showLoading();
  try {
    const { from, to, compare } = panoramicaState;
    const prev = compare ? previousRange(from, to) : null;
    const ombIds = ombrelloniList.map(o => o.id);

    // === Query in parallelo ===
    const [dispCur, dispPrev, distrCur, distrPrev, spentCur, spentPrev] = await Promise.all([
      sb.from('disponibilita').select('ombrellone_id,data,stato')
        .in('ombrellone_id', ombIds).gte('data', from).lte('data', to),
      prev ? sb.from('disponibilita').select('ombrellone_id,data,stato')
        .in('ombrellone_id', ombIds).gte('data', prev.from).lte('data', prev.to) : Promise.resolve({ data: [] }),
      sb.from('transazioni').select('importo,created_at')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto')
        .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59'),
      prev ? sb.from('transazioni').select('importo,created_at')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto')
        .gte('created_at', prev.from + 'T00:00:00').lte('created_at', prev.to + 'T23:59:59') : Promise.resolve({ data: [] }),
      sb.from('transazioni').select('importo,created_at,categoria')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_usato')
        .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59'),
      prev ? sb.from('transazioni').select('importo,created_at')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_usato')
        .gte('created_at', prev.from + 'T00:00:00').lte('created_at', prev.to + 'T23:59:59') : Promise.resolve({ data: [] }),
    ]);

    // === KPI 1: Disponibilità dichiarate (stato != 'ombrellone' / include libero+sub_affittato+sub_affittato_cliente) ===
    // Conteggio: righe con stato tra {libero,sub_affittato}
    const countDisp = rows => (rows || []).filter(r => r.stato === 'libero' || r.stato === 'sub_affittato').length;
    const countPren = rows => (rows || []).filter(r => r.stato === 'sub_affittato').length;
    const dispCurV = countDisp(dispCur.data);
    const dispPrevV = countDisp(dispPrev.data);
    const prenCurV = countPren(dispCur.data);
    const prenPrevV = countPren(dispPrev.data);

    // === KPI 3: Coin distribuiti ===
    const sumImporto = rows => (rows || []).reduce((s, r) => s + parseFloat(r.importo || 0), 0);
    const distrCurV = sumImporto(distrCur.data);
    const distrPrevV = sumImporto(distrPrev.data);

    // === KPI 4: Coin spesi ===
    const spentCurV = sumImporto(spentCur.data);
    const spentPrevV = sumImporto(spentPrev.data);

    // === Sparkline (serie giornaliera) ===
    const dispByDay = groupByDay((dispCur.data || []).filter(r => r.stato === 'libero' || r.stato === 'sub_affittato'), 'data');
    const prenByDay = groupByDay((dispCur.data || []).filter(r => r.stato === 'sub_affittato'), 'data');
    const distrByDay = groupByDay(distrCur.data, 'created_at', 'importo', true);
    const spentByDay = groupByDay(spentCur.data, 'created_at', 'importo', true);

    const sparkDisp = fillSeries(dispByDay, from, to);
    const sparkPren = fillSeries(prenByDay, from, to);
    const sparkDistr = fillSeries(distrByDay, from, to);
    const sparkSpent = fillSeries(spentByDay, from, to);

    panoramicaState.kpiData = {
      disp: { value: dispCurV, prev: dispPrevV, delta: computeDelta(dispCurV, dispPrevV), spark: sparkDisp },
      pren: { value: prenCurV, prev: prenPrevV, delta: computeDelta(prenCurV, prenPrevV), spark: sparkPren },
      distr: { value: distrCurV, prev: distrPrevV, delta: computeDelta(distrCurV, distrPrevV), spark: sparkDistr },
      spent: { value: spentCurV, prev: spentPrevV, delta: computeDelta(spentCurV, spentPrevV), spark: sparkSpent },
    };

    renderPanoramicaKpis();
    renderPanoramicaFlow();
    await renderPanoramicaTopClienti();
  } finally {
    hideLoading();
  }
}

/** Popola le 4 KPI card con valore, delta, sparkline */
function renderPanoramicaKpis() {
  const { kpiData } = panoramicaState;
  if (!kpiData) return;

  const setKpi = (prefix, data, isCoin) => {
    const valEl = document.getElementById(`${prefix}-val`);
    const delEl = document.getElementById(`${prefix}-delta`);
    const sparkEl = document.getElementById(`${prefix}-spark`);
    if (valEl) {
      valEl.textContent = isCoin
        ? parseFloat(data.value || 0).toFixed(2)
        : String(data.value || 0);
    }
    if (delEl) delEl.innerHTML = panoramicaState.compare ? formatDeltaHTML(data.delta) : '';
    if (sparkEl) renderSparkline(sparkEl, data.spark, getComputedStyle(sparkEl).color || null);
  };

  setKpi('pano-kpi-disp', kpiData.disp, false);
  setKpi('pano-kpi-pren', kpiData.pren, false);
  setKpi('pano-kpi-distr', kpiData.distr, true);
  setKpi('pano-kpi-spent', kpiData.spent, true);

  // unità coin dinamica
  document.querySelectorAll('[data-coin-unit]').forEach(el => {
    el.textContent = coinName(currentStabilimento);
  });
}

/** Flow diagram: disp → pren → distr → spent */
function renderPanoramicaFlow() {
  const { kpiData } = panoramicaState;
  if (!kpiData) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('flow-disp', kpiData.disp.value);
  set('flow-pren', kpiData.pren.value);
  set('flow-distr', parseFloat(kpiData.distr.value || 0).toFixed(2));
  set('flow-spent', parseFloat(kpiData.spent.value || 0).toFixed(2));

  // Conversion rates
  const toPct = (num, den) => den > 0 ? Math.round((num / den) * 100) + '%' : '–';
  set('flow-conv-1', toPct(kpiData.pren.value, kpiData.disp.value));
  set('flow-conv-2', toPct(kpiData.spent.value, kpiData.distr.value));
}

/** Top-3 ombrelloni più prenotati del periodo */
async function renderPanoramicaTopClienti() {
  const ul = document.getElementById('pano-top-ombrelloni');
  if (!ul) return;
  ul.innerHTML = '<li class="pano-top-empty">Caricamento…</li>';
  const { from, to } = panoramicaState;
  const ombIds = ombrelloniList.map(o => o.id);
  const { data: rows } = await sb.from('disponibilita')
    .select('ombrellone_id,stato')
    .in('ombrellone_id', ombIds)
    .eq('stato', 'sub_affittato')
    .gte('data', from).lte('data', to);
  const byOmb = {};
  (rows || []).forEach(r => { byOmb[r.ombrellone_id] = (byOmb[r.ombrellone_id] || 0) + 1; });
  const clienteByOmb = {};
  (clientiList || []).filter(c => !c.rifiutato).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });
  const top = Object.entries(byOmb)
    .map(([id, n]) => {
      const o = ombrelloniList.find(x => x.id === id);
      const c = clienteByOmb[id];
      return {
        id,
        label: o ? `Fila ${o.fila} · N°${o.numero}` : 'Ombrellone',
        cliente: c ? `${c.nome || ''} ${c.cognome || ''}`.trim() : '—',
        count: n,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (!top.length) {
    ul.innerHTML = '<li class="pano-top-empty">Nessun sub-affitto nel periodo.</li>';
    return;
  }
  ul.innerHTML = top.map((t, i) => `
    <li class="pano-top-item">
      <span class="pano-top-rank">${i + 1}</span>
      <span class="pano-top-label">
        <span class="pano-top-title">${escapeHtml(t.label)}</span>
        <span class="pano-top-sub">${escapeHtml(t.cliente)}</span>
      </span>
      <span class="pano-top-count">${t.count} notti</span>
    </li>
  `).join('');
}

// ============================================================
// DEEP DIVE — router + stubs
// ============================================================

/**
 * Apre il deep dive richiesto nascondendo la Panoramica.
 * kind: 'disponibilita'|'prenotazioni'|'coin-distr'|'coin-spent'
 */
function openDeepDive(kind) {
  const pano = document.getElementById('pano-overview');
  const dd = document.getElementById('pano-deepdive');
  if (!pano || !dd) return;
  pano.classList.add('hidden');
  dd.classList.remove('hidden');

  // eredita range dalla panoramica
  ddState.current = kind;
  ddState.from = panoramicaState.from;
  ddState.to = panoramicaState.to;
  ddState.preset = panoramicaState.preset;
  ddState.compare = panoramicaState.compare;

  // mostra solo il pannello richiesto
  document.querySelectorAll('.dd-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById(`dd-panel-${kind}`);
  if (panel) panel.classList.remove('hidden');

  // breadcrumb
  const crumb = document.getElementById('dd-crumb-title');
  if (crumb) crumb.textContent = deepDiveTitle(kind);
  syncDdToolbar();

  // load
  if (kind === 'disponibilita') ddLoadDisponibilita();
  else if (kind === 'prenotazioni') ddLoadPrenotazioni();
  else if (kind === 'coin-distr') ddLoadCoinDistr();
  else if (kind === 'coin-spent') ddLoadCoinSpent();

  // scroll al top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deepDiveTitle(kind) {
  switch (kind) {
    case 'disponibilita': return 'Disponibilità dichiarate';
    case 'prenotazioni': return 'Prenotazioni effettuate';
    case 'coin-distr': return `${coinName(currentStabilimento)} distribuiti`;
    case 'coin-spent': return `${coinName(currentStabilimento)} spesi`;
    default: return 'Deep dive';
  }
}

/** Torna alla Panoramica dal deep dive */
function ddBack() {
  const pano = document.getElementById('pano-overview');
  const dd = document.getElementById('pano-deepdive');
  if (!pano || !dd) return;
  dd.classList.add('hidden');
  pano.classList.remove('hidden');
  ddState.current = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Cambia range dentro il deep dive (mirror della toolbar panoramica) */
function setDdRange(preset) {
  const today = new Date();
  const todayStrV = toLocalDateStr(today);
  let from = null, to = todayStrV;
  if (preset === '7d') { const d = new Date(today); d.setDate(d.getDate() - 6); from = toLocalDateStr(d); }
  else if (preset === '30d') { const d = new Date(today); d.setDate(d.getDate() - 29); from = toLocalDateStr(d); }
  else if (preset === '90d') { const d = new Date(today); d.setDate(d.getDate() - 89); from = toLocalDateStr(d); }
  else if (preset === 'season') {
    from = currentStabilimento?.data_inizio_stagione || (today.getFullYear() + '-06-01');
    const fine = currentStabilimento?.data_fine_stagione || (today.getFullYear() + '-09-15');
    to = fine < todayStrV ? fine : todayStrV;
  } else {
    const fromEl = document.getElementById('dd-range-from');
    const toEl = document.getElementById('dd-range-to');
    if (fromEl?.value && toEl?.value) { from = fromEl.value; to = toEl.value; }
    else { const d = new Date(today); d.setDate(d.getDate() - 6); from = toLocalDateStr(d); }
  }
  ddState.from = from;
  ddState.to = to;
  ddState.preset = preset;
  syncDdToolbar();
  reloadCurrentDd();
}

function onDdCustomRange() {
  const from = document.getElementById('dd-range-from').value;
  const to = document.getElementById('dd-range-to').value;
  if (!from || !to || from > to) return;
  ddState.from = from;
  ddState.to = to;
  ddState.preset = 'custom';
  syncDdToolbar();
  reloadCurrentDd();
}

function onDdCompareToggle() {
  ddState.compare = document.getElementById('dd-compare').checked;
  reloadCurrentDd();
}

function syncDdToolbar() {
  document.querySelectorAll('.dd-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === ddState.preset);
  });
  const fromEl = document.getElementById('dd-range-from');
  const toEl = document.getElementById('dd-range-to');
  if (fromEl && fromEl.value !== ddState.from) fromEl.value = ddState.from;
  if (toEl && toEl.value !== ddState.to) toEl.value = ddState.to;
  const label = document.getElementById('dd-range-label');
  if (label) label.textContent = labelRange(ddState.from, ddState.to);
  const cmp = document.getElementById('dd-compare');
  if (cmp) cmp.checked = ddState.compare;
}

function reloadCurrentDd() {
  if (ddState.current === 'disponibilita') ddLoadDisponibilita();
  else if (ddState.current === 'prenotazioni') ddLoadPrenotazioni();
  else if (ddState.current === 'coin-distr') ddLoadCoinDistr();
  else if (ddState.current === 'coin-spent') ddLoadCoinSpent();
}

function ddExport() {
  if (!ddState.lastRows || !ddState.lastRows.length) {
    alert('Nessun dato da esportare in questo periodo.');
    return;
  }
  exportXlsx(ddState.lastRows, ddState.lastFilename, deepDiveTitle(ddState.current));
}

// ============================================================
// DEEP DIVE — DISPONIBILITÀ (stub Consegna 2)
// ============================================================

async function ddLoadDisponibilita() {
  const body = document.getElementById('dd-body-disponibilita');
  if (!body) return;
  body.innerHTML = '<div class="dd-placeholder">La versione estesa con grafici, fonti e confronto arriva nella Consegna 2. Per ora usa la tab Ombrelloni per la mappa.</div>';
  ddState.lastRows = [];
  ddState.lastFilename = 'disponibilita';
}

async function ddLoadPrenotazioni() {
  const body = document.getElementById('dd-body-prenotazioni');
  if (!body) return;
  body.innerHTML = '<div class="dd-placeholder">La versione estesa con funnel, tempo medio di piazzamento e mix multi-giorno arriva nella Consegna 2. Per ora usa la tab Prenotazioni.</div>';
  ddState.lastRows = [];
  ddState.lastFilename = 'prenotazioni';
}

async function ddLoadCoinDistr() {
  const body = document.getElementById('dd-body-coin-distr');
  if (!body) return;
  body.innerHTML = '<div class="dd-placeholder">La versione estesa con heatmap ora/giorno e top cliente/ombrellone arriva nella Consegna 2. Per ora usa la tab Crediti.</div>';
  ddState.lastRows = [];
  ddState.lastFilename = 'coin-distribuiti';
}

async function ddLoadCoinSpent() {
  const body = document.getElementById('dd-body-coin-spent');
  if (!body) return;
  body.innerHTML = '<div class="dd-placeholder">La versione estesa con pie chart per categoria (bar/ristorante/altro), top spender e tempo distr→spent arriva nella Consegna 2. Per ora usa la tab Crediti.</div>';
  ddState.lastRows = [];
  ddState.lastFilename = 'coin-spesi';
}

// ============================================================
// INIT
// ============================================================

/** Chiamata una volta all'apertura del tab Panoramica. */
function panoramicaInit() {
  if (!panoramicaState.from) {
    setPanoramicaRange('7d'); // default
  } else {
    syncPanoramicaToolbar();
    panoramicaLoad();
  }
}
