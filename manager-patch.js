// js/dd-common.js — helpers condivisi tra Panoramica e Deep Dive
// Esposti come globals (coerente con lo stile del resto del progetto, no module/import).

/**
 * Converte un range in querystring ISO (YYYY-MM-DD), clampato a oggi se end > oggi.
 * Input:  {from: '2026-05-01', to: '2026-05-31'}
 * Output: {fromISO: '2026-05-01T00:00:00Z', toISO: '2026-05-31T23:59:59.999Z'}
 */
function dateRangeQS(from, to) {
  if (!from || !to) return null;
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T23:59:59.999');
  return {
    fromISO: fromDate.toISOString(),
    toISO: toDate.toISOString(),
    fromStr: from,
    toStr: to,
    days: Math.round((toDate - fromDate) / 86400000) + 1
  };
}

/**
 * Dato un range {from,to} restituisce il range di confronto del periodo precedente
 * di pari durata (utile per calcolo delta %).
 */
function previousRange(from, to) {
  if (!from || !to) return null;
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    from: toLocalDateStr(prevStart),
    to: toLocalDateStr(prevEnd)
  };
}

/**
 * Delta % tra current e previous. Ritorna null se previous=0 (non comparabile).
 * Se current=0 e previous>0 → -100. Se current>0 e previous=0 → null (mostra "nuovo" in UI).
 */
function computeDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0 && c === 0) return 0;
  if (p === 0) return null; // non comparabile
  return Math.round(((c - p) / p) * 100);
}

/**
 * Formatta un delta come stringa colorata. Esempio:
 *   formatDeltaHTML(12)  → '<span class="kpi-delta-pos">▲ 12%</span>'
 *   formatDeltaHTML(-8)  → '<span class="kpi-delta-neg">▼ 8%</span>'
 *   formatDeltaHTML(0)   → '<span class="kpi-delta-flat">= stabile</span>'
 *   formatDeltaHTML(null)→ '<span class="kpi-delta-flat">· nuovo</span>'
 */
function formatDeltaHTML(delta) {
  if (delta === null || typeof delta === 'undefined') {
    return '<span class="kpi-delta-flat">· nuovo</span>';
  }
  if (delta > 0) return `<span class="kpi-delta-pos">▲ ${delta}%</span>`;
  if (delta < 0) return `<span class="kpi-delta-neg">▼ ${Math.abs(delta)}%</span>`;
  return '<span class="kpi-delta-flat">= stabile</span>';
}

/**
 * Renderizza una sparkline SVG dentro un <svg> esistente.
 * @param {SVGElement} svgEl  - il nodo <svg> (viewBox 0 0 160 40)
 * @param {number[]}   values - serie di punti
 * @param {string}     color  - colore linea (fallback currentColor)
 */
function renderSparkline(svgEl, values, color) {
  if (!svgEl) return;
  svgEl.innerHTML = '';
  if (!values || values.length < 2) return;
  const W = 160, H = 40, PAD = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (W - PAD * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (H - PAD * 2) * (1 - (v - min) / span);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const lastX = pts[pts.length - 1][0].toFixed(1);
  const lastY = pts[pts.length - 1][1].toFixed(1);
  // Area sotto la linea (gradient via opacity)
  const areaD = `${d} L${lastX},${H - PAD} L${pts[0][0].toFixed(1)},${H - PAD} Z`;
  const fill = color || 'currentColor';
  svgEl.innerHTML = `
    <path d="${areaD}" fill="${fill}" opacity="0.12"></path>
    <path d="${d}" fill="none" stroke="${fill}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${fill}"></circle>
  `;
}

/**
 * Raggruppa una lista di record per giorno (campo 'data' o 'created_at').
 * Ritorna una Map<YYYY-MM-DD, number> con la somma/count aggregata.
 *
 * @param {Object[]} records
 * @param {string}   dateField      - nome campo data (es. 'data' o 'created_at')
 * @param {string?}  sumField       - se presente somma questo campo; altrimenti conta
 * @param {boolean?} isTimestamp    - se true tratta dateField come ISO timestamp
 */
function groupByDay(records, dateField, sumField, isTimestamp) {
  const map = new Map();
  (records || []).forEach(r => {
    let key = r[dateField];
    if (!key) return;
    if (isTimestamp) key = key.slice(0, 10); // 'YYYY-MM-DD' from ISO
    const prev = map.get(key) || 0;
    const add = sumField ? parseFloat(r[sumField] || 0) : 1;
    map.set(key, prev + add);
  });
  return map;
}

/**
 * Genera array di YYYY-MM-DD per tutti i giorni del range (inclusi).
 */
function dateRangeDays(from, to) {
  const out = [];
  if (!from || !to) return out;
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    out.push(toLocalDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Riempie la serie usando i giorni del range; per ogni giorno
 * legge il valore dalla map (default 0). Usata per sparkline e grafici.
 */
function fillSeries(map, from, to) {
  return dateRangeDays(from, to).map(d => map.get(d) || 0);
}

/**
 * Esporta un array di oggetti in un file .xlsx scaricato.
 * @param {Object[]} rows   - righe (ogni oggetto = una riga)
 * @param {string}   name   - nome base del file (senza .xlsx)
 * @param {string?}  sheet  - nome foglio (default 'Dati')
 */
function exportXlsx(rows, name, sheet) {
  if (!rows || !rows.length) {
    alert('Nessun dato da esportare.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('Libreria Excel non caricata.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet || 'Dati');
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${name}_${ts}.xlsx`);
}

/**
 * Label breve italiano di un range (usato nelle pill di contesto).
 *   labelRange('2026-05-01','2026-05-31') → '1 mag – 31 mag'
 */
function labelRange(from, to) {
  if (!from || !to) return '';
  const fmt = (s) => {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  };
  if (from === to) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}
