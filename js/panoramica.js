// js/panoramica.js — Panoramica manager SpiaggiaMia
//
// Esporta globals: panoramicaInit, panoramicaLoad, setPanoramicaRange,
//                  setChartGranularity, setTopSort
//
// Dipendenze globali attese (caricate PRIMA di questo file):
//   sb (Supabase client), currentStabilimento, ombrelloniList, clientiList,
//   formatCoin, coinName, toLocalDateStr, todayStr, formatDate, escapeHtml,
//   showLoading, hideLoading, flatpickr,
//   dd-common.js (renderSparkline, groupByDay, fillSeries, dateRangeDays)

// ============================================================
// STATO
// ============================================================

const panoramicaState = {
  from: null,
  to: null,
  preset: 'season',  // '7d'|'30d'|'90d'|'season'|'custom'
  data: null,        // { dispRows, distrRows, spentRows } cache del fetch corrente
};

const chartState = {
  gran: { disp: 'day', coin: 'day' },   // 'day'|'week'|'month'
  topSort: { usage: 'dichiarate', coin: 'ricevuti' },
};

let panoramicaRangePickerInstance = null;

// ============================================================
// TOOLBAR PERIODO
// ============================================================

function panoramicaPresetDates(preset) {
  const today = new Date();
  const todayStrV = toLocalDateStr(today);
  if (preset === 'season') {
    const inizio = currentStabilimento?.data_inizio_stagione || (today.getFullYear() + '-06-01');
    const fine = currentStabilimento?.data_fine_stagione || (today.getFullYear() + '-09-15');
    return { from: inizio, to: fine };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 7;
  const d = new Date(today); d.setDate(d.getDate() - (days - 1));
  return { from: toLocalDateStr(d), to: todayStrV };
}

function setPanoramicaRange(preset) {
  const { from, to } = panoramicaPresetDates(preset);
  panoramicaState.from = from;
  panoramicaState.to = to;
  panoramicaState.preset = preset;
  const fromHidden = document.getElementById('pano-date-from');
  const toHidden = document.getElementById('pano-date-to');
  if (fromHidden) fromHidden.value = from;
  if (toHidden) toHidden.value = to;
  if (panoramicaRangePickerInstance) {
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    panoramicaRangePickerInstance.setDate([fromDate, toDate], false);
  }
  updatePanoramicaPresetActive();
  panoramicaLoad();
}

function initPanoramicaRangePicker(from, to) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('pano-range-picker');
  if (!input) return;
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  if (panoramicaRangePickerInstance) {
    panoramicaRangePickerInstance.setDate([fromDate, toDate], false);
    return;
  }
  panoramicaRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [fromDate, toDate],
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length !== 2) return;
      const f = toLocalDateStr(selectedDates[0]);
      const t = toLocalDateStr(selectedDates[1]);
      panoramicaState.from = f;
      panoramicaState.to = t;
      panoramicaState.preset = 'custom';
      const fh = document.getElementById('pano-date-from');
      const th = document.getElementById('pano-date-to');
      if (fh) fh.value = f;
      if (th) th.value = t;
      updatePanoramicaPresetActive();
      panoramicaLoad();
    },
  });
}

function updatePanoramicaPresetActive() {
  const preset = panoramicaState.preset;
  document.querySelectorAll('.pano-preset-btn').forEach(btn => {
    const active = btn.dataset.preset === preset;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-outline', !active);
  });
}

// ============================================================
// LOAD + RENDER
// ============================================================

