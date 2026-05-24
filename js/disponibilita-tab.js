// Sotto-tab "Vedi disponibilità" del tab "Prenotazioni" del manager.
// Tabella ombrelloni × giorni con filtri, click → quick action.

const DISP_VIEW_MAX_DAYS = 31;

let dispRangePickerInstance = null;
let dispViewLoaded = false;       // vista già caricata almeno una volta
let dispViewStale = false;        // marcata da invalidate dopo create/cancel
let dispViewData = null;          // { from, to, dates, dispByOmbDate, ruleByDate, prenByDispId, regole }
let dispStabRegoleTipi = new Set(); // tipi di regole esistenti per lo stabilimento corrente

function switchPrenSubtab(name, btn) {
  document.querySelectorAll('.pren-subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.pren-subpanel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const el = document.querySelector(`.pren-subtab[data-pren-subtab="${name}"]`);
    if (el) el.classList.add('active');
  }
  const pane = document.getElementById('pren-sub-' + name);
  if (pane) pane.classList.add('active');

  if (name === 'vedi') {
    initDispView();
  }
  if (name === 'disponibilita-omb') {
    if (typeof avanzateInit === 'function') avanzateInit();
  }
}

function initDispView() {
  // Default: copia il range del primo tab; se non disponibile usa oggi.
  const fromMap = document.getElementById('map-date-from')?.value;
  const toMap = document.getElementById('map-date-to')?.value;
  const fromEl = document.getElementById('disp-date-from');
  const toEl = document.getElementById('disp-date-to');
  if (!fromEl.value) {
    const f = fromMap || todayStr();
    const t = toMap || f;
    fromEl.value = f;
    toEl.value = clampDispRange(f, t).to;
  }
  initDispRangePicker(fromEl.value, toEl.value);
  populateDispFilaCheckboxes();
  loadDispStabRegoleTipi().then(() => {
    renderDispLegend();
    updateDispRegoleVisibility();
  });

  if (!dispViewLoaded || dispViewStale) {
    loadDispView();
  } else {
    renderDispView();
  }
}

async function loadDispStabRegoleTipi() {
  if (!currentStabilimento) { dispStabRegoleTipi = new Set(); return; }
  const { data, error } = await sb.from('regole_stato_ombrelloni')
    .select('tipo')
    .eq('stabilimento_id', currentStabilimento.id);
  if (error) { console.error(error); dispStabRegoleTipi = new Set(); return; }
  dispStabRegoleTipi = new Set((data || []).map(r => r.tipo));
}

function updateDispRegoleVisibility() {
  const wrap = document.getElementById('disp-chk-regola-wrap');
  if (!wrap) return;
  const has = dispStabRegoleTipi.size > 0;
  wrap.classList.toggle('hidden', !has);
  if (!has) {
    const chk = wrap.querySelector('input[type=checkbox]');
    if (chk && chk.checked) { chk.checked = false; renderDispView(); }
  }
}

function clampDispRange(from, to) {
  if (!from) return { from: todayStr(), to: todayStr() };
  if (!to || to < from) to = from;
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const diff = Math.floor((end - start) / 86400000) + 1;
  if (diff > DISP_VIEW_MAX_DAYS) {
    const cap = new Date(start);
    cap.setDate(cap.getDate() + DISP_VIEW_MAX_DAYS - 1);
    to = toLocalDateStr(cap);
  }
  return { from, to };
}

function setDispRangePreset(days) {
  const today = todayStr();
  const startDate = new Date(today + 'T00:00:00');
  const endDate = new Date(today + 'T00:00:00');
  endDate.setDate(endDate.getDate() + days - 1);
  const endStr = toLocalDateStr(endDate);
  document.getElementById('disp-date-from').value = today;
  document.getElementById('disp-date-to').value = endStr;
  if (dispRangePickerInstance) dispRangePickerInstance.setDate([startDate, endDate], false);
  loadDispView();
}

