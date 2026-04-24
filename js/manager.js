function getDatesInRange(from, to) {
  const dates = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    dates.push(toLocalDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function changeMapDate(dir) {
  const d = new Date(currentMapDate + 'T00:00:00');
  d.setDate(d.getDate() + dir);
  currentMapDate = toLocalDateStr(d);
  document.getElementById('map-date').value = currentMapDate;
  refreshMap();
}

function setMapRangePreset(days) {
  const today = todayStr();
  const startDate = new Date(today + 'T00:00:00');
  const endDate = new Date(today + 'T00:00:00');
  endDate.setDate(endDate.getDate() + days - 1);
  const endStr = toLocalDateStr(endDate);
  document.getElementById('map-date-from').value = today;
  document.getElementById('map-date-to').value = endStr;
  if (mapRangePickerInstance) mapRangePickerInstance.setDate([startDate, endDate], false);
  refreshMap();
}

let mapRangePickerInstance = null;
function initMapRangePicker(today) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('map-range-picker');
  if (!input) return;
  const todayDate = new Date(today + 'T00:00:00');
  if (mapRangePickerInstance) {
    mapRangePickerInstance.setDate([todayDate, todayDate], false);
    return;
  }
  mapRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [todayDate, todayDate],
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        const from = toLocalDateStr(selectedDates[0]);
        const to = toLocalDateStr(selectedDates[1]);
        document.getElementById('map-date-from').value = from;
        document.getElementById('map-date-to').value = to;
        refreshMap();
      } else if (selectedDates.length === 1) {
        const from = toLocalDateStr(selectedDates[0]);
        document.getElementById('map-date-from').value = from;
        document.getElementById('map-date-to').value = from;
      }
    },
  });
}

function updateMapPresetActive() {
  const from = document.getElementById('map-date-from').value;
  const to = document.getElementById('map-date-to').value || from;
  const today = todayStr();
  let activeDays = null;
  if (from === today) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if ([1, 2, 3, 7].includes(diff)) activeDays = diff;
  }
  document.querySelectorAll('.map-preset-btn').forEach(btn => {
    const days = parseInt(btn.dataset.days, 10);
    if (days === activeDays) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

async function refreshMap() {
  const from = document.getElementById('map-date-from').value;
  const to = document.getElementById('map-date-to').value || from;
  if (!from) return;
  const dates = getDatesInRange(from, to);
  if (dates.length === 0) return;

  const { data: disp } = await sb.from('disponibilita')
    .select('*')
    .gte('data', from)
    .lte('data', to)
    .in('ombrellone_id', ombrelloniList.map(o => o.id));

  const dispByOmbDate = {};
  (disp || []).forEach(d => {
    if (!dispByOmbDate[d.ombrellone_id]) dispByOmbDate[d.ombrellone_id] = {};
    dispByOmbDate[d.ombrellone_id][d.data] = d.stato;
  });

  const isSingleDay = from === to;

  const freeDaysByOmb = {};
  ombrelloniList.forEach(o => {
    const ombDisp = dispByOmbDate[o.id] || {};
    freeDaysByOmb[o.id] = dates.filter(d => ombDisp[d] === 'libero');
  });

  const alwaysFreeIds = new Set(
    ombrelloniList.filter(o => freeDaysByOmb[o.id].length === dates.length).map(o => o.id)
  );

  const combinationIds = new Set();
  const combinationCovers = {};
  let combinationValid = false;
  if (!isSingleDay) {
    const byOmbId = {};
    ombrelloniList.forEach(o => { byOmbId[o.id] = o; });
    const candidateIds = ombrelloniList
      .filter(o => !alwaysFreeIds.has(o.id) && freeDaysByOmb[o.id].length > 0)
      .map(o => o.id);
    const sortKey = id => {
      const o = byOmbId[id];
      return `${o.fila}${String(o.numero).padStart(4, '0')}`;
    };
    const uncovered = new Set(dates);
    const remaining = new Set(candidateIds);
    while (uncovered.size > 0 && remaining.size > 0) {
      let bestId = null;
      let bestCount = 0;
      for (const id of remaining) {
        let cov = 0;
        for (const d of freeDaysByOmb[id]) if (uncovered.has(d)) cov++;
        if (cov > bestCount || (cov === bestCount && cov > 0 && bestId && sortKey(id) < sortKey(bestId))) {
          bestId = id;
          bestCount = cov;
        }
      }
      if (!bestId || bestCount === 0) break;
      const covered = freeDaysByOmb[bestId].filter(d => uncovered.has(d));
      combinationIds.add(bestId);
      combinationCovers[bestId] = covered;
      covered.forEach(d => uncovered.delete(d));
      remaining.delete(bestId);
    }
    combinationValid = uncovered.size === 0 && combinationIds.size > 0;
    if (!combinationValid) {
      combinationIds.clear();
      Object.keys(combinationCovers).forEach(k => delete combinationCovers[k]);
    }
  }

  const partialIds = new Set();
  if (!isSingleDay && !combinationValid) {
    ombrelloniList.forEach(o => {
      if (!alwaysFreeIds.has(o.id) && freeDaysByOmb[o.id].length > 0) partialIds.add(o.id);
    });
  }

  const rangeDispMap = {};
  ombrelloniList.forEach(o => {
    const ombDisp = dispByOmbDate[o.id] || {};
    const anySub = dates.some(d => ombDisp[d] === 'sub_affittato');
    if (alwaysFreeIds.has(o.id)) rangeDispMap[o.id] = 'libero';
    else if (combinationIds.has(o.id)) rangeDispMap[o.id] = 'combinazione';
    else if (partialIds.has(o.id)) rangeDispMap[o.id] = 'parziale';
    else if (anySub) rangeDispMap[o.id] = 'sub_affittato';
    else rangeDispMap[o.id] = 'occupied';
  });

  currentMapRange = { from, to, dispByOmbDate, dates, combinationCovers, combinationValid, rangeDispMap };

  const isToday = isSingleDay && from === todayStr();
  const label = isSingleDay
    ? (isToday ? 'oggi' : formatDate(from))
    : `${formatDate(from)} → ${formatDate(to)}`;

  document.getElementById('map-range-label').textContent = label;

  const free = alwaysFreeIds.size;
  const combo = combinationIds.size;
  const partial = partialIds.size;
  const subleased = ombrelloniList.filter(o => rangeDispMap[o.id] === 'sub_affittato').length;

  if (isToday) {
    document.getElementById('stat-liberi').textContent = free;
    document.getElementById('stat-subaffittati').textContent = subleased;
  }

  pruneBookingSelection();
  renderManagerMap(ombrelloniList, rangeDispMap);
  renderBookingSelectionPanel();

  const freeEl = document.getElementById('map-free-count');
  const pill = (bg, fg, text) => `<span style="background:${bg};color:${fg};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block;margin:2px 0">${text}</span>`;
  const pills = [];
  if (isSingleDay) {
    if (free > 0) {
      pills.push(pill('var(--green-light)', 'var(--green)', `✓ ${free} ombrellon${free > 1 ? 'i' : 'e'} liber${free > 1 ? 'i' : 'o'}`));
    } else {
      pills.push(pill('var(--red-light)', 'var(--red)', 'Nessun ombrellone libero'));
    }
  } else {
    if (free > 0) {
      pills.push(pill('var(--green-light)', 'var(--green)', `✓ ${free} ombrellon${free > 1 ? 'i' : 'e'} liber${free > 1 ? 'i' : 'o'} per tutto il periodo`));
    }
    if (combinationValid) {
      pills.push(pill('var(--coral-light)', 'var(--coral)', `⚡ Combinazione: ${combo} ombrelloni coprono l'intero periodo`));
    }
    if (!free && !combinationValid) {
      if (partial > 0) {
        pills.push(pill('var(--yellow-light)', '#9C7A1F', `${partial} ombrellon${partial > 1 ? 'i' : 'e'} liber${partial > 1 ? 'i' : 'o'} solo in parte — nessuna combinazione copre l'intero periodo`));
      } else {
        pills.push(pill('var(--red-light)', 'var(--red)', 'Nessun ombrellone libero nel periodo'));
      }
    }
  }
  freeEl.innerHTML = pills.map(p => `<div>${p}</div>`).join('');

  updateMapPresetActive();
}

async function loadManagerData() {
  const today = todayStr();
  currentMapDate = today;
  document.getElementById('map-date-from').value = today;
  document.getElementById('map-date-to').value = today;
  initMapRangePicker(today);
  document.getElementById('manager-stab-nome').textContent = currentStabilimento.nome;
  document.getElementById('manager-today-label').textContent = currentStabilimento.citta + ' — ' + formatDate(today);
  refreshCoinLabels(currentStabilimento);

  const { data: ombs } = await sb.from('ombrelloni').select('*').eq('stabilimento_id', currentStabilimento.id).order('fila').order('numero');
  ombrelloniList = ombs || [];

  const { data: clienti } = await sb.from('clienti_stagionali').select('*').eq('stabilimento_id', currentStabilimento.id);
  clientiList = clienti || [];

  const { data: disp } = await sb.from('disponibilita').select('*').eq('data', today).in('ombrellone_id', ombrelloniList.map(o => o.id));
  const dispMap = {};
  (disp || []).forEach(d => { dispMap[d.ombrellone_id] = d.stato; });
  currentDispMap = dispMap;

  document.getElementById('stat-totali').textContent = ombrelloniList.length;
  const linkScarica = document.getElementById('link-scarica-excel');
  if (linkScarica) linkScarica.textContent = ombrelloniList.length ? '📥 Scarica Excel con i dati attuali' : '📥 Scarica template Excel di esempio';

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const { data: txWeek } = await sb.from('transazioni').select('importo').eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto').gte('created_at', weekAgo.toISOString());
  const totCrediti = (txWeek || []).reduce((s, t) => s + parseFloat(t.importo), 0);
  document.getElementById('stat-crediti').textContent = parseFloat(totCrediti || 0).toFixed(2);
  document.getElementById('stat-crediti-unit').textContent = coinName(currentStabilimento);

  await loadDashboardUpcomingKpis(today);
  await loadDashboardCreditsKpis();

  await refreshMap();
  renderGestioneTable(ombrelloniList, dispMap, clientiList);
  renderCreditiTable(clientiList, ombrelloniList);
  applyDefaultTxFilter(today);
  initTxRangePicker();
  await loadAllTx();
  applyDefaultPrenFilter(today);
  initPrenRangePicker();
  await loadPrenotazioni();
  populateClienteSelect();
  if (!document.getElementById('analytics-date-from').value) {
    setAnalyticsRange(30);
  } else {
    await loadCreditiAnalytics();
  }
}

async function loadDashboardUpcomingKpis(today) {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (!ombrelloniList.length) {
    ['stat-liberi-3gg', 'stat-sub-3gg', 'stat-liberi-7gg', 'stat-sub-7gg'].forEach(id => setText(id, '0'));
    return;
  }
  const start = new Date(today + 'T00:00:00');
  const end = new Date(today + 'T00:00:00'); end.setDate(end.getDate() + 6);
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const { data: disp } = await sb.from('disponibilita')
    .select('ombrellone_id,data,stato')
    .in('ombrellone_id', ombrelloniList.map(o => o.id))
    .gte('data', startStr)
    .lte('data', endStr);

  const day3End = new Date(today + 'T00:00:00'); day3End.setDate(day3End.getDate() + 2);
  const day3EndStr = toLocalDateStr(day3End);

  const free3 = new Set(), sub3 = new Set(), free7 = new Set(), sub7 = new Set();
  (disp || []).forEach(d => {
    if (d.stato === 'libero') {
      if (d.data <= day3EndStr) free3.add(d.ombrellone_id);
      free7.add(d.ombrellone_id);
    } else if (d.stato === 'sub_affittato') {
      if (d.data <= day3EndStr) sub3.add(d.ombrellone_id);
      sub7.add(d.ombrellone_id);
    }
  });

  setText('stat-liberi-3gg', free3.size);
  setText('stat-sub-3gg', sub3.size);
  setText('stat-liberi-7gg', free7.size);
  setText('stat-sub-7gg', sub7.size);
}

async function loadDashboardCreditsKpis() {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const from = new Date(); from.setDate(from.getDate() - 30);
  const { data: txs } = await sb.from('transazioni')
    .select('tipo,importo')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('tipo', ['credito_ricevuto', 'credito_usato', 'sub_affitto'])
    .gte('created_at', from.toISOString());

  let ricevuti = 0, spesi = 0, subaffitti = 0;
  (txs || []).forEach(t => {
    const imp = parseFloat(t.importo || 0);
    if (t.tipo === 'credito_ricevuto') ricevuti += imp;
    else if (t.tipo === 'credito_usato') spesi += imp;
    else if (t.tipo === 'sub_affitto') subaffitti += 1;
  });

  setText('dash-crediti-ricevuti', formatCoin(ricevuti));
  setText('dash-crediti-spesi', formatCoin(spesi));
  setText('dash-subaffitti', subaffitti);
  setText('dash-subaffitti-sub', subaffitti === 1 ? 'giornata sub-affittata' : 'giornate sub-affittate');
}

function applyDefaultTxFilter(today) {
  const fromEl = document.getElementById('tx-filter-from');
  const toEl = document.getElementById('tx-filter-to');
  if (!fromEl || !toEl) return;
  if (fromEl.value || toEl.value) return;
  const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 6);
  fromEl.value = toLocalDateStr(start);
  toEl.value = today;
}

function applyDefaultPrenFilter(today) {
  const fromEl = document.getElementById('pren-filter-from');
  const toEl = document.getElementById('pren-filter-to');
  if (!fromEl || !toEl) return;
  if (fromEl.value || toEl.value) return;
  // Default: recent + upcoming window (last 7 days → next 30 days).
  const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 7);
  const end = new Date(today + 'T00:00:00'); end.setDate(end.getDate() + 30);
  fromEl.value = toLocalDateStr(start);
  toEl.value = toLocalDateStr(end);
}