async function panoramicaLoad() {
  if (!currentStabilimento || !panoramicaState.from || !panoramicaState.to) return;

  // Coin label dinamico (header + legende)
  document.querySelectorAll('[data-coin-unit]').forEach(el => { el.textContent = coinName(currentStabilimento); });
  document.querySelectorAll('[data-coin-unit-prefix]').forEach(el => { el.textContent = coinName(currentStabilimento); });
  const trendT = document.querySelector('[data-coin-trend-title]');
  if (trendT) trendT.textContent = `Andamento ${coinName(currentStabilimento)}`;
  const topT = document.querySelector('[data-coin-top-title]');
  if (topT) topT.textContent = `Top 5 ombrelloni — ${coinName(currentStabilimento)}`;

  if (!ombrelloniList || !ombrelloniList.length) {
    ['pano-kpi-disp','pano-kpi-pren','pano-kpi-distr','pano-kpi-spent'].forEach(id => {
      const el = document.getElementById(`${id}-val`); if (el) el.textContent = '0';
    });
    ['pano-chart-disp','pano-chart-coin','pano-top-usage','pano-top-coin'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = '<div class="pano-chart-empty">Nessun ombrellone configurato.</div>';
    });
    return;
  }

  showLoading();
  try {
    const { from, to } = panoramicaState;
    const ombIds = ombrelloniList.map(o => o.id);

    const [dispCur, distrCur, spentCur] = await Promise.all([
      sb.from('disponibilita').select('ombrellone_id,data,stato')
        .in('ombrellone_id', ombIds).gte('data', from).lte('data', to),
      sb.from('transazioni').select('ombrellone_id,cliente_id,importo,created_at')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto')
        .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59'),
      sb.from('transazioni').select('ombrellone_id,cliente_id,importo,created_at')
        .eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_usato')
        .gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59'),
    ]);

    panoramicaState.data = {
      dispRows: dispCur.data || [],
      distrRows: distrCur.data || [],
      spentRows: spentCur.data || [],
    };

    renderKpis();
    updateGranularityEnabled();
    renderTrendCharts();
    renderTopCharts();
  } finally {
    hideLoading();
  }
}

function renderKpis() {
  const { dispRows, distrRows, spentRows } = panoramicaState.data;
  const dispCount = dispRows.filter(r => r.stato === 'libero' || r.stato === 'sub_affittato').length;
  const prenCount = dispRows.filter(r => r.stato === 'sub_affittato').length;
  const distrSum = distrRows.reduce((s, r) => s + parseFloat(r.importo || 0), 0);
  const spentSum = spentRows.reduce((s, r) => s + parseFloat(r.importo || 0), 0);

  const setKpi = (prefix, value, isCoin, sparkValues) => {
    const valEl = document.getElementById(`${prefix}-val`);
    const sparkEl = document.getElementById(`${prefix}-spark`);
    if (valEl) valEl.textContent = isCoin ? parseFloat(value || 0).toFixed(2) : String(value || 0);
    if (sparkEl) renderSparkline(sparkEl, sparkValues, getComputedStyle(sparkEl).color || null);
  };

  const { from, to } = panoramicaState;
  const sparkDisp = fillSeries(groupByDay(dispRows.filter(r => r.stato === 'libero' || r.stato === 'sub_affittato'), 'data'), from, to);
  const sparkPren = fillSeries(groupByDay(dispRows.filter(r => r.stato === 'sub_affittato'), 'data'), from, to);
  const sparkDistr = fillSeries(groupByDay(distrRows, 'created_at', 'importo', true), from, to);
  const sparkSpent = fillSeries(groupByDay(spentRows, 'created_at', 'importo', true), from, to);

  setKpi('pano-kpi-disp', dispCount, false, sparkDisp);
  setKpi('pano-kpi-pren', prenCount, false, sparkPren);
  setKpi('pano-kpi-distr', distrSum, true, sparkDistr);
  setKpi('pano-kpi-spent', spentSum, true, sparkSpent);
}

// ============================================================
// GRANULARITÀ + TREND CHARTS
// ============================================================