function initDispRangePicker(fromStr, toStr) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('disp-range-picker');
  if (!input) return;
  const fromDate = new Date(fromStr + 'T00:00:00');
  const toDate = new Date(toStr + 'T00:00:00');
  if (dispRangePickerInstance) {
    dispRangePickerInstance.setDate([fromDate, toDate], false);
    return;
  }
  dispRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [fromDate, toDate],
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        let from = toLocalDateStr(selectedDates[0]);
        let to = toLocalDateStr(selectedDates[1]);
        const clamped = clampDispRange(from, to);
        if (clamped.to !== to) {
          alert(`Il range massimo è ${DISP_VIEW_MAX_DAYS} giorni: ho ridotto la data finale a ${formatDate(clamped.to)}.`);
          to = clamped.to;
          dispRangePickerInstance.setDate([new Date(from + 'T00:00:00'), new Date(to + 'T00:00:00')], false);
        }
        document.getElementById('disp-date-from').value = from;
        document.getElementById('disp-date-to').value = to;
        loadDispView();
      } else if (selectedDates.length === 1) {
        const f = toLocalDateStr(selectedDates[0]);
        document.getElementById('disp-date-from').value = f;
        document.getElementById('disp-date-to').value = f;
      }
    },
  });
}

function populateDispFilaCheckboxes() {
  const wrap = document.getElementById('disp-filter-file');
  if (!wrap) return;
  const file = Array.from(new Set((ombrelloniList || []).map(o => o.fila))).sort();
  if (!file.length) {
    wrap.innerHTML = '<span style="color:var(--text-light);font-size:12px">Nessuna fila</span>';
    return;
  }
  // Conserva spunte già presenti.
  const prev = new Set(
    Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value)
  );
  const allChecked = prev.size === 0; // default: tutte attive
  wrap.innerHTML = file.map(f => {
    const checked = allChecked || prev.has(f) ? 'checked' : '';
    return `<label class="disp-chk"><input type="checkbox" value="${escapeHtml(f)}" ${checked} onchange="renderDispView()"> ${escapeHtml(f)}</label>`;
  }).join('');
}

function renderDispLegend() {
  const el = document.getElementById('disp-legend');
  if (!el) return;
  const items = [
    { cls: 'disp-cell-libero', label: 'Disponibile - Stagionale Assegnato' },
    { cls: 'disp-cell-default-libero', label: 'Disponibile - NO Assegnato ad uno Stagionale' },
    { cls: 'disp-cell-subaffittato', label: 'Sub-affittato' },
    { cls: 'disp-cell-occupato', label: 'Non subaffittabile' },
  ];
  if (dispStabRegoleTipi.has('chiusura_speciale')) items.push({ cls: 'disp-cell-chiusura', label: 'Chiusura speciale' });
  if (dispStabRegoleTipi.has('sempre_libero')) items.push({ cls: 'disp-cell-sempre-libero', label: 'Sempre subaffittabile' });
  if (dispStabRegoleTipi.has('mai_libero')) items.push({ cls: 'disp-cell-mai-libero', label: 'Mai subaffittabile' });
  items.push({ cls: 'disp-cell-fuori-stagione', label: 'Fuori stagione' });
  el.innerHTML = items.map(i =>
    `<span class="legend-item"><span class="legend-swatch ${i.cls}"></span>${i.label}</span>`
  ).join('');
}

function dispViewMarkStale() {
  dispViewStale = true;
}