function renderManagerMap(ombs, dispMap) {
  const el = document.getElementById('manager-map');
  el.innerHTML = '';
  const byRow = {};
  ombs.forEach(o => { if (!byRow[o.fila]) byRow[o.fila] = []; byRow[o.fila].push(o); });
  const colNumbers = Array.from(new Set(ombs.map(o => o.numero)))
    .sort((a, b) => a - b);
  Object.keys(byRow).sort().reverse().forEach(fila => {
    const row = document.createElement('div'); row.className = 'map-row';
    const lbl = document.createElement('div'); lbl.className = 'row-label'; lbl.textContent = fila;
    row.appendChild(lbl);
    byRow[fila].sort((a,b) => a.numero - b.numero).forEach(o => {
      const stato = dispMap[o.id] || 'occupied';
      const el2 = document.createElement('div');
      const cls = stato === 'libero' ? 'free'
        : stato === 'combinazione' ? 'combo'
        : stato === 'parziale' ? 'partial'
        : stato === 'sub_affittato' ? 'subleased'
        : 'occupied';
      const isSelected = bookingSelection.has(o.id);
      el2.className = 'ombrellone ' + cls + (isSelected ? ' selected' : '');
      el2.textContent = '☂️';
      let hint = '';
      const fmtDay = d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
      };
      const freeDays = (currentMapRange?.dates || []).filter(d => (currentMapRange?.dispByOmbDate?.[o.id] || {})[d] === 'libero');
      const selectSuffix = isSelected
        ? ' — selezionato, clicca per rimuoverlo dalla prenotazione'
        : ' — clicca per aggiungerlo alla prenotazione';
      if (stato === 'libero') {
        hint = ' — libero per tutto il periodo' + selectSuffix;
      } else if (stato === 'combinazione') {
        const covers = (currentMapRange?.combinationCovers || {})[o.id] || [];
        const days = covers.map(fmtDay).join(', ');
        const extra = freeDays.filter(d => !covers.includes(d));
        const extraTxt = extra.length ? ` (libero anche ${extra.map(fmtDay).join(', ')})` : '';
        hint = ` — copre ${covers.length} giorn${covers.length === 1 ? 'o' : 'i'}: ${days}${extraTxt}` + selectSuffix;
      } else if (stato === 'parziale') {
        const days = freeDays.map(fmtDay).join(', ');
        hint = ` — libero ${freeDays.length} giorn${freeDays.length === 1 ? 'o' : 'i'}: ${days}` + selectSuffix;
      } else if (stato === 'sub_affittato') {
        hint = ' — sub-affittato';
      }
      el2.title = `${fila}${o.numero} — ${formatCoin(o.credito_giornaliero)}/gg${hint}`;
      el2.onclick = () => toggleMapOmbSelection(o, stato);
      row.appendChild(el2);
    });
    el.appendChild(row);
  });
  if (colNumbers.length) {
    const numRow = document.createElement('div');
    numRow.className = 'map-row map-col-numbers';
    const spacer = document.createElement('div');
    spacer.className = 'row-label';
    numRow.appendChild(spacer);
    colNumbers.forEach(n => {
      const cell = document.createElement('div');
      cell.className = 'col-label';
      cell.textContent = n;
      numRow.appendChild(cell);
    });
    el.appendChild(numRow);
  }
}

function toggleMapOmbSelection(omb, stato) {
  if (!currentMapRange) return;
  const label = `Fila ${omb.fila} N°${omb.numero}`;
  if (stato === 'sub_affittato') {
    alert(`${label} è già sub-affittato in parte del periodo. Annullalo dalla tab Prenotazioni se necessario.`);
    return;
  }
  if (stato === 'occupied') {
    alert(`${label} non è libero nel periodo selezionato: non puoi includerlo nella prenotazione.`);
    return;
  }
  if (bookingSelection.has(omb.id)) bookingSelection.delete(omb.id);
  else bookingSelection.add(omb.id);
  renderManagerMap(ombrelloniList, currentMapRange.rangeDispMap);
  renderBookingSelectionPanel();
}

function computeBookingCoverage() {
  if (!currentMapRange) return { pairs: [], coveredDays: new Set(), missingDays: [], totalCredit: 0 };
  const { dispByOmbDate, dates } = currentMapRange;
  const pairs = [];
  const coveredDays = new Set();
  let totalCredit = 0;
  for (const ombId of bookingSelection) {
    const omb = ombrelloniList.find(o => o.id === ombId);
    if (!omb) continue;
    const ombDisp = dispByOmbDate[ombId] || {};
    for (const d of dates) {
      if (ombDisp[d] === 'libero') {
        pairs.push({ omb, date: d });
        coveredDays.add(d);
        totalCredit += parseFloat(omb.credito_giornaliero || 0);
      }
    }
  }
  const missingDays = dates.filter(d => !coveredDays.has(d));
  return { pairs, coveredDays, missingDays, totalCredit };
}