function setChartGranularity(chart, gran) {
  chartState.gran[chart] = gran;
  document.querySelectorAll(`[data-chart="${chart}"] .pano-gran-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.gran === gran);
  });
  if (chart === 'disp') renderTrendChart('disp');
  else if (chart === 'coin') renderTrendChart('coin');
}

function updateGranularityEnabled() {
  const days = dateRangeDays(panoramicaState.from, panoramicaState.to).length;
  ['disp', 'coin'].forEach(chart => {
    document.querySelectorAll(`[data-chart="${chart}"] .pano-gran-btn`).forEach(btn => {
      const gran = btn.dataset.gran;
      let disable = false;
      if (gran === 'week' && days < 7) disable = true;
      if (gran === 'month' && days < 28) disable = true;
      btn.disabled = disable;
      btn.classList.toggle('disabled', disable);
    });
    if (chartState.gran[chart] === 'month' && days < 28) chartState.gran[chart] = 'day';
    if (chartState.gran[chart] === 'week' && days < 7) chartState.gran[chart] = 'day';
    document.querySelectorAll(`[data-chart="${chart}"] .pano-gran-btn`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.gran === chartState.gran[chart]);
    });
  });
}

function bucketKeyFor(dateStr, gran) {
  if (gran === 'day') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  if (gran === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  // week → monday della settimana ISO
  const dow = d.getDay();                  // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // distanza da lunedì
  const monday = new Date(d); monday.setDate(d.getDate() + offset);
  return toLocalDateStr(monday);
}

function bucketKeysForRange(from, to, gran) {
  const out = [];
  const seen = new Set();
  dateRangeDays(from, to).forEach(dStr => {
    const k = bucketKeyFor(dStr, gran);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  });
  return out;
}

function bucketLabel(key, gran) {
  if (gran === 'month') {
    const [y, m] = key.split('-');
    const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
  }
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function aggregateByBucket(rows, dateField, valField, isTimestamp, gran) {
  const map = new Map();
  (rows || []).forEach(r => {
    let dateStr = r[dateField];
    if (!dateStr) return;
    if (isTimestamp) dateStr = String(dateStr).slice(0, 10);
    const key = bucketKeyFor(dateStr, gran);
    const add = valField ? parseFloat(r[valField] || 0) : 1;
    map.set(key, (map.get(key) || 0) + add);
  });
  return map;
}

function renderTrendCharts() {
  renderTrendChart('disp');
  renderTrendChart('coin');
}

function renderTrendChart(chart) {
  const target = document.getElementById(`pano-chart-${chart}`);
  if (!target) return;
  if (!panoramicaState.data) return;
  const { dispRows, distrRows, spentRows } = panoramicaState.data;
  const { from, to } = panoramicaState;
  const gran = chartState.gran[chart];

  const buckets = bucketKeysForRange(from, to, gran);
  let mapA, mapB, colorA, colorB, isCoin;
  if (chart === 'disp') {
    mapA = aggregateByBucket(dispRows.filter(r => r.stato === 'libero' || r.stato === 'sub_affittato'), 'data', null, false, gran);
    mapB = aggregateByBucket(dispRows.filter(r => r.stato === 'sub_affittato'), 'data', null, false, gran);
    colorA = 'var(--ocean,#1B6CA8)';
    colorB = 'var(--coral,#E07B54)';
    isCoin = false;
  } else {
    mapA = aggregateByBucket(distrRows, 'created_at', 'importo', true, gran);
    mapB = aggregateByBucket(spentRows, 'created_at', 'importo', true, gran);
    colorA = '#0A7C4A';
    colorB = 'var(--coral,#E07B54)';
    isCoin = true;
  }
  const seriesA = buckets.map(k => mapA.get(k) || 0);
  const seriesB = buckets.map(k => mapB.get(k) || 0);

  if (!seriesA.some(v => v > 0) && !seriesB.some(v => v > 0)) {
    target.innerHTML = '<div class="pano-chart-empty">Nessun dato nel periodo.</div>';
    return;
  }

  drawGroupedBars(target, buckets.map(k => bucketLabel(k, gran)), seriesA, seriesB, colorA, colorB, isCoin);
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

function drawGroupedBars(target, labels, seriesA, seriesB, colorA, colorB, isCoin) {
  const N = labels.length;
  const W = 800, H = 240;
  const PL = 48, PR = 16, PT = 12, PB = 56;
  const innerW = W - PL - PR;
  const innerH = H - PT - PB;
  const max = Math.max(1, ...seriesA, ...seriesB);
  const niceMax = niceCeil(max);
  const bucketW = innerW / N;
  const barGap = N > 30 ? 1 : 2;
  const barW = Math.max(1.5, (bucketW - barGap) / 2 - 1);
  const yScale = (v) => PT + innerH * (1 - v / niceMax);

  const fmt = isCoin ? (v) => parseFloat(v || 0).toFixed(2) : (v) => String(Math.round(v));

  // Grid + Y ticks (5)
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax * i) / ticks;
    const y = PT + innerH * (1 - i / ticks);
    grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#E8EBEE" stroke-width="1"/>`;
    grid += `<text x="${PL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#5C6570">${fmt(v)}</text>`;
  }

  // Bars
  let bars = '';
  for (let i = 0; i < N; i++) {
    const xCenter = PL + bucketW * (i + 0.5);
    const xA = xCenter - barW - barGap / 2;
    const xB = xCenter + barGap / 2;
    const yA = yScale(seriesA[i]);
    const yB = yScale(seriesB[i]);
    const hA = (PT + innerH) - yA;
    const hB = (PT + innerH) - yB;
    const tA = `${labels[i]}: ${fmt(seriesA[i])}`;
    const tB = `${labels[i]}: ${fmt(seriesB[i])}`;
    bars += `<rect x="${xA.toFixed(1)}" y="${yA.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, hA).toFixed(1)}" fill="${colorA}"><title>${escapeHtml(tA)}</title></rect>`;
    bars += `<rect x="${xB.toFixed(1)}" y="${yB.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, hB).toFixed(1)}" fill="${colorB}"><title>${escapeHtml(tB)}</title></rect>`;
  }

  // X labels (max ~12 visibili per non sovrapporsi)
  const labelStep = Math.max(1, Math.ceil(N / 12));
  let xLabels = '';
  for (let i = 0; i < N; i++) {
    if (i % labelStep !== 0) continue;
    const x = PL + bucketW * (i + 0.5);
    const y = PT + innerH + 16;
    xLabels += `<text x="${x.toFixed(1)}" y="${y}" text-anchor="middle" font-size="10" fill="#5C6570">${escapeHtml(labels[i])}</text>`;
  }

  target.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="pano-trend-svg">` +
    grid + bars + xLabels +
    `</svg>`;
}

// ============================================================
// TOP 5 OMBRELLONI
// ============================================================

function setTopSort(chart, sort) {
  chartState.topSort[chart] = sort;
  document.querySelectorAll(`[data-chart="top-${chart}"] .pano-gran-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sort);
  });
  renderTopCharts(chart);
}