async function loadDispView() {
  const wrap = document.getElementById('disp-table-wrap');
  if (!wrap) return;
  const from = document.getElementById('disp-date-from').value;
  const to = document.getElementById('disp-date-to').value || from;
  if (!from || !currentStabilimento) return;
  const dates = getDatesInRange(from, to);
  if (!dates.length) return;

  wrap.innerHTML = '<div class="tx-empty">Caricamento...</div>';

  const ombIds = (ombrelloniList || []).map(o => o.id);
  if (!ombIds.length) {
    wrap.innerHTML = '<div class="tx-empty">Nessun ombrellone configurato.</div>';
    return;
  }

  const [{ data: disp, error: e1 }, { data: regole, error: e2 }] = await Promise.all([
    fetchAllPaginated(() => sb.from('disponibilita').select('*').gte('data', from).lte('data', to).in('ombrellone_id', ombIds)),
    sb.from('regole_stato_ombrelloni').select('*').eq('stabilimento_id', currentStabilimento.id).gte('data_a', from).lte('data_da', to),
  ]);
  if (e1 || e2) {
    wrap.innerHTML = '<div class="tx-empty">Errore nel caricamento</div>';
    console.error(e1 || e2);
    return;
  }

  // Mappa singolo giorno: { ombId: { data: { stato, cliente_id, id, nome_prenotazione } } }
  const dispByOmbDate = {};
  (disp || []).forEach(d => {
    if (!dispByOmbDate[d.ombrellone_id]) dispByOmbDate[d.ombrellone_id] = {};
    dispByOmbDate[d.ombrellone_id][d.data] = {
      id: d.id,
      stato: d.stato,
      cliente_id: d.cliente_id || null,
      nome_prenotazione: d.nome_prenotazione || null,
    };
  });

  // Regole: precedenza chiusura_speciale > mai_libero > sempre_libero (come refreshMap).
  const ruleByDate = {};
  const rulePri = { sempre_libero: 1, mai_libero: 2, chiusura_speciale: 3 };
  (regole || []).forEach(r => {
    for (const d of dates) {
      if (d < r.data_da || d > r.data_a) continue;
      if (!ruleByDate[d] || rulePri[r.tipo] > rulePri[ruleByDate[d]]) {
        ruleByDate[d] = r.tipo;
      }
    }
  });

  // Indice disp.id → riga (per quick-cancel).
  const prenByDispId = {};
  (disp || []).forEach(d => {
    if (d.stato === 'sub_affittato') prenByDispId[d.id] = d;
  });

  dispViewData = { from, to, dates, dispByOmbDate, ruleByDate, prenByDispId, regole: regole || [] };
  dispViewLoaded = true;
  dispViewStale = false;
  renderDispView();
}

function getDispCellState(ombId, date) {
  // Restituisce: { kind, label, info }
  // kind ∈ libero | default-libero | subaffittato | occupato | chiusura | sempre-libero | mai-libero | fuori-stagione
  const stab = currentStabilimento;
  const inizio = stab?.data_inizio_stagione;
  const fine = stab?.data_fine_stagione;
  if (inizio && fine && (date < inizio || date > fine)) {
    return { kind: 'fuori-stagione', label: 'Fuori stagione', info: '' };
  }
  const rule = dispViewData.ruleByDate[date];
  const ombDisp = (dispViewData.dispByOmbDate[ombId] || {})[date];

  // chiusura_speciale: priorità massima, niente sub-affitti residui (l'RPC li annulla).
  if (rule === 'chiusura_speciale') {
    return { kind: 'chiusura', label: 'Chiusura speciale', info: '' };
  }
  // sub_affittato real-time (anche se c'è un override sempre_libero non lo tocchiamo).
  if (ombDisp && ombDisp.stato === 'sub_affittato') {
    return { kind: 'subaffittato', label: 'Sub-affittato', info: '', disp: ombDisp };
  }
  if (rule === 'sempre_libero') {
    return { kind: 'sempre-libero', label: 'Sempre subaffittabile', info: '' };
  }
  if (rule === 'mai_libero') {
    return { kind: 'mai-libero', label: 'Mai subaffittabile', info: '' };
  }
  if (ombDisp && ombDisp.stato === 'libero') {
    if (ombDisp.cliente_id) return { kind: 'libero', label: 'Disponibile - Stagionale Assegnato', info: '' };
    return { kind: 'default-libero', label: 'Disponibile - NO Assegnato ad uno Stagionale', info: '' };
  }
  return { kind: 'occupato', label: 'Non subaffittabile', info: '' };
}