function renderBookingSelectionPanel() {
  const el = document.getElementById('booking-selection-panel');
  if (!el) return;
  if (!currentMapRange || bookingSelection.size === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const { dates } = currentMapRange;
  const { pairs, missingDays, totalCredit } = computeBookingCoverage();
  const nOmb = bookingSelection.size;
  const covered = dates.length - missingDays.length;
  const complete = missingDays.length === 0 && pairs.length > 0;

  const fmtDay = d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  };

  const missingBlock = missingDays.length
    ? `<div class="booking-missing"><strong>Giorni ancora scoperti (${missingDays.length}):</strong> ${missingDays.map(fmtDay).join(', ')}</div>`
    : `<div class="booking-complete">✓ Periodo coperto interamente</div>`;

  const btnClass = complete ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm';
  const btnAttr = complete ? '' : 'disabled';

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="booking-panel-head">
      <div class="booking-panel-title">🧾 Nuova prenotazione</div>
      <div class="booking-panel-stats">
        <span><strong>${nOmb}</strong> ombrellone${nOmb > 1 ? 'i' : ''} selezionat${nOmb > 1 ? 'i' : 'o'}</span>
        <span>·</span>
        <span><strong>${covered}/${dates.length}</strong> giorn${dates.length > 1 ? 'i' : 'o'} coperti</span>
        <span>·</span>
        <span><strong>${pairs.length}</strong> sub-affitt${pairs.length === 1 ? 'o' : 'i'}</span>
        <span>·</span>
        <span><strong>${formatCoin(totalCredit.toFixed(2), currentStabilimento)}</strong> totali</span>
      </div>
    </div>
    ${missingBlock}
    <div class="booking-panel-actions">
      <button type="button" class="btn btn-outline btn-sm" onclick="clearBookingSelection()">Annulla selezione</button>
      <button type="button" class="${btnClass}" ${btnAttr} onclick="openFinalizeBookingModal()">Finalizza prenotazione</button>
    </div>
  `;
}

function clearBookingSelection() {
  bookingSelection.clear();
  if (currentMapRange) renderManagerMap(ombrelloniList, currentMapRange.rangeDispMap);
  renderBookingSelectionPanel();
}

function pruneBookingSelection() {
  if (!currentMapRange || bookingSelection.size === 0) return;
  const { dispByOmbDate, dates } = currentMapRange;
  for (const id of Array.from(bookingSelection)) {
    const ombDisp = dispByOmbDate[id] || {};
    const hasFree = dates.some(d => ombDisp[d] === 'libero');
    if (!hasFree) bookingSelection.delete(id);
  }
}

function clienteStato(c) {
  if (!c) return 'senza';
  if (c.user_id) return 'attivo';
  if (c.invitato_at) return 'invitato';
  return 'mai';
}

function renderGestioneTable(ombs, dispMap, clienti) {
  const clienteByOmb = {};
  (clienti || []).filter(c => !c.rifiutato).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });
  const validClienteIds = new Set(Object.values(clienteByOmb).map(c => c.id));
  for (const id of Array.from(selectedClienteIds)) {
    if (!validClienteIds.has(id)) selectedClienteIds.delete(id);
  }
  renderGestioneFiltered();
}

function getFiltratiGestione() {
  const q = (document.getElementById('clienti-filter')?.value || '').trim().toLowerCase();
  const statoF = document.getElementById('clienti-stato-filter')?.value || '';
  const clienteByOmb = {};
  (clientiList || []).filter(c => !c.rifiutato).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });
  return (ombrelloniList || []).map(o => ({ omb: o, cliente: clienteByOmb[o.id] || null })).filter(({ omb, cliente }) => {
    if (statoF && clienteStato(cliente) !== statoF) return false;
    if (!q) return true;
    const hay = `${omb.fila} ${omb.numero} ${omb.fila}${omb.numero} ${cliente?.nome || ''} ${cliente?.cognome || ''} ${cliente?.email || ''} ${cliente?.telefono || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderGestioneFiltered() {
  const tb = document.getElementById('gestione-table');
  if (!tb) return;
  const righe = getFiltratiGestione();
  const totali = (ombrelloniList || []).length;

  const countLbl = document.getElementById('clienti-count-label');
  if (countLbl) {
    countLbl.textContent = righe.length === totali
      ? `${totali} righe`
      : `${righe.length} di ${totali} righe`;
  }

  if (!righe.length) {
    const empty = totali
      ? 'Nessuna riga corrisponde al filtro.'
      : 'Nessun ombrellone ancora. Aggiungine uno o importa un Excel.';
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-light);padding:24px">${empty}</td></tr>`;
    updateClientiBulkToolbar();
    syncCheckAllClienti(righe);
    return;
  }

  tb.innerHTML = righe.map(({ omb, cliente }) => {
    const stato = dispStato(omb.id);
    const clStato = clienteStato(cliente);
    const pill = cliente
      ? (clStato === 'attivo'
          ? '<span class="pill pill-green">Cliente attivo</span>'
          : clStato === 'invitato'
            ? '<span class="pill pill-yellow">Invito inviato</span>'
            : '<span class="pill pill-gray">Mai invitato</span>')
      : (stato === 'libero'
          ? '<span class="pill pill-green">Libero oggi</span>'
          : stato === 'sub_affittato'
            ? '<span class="pill pill-yellow">Sub-affittato</span>'
            : '<span class="pill pill-gray">Senza cliente</span>');
    const checkbox = cliente
      ? `<input type="checkbox" class="clienti-check" data-id="${cliente.id}" ${selectedClienteIds.has(cliente.id) ? 'checked' : ''} onchange="toggleCliente('${cliente.id}', this.checked)">`
      : '';
    const azioniInvito = cliente && !cliente.user_id
      ? `<button class="btn btn-outline btn-sm" onclick="invitaSingolo('${cliente.id}')" title="Invia/reinvia invito" style="margin-right:4px">✉️</button>`
      : '';
    return `<tr>
      <td>${checkbox}</td>
      <td><strong>${escapeHtml(omb.fila)}</strong></td>
      <td>${omb.numero}</td>
      <td>${formatCoin(omb.credito_giornaliero)}</td>
      <td>${cliente ? `<strong>${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}</strong>` : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${cliente ? escapeHtml(cliente.email || '') : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${cliente ? (escapeHtml(cliente.telefono || '') || '–') : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${pill}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="openViewOmbrelloneModal('${omb.id}')" title="Vedi disponibilità" style="margin-right:4px">👁️</button>
        <button class="btn btn-outline btn-sm" onclick="openEditRowModal('${omb.id}')" title="Modifica" style="margin-right:4px">✏️</button>
        ${azioniInvito}
        <button class="btn btn-danger btn-sm" onclick="deleteRow('${omb.id}')" title="Rimuovi riga">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  updateClientiBulkToolbar();
  syncCheckAllClienti(righe);
}

function dispStato(ombId) {
  return (currentDispMap && currentDispMap[ombId]) || 'occupied';
}

function syncCheckAllClienti(righe) {
  const chk = document.getElementById('clienti-check-all');
  if (!chk) return;
  const ids = righe.map(r => r.cliente?.id).filter(Boolean);
  const all = ids.length > 0 && ids.every(id => selectedClienteIds.has(id));
  const some = ids.some(id => selectedClienteIds.has(id));
  chk.checked = all;
  chk.indeterminate = !all && some;
}

function toggleAllClienti(checked) {
  document.querySelectorAll('.clienti-check').forEach(cb => {
    const id = cb.dataset.id;
    if (checked) selectedClienteIds.add(id); else selectedClienteIds.delete(id);
    cb.checked = checked;
  });
  updateClientiBulkToolbar();
}

function toggleCliente(id, checked) {
  if (checked) selectedClienteIds.add(id); else selectedClienteIds.delete(id);
  updateClientiBulkToolbar();
  syncCheckAllClienti(getFiltratiGestione());
}

function clearClientiSelection() {
  selectedClienteIds.clear();
  renderGestioneFiltered();
}

function updateClientiBulkToolbar() {
  const toolbar = document.getElementById('clienti-bulk-toolbar');
  const count = document.getElementById('clienti-selected-count');
  if (!toolbar || !count) return;
  const n = selectedClienteIds.size;
  if (n > 0) {
    toolbar.classList.remove('hidden');
    toolbar.style.display = 'flex';
    count.textContent = `${n} selezionat${n === 1 ? 'o' : 'i'}`;
  } else {
    toolbar.classList.add('hidden');
    toolbar.style.display = 'none';
  }
}

async function invitaSingolo(id) {
  const c = clientiList.find(x => x.id === id);
  if (!c) return;
  if (!c.invito_token) { alert('Token invito mancante, impossibile inviare.'); return; }
  const omb = c.ombrellone_id ? ombrelloniList.find(o => o.id === c.ombrellone_id) : null;
  const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : '';
  const inviteLink = `${window.location.origin}/?invito=${c.invito_token}`;
  const ok = await retryUntilTrue(
    () => inviaEmail('invito', { email: c.email, nome: c.nome, cognome: c.cognome, ombrellone: ombStr, invite_link: inviteLink }, currentStabilimento),
    3, 500
  );
  await sb.from('clienti_stagionali').update({ invitato_at: new Date().toISOString() }).eq('id', id);
  alert(ok ? '✉️ Invito inviato.' : '⚠ Invio email fallito. Riprova più tardi.');
  await loadManagerData();
}

function renderCreditiTable(clienti, ombs) {
  const tb = document.getElementById('crediti-table');
  if (!tb) return;
  const sourceClienti = clienti || clientiList || [];
  const sourceOmbs = ombs || ombrelloniList || [];
  const ombById = {};
  sourceOmbs.forEach(o => ombById[o.id] = o);

  const q = (document.getElementById('crediti-filter')?.value || '').trim().toLowerCase();
  const filtrati = sourceClienti.filter(c => {
    if (!q) return true;
    const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    const ombStr = o ? `fila ${o.fila} n°${o.numero} ${o.fila}${o.numero}` : '';
    const hay = `${c.nome || ''} ${c.cognome || ''} ${ombStr}`.toLowerCase();
    return hay.includes(q);
  });

  const countLbl = document.getElementById('crediti-count-label');
  if (countLbl) {
    countLbl.textContent = filtrati.length === sourceClienti.length
      ? `${sourceClienti.length} clienti`
      : `${filtrati.length} di ${sourceClienti.length} clienti`;
  }

  tb.innerHTML = filtrati.map(c => {
    const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    return `<tr>
      <td>${c.nome} ${c.cognome}</td>
      <td>${o ? `${o.fila}${o.numero}` : '–'}</td>
      <td><strong>${formatCoin(c.credito_saldo)}</strong></td>
    </tr>`;
  }).join('') || `<tr><td colspan="3" style="text-align:center;color:var(--text-light);padding:24px">${q ? 'Nessun risultato per la ricerca' : 'Nessun cliente'}</td></tr>`;
}

function populateClienteSelect() {
  const sel = document.getElementById('credito-cliente');
  sel.innerHTML = clientiList.map(c => `<option value="${c.id}">${c.nome} ${c.cognome} (${formatCoin(c.credito_saldo)})</option>`).join('');
}

function setAnalyticsRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  document.getElementById('analytics-date-from').value = toLocalDateStr(from);
  document.getElementById('analytics-date-to').value = toLocalDateStr(to);
  loadCreditiAnalytics();
}

async function loadCreditiAnalytics() {
  const from = document.getElementById('analytics-date-from').value;
  const to = document.getElementById('analytics-date-to').value;
  if (!from || !to) return;
  if (from > to) { showAlert('crediti-alert', 'Periodo non valido: la data iniziale è successiva a quella finale', 'error'); return; }

  const fromIso = new Date(from + 'T00:00:00').toISOString();
  const toIso = new Date(to + 'T23:59:59.999').toISOString();

  const { data: txs, error } = await sb.from('transazioni')
    .select('ombrellone_id, cliente_id, tipo, importo')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('tipo', ['sub_affitto', 'credito_ricevuto', 'credito_usato'])
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (error) { console.error(error); return; }

  const ombById = {};
  ombrelloniList.forEach(o => { ombById[o.id] = o; });
  const cliById = {};
  clientiList.forEach(c => { cliById[c.id] = c; });
  const cliByOmb = {};
  clientiList.forEach(c => { if (c.ombrellone_id) cliByOmb[c.ombrellone_id] = c; });

  const stats = {};
  const ensure = (key) => stats[key] || (stats[key] = { ombrellone_id: null, cliente_id: null, ricevuti: 0, spesi: 0, subaffitti: 0 });

  let totRic = 0, totSpe = 0, totSub = 0;

  (txs || []).forEach(t => {
    const importo = parseFloat(t.importo || 0);
    if (t.tipo === 'sub_affitto') {
      const key = t.ombrellone_id || `nob:${t.cliente_id || 'unknown'}`;
      const s = ensure(key);
      s.ombrellone_id = t.ombrellone_id;
      if (!s.cliente_id) s.cliente_id = t.cliente_id || (t.ombrellone_id ? (cliByOmb[t.ombrellone_id]?.id || null) : null);
      s.subaffitti += 1;
      totSub += 1;
    } else if (t.tipo === 'credito_ricevuto') {
      const key = t.ombrellone_id || `cli:${t.cliente_id || 'unknown'}`;
      const s = ensure(key);
      s.ombrellone_id = t.ombrellone_id;
      if (!s.cliente_id) s.cliente_id = t.cliente_id;
      s.ricevuti += importo;
      totRic += importo;
    } else if (t.tipo === 'credito_usato') {
      const cliId = t.cliente_id;
      const ombId = cliId ? (clientiList.find(c => c.id === cliId)?.ombrellone_id || null) : null;
      const key = ombId || `cli:${cliId || 'unknown'}`;
      const s = ensure(key);
      s.ombrellone_id = ombId;
      if (!s.cliente_id) s.cliente_id = cliId;
      s.spesi += importo;
      totSpe += importo;
    }
  });

  document.getElementById('analytics-tot-ricevuti').textContent = formatCoin(totRic);
  document.getElementById('analytics-tot-spesi').textContent = formatCoin(totSpe);
  document.getElementById('analytics-tot-subaffitti').textContent = totSub;
  document.getElementById('analytics-tot-subaffitti-sub').textContent = totSub === 1 ? 'giornata sub-affittata' : 'giornate sub-affittate';

  const rows = Object.values(stats);
  rows.sort((a, b) => {
    const oa = a.ombrellone_id ? ombById[a.ombrellone_id] : null;
    const ob = b.ombrellone_id ? ombById[b.ombrellone_id] : null;
    if (oa && ob) {
      if (oa.fila !== ob.fila) return String(oa.fila).localeCompare(String(ob.fila));
      return (oa.numero || 0) - (ob.numero || 0);
    }
    if (oa) return -1;
    if (ob) return 1;
    return 0;
  });

  const tb = document.getElementById('analytics-table');
  const empty = document.getElementById('analytics-empty');
  if (!rows.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tb.innerHTML = rows.map(s => {
    const o = s.ombrellone_id ? ombById[s.ombrellone_id] : null;
    const c = s.cliente_id ? cliById[s.cliente_id] : null;
    const ombStr = o ? `Fila ${o.fila} N°${o.numero}` : '<span style="color:var(--text-light)">— ombrellone rimosso</span>';
    const cliStr = c ? `${c.nome} ${c.cognome}` : '<span style="color:var(--text-light)">—</span>';
    const saldo = s.ricevuti - s.spesi;
    const saldoColor = saldo > 0 ? 'var(--ocean)' : saldo < 0 ? 'var(--coral)' : 'var(--text-light)';
    const saldoSign = saldo > 0 ? '+' : '';
    return `<tr>
      <td><strong>${ombStr}</strong></td>
      <td>${cliStr}</td>
      <td style="text-align:right">${s.subaffitti}</td>
      <td style="text-align:right;color:var(--ocean)">${formatCoin(s.ricevuti)}</td>
      <td style="text-align:right;color:var(--coral)">${formatCoin(s.spesi)}</td>
      <td style="text-align:right;color:${saldoColor};font-weight:600">${saldoSign}${formatCoin(saldo).replace(/^-/, '−')}</td>
    </tr>`;
  }).join('');
}

function ombById() {
  const map = {};
  (ombrelloniList || []).forEach(o => { map[o.id] = o; });
  return map;
}

function populateTxOmbrelloneSelect() {
  const sel = document.getElementById('tx-filter-ombrellone');
  if (!sel) return;
  const current = sel.value;
  const sorted = (ombrelloniList || []).slice().sort((a, b) => {
    if (a.fila !== b.fila) return String(a.fila).localeCompare(String(b.fila));
    return (a.numero || 0) - (b.numero || 0);
  });
  sel.innerHTML = '<option value="">Tutti gli ombrelloni</option>' +
    sorted.map(o => `<option value="${o.id}">Fila ${o.fila} N°${o.numero}</option>`).join('');
  if (current && sorted.some(o => o.id === current)) sel.value = current;
}

function updateTxPresetActive() {
  const from = document.getElementById('tx-filter-from')?.value || '';
  const to = document.getElementById('tx-filter-to')?.value || '';
  const today = todayStr();
  const yDate = new Date(today + 'T00:00:00'); yDate.setDate(yDate.getDate() - 1);
  const yesterday = toLocalDateStr(yDate);
  let active = null;
  if (from && from === to) {
    if (from === today) active = 'today';
    else if (from === yesterday) active = 'yesterday';
  } else if (from && to === today) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if (diff === 3) active = '3';
    else if (diff === 7) active = '7';
  }
  document.querySelectorAll('.tx-preset-btn').forEach(btn => {
    if (btn.dataset.preset === active) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

let txRangePickerInstance = null;
function initTxRangePicker() {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('tx-range-picker');
  if (!input) return;
  const fromVal = document.getElementById('tx-filter-from')?.value || '';
  const toVal = document.getElementById('tx-filter-to')?.value || fromVal;
  const defaults = [];
  if (fromVal) defaults.push(new Date(fromVal + 'T00:00:00'));
  if (toVal && toVal !== fromVal) defaults.push(new Date(toVal + 'T00:00:00'));
  if (txRangePickerInstance) {
    if (defaults.length) txRangePickerInstance.setDate(defaults, false);
    else txRangePickerInstance.clear();
    return;
  }
  txRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: defaults.length ? defaults : null,
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        const from = toLocalDateStr(selectedDates[0]);
        const to = toLocalDateStr(selectedDates[1]);
        document.getElementById('tx-filter-from').value = from;
        document.getElementById('tx-filter-to').value = to;
        loadAllTx();
      } else if (selectedDates.length === 1) {
        const from = toLocalDateStr(selectedDates[0]);
        document.getElementById('tx-filter-from').value = from;
        document.getElementById('tx-filter-to').value = from;
      } else {
        document.getElementById('tx-filter-from').value = '';
        document.getElementById('tx-filter-to').value = '';
        loadAllTx();
      }
    },
  });
}

function setTxRange(preset) {
  const today = todayStr();
  let from, to;
  if (preset === 'today') {
    from = to = today;
  } else if (preset === 'yesterday') {
    const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 1);
    from = to = toLocalDateStr(d);
  } else {
    const days = parseInt(preset, 10);
    const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - (days - 1));
    from = toLocalDateStr(start);
    to = today;
  }
  document.getElementById('tx-filter-from').value = from;
  document.getElementById('tx-filter-to').value = to;
  if (txRangePickerInstance) {
    txRangePickerInstance.setDate([new Date(from + 'T00:00:00'), new Date(to + 'T00:00:00')], false);
  }
  loadAllTx();
}

function clearTxFilters() {
  const ombEl = document.getElementById('tx-filter-ombrellone');
  const tipoEl = document.getElementById('tx-filter-tipo');
  if (ombEl) ombEl.value = '';
  if (tipoEl) tipoEl.value = '';
  document.getElementById('tx-filter-from').value = '';
  document.getElementById('tx-filter-to').value = '';
  if (txRangePickerInstance) txRangePickerInstance.clear();
  loadAllTx();
}

async function loadAllTx() {
  populateTxOmbrelloneSelect();
  updateTxPresetActive();
  const ombId = document.getElementById('tx-filter-ombrellone')?.value || '';
  const tipo = document.getElementById('tx-filter-tipo')?.value || '';
  const from = document.getElementById('tx-filter-from')?.value || '';
  const to = document.getElementById('tx-filter-to')?.value || '';
  const countEl = document.getElementById('tx-count-label');
  const listEl = document.getElementById('all-tx-list');
  if (from && to && from > to) {
    if (countEl) countEl.textContent = '';
    listEl.innerHTML = '<div class="tx-empty">Periodo non valido: la data iniziale è successiva a quella finale</div>';
    return;
  }
  let q = sb.from('transazioni').select('*').eq('stabilimento_id', currentStabilimento.id);
  if (ombId) q = q.eq('ombrellone_id', ombId);
  if (tipo) q = q.eq('tipo', tipo);
  if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
  if (to) q = q.lte('created_at', new Date(to + 'T23:59:59.999').toISOString());
  q = q.order('created_at', { ascending: false });
  if (!from && !to) q = q.limit(50);
  const { data, error } = await q;
  if (error) { console.error(error); listEl.innerHTML = '<div class="tx-empty">Errore nel caricamento</div>'; return; }
  const rows = data || [];
  if (countEl) {
    if (!from && !to && !ombId && !tipo) {
      countEl.textContent = rows.length ? `Ultime ${rows.length} transazioni` : '';
    } else {
      countEl.textContent = `${rows.length} transazion${rows.length === 1 ? 'e' : 'i'} trovat${rows.length === 1 ? 'a' : 'e'}`;
    }
  }
  listEl.innerHTML = renderTxList(rows, currentStabilimento, ombById());
}

function renderTxList(txs, stab, ombsMap) {
  if (!txs.length) return '<div class="tx-empty">Nessuna transazione ancora</div>';
  const icons = {
    disponibilita_aggiunta: {e:'📅',c:'green'},
    disponibilita_rimossa: {e:'🗑️',c:'red'},
    sub_affitto: {e:'💰',c:'yellow'},
    sub_affitto_annullato: {e:'↩️',c:'red'},
    credito_ricevuto: {e:'⭐',c:'yellow'},
    credito_usato: {e:'🎉',c:'coral'},
    credito_revocato: {e:'⛔',c:'red'},
  };
  const labels = {
    disponibilita_aggiunta: 'Disponibilità dichiarata',
    disponibilita_rimossa: 'Disponibilità rimossa',
    sub_affitto: 'Sub-affitto confermato',
    sub_affitto_annullato: 'Sub-affitto annullato',
    credito_ricevuto: 'Credito ricevuto',
    credito_usato: 'Credito utilizzato',
    credito_revocato: 'Credito revocato',
  };
  return txs.map(t => {
    const ic = icons[t.tipo] || {e:'📌',c:'blue'};
    let ombStr = '';
    if (ombsMap && t.ombrellone_id) {
      const o = ombsMap[t.ombrellone_id];
      ombStr = o
        ? `<span class="tx-omb">Fila ${o.fila} N°${o.numero}</span>`
        : `<span class="tx-omb tx-omb-missing">ombrellone rimosso</span>`;
    }
    const bloccatoDalProprietario = t.tipo === 'disponibilita_rimossa' && typeof t.nota === 'string' && t.nota.includes('bloccato dal proprietario');
    const label = bloccatoDalProprietario ? 'Ombrellone sub-affittato con successo' : (labels[t.tipo] || t.tipo);
    return `<div class="tx-item">
      <div class="tx-dot ${ic.c}">${ic.e}</div>
      <div class="tx-info">
        <div class="tx-title">${label}${t.importo ? ` — ${formatCoin(t.importo, stab)}` : ''}${ombStr ? ' ' + ombStr : ''}</div>
        <div class="tx-sub">${t.nota || ''}</div>
      </div>
      <div class="tx-time">${formatDateShort(t.created_at)}</div>
    </div>`;
  }).join('');
}

function managerTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('mtab-' + tab);
  panel.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'email') loadEmailTemplates();
  if (tab === 'prenotazioni') loadPrenotazioni();
  if (tab === 'log') {
    // Default: ultimi 7 giorni, size 30.
    if (!document.getElementById('audit-date-from').value) {
      document.getElementById('audit-date-from').value = auditDaysAgoIso(7);
      document.getElementById('audit-date-to').value   = auditTodayIso();
    }
    auditState.page = 1;
    loadAuditLog();
  }
  enhanceDateInputs(panel);
}

function generateDefaultBookingName() {
  const stabNome = currentStabilimento?.nome || 'Stabilimento';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${stabNome} — ${dt} · #${code}`;
}

function openFinalizeBookingModal() {
  if (!currentMapRange || bookingSelection.size === 0) return;
  const { pairs, missingDays, totalCredit } = computeBookingCoverage();
  if (missingDays.length > 0 || pairs.length === 0) return;

  const { dates } = currentMapRange;
  const fmtDay = d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  };
  const periodo = dates.length === 1 ? fmtDay(dates[0]) : `${fmtDay(dates[0])} → ${fmtDay(dates[dates.length - 1])}`;
  const nOmb = bookingSelection.size;
  const ombList = Array.from(bookingSelection).map(id => {
    const o = ombrelloniList.find(x => x.id === id);
    return o ? `Fila ${o.fila} N°${o.numero}` : '';
  }).filter(Boolean).join(', ');

  const summary = `
    <div><strong>Periodo:</strong> ${periodo}</div>
    <div style="margin-top:4px"><strong>Ombrelloni (${nOmb}):</strong> ${ombList}</div>
    <div style="margin-top:4px"><strong>Sub-affitti totali:</strong> ${pairs.length}</div>
    <div style="margin-top:4px"><strong>Credito totale:</strong> ${formatCoin(totalCredit.toFixed(2), currentStabilimento)}</div>
  `;
  document.getElementById('finalize-booking-summary').innerHTML = summary;
  document.getElementById('finalize-booking-nome').value = '';
  showAlert('finalize-booking-alert', '', '');
  document.getElementById('modal-finalize-booking').classList.remove('hidden');
}

async function finalizeBookingSelection() {
  if (!currentMapRange || bookingSelection.size === 0) return;
  const { pairs, missingDays } = computeBookingCoverage();
  if (missingDays.length > 0 || pairs.length === 0) {
    showAlert('finalize-booking-alert', 'Il periodo non è coperto interamente. Aggiungi altri ombrelloni.', 'error');
    return;
  }
  const rawName = document.getElementById('finalize-booking-nome').value.trim();
  const nomePrenotazione = rawName || generateDefaultBookingName();

  showLoading();
  try {
    const dispRows = pairs.map(p => {
      const cliente = clientiList.find(c => c.ombrellone_id === p.omb.id) || null;
      return {
        ombrellone_id: p.omb.id,
        cliente_id: cliente?.id || null,
        data: p.date,
        stato: 'sub_affittato',
        nome_prenotazione: nomePrenotazione,
      };
    });

    const { error: dispErr } = await sb.from('disponibilita').upsert(dispRows, { onConflict: 'ombrellone_id,data' });
    if (dispErr) {
      showAlert('finalize-booking-alert', 'Errore upsert disponibilità: ' + dispErr.message, 'error');
      return;
    }

    const txRows = pairs.map(p => {
      const cliente = clientiList.find(c => c.ombrellone_id === p.omb.id) || null;
      const notaBase = `Ombrellone ${p.omb.fila}${p.omb.numero} sub-affittato il ${formatDate(p.date)}`;
      const nota = nomePrenotazione ? `${notaBase} — prenotazione "${nomePrenotazione}"` : notaBase;
      return {
        stabilimento_id: currentStabilimento.id,
        ombrellone_id: p.omb.id,
        cliente_id: cliente?.id || null,
        tipo: 'sub_affitto',
        importo: p.omb.credito_giornaliero,
        nota,
      };
    });
    const { error: txErr } = await sb.from('transazioni').insert(txRows);
    if (txErr) {
      showAlert('finalize-booking-alert', 'Sub-affitti salvati, ma errore nella registrazione delle transazioni: ' + txErr.message, 'error');
      return;
    }

    const creditsByCliente = new Map();
    for (const p of pairs) {
      const cliente = clientiList.find(c => c.ombrellone_id === p.omb.id);
      if (!cliente) continue;
      if (!creditsByCliente.has(cliente.id)) creditsByCliente.set(cliente.id, { cliente, rows: [], delta: 0 });
      const entry = creditsByCliente.get(cliente.id);
      entry.rows.push({
        stabilimento_id: currentStabilimento.id,
        ombrellone_id: p.omb.id,
        cliente_id: cliente.id,
        tipo: 'credito_ricevuto',
        importo: p.omb.credito_giornaliero,
        nota: `Credito per sub-affitto ${p.omb.fila}${p.omb.numero} (${formatDate(p.date)})`,
      });
      entry.delta += parseFloat(p.omb.credito_giornaliero || 0);
    }

    const creditTxRows = [];
    for (const entry of creditsByCliente.values()) creditTxRows.push(...entry.rows);
    if (creditTxRows.length) {
      const { error: credTxErr } = await sb.from('transazioni').insert(creditTxRows);
      if (credTxErr) {
        showAlert('finalize-booking-alert', 'Sub-affitti e transazioni salvati, ma errore sui crediti cliente: ' + credTxErr.message, 'error');
        return;
      }
    }

    for (const entry of creditsByCliente.values()) {
      const cliente = entry.cliente;
      const nuovoSaldo = (parseFloat(cliente.credito_saldo || 0) + entry.delta).toFixed(2);
      await sb.from('clienti_stagionali').update({ credito_saldo: nuovoSaldo }).eq('id', cliente.id);
      if (cliente.email) {
        const firstOmb = entry.rows[0];
        const ombLabel = (() => {
          const o = ombrelloniList.find(x => x.id === firstOmb.ombrellone_id);
          return o ? `Fila ${o.fila} N°${o.numero}` : '';
        })();
        const giornate = entry.rows.length;
        const nota = giornate > 1
          ? `Credito per ${giornate} giornate di sub-affitto${nomePrenotazione ? ` — prenotazione "${nomePrenotazione}"` : ''}`
          : firstOmb.nota;
        inviaEmail('credito_accreditato', {
          email: cliente.email,
          nome: cliente.nome,
          cognome: cliente.cognome,
          ombrellone: ombLabel,
          importo_formatted: formatCoin(entry.delta.toFixed(2), currentStabilimento),
          saldo_formatted: formatCoin(nuovoSaldo, currentStabilimento),
          nota,
        }, currentStabilimento);
      }
    }

    closeModal('modal-finalize-booking');
    bookingSelection.clear();
    await loadManagerData();
    if (document.getElementById('mtab-prenotazioni')?.classList.contains('active')) {
      await loadPrenotazioni();
    }
    showAlert('', '', '');
  } finally {
    hideLoading();
  }
}

function clearPrenFilters() {
  const t = document.getElementById('pren-filter-text');
  const f = document.getElementById('pren-filter-from');
  const to = document.getElementById('pren-filter-to');
  if (t) t.value = '';
  if (f) f.value = '';
  if (to) to.value = '';
  if (prenRangePickerInstance) prenRangePickerInstance.clear();
  renderPrenotazioni();
}

let prenRangePickerInstance = null;
function initPrenRangePicker() {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('pren-range-picker');
  if (!input) return;
  const fromVal = document.getElementById('pren-filter-from')?.value || '';
  const toVal = document.getElementById('pren-filter-to')?.value || fromVal;
  const defaults = [];
  if (fromVal) defaults.push(new Date(fromVal + 'T00:00:00'));
  if (toVal && toVal !== fromVal) defaults.push(new Date(toVal + 'T00:00:00'));
  if (prenRangePickerInstance) {
    if (defaults.length) prenRangePickerInstance.setDate(defaults, false);
    else prenRangePickerInstance.clear();
    return;
  }
  prenRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: defaults.length ? defaults : null,
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        const from = toLocalDateStr(selectedDates[0]);
        const to = toLocalDateStr(selectedDates[1]);
        document.getElementById('pren-filter-from').value = from;
        document.getElementById('pren-filter-to').value = to;
        renderPrenotazioni();
      } else if (selectedDates.length === 1) {
        const from = toLocalDateStr(selectedDates[0]);
        document.getElementById('pren-filter-from').value = from;
        document.getElementById('pren-filter-to').value = from;
      } else {
        document.getElementById('pren-filter-from').value = '';
        document.getElementById('pren-filter-to').value = '';
        renderPrenotazioni();
      }
    },
  });
}