function clientLabelFor(ombId) {
  const c = (clientiList || []).find(x => !x.rifiutato && x.ombrellone_id === ombId);
  if (!c) return '—';
  return `${c.nome || ''} ${c.cognome || ''}`.trim() || '—';
}

function ombLabelFor(id) {
  const o = (ombrelloniList || []).find(x => x.id === id);
  return o ? `Fila ${o.fila} · N°${o.numero}` : 'Ombrellone';
}

function renderTopCharts(only) {
  if (!only || only === 'usage') renderTopUsage();
  if (!only || only === 'coin') renderTopCoin();
}

function renderTopUsage() {
  const target = document.getElementById('pano-top-usage');
  if (!target) return;
  if (!panoramicaState.data) return;
  const { dispRows } = panoramicaState.data;
  const dichByOmb = new Map();
  const subByOmb = new Map();
  dispRows.forEach(r => {
    if (r.stato === 'libero' || r.stato === 'sub_affittato') {
      dichByOmb.set(r.ombrellone_id, (dichByOmb.get(r.ombrellone_id) || 0) + 1);
    }
    if (r.stato === 'sub_affittato') {
      subByOmb.set(r.ombrellone_id, (subByOmb.get(r.ombrellone_id) || 0) + 1);
    }
  });
  const allIds = new Set([...dichByOmb.keys(), ...subByOmb.keys()]);
  const items = [...allIds].map(id => ({
    id,
    ombrellone: ombLabelFor(id),
    cliente: clientLabelFor(id),
    a: dichByOmb.get(id) || 0,   // dichiarate
    b: subByOmb.get(id) || 0,    // sub-affittate
  })).filter(it => it.a > 0 || it.b > 0);

  const sortKey = chartState.topSort.usage === 'subaffittate' ? 'b' : 'a';
  items.sort((x, y) => y[sortKey] - x[sortKey] || y.a - x.a);
  const top = items.slice(0, 5);

  drawTopBars(target, top, 'var(--ocean,#1B6CA8)', 'var(--coral,#E07B54)', false, 'Dichiarate', 'Sub-affittate');
}