function renderDispView() {
  const wrap = document.getElementById('disp-table-wrap');
  if (!wrap || !dispViewData) return;

  const { dates } = dispViewData;
  const ombs = (ombrelloniList || []).slice();

  // Filtri
  const checkedFile = new Set(
    Array.from(document.querySelectorAll('#disp-filter-file input[type=checkbox]:checked')).map(i => i.value)
  );
  const stati = new Set(
    Array.from(document.querySelectorAll('.disp-chk input[type=checkbox][data-stato]:checked')).map(i => i.getAttribute('data-stato'))
  );
  const q = (document.getElementById('disp-search')?.value || '').trim().toLowerCase();

  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  // Filtro file: nasconde righe non spuntate.
  const filtered = ombs.filter(o => checkedFile.has(o.fila));

  // Filtro ricerca: filtra le righe (ombrelloni con cliente assegnato matchante OPPURE
  // con almeno una prenotazione nel range con cliente o nome_prenotazione matchante).
  // E in più evidenzia le celle matchanti.
  const matchOmbIds = new Set();
  const matchCells = new Set(); // "ombId|date"
  if (q) {
    filtered.forEach(o => {
      // Match per cliente assegnato all'ombrellone (anagrafica)
      const cli = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === o.id);
      if (cli) {
        const fullName = `${cli.nome || ''} ${cli.cognome || ''}`.toLowerCase();
        if (fullName.includes(q)) matchOmbIds.add(o.id);
      }
      // Match per disponibilita nel range (cliente sub-affitto o nome_prenotazione)
      const ombDisp = dispViewData.dispByOmbDate[o.id] || {};
      for (const date of dates) {
        const d = ombDisp[date];
        if (!d) continue;
        let m = false;
        if (d.nome_prenotazione && d.nome_prenotazione.toLowerCase().includes(q)) m = true;
        if (!m && d.cliente_id && cliById[d.cliente_id]) {
          const c = cliById[d.cliente_id];
          if (`${c.nome || ''} ${c.cognome || ''}`.toLowerCase().includes(q)) m = true;
        }
        if (m) {
          matchOmbIds.add(o.id);
          matchCells.add(`${o.id}|${date}`);
        }
      }
    });
  }

  const visibleOmbs = q ? filtered.filter(o => matchOmbIds.has(o.id)) : filtered;

  if (!visibleOmbs.length) {
    wrap.innerHTML = '<div class="tx-empty" style="padding:30px">Nessun ombrellone corrisponde ai filtri.</div>';
    return;
  }

  // Ordine: fila desc, poi numero asc (come la mappa).
  visibleOmbs.sort((a, b) => {
    if (a.fila !== b.fila) return a.fila < b.fila ? 1 : -1;
    return a.numero - b.numero;
  });

  // Header giorni
  const fmtDay = d => {
    const dt = new Date(d + 'T00:00:00');
    return {
      day: String(dt.getDate()).padStart(2, '0'),
      mese: dt.toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''),
      dow: dt.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', ''),
    };
  };
  const today = todayStr();
  const headHtml = `
    <thead>
      <tr>
        <th class="disp-th-row">Ombrellone</th>
        ${dates.map(d => {
          const f = fmtDay(d);
          const isToday = d === today;
          const todayStyle = isToday ? 'box-shadow:inset 0 -3px 0 var(--ocean);' : '';
          return `<th style="${todayStyle}" title="${escapeHtml(formatDate(d))}">
            <span class="dh-day">${f.day}</span>
            <span class="dh-mese">${escapeHtml(f.dow)} ${escapeHtml(f.mese)}</span>
          </th>`;
        }).join('')}
      </tr>
    </thead>`;

  // Body
  let prevFila = null;
  const bodyHtml = `<tbody>${visibleOmbs.map(o => {
    const isFirstOfFila = o.fila !== prevFila;
    prevFila = o.fila;
    const cells = dates.map(d => {
      const st = getDispCellState(o.id, d);
      const cellKey = `${o.id}|${d}`;
      let cls = 'disp-cell disp-cell-' + st.kind;
      if (q) {
        if (matchCells.has(cellKey)) cls += ' match';
        else cls += ' dimmed';
      }
      // Filtro stato (checkbox): se almeno una checkbox attiva, smorza non-corrispondenti.
      if (stati.size) {
        let belongs = false;
        if (stati.has('libero') && (st.kind === 'libero' || st.kind === 'default-libero' || st.kind === 'sempre-libero')) belongs = true;
        if (stati.has('subaffittato') && st.kind === 'subaffittato') belongs = true;
        if (stati.has('regola') && (st.kind === 'chiusura' || st.kind === 'sempre-libero' || st.kind === 'mai-libero')) belongs = true;
        if (!belongs && !cls.includes(' dimmed')) cls += ' dimmed';
      }
      const noAction = (st.kind === 'occupato' || st.kind === 'fuori-stagione' || st.kind === 'chiusura' || st.kind === 'mai-libero');
      if (noAction) cls += ' disp-cell-noaction';
      const tooltipBase = `${o.fila}${o.numero} · ${formatDate(d)} — ${st.label}`;
      const onclick = `onDispCellClick('${o.id}','${d}',event)`;
      return `<td class="${cls}" data-omb="${o.id}" data-date="${d}" data-kind="${st.kind}" title="${escapeHtml(tooltipBase)}" onclick="${onclick}"></td>`;
    }).join('');
    const rowCls = isFirstOfFila && prevFila !== null ? 'disp-row-fila-start' : '';
    return `<tr class="${rowCls}"><th class="disp-th-row" scope="row">Fila ${escapeHtml(o.fila)} N°${o.numero}</th>${cells}</tr>`;
  }).join('')}</tbody>`;

  wrap.innerHTML = `<table class="disp-table">${headHtml}${bodyHtml}</table>`;
}