function setPrenRange(preset) {
  const today = todayStr();
  let from, to;
  if (preset === 'today') {
    from = to = today;
  } else if (preset === 'next7') {
    const end = new Date(today + 'T00:00:00'); end.setDate(end.getDate() + 6);
    from = today; to = toLocalDateStr(end);
  } else if (preset === 'last7') {
    const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 6);
    from = toLocalDateStr(start); to = today;
  } else if (preset === 'last30') {
    const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 29);
    from = toLocalDateStr(start); to = today;
  } else return;
  document.getElementById('pren-filter-from').value = from;
  document.getElementById('pren-filter-to').value = to;
  if (prenRangePickerInstance) {
    prenRangePickerInstance.setDate([new Date(from + 'T00:00:00'), new Date(to + 'T00:00:00')], false);
  }
  renderPrenotazioni();
}

function updatePrenPresetActive() {
  const from = document.getElementById('pren-filter-from')?.value || '';
  const to = document.getElementById('pren-filter-to')?.value || '';
  const today = todayStr();
  let active = null;
  if (from && to) {
    if (from === today && to === today) {
      active = 'today';
    } else if (from === today) {
      const start = new Date(from + 'T00:00:00');
      const endD = new Date(to + 'T00:00:00');
      const diff = Math.round((endD - start) / 86400000) + 1;
      if (diff === 7) active = 'next7';
    } else if (to === today) {
      const start = new Date(from + 'T00:00:00');
      const endD = new Date(to + 'T00:00:00');
      const diff = Math.round((endD - start) / 86400000) + 1;
      if (diff === 7) active = 'last7';
      else if (diff === 30) active = 'last30';
    }
  }
  document.querySelectorAll('.pren-preset-btn').forEach(btn => {
    if (btn.dataset.preset === active) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

let prenotazioniList = [];

async function loadPrenotazioni() {
  const listEl = document.getElementById('prenotazioni-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="tx-empty">Caricamento...</div>';
  const ombIds = (ombrelloniList || []).map(o => o.id);
  if (!ombIds.length) {
    prenotazioniList = [];
    renderPrenotazioni();
    return;
  }
  const { data, error } = await sb.from('disponibilita')
    .select('*')
    .in('ombrellone_id', ombIds)
    .eq('stato', 'sub_affittato')
    .order('data', { ascending: false });
  if (error) { console.error(error); listEl.innerHTML = '<div class="tx-empty">Errore nel caricamento</div>'; return; }
  prenotazioniList = data || [];
  renderPrenotazioni();
}

function renderPrenotazioni() {
  const listEl = document.getElementById('prenotazioni-list');
  const countEl = document.getElementById('pren-count-label');
  if (!listEl) return;

  updatePrenPresetActive();

  const q = (document.getElementById('pren-filter-text')?.value || '').trim().toLowerCase();
  const from = document.getElementById('pren-filter-from')?.value || '';
  const to = document.getElementById('pren-filter-to')?.value || '';
  if (from && to && from > to) {
    if (countEl) countEl.textContent = '';
    listEl.innerHTML = '<div class="tx-empty">Periodo non valido: la data iniziale è successiva a quella finale</div>';
    return;
  }

  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  const rows = (prenotazioniList || []).filter(p => {
    if (from && p.data < from) return false;
    if (to && p.data > to) return false;
    if (!q) return true;
    const omb = ombsMap[p.ombrellone_id];
    const cli = p.cliente_id ? cliById[p.cliente_id] : null;
    const hay = [
      p.nome_prenotazione || '',
      omb ? `fila ${omb.fila} n°${omb.numero} ${omb.fila}${omb.numero}` : '',
      cli ? `${cli.nome} ${cli.cognome}` : '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!rows.length) {
    if (countEl) countEl.textContent = '';
    listEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione trovata</div>';
    return;
  }

  const groups = new Map();
  rows.forEach(r => {
    const key = r.nome_prenotazione && r.nome_prenotazione.trim()
      ? `N:${r.nome_prenotazione.trim()}`
      : `I:${r.id}`;
    if (!groups.has(key)) groups.set(key, { nome: r.nome_prenotazione || null, items: [] });
    groups.get(key).items.push(r);
  });

  const ordered = Array.from(groups.values()).sort((a, b) => {
    const maxA = a.items.reduce((m, x) => x.data > m ? x.data : m, '');
    const maxB = b.items.reduce((m, x) => x.data > m ? x.data : m, '');
    if (maxA !== maxB) return maxA < maxB ? 1 : -1;
    return 0;
  });

  cancelBookingGroups.clear();
  ordered.forEach((g, i) => cancelBookingGroups.set(`g-${i}`, g));

  const totalBookings = rows.length;
  const totalGroups = ordered.length;
  if (countEl) {
    countEl.textContent = `${totalGroups} prenotazion${totalGroups === 1 ? 'e' : 'i'} · ${totalBookings} sub-affitt${totalBookings === 1 ? 'o' : 'i'}`;
  }

  listEl.innerHTML = ordered.map((g, gi) => {
    const items = g.items.slice().sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
    const dates = items.map(i => i.data);
    const dateLabel = dates.length === 1
      ? formatDate(dates[0])
      : `${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])} (${dates.length} giorn${dates.length === 1 ? 'o' : 'i'})`;

    const clientiSet = new Set();
    items.forEach(i => {
      if (i.cliente_id && cliById[i.cliente_id]) {
        const c = cliById[i.cliente_id];
        clientiSet.add(`${c.nome} ${c.cognome}`);
      }
    });
    const clientiLabel = clientiSet.size
      ? Array.from(clientiSet).join(', ')
      : '<span style="color:var(--text-light)">nessun cliente stagionale</span>';

    const totImporto = items.reduce((s, i) => {
      const o = ombsMap[i.ombrellone_id];
      return s + (o ? parseFloat(o.credito_giornaliero || 0) : 0);
    }, 0);

    const rowsHtml = items.map(i => {
      const o = ombsMap[i.ombrellone_id];
      const ombStr = o ? `Fila ${o.fila} N°${o.numero}` : '<span style="color:var(--text-light)">ombrellone rimosso</span>';
      const cli = i.cliente_id ? cliById[i.cliente_id] : null;
      const cliStr = cli ? `${cli.nome} ${cli.cognome}` : '<span style="color:var(--text-light)">—</span>';
      const imp = o ? formatCoin(o.credito_giornaliero, currentStabilimento) : '—';
      return `<tr>
        <td>${formatDate(i.data)}</td>
        <td><strong>${ombStr}</strong></td>
        <td>${cliStr}</td>
        <td style="text-align:right">${imp}</td>
      </tr>`;
    }).join('');

    const title = g.nome
      ? `<span style="font-weight:600">${g.nome}</span>`
      : `<span style="color:var(--text-light);font-style:italic">Prenotazione senza nome</span>`;

    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header" style="flex-wrap:wrap;gap:8px">
        <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">📖 ${title}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:13px;color:var(--text-mid)">${dateLabel}</div>
          <button class="btn btn-outline btn-sm" onclick="openModifyBookingModal('g-${gi}')">Modifica prenotazione</button>
          <button class="btn btn-danger btn-sm" onclick="openCancelBookingModal('g-${gi}')">Annulla prenotazione</button>
        </div>
      </div>
      <div class="card-body">
        <div style="font-size:13px;color:var(--text-mid);margin-bottom:8px"><strong>Cliente Stagionale:</strong> ${clientiLabel} · <strong>Totale:</strong> ${formatCoin(totImporto, currentStabilimento)}</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Data</th><th>Ombrellone</th><th>Cliente Stagionale</th><th style="text-align:right">Importo</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>
      </div>
    </div>`;
  }).join('');
}

let cancelBookingCurrentId = null;
let modifyBookingCurrentId = null;
let modifyBookingKeepIds = new Set();

async function freeBookingItems(items, group, alertId) {
  const dispIds = items.map(i => i.id);
  const { error } = await sb.rpc('cancel_booking', { p_disp_ids: dispIds });
  if (error) { showAlert(alertId, 'Errore annullamento prenotazione: ' + error.message, 'error'); return false; }
  return true;
}

function openCancelBookingModal(gid) {
  const group = cancelBookingGroups.get(gid);
  if (!group) return;
  cancelBookingCurrentId = gid;

  const items = group.items;
  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  const dates = items.map(i => i.data).sort();
  const dateLabel = dates.length === 1
    ? formatDate(dates[0])
    : `${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])} (${dates.length} giorn${dates.length === 1 ? 'o' : 'i'})`;

  const deltaByCliente = new Map();
  let totImporto = 0;
  items.forEach(i => {
    const o = ombsMap[i.ombrellone_id];
    const imp = o ? parseFloat(o.credito_giornaliero || 0) : 0;
    totImporto += imp;
    if (i.cliente_id) deltaByCliente.set(i.cliente_id, (deltaByCliente.get(i.cliente_id) || 0) + imp);
  });

  const clientiRighe = Array.from(deltaByCliente.entries()).map(([cid, delta]) => {
    const c = cliById[cid];
    if (!c) return `<li>Cliente non trovato — ${formatCoin(delta.toFixed(2), currentStabilimento)} da revocare</li>`;
    const saldoAttuale = parseFloat(c.credito_saldo || 0);
    const saldoNuovo = saldoAttuale - delta;
    const warn = saldoNuovo < 0 ? ` <span style="color:var(--red);font-weight:600">(saldo andrà negativo: ${formatCoin(saldoNuovo.toFixed(2), currentStabilimento)})</span>` : '';
    return `<li><strong>${c.nome} ${c.cognome}</strong>: revoca di ${formatCoin(delta.toFixed(2), currentStabilimento)} (saldo attuale: ${formatCoin(saldoAttuale.toFixed(2), currentStabilimento)})${warn}</li>`;
  }).join('');

  const nomeLabel = group.nome
    ? `<div><strong>Prenotazione:</strong> ${group.nome}</div>`
    : `<div><strong>Prenotazione:</strong> <span style="color:var(--text-light);font-style:italic">senza nome</span></div>`;

  document.getElementById('cancel-booking-summary').innerHTML = `
    ${nomeLabel}
    <div style="margin-top:4px"><strong>Periodo:</strong> ${dateLabel}</div>
    <div style="margin-top:4px"><strong>Sub-affitti da annullare:</strong> ${items.length}</div>
    <div style="margin-top:4px"><strong>Credito totale revocato:</strong> ${formatCoin(totImporto.toFixed(2), currentStabilimento)}</div>
    ${clientiRighe ? `<div style="margin-top:10px;font-size:13px"><strong>Impatto sui clienti:</strong><ul style="margin:6px 0 0 18px;line-height:1.6">${clientiRighe}</ul></div>` : ''}
  `;
  showAlert('cancel-booking-alert', '', '');
  document.getElementById('modal-cancel-booking').classList.remove('hidden');
}

async function confirmCancelBooking() {
  const gid = cancelBookingCurrentId;
  if (!gid) return;
  const group = cancelBookingGroups.get(gid);
  if (!group) return;
  const items = group.items;
  if (!items.length) return;

  showLoading();
  try {
    const ok = await freeBookingItems(items, group, 'cancel-booking-alert');
    if (!ok) return;

    closeModal('modal-cancel-booking');
    cancelBookingCurrentId = null;
    await loadManagerData();
    await loadPrenotazioni();
    showAlert('', '', '');
  } finally {
    hideLoading();
  }
}

function openModifyBookingModal(gid) {
  const group = cancelBookingGroups.get(gid);
  if (!group) return;
  modifyBookingCurrentId = gid;

  const items = group.items.slice().sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  modifyBookingKeepIds = new Set(items.map(i => i.id));

  const nomeLabel = group.nome
    ? `<div><strong>Prenotazione:</strong> ${group.nome}</div>`
    : `<div><strong>Prenotazione:</strong> <span style="color:var(--text-light);font-style:italic">senza nome</span></div>`;
  document.getElementById('modify-booking-header').innerHTML = nomeLabel;

  const rowsHtml = items.map(i => {
    const o = ombsMap[i.ombrellone_id];
    const ombStr = o ? `Fila ${o.fila} N°${o.numero}` : '<span style="color:var(--text-light)">ombrellone rimosso</span>';
    const cli = i.cliente_id ? cliById[i.cliente_id] : null;
    const cliStr = cli ? `${cli.nome} ${cli.cognome}` : '<span style="color:var(--text-light)">—</span>';
    const imp = o ? formatCoin(o.credito_giornaliero, currentStabilimento) : '—';
    return `<tr>
      <td><input type="checkbox" class="modify-booking-chk" data-id="${i.id}" checked onchange="onModifyBookingToggle(this)"></td>
      <td>${formatDate(i.data)}</td>
      <td><strong>${ombStr}</strong></td>
      <td>${cliStr}</td>
      <td style="text-align:right">${imp}</td>
    </tr>`;
  }).join('');
  document.getElementById('modify-booking-rows').innerHTML = rowsHtml;

  updateModifyBookingImpact();
  showAlert('modify-booking-alert', '', '');
  document.getElementById('modal-modify-booking').classList.remove('hidden');
}

function onModifyBookingToggle(el) {
  const id = el.getAttribute('data-id');
  if (!id) return;
  if (el.checked) modifyBookingKeepIds.add(id);
  else modifyBookingKeepIds.delete(id);
  updateModifyBookingImpact();
}

function updateModifyBookingImpact() {
  const gid = modifyBookingCurrentId;
  const group = gid ? cancelBookingGroups.get(gid) : null;
  const target = document.getElementById('modify-booking-impact');
  if (!group || !target) return;

  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  const removed = group.items.filter(i => !modifyBookingKeepIds.has(i.id));
  if (!removed.length) {
    target.innerHTML = `<span style="color:var(--text-light)">Nessuna modifica selezionata.</span>`;
    return;
  }

  const deltaByCliente = new Map();
  let totImporto = 0;
  removed.forEach(i => {
    const o = ombsMap[i.ombrellone_id];
    const imp = o ? parseFloat(o.credito_giornaliero || 0) : 0;
    totImporto += imp;
    if (i.cliente_id) deltaByCliente.set(i.cliente_id, (deltaByCliente.get(i.cliente_id) || 0) + imp);
  });

  const righe = Array.from(deltaByCliente.entries()).map(([cid, delta]) => {
    const c = cliById[cid];
    if (!c) return `<li>Cliente non trovato — ${formatCoin(delta.toFixed(2), currentStabilimento)} da revocare</li>`;
    const saldoAttuale = parseFloat(c.credito_saldo || 0);
    const saldoNuovo = saldoAttuale - delta;
    const warn = saldoNuovo < 0 ? ` <span style="color:var(--red);font-weight:600">(saldo andrà negativo: ${formatCoin(saldoNuovo.toFixed(2), currentStabilimento)})</span>` : '';
    return `<li><strong>${c.nome} ${c.cognome}</strong>: revoca di ${formatCoin(delta.toFixed(2), currentStabilimento)} (saldo attuale: ${formatCoin(saldoAttuale.toFixed(2), currentStabilimento)})${warn}</li>`;
  }).join('');

  target.innerHTML = `
    <div><strong>Sub-affitti da rimuovere:</strong> ${removed.length}</div>
    <div style="margin-top:4px"><strong>Credito totale revocato:</strong> ${formatCoin(totImporto.toFixed(2), currentStabilimento)}</div>
    ${righe ? `<div style="margin-top:8px"><strong>Impatto sui clienti:</strong><ul style="margin:6px 0 0 18px;line-height:1.6">${righe}</ul></div>` : ''}
  `;
}

async function confirmModifyBooking() {
  const gid = modifyBookingCurrentId;
  if (!gid) return;
  const group = cancelBookingGroups.get(gid);
  if (!group) return;

  const removed = group.items.filter(i => !modifyBookingKeepIds.has(i.id));
  if (!removed.length) {
    showAlert('modify-booking-alert', 'Non hai selezionato nessun giorno / ombrellone da rimuovere.', 'error');
    return;
  }
  if (removed.length === group.items.length) {
    showAlert('modify-booking-alert', 'Stai rimuovendo tutti i sub-affitti: usa invece "Annulla prenotazione".', 'error');
    return;
  }

  showLoading();
  try {
    const ok = await freeBookingItems(removed, group, 'modify-booking-alert');
    if (!ok) return;

    closeModal('modal-modify-booking');
    modifyBookingCurrentId = null;
    modifyBookingKeepIds = new Set();
    await loadManagerData();
    await loadPrenotazioni();
    showAlert('', '', '');
  } finally {
    hideLoading();
  }
}

async function usaCredito() {
  const clienteId = document.getElementById('credito-cliente').value;
  const importo = parseFloat(document.getElementById('credito-importo').value);
  const nota = document.getElementById('credito-nota').value.trim();
  if (!clienteId || !importo || importo <= 0) { showAlert('crediti-alert', 'Seleziona cliente e inserisci un importo valido', 'error'); return; }
  const cliente = clientiList.find(c => c.id === clienteId);
  if (parseFloat(cliente.credito_saldo) < importo) { showAlert('crediti-alert', 'Credito insufficiente', 'error'); return; }
  const nuovoSaldo = (parseFloat(cliente.credito_saldo) - importo).toFixed(2);
  const notaFinale = nota || 'Utilizzo credito';
  await sb.from('clienti_stagionali').update({ credito_saldo: nuovoSaldo }).eq('id', clienteId);
  await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, cliente_id: clienteId, tipo: 'credito_usato', importo, nota: notaFinale });
  if (cliente.email) {
    inviaEmail('credito_ritirato', {
      email: cliente.email,
      nome: cliente.nome,
      cognome: cliente.cognome,
      importo_formatted: formatCoin(importo, currentStabilimento),
      saldo_formatted: formatCoin(nuovoSaldo, currentStabilimento),
      nota: notaFinale,
    }, currentStabilimento);
  }
  showAlert('crediti-alert', `Credito di ${formatCoin(importo)} registrato per ${cliente.nome}`, 'success');
  document.getElementById('credito-importo').value = '';
  document.getElementById('credito-nota').value = '';
  await loadManagerData();
}

function findOmbOccupant(ombId, excludeEmail) {
  if (!ombId) return null;
  const lo = (excludeEmail || '').toLowerCase();
  return (clientiList || []).find(c => c.ombrellone_id === ombId && (c.email || '').toLowerCase() !== lo) || null;
}

function openAddRowModal() {
  ['row-fila','row-numero','row-credito','row-nome','row-cognome','row-email','row-telefono'].forEach(id => document.getElementById(id).value = '');
  const chk = document.getElementById('row-invia-invito');
  if (chk) chk.checked = true;
  showAlert('add-row-alert', '', '');
  document.getElementById('modal-add-row').classList.remove('hidden');
}

async function confirmAddRow() {
  const fila = document.getElementById('row-fila').value.trim().toUpperCase();
  const numero = parseInt(document.getElementById('row-numero').value);
  const credito = parseFloat(document.getElementById('row-credito').value);
  const nome = document.getElementById('row-nome').value.trim();
  const cognome = document.getElementById('row-cognome').value.trim();
  const email = document.getElementById('row-email').value.trim();
  const telefono = document.getElementById('row-telefono').value.trim();
  const inviaInvito = document.getElementById('row-invia-invito')?.checked;

  if (!fila || !numero) { showAlert('add-row-alert', 'Fila e numero sono obbligatori', 'error'); return; }
  const hasCliente = !!(nome || cognome || email || telefono);
  if (hasCliente && !email) { showAlert('add-row-alert', "Per salvare il cliente serve un'email valida", 'error'); return; }
  if (hasCliente && !EMAIL_RE.test(email)) { showAlert('add-row-alert', 'Email cliente non valida', 'error'); return; }

  const btn = document.getElementById('btn-add-row');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }

  const creditoVal = isNaN(credito) ? 10 : credito;
  let ombId;
  const existingOmb = (ombrelloniList || []).find(o => o.fila === fila && o.numero === numero);
  if (existingOmb) {
    const { error } = await sb.from('ombrelloni').update({ credito_giornaliero: creditoVal }).eq('id', existingOmb.id);
    if (error) { showAlert('add-row-alert', error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Salva'; } return; }
    ombId = existingOmb.id;
  } else {
    const { data: inserted, error } = await sb.from('ombrelloni')
      .insert({ stabilimento_id: currentStabilimento.id, fila, numero, credito_giornaliero: creditoVal })
      .select('id').single();
    if (error) { showAlert('add-row-alert', error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Salva'; } return; }
    ombId = inserted.id;
  }

  if (!hasCliente) {
    if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
    closeModal('modal-add-row');
    await loadManagerData();
    return;
  }

  const occupant = findOmbOccupant(ombId, email);
  if (occupant) {
    pendingConflict = {
      kind: 'add',
      payload: { nome, cognome, email, telefono, ombId, inviaInvito },
      occupantId: occupant.id,
      ombLabel: `Fila ${fila} N°${numero}`,
      occupantName: `${occupant.nome || ''} ${occupant.cognome || ''}`.trim() || occupant.email,
    };
    document.getElementById('conflict-msg').innerHTML =
      `L'ombrellone <strong>${pendingConflict.ombLabel}</strong> è già assegnato a <strong>${escapeHtml(pendingConflict.occupantName)}</strong>. Chi vuoi tenere su questo ombrellone?`;
    document.getElementById('modal-conflict-cliente').classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
    return;
  }

  await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito });
  if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
}

async function saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito }) {
  const now = new Date().toISOString();
  const { data: existing } = await sb.from('clienti_stagionali')
    .select('id,invito_token,user_id')
    .eq('stabilimento_id', currentStabilimento.id)
    .eq('email', email)
    .maybeSingle();

  const baseUpdate = { nome, cognome, telefono, ombrellone_id: ombId };
  if (inviaInvito) baseUpdate.invitato_at = now;

  let token;
  if (existing) {
    if (existing.user_id) {
      showAlert('add-row-alert', 'Questo cliente ha già completato la registrazione. Usa "Modifica" dalla tabella per cambiargli ombrellone.', 'error');
      return;
    }
    const { error: upErr } = await sb.from('clienti_stagionali').update(baseUpdate).eq('id', existing.id);
    if (upErr) { showAlert('add-row-alert', upErr.message, 'error'); return; }
    token = existing.invito_token;
  } else {
    const { data: inserted, error: insErr } = await sb.from('clienti_stagionali')
      .insert({ stabilimento_id: currentStabilimento.id, email, fonte: 'csv', approvato: false, ...baseUpdate })
      .select('id,invito_token').single();
    if (insErr) { showAlert('add-row-alert', insErr.message, 'error'); return; }
    token = inserted?.invito_token;
  }

  if (inviaInvito && token) {
    const omb = ombId ? (ombrelloniList.find(o => o.id === ombId) || null) : null;
    const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : '';
    const inviteLink = `${window.location.origin}/?invito=${token}`;
    const ok = await retryUntilTrue(
      () => inviaEmail('invito', { email, nome, cognome, ombrellone: ombStr, invite_link: inviteLink }, currentStabilimento),
      3, 500
    );
    if (!ok) {
      showAlert('add-row-alert', '⚠ Cliente salvato ma invio email fallito. Riprova dalla tabella.', 'error');
      await loadManagerData();
      return;
    }
  }

  closeModal('modal-add-row');
  await loadManagerData();
}

async function resolveConflict(choice) {
  if (!pendingConflict) { closeModal('modal-conflict-cliente'); return; }
  if (choice === 'keep') {
    closeModal('modal-conflict-cliente');
    pendingConflict = null;
    return;
  }
  const { kind, payload, occupantId } = pendingConflict;
  await sb.from('clienti_stagionali').update({ ombrellone_id: null }).eq('id', occupantId);
  closeModal('modal-conflict-cliente');
  const p = payload;
  pendingConflict = null;
  if (kind === 'add') await saveCliente(p);
  else if (kind === 'edit') await saveEditedCliente(p);
}

function openEditRowModal(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;
  document.getElementById('edit-row-omb-id').value = omb.id;
  document.getElementById('edit-row-cl-id').value = cliente?.id || '';
  document.getElementById('edit-row-fila').value = omb.fila;
  document.getElementById('edit-row-numero').value = omb.numero;
  document.getElementById('edit-row-credito').value = omb.credito_giornaliero;
  document.getElementById('edit-row-nome').value = cliente?.nome || '';
  document.getElementById('edit-row-cognome').value = cliente?.cognome || '';
  document.getElementById('edit-row-email').value = cliente?.email || '';
  document.getElementById('edit-row-telefono').value = cliente?.telefono || '';
  const emailInput = document.getElementById('edit-row-email');
  emailInput.disabled = !!cliente?.user_id;
  emailInput.title = cliente?.user_id ? 'Email non modificabile: il cliente è già attivo.' : '';
  showAlert('edit-row-alert', '', '');
  document.getElementById('modal-edit-row').classList.remove('hidden');
}

async function confirmEditRow() {
  const ombId = document.getElementById('edit-row-omb-id').value;
  const clId  = document.getElementById('edit-row-cl-id').value || null;
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const fila = document.getElementById('edit-row-fila').value.trim().toUpperCase();
  const numero = parseInt(document.getElementById('edit-row-numero').value);
  const credito = parseFloat(document.getElementById('edit-row-credito').value);
  const nome = document.getElementById('edit-row-nome').value.trim();
  const cognome = document.getElementById('edit-row-cognome').value.trim();
  const email = document.getElementById('edit-row-email').value.trim();
  const telefono = document.getElementById('edit-row-telefono').value.trim();

  if (!fila || !numero) { showAlert('edit-row-alert', 'Fila e numero sono obbligatori', 'error'); return; }
  const ombUpdate = { fila, numero, credito_giornaliero: isNaN(credito) ? omb.credito_giornaliero : credito };
  const { error: ombErr } = await sb.from('ombrelloni').update(ombUpdate).eq('id', ombId);
  if (ombErr) { showAlert('edit-row-alert', ombErr.message, 'error'); return; }

  const hasCliente = !!(nome || cognome || email || telefono);
  const existing = clId ? (clientiList || []).find(c => c.id === clId) : null;

  if (!hasCliente && existing) {
    if (existing.user_id) { showAlert('edit-row-alert', 'Impossibile rimuovere un cliente già attivo. Usa 🗑️ per eliminarlo.', 'error'); return; }
    await sb.from('clienti_stagionali').delete().eq('id', existing.id);
    closeModal('modal-edit-row');
    await loadManagerData();
    return;
  }

  if (hasCliente) {
    if (!email || !EMAIL_RE.test(email)) { showAlert('edit-row-alert', 'Email cliente non valida', 'error'); return; }
    if (existing) {
      const update = { nome, cognome, telefono, ombrellone_id: ombId };
      if (!existing.user_id) update.email = email;
      const { error } = await sb.from('clienti_stagionali').update(update).eq('id', existing.id);
      if (error) { showAlert('edit-row-alert', error.message, 'error'); return; }
    } else {
      const occupant = findOmbOccupant(ombId, email);
      if (occupant) {
        pendingConflict = {
          kind: 'edit',
          payload: { id: null, nome, cognome, email, telefono, ombId },
          occupantId: occupant.id,
          ombLabel: `Fila ${fila} N°${numero}`,
          occupantName: `${occupant.nome || ''} ${occupant.cognome || ''}`.trim() || occupant.email,
        };
        document.getElementById('conflict-msg').innerHTML =
          `L'ombrellone <strong>${pendingConflict.ombLabel}</strong> è già assegnato a <strong>${escapeHtml(pendingConflict.occupantName)}</strong>. Chi vuoi tenere su questo ombrellone?`;
        document.getElementById('modal-conflict-cliente').classList.remove('hidden');
        return;
      }
      await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito: false });
      return;
    }
  }

  closeModal('modal-edit-row');
  await loadManagerData();
}