function renderTopCoin() {
  const target = document.getElementById('pano-top-coin');
  if (!target) return;
  if (!panoramicaState.data) return;
  const { distrRows, spentRows } = panoramicaState.data;
  const ombByCliente = new Map();
  (clientiList || []).forEach(c => { if (c.ombrellone_id) ombByCliente.set(c.id, c.ombrellone_id); });
  const resolveOmb = (r) => r.ombrellone_id || (r.cliente_id ? ombByCliente.get(r.cliente_id) : null);
  const recByOmb = new Map();
  const speByOmb = new Map();
  distrRows.forEach(r => {
    const ombId = resolveOmb(r);
    if (!ombId) return;
    recByOmb.set(ombId, (recByOmb.get(ombId) || 0) + parseFloat(r.importo || 0));
  });
  spentRows.forEach(r => {
    const ombId = resolveOmb(r);
    if (!ombId) return;
    speByOmb.set(ombId, (speByOmb.get(ombId) || 0) + parseFloat(r.importo || 0));
  });
  const allIds = new Set([...recByOmb.keys(), ...speByOmb.keys()]);
  const items = [...allIds].map(id => ({
    id,
    ombrellone: ombLabelFor(id),
    cliente: clientLabelFor(id),
    a: recByOmb.get(id) || 0,
    b: speByOmb.get(id) || 0,
  })).filter(it => it.a > 0 || it.b > 0);

  const sortKey = chartState.topSort.coin === 'spesi' ? 'b' : 'a';
  items.sort((x, y) => y[sortKey] - x[sortKey] || y.a - x.a);
  const top = items.slice(0, 5);

  drawTopBars(target, top, '#0A7C4A', 'var(--coral,#E07B54)', true, 'Ricevuti', 'Spesi');
}

function drawTopBars(target, items, colorA, colorB, isCoin, labelA, labelB) {
  if (!items.length) {
    target.innerHTML = '<div class="pano-chart-empty">Nessun dato nel periodo.</div>';
    return;
  }
  const max = Math.max(1, ...items.flatMap(it => [it.a, it.b]));
  const fmt = (v) => isCoin ? parseFloat(v || 0).toFixed(2) : String(Math.round(v));

  target.innerHTML = items.map(it => `
    <div class="pano-top5-row">
      <div class="pano-top5-info">
        <div class="pano-top5-omb">${escapeHtml(it.ombrellone)}</div>
        <div class="pano-top5-cli">${escapeHtml(it.cliente)}</div>
      </div>
      <div class="pano-top5-bars">
        <div class="pano-top5-bar-row" title="${escapeHtml(labelA)}: ${fmt(it.a)}">
          <div class="pano-top5-bar-track">
            <div class="pano-top5-bar" style="width:${(it.a / max * 100).toFixed(1)}%;background:${colorA}"></div>
          </div>
          <span class="pano-top5-val">${fmt(it.a)}</span>
        </div>
        <div class="pano-top5-bar-row" title="${escapeHtml(labelB)}: ${fmt(it.b)}">
          <div class="pano-top5-bar-track">
            <div class="pano-top5-bar" style="width:${(it.b / max * 100).toFixed(1)}%;background:${colorB}"></div>
          </div>
          <span class="pano-top5-val">${fmt(it.b)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ============================================================
// INIT
// ============================================================

function panoramicaInit() {
  if (!panoramicaState.from) {
    const { from, to } = panoramicaPresetDates('season');
    panoramicaState.from = from;
    panoramicaState.to = to;
    panoramicaState.preset = 'season';
  }
  const fromHidden = document.getElementById('pano-date-from');
  const toHidden = document.getElementById('pano-date-to');
  if (fromHidden) fromHidden.value = panoramicaState.from;
  if (toHidden) toHidden.value = panoramicaState.to;
  initPanoramicaRangePicker(panoramicaState.from, panoramicaState.to);
  updatePanoramicaPresetActive();
  panoramicaLoad();
}