// ---- Click su cella → quick action --------------------------------------

function onDispCellClick(ombId, date, ev) {
  closeDispPopover();
  const omb = (ombrelloniList || []).find(o => o.id === ombId);
  if (!omb || !dispViewData) return;
  const st = getDispCellState(ombId, date);
  const cellEl = ev?.target?.closest?.('td');
  if (!cellEl) return;

  if (st.kind === 'libero' || st.kind === 'default-libero' || st.kind === 'sempre-libero') {
    showDispPopoverFree(cellEl, omb, date);
  } else if (st.kind === 'subaffittato') {
    showDispPopoverSubaffittato(cellEl, omb, date, st.disp);
  } else {
    // occupato / chiusura / mai-libero / fuori-stagione: solo info.
    showDispPopoverInfo(cellEl, omb, date, st);
  }
}

let _dispPopoverEl = null;
let _dispPopoverDismissBound = null;

function dispPopoverDismiss(ev) {
  if (!_dispPopoverEl) return;
  if (_dispPopoverEl.contains(ev.target)) return;
  // Anche un click su un'altra cella della tabella deve chiudere il popover
  // prima che onDispCellClick lo riapra: non bloccare la propagazione.
  closeDispPopover();
}

function buildPopover(html, anchorEl) {
  closeDispPopover();
  const pop = document.createElement('div');
  pop.className = 'disp-popover';
  pop.innerHTML = html;
  document.body.appendChild(pop);

  const rect = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = rect.left + window.scrollX + rect.width / 2 - pw / 2;
  let top = rect.bottom + window.scrollY + 6;
  if (left < 8) left = 8;
  if (left + pw > document.documentElement.clientWidth - 8) {
    left = document.documentElement.clientWidth - 8 - pw;
  }
  if (top + ph > window.scrollY + window.innerHeight - 8) {
    top = rect.top + window.scrollY - ph - 6;
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  _dispPopoverEl = pop;
  _dispPopoverDismissBound = dispPopoverDismiss;
  // Listener persistente (rimosso in closeDispPopover).
  setTimeout(() => {
    document.addEventListener('click', _dispPopoverDismissBound, true);
  }, 0);
  return pop;
}

function closeDispPopover() {
  if (_dispPopoverDismissBound) {
    document.removeEventListener('click', _dispPopoverDismissBound, true);
    _dispPopoverDismissBound = null;
  }
  if (_dispPopoverEl) { _dispPopoverEl.remove(); _dispPopoverEl = null; }
}

function showDispPopoverFree(cellEl, omb, date) {
  const html = `
    <button class="disp-pop-close" onclick="closeDispPopover()" aria-label="Chiudi">×</button>
    <h4>Fila ${escapeHtml(omb.fila)} N°${omb.numero} · ${escapeHtml(formatDate(date))}</h4>
    <div class="disp-pop-meta">Ombrellone subaffittabile in questo giorno.</div>
    <div class="disp-pop-actions">
      <button class="btn btn-primary btn-sm" onclick="dispGoToCreate('${omb.id}','${date}')">Crea prenotazione</button>
    </div>
  `;
  _dispPopoverEl = buildPopover(html, cellEl);
}

function showDispPopoverSubaffittato(cellEl, omb, date, disp) {
  const cli = disp?.cliente_id ? (clientiList || []).find(c => c.id === disp.cliente_id) : null;
  const cliLabel = cli ? `${escapeHtml(cli.nome)} ${escapeHtml(cli.cognome)}` : '<span style="color:var(--text-light)">nessuno stagionale</span>';
  const importo = formatCoin(parseFloat(omb.credito_giornaliero || 0).toFixed(2), currentStabilimento);
  const nome = disp?.nome_prenotazione ? `<div><strong>Prenotazione:</strong> ${escapeHtml(disp.nome_prenotazione)}</div>` : '';
  const html = `
    <button class="disp-pop-close" onclick="closeDispPopover()" aria-label="Chiudi">×</button>
    <h4>Fila ${escapeHtml(omb.fila)} N°${omb.numero} · ${escapeHtml(formatDate(date))}</h4>
    <div class="disp-pop-meta">
      ${nome}
      <div><strong>Stagionale:</strong> ${cliLabel}</div>
      <div><strong>Importo giorno:</strong> ${importo}</div>
    </div>
    <div class="disp-pop-actions">
      <button class="btn btn-coral btn-sm" onclick="dispCancelDisp('${disp.id}')">Annulla questo giorno</button>
    </div>
  `;
  _dispPopoverEl = buildPopover(html, cellEl);
}

function showDispPopoverInfo(cellEl, omb, date, st) {
  const html = `
    <button class="disp-pop-close" onclick="closeDispPopover()" aria-label="Chiudi">×</button>
    <h4>Fila ${escapeHtml(omb.fila)} N°${omb.numero} · ${escapeHtml(formatDate(date))}</h4>
    <div class="disp-pop-meta">${escapeHtml(st.label)}.</div>
  `;
  _dispPopoverEl = buildPopover(html, cellEl);
}

// Vai al primo tab pre-compilando ombrellone + range 1 giorno.
function dispGoToCreate(ombId, date) {
  closeDispPopover();
  const omb = (ombrelloniList || []).find(o => o.id === ombId);
  if (!omb) return;

  // Imposta range mappa = singolo giorno.
  document.getElementById('map-date-from').value = date;
  document.getElementById('map-date-to').value = date;
  if (typeof mapRangePickerInstance !== 'undefined' && mapRangePickerInstance) {
    const dt = new Date(date + 'T00:00:00');
    mapRangePickerInstance.setDate([dt, dt], false);
  }

  // Reset selezione e aggiunge l'ombrellone.
  if (typeof bookingSelection !== 'undefined') {
    bookingSelection.clear();
    bookingSelection.add(ombId);
  }

  // Switch tab.
  switchPrenSubtab('crea');

  // Refresh mappa con nuovo range; renderManagerMap rispetta bookingSelection.
  if (typeof refreshMap === 'function') refreshMap();

  // Scroll alla mappa.
  const mapCard = document.getElementById('manager-map');
  if (mapCard) mapCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Annulla il singolo sub-affitto (riusa il modal esistente).
async function dispCancelDisp(dispId) {
  closeDispPopover();
  const disp = dispViewData?.prenByDispId?.[dispId];
  if (!disp) return;

  // Costruisce un gruppo monouso e lo registra in cancelBookingGroups.
  const group = { nome: disp.nome_prenotazione || null, items: [disp] };
  const gid = `disp-${dispId}`;
  if (typeof cancelBookingGroups !== 'undefined') {
    cancelBookingGroups.set(gid, group);
  }
  if (typeof openCancelBookingModal === 'function') {
    openCancelBookingModal(gid);
  }
}

// Hook: chiamato dopo create/cancel/modify booking dal primo tab per
// invalidare la vista. Se il pannello "vedi" è visibile, ricarica.
function dispViewInvalidate() {
  dispViewStale = true;
  const pane = document.getElementById('pren-sub-vedi');
  if (pane && pane.classList.contains('active')) {
    loadDispView();
  }
}