async function saveEditedCliente({ id, nome, cognome, email, telefono, ombId }) {
  if (id) {
    const c = (clientiList || []).find(x => x.id === id);
    const update = { nome, cognome, telefono, ombrellone_id: ombId };
    if (!c?.user_id) update.email = email;
    const { error } = await sb.from('clienti_stagionali').update(update).eq('id', id);
    if (error) { showAlert('edit-row-alert', error.message, 'error'); return; }
    closeModal('modal-edit-row');
    await loadManagerData();
  } else {
    await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito: false });
    closeModal('modal-edit-row');
  }
}

async function deleteRow(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;
  const msg = cliente
    ? `Rimuovere l'ombrellone Fila ${omb.fila} N°${omb.numero} e il cliente associato (${cliente.nome || ''} ${cliente.cognome || ''})?`
    : `Rimuovere l'ombrellone Fila ${omb.fila} N°${omb.numero}?`;
  if (!confirm(msg)) return;
  if (cliente) await sb.from('clienti_stagionali').delete().eq('id', cliente.id);
  await sb.from('ombrelloni').delete().eq('id', ombId);
  await loadManagerData();
}

let viewOmbIdCurrent = null;
let viewOmbDispMap = {};
let viewOmbCalYear = new Date().getFullYear();
let viewOmbCalMonth = new Date().getMonth();

async function openViewOmbrelloneModal(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;

  viewOmbIdCurrent = ombId;
  const now = new Date();
  viewOmbCalYear = now.getFullYear();
  viewOmbCalMonth = now.getMonth();

  document.getElementById('view-omb-title').textContent = `☂️ Ombrellone Fila ${omb.fila} · N°${omb.numero}`;
  document.getElementById('view-omb-credito').textContent = formatCoin(omb.credito_giornaliero);
  const clienteInfo = cliente
    ? `${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}${cliente.email ? ' · ' + escapeHtml(cliente.email) : ''}`
    : '<span style="color:var(--text-light)">Nessun cliente associato</span>';
  document.getElementById('view-omb-cliente').innerHTML = clienteInfo;
  document.getElementById('view-omb-saldo').textContent = cliente
    ? formatCoin(cliente.credito_saldo)
    : '–';

  showLoading();
  const { data: disp } = await sb.from('disponibilita').select('data, stato').eq('ombrellone_id', ombId);
  viewOmbDispMap = {};
  (disp || []).forEach(d => { viewOmbDispMap[d.data] = d.stato; });
  hideLoading();

  renderViewOmbrelloneCalendar();
  document.getElementById('modal-view-ombrellone').classList.remove('hidden');
}

function viewOmbrelloneCalNav(dir) {
  viewOmbCalMonth += dir;
  if (viewOmbCalMonth > 11) { viewOmbCalMonth = 0; viewOmbCalYear++; }
  if (viewOmbCalMonth < 0) { viewOmbCalMonth = 11; viewOmbCalYear--; }
  renderViewOmbrelloneCalendar();
}

function renderViewOmbrelloneCalendar() {
  const el = document.getElementById('view-omb-calendar');
  const label = document.getElementById('view-omb-cal-label');
  if (!el || !label) return;
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  label.textContent = months[viewOmbCalMonth] + ' ' + viewOmbCalYear;
  const firstDay = new Date(viewOmbCalYear, viewOmbCalMonth, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewOmbCalYear, viewOmbCalMonth + 1, 0).getDate();
  const today = new Date();
  el.innerHTML = '';
  for (let i = 0; i < offset; i++) {
    const d = document.createElement('div'); d.className = 'cal-day empty'; el.appendChild(d);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewOmbCalYear}-${String(viewOmbCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(viewOmbCalYear, viewOmbCalMonth, d);
    const isToday = cellDate.toDateString() === today.toDateString();
    const isPast = cellDate < today && !isToday;
    const stato = viewOmbDispMap[dateStr];
    let cls = 'cal-day cal-day-readonly';
    if (isPast) cls += ' past';
    else if (isToday) cls += ' today';
    if (stato === 'libero') cls += ' free';
    if (stato === 'sub_affittato') cls += ' subleased';
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = d;
    if (stato === 'libero') div.title = `${formatDate(dateStr)} · Dichiarato libero`;
    else if (stato === 'sub_affittato') div.title = `${formatDate(dateStr)} · Sub-affittato`;
    el.appendChild(div);
  }
}
