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

async function renderMapRegoleBanner(from, to, dates, regole) {
  const el = document.getElementById('map-regole-banner');
  if (!el || !currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine = currentStabilimento.data_fine_stagione;
  const pills = [];

  // Fuori stagione: completamente o parzialmente.
  if (inizio && fine && dates.length) {
    const allOut = dates.every(d => d < inizio || d > fine);
    const someOut = !allOut && dates.some(d => d < inizio || d > fine);
    if (allOut) {
      pills.push({ bg:'var(--sand)', fg:'var(--text-strong)', icon:'🌙', text:`Periodo interamente fuori stagione (${formatDate(inizio)} → ${formatDate(fine)})` });
    } else if (someOut) {
      pills.push({ bg:'var(--sand)', fg:'var(--text-mid)', icon:'⚠️', text:`Parte del periodo è fuori stagione (${formatDate(inizio)} → ${formatDate(fine)})` });
    }
  }

  // Regole forzate sovrapposte al range (passate come parametro per evitare doppia query).
  const labelByTipo = {
    chiusura_speciale: { l:'Chiusura speciale', bg:'var(--coral-light)', fg:'var(--coral)', icon:'🚫' },
    sempre_libero:     { l:'Sempre subaffittabile', bg:'var(--green-light)', fg:'var(--green)', icon:'✅' },
    mai_libero:        { l:'Mai subaffittabile', bg:'var(--yellow-light)', fg:'#9C7A1F', icon:'🔒' },
  };
  (regole || []).forEach(r => {
    const m = labelByTipo[r.tipo]; if (!m) return;
    const range = r.data_da === r.data_a ? formatDate(r.data_da) : `${formatDate(r.data_da)} → ${formatDate(r.data_a)}`;
    pills.push({ bg:m.bg, fg:m.fg, icon:m.icon, text:`${m.l} attiva (${range})` });
  });

  if (!pills.length) { el.innerHTML = ''; return; }
  el.innerHTML = pills.map(p =>
    `<div style="background:${p.bg};color:${p.fg};padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;display:inline-block;margin:2px 4px 2px 0">${p.icon} ${escapeHtml(p.text)}</div>`
  ).join('');
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

  const ombIds = ombrelloniList.map(o => o.id);
  const [{ data: disp }, { data: regole }] = await Promise.all([
    fetchAllPaginated(() => sb.from('disponibilita')
      .select('*')
      .gte('data', from)
      .lte('data', to)
      .in('ombrellone_id', ombIds)),
    sb.from('regole_stato_ombrelloni')
      .select('*')
      .eq('stabilimento_id', currentStabilimento.id)
      .gte('data_a', from)
      .lte('data_da', to),
  ]);

  renderMapRegoleBanner(from, to, dates, regole || []);

  const dispByOmbDate = {};
  (disp || []).forEach(d => {
    if (!dispByOmbDate[d.ombrellone_id]) dispByOmbDate[d.ombrellone_id] = {};
    dispByOmbDate[d.ombrellone_id][d.data] = d.stato;
  });

  // Applica override delle regole forzate sui giorni del range.
  // Precedenza per giorno: chiusura_speciale > mai_libero > sempre_libero.
  // - sempre_libero: tutti gli ombrelloni → 'libero' (eccetto sub_affittato già esistenti)
  // - chiusura_speciale: tutti gli ombrelloni → non bookable (rimuovo eventuali 'libero')
  // - mai_libero: nessun override sulla mappa proprietario (lo stagionale è già bloccato)
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
  for (const d of dates) {
    const tipo = ruleByDate[d];
    if (!tipo) continue;
    ombrelloniList.forEach(o => {
      if (!dispByOmbDate[o.id]) dispByOmbDate[o.id] = {};
      const existing = dispByOmbDate[o.id][d];
      if (tipo === 'sempre_libero') {
        if (existing !== 'sub_affittato') dispByOmbDate[o.id][d] = 'libero';
      } else if (tipo === 'chiusura_speciale') {
        // Le sub_affittato sono già state annullate dall'RPC. Rimuovo eventuali 'libero'
        // residui per impedire al gestore di prenotare nei giorni di chiusura.
        if (existing === 'libero') delete dispByOmbDate[o.id][d];
      }
    });
  }

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

  await loadPanoramicaDefaultIfEmpty();

  await refreshMap();
  renderGestioneTable(ombrelloniList, dispMap, clientiList);
  applyDefaultPrenFilter(today);
  initPrenRangePicker();
  await loadPrenotazioni();
  populateClienteSelect();
  if (!document.getElementById('analytics-date-from').value) {
    setAnalyticsRange('oggi');
  } else {
    updateAnalyticsPresetActive();
    await loadCreditiAnalytics();
  }
}

async function loadPanoramicaDefaultIfEmpty() {
  try {
    if (document.getElementById('pano-overview') && typeof panoramicaInit === 'function') {
      panoramicaInit();
    } else {
      if (typeof loadDashboardUpcomingKpis === 'function') await loadDashboardUpcomingKpis(todayStr());
      if (typeof loadDashboardCreditsKpis === 'function') await loadDashboardCreditsKpis();
    }
  } catch (e) {
    console.error('Panoramica init failed:', e);
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

function applyDefaultPrenFilter(today) {
  const fromEl = document.getElementById('pren-filter-from');
  const toEl = document.getElementById('pren-filter-to');
  if (!fromEl || !toEl) return;
  if (fromEl.value || toEl.value) return;
  const start = new Date(today + 'T00:00:00');
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
      const hasCliente = (clientiList || []).some(c => !c.rifiutato && c.ombrellone_id === o.id);
      const noClienteCls = !hasCliente ? ' no-cliente' : '';
      el2.className = 'ombrellone ' + cls + noClienteCls + (isSelected ? ' selected' : '');
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
    return `<tr style="cursor:pointer" onclick="openViewOmbrelloneModal('${omb.id}')" title="Vedi dettagli ombrellone">
      <td onclick="event.stopPropagation()">${checkbox}</td>
      <td><strong>${escapeHtml(omb.fila)}</strong></td>
      <td>${omb.numero}</td>
      <td>${formatCoin(omb.credito_giornaliero)}</td>
      <td>${cliente ? `<strong>${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}</strong>` : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${cliente ? escapeHtml(cliente.email || '') : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${cliente ? (escapeHtml(cliente.telefono || '') || '–') : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${pill}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        <button class="btn btn-outline btn-sm" onclick="openViewOmbrelloneModal('${omb.id}')" title="Vedi dettagli" style="margin-right:4px">👁️</button>
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

function invitaSingolo(id) {
  const c = clientiList.find(x => x.id === id);
  if (!c) return;
  if (!c.invito_token) { alert('Token invito mancante, impossibile inviare.'); return; }
  openBulkInviteModal([id]);
}

async function refreshCreditoCliente() {
  if (!currentStabilimento) return;
  const [{ data: clienti }, { data: ombs }] = await Promise.all([
    sb.from('clienti_stagionali').select('*').eq('stabilimento_id', currentStabilimento.id),
    sb.from('ombrelloni').select('*').eq('stabilimento_id', currentStabilimento.id).order('fila').order('numero'),
  ]);
  if (clienti) clientiList = clienti;
  if (ombs) ombrelloniList = ombs;
  populateClienteSelect();
}

function populateClienteSelect() {
  const root = document.querySelector('[data-combobox="credito-cliente"]');
  if (!root) return;
  const search = document.getElementById('credito-cliente-search');
  const hidden = document.getElementById('credito-cliente');
  const list = document.getElementById('credito-cliente-list');

  const ombsById = {};
  (ombrelloniList || []).forEach(o => { ombsById[o.id] = o; });
  const entries = (clientiList || []).map(c => {
    const o = c.ombrellone_id ? ombsById[c.ombrellone_id] : null;
    const nome = `${c.nome || ''} ${c.cognome || ''}`.trim() || c.email || '(senza nome)';
    return {
      id: c.id,
      nome,
      ombrellone: o ? `${o.fila}${o.numero}` : '',
      saldoLabel: formatCoin(c.credito_saldo, currentStabilimento),
    };
  });
  entries.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  root._entries = entries;

  initClienteCombobox();

  if (hidden.value) {
    const sel = entries.find(e => e.id === hidden.value);
    if (sel) {
      search.value = formatClienteComboLabel(sel);
      updateCreditoSaldoBox(sel);
    } else {
      hidden.value = '';
      search.value = '';
      updateCreditoSaldoBox(null);
    }
  }
  renderClienteComboList(list.classList.contains('hidden') ? '' : search.value);
}

function formatClienteComboLabel(e) {
  const omb = e.ombrellone ? ` · ${e.ombrellone}` : '';
  return `${e.nome}${omb} (${e.saldoLabel})`;
}

function renderClienteComboList(query) {
  const root = document.querySelector('[data-combobox="credito-cliente"]');
  if (!root) return;
  const list = document.getElementById('credito-cliente-list');
  const entries = root._entries || [];
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? entries.filter(e => e.nome.toLowerCase().includes(q) || e.ombrellone.toLowerCase().includes(q))
    : entries;
  if (!filtered.length) {
    list.innerHTML = `<div class="combobox-empty">Nessun cliente trovato</div>`;
    return;
  }
  list.innerHTML = filtered.map(e => `
    <button type="button" class="combobox-item" data-id="${e.id}">
      <span class="combobox-item-main">${escapeHtml(e.nome)}${e.ombrellone ? ` <span class="combobox-item-omb">${escapeHtml(e.ombrellone)}</span>` : ''}</span>
      <span class="combobox-item-saldo">${escapeHtml(e.saldoLabel)}</span>
    </button>`).join('');
}

function updateCreditoSaldoBox(entry) {
  const box = document.getElementById('credito-saldo-box');
  const val = document.getElementById('credito-saldo-value');
  if (!box || !val) return;
  if (!entry) { box.classList.add('hidden'); return; }
  val.textContent = entry.saldoLabel;
  box.classList.remove('hidden');
}

function selectClienteCombo(id) {
  const root = document.querySelector('[data-combobox="credito-cliente"]');
  if (!root) return;
  const entries = root._entries || [];
  const e = entries.find(x => x.id === id);
  if (!e) return;
  document.getElementById('credito-cliente').value = id;
  document.getElementById('credito-cliente-search').value = formatClienteComboLabel(e);
  document.getElementById('credito-cliente-list').classList.add('hidden');
  updateCreditoSaldoBox(e);
}

function initClienteCombobox() {
  const search = document.getElementById('credito-cliente-search');
  const list = document.getElementById('credito-cliente-list');
  if (!search || !list || search._comboBound) return;
  search._comboBound = true;

  search.addEventListener('input', () => {
    document.getElementById('credito-cliente').value = '';
    updateCreditoSaldoBox(null);
    renderClienteComboList(search.value);
    list.classList.remove('hidden');
  });
  search.addEventListener('focus', () => {
    // Se c'è già una selezione, seleziona tutto il testo: la prima digitazione
    // lo sostituisce (così l'utente non deve cancellare a mano la label "(saldo)").
    if (document.getElementById('credito-cliente').value) {
      try { search.select(); } catch (_) {}
    }
    // Mostra sempre l'elenco completo al focus (non filtrare con la label completa).
    renderClienteComboList('');
    list.classList.remove('hidden');
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { list.classList.add('hidden'); search.blur(); }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.combobox-item');
    if (!btn) return;
    e.preventDefault();
    selectClienteCombo(btn.dataset.id);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-combobox="credito-cliente"]')) {
      list.classList.add('hidden');
    }
  });
}

const ANALYTICS_PAGE_SIZE = 10;
let analyticsRows = [];
let analyticsPage = 1;
let analyticsCtx = { ombById: {}, cliById: {} };

function setAnalyticsRange(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'ieri') {
    from.setDate(from.getDate() - 1);
    to.setDate(to.getDate() - 1);
  } else if (preset !== 'oggi') {
    const days = parseInt(preset, 10);
    from.setDate(from.getDate() - (days - 1));
  }
  setDateInputValue(document.getElementById('analytics-date-from'), from);
  setDateInputValue(document.getElementById('analytics-date-to'), to);
  updateAnalyticsPresetActive();
  loadCreditiAnalytics();
}

function updateAnalyticsPresetActive() {
  const from = document.getElementById('analytics-date-from')?.value || '';
  const to = document.getElementById('analytics-date-to')?.value || '';
  const today = todayStr();
  let active = null;
  if (from && to) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if (to === today) {
      if (diff === 1) active = 'oggi';
      else if (diff === 3) active = '3';
      else if (diff === 7) active = '7';
    } else if (diff === 1 && from === to) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (from === toLocalDateStr(yesterday)) active = 'ieri';
    }
  }
  document.querySelectorAll('.analytics-preset-btn').forEach(btn => {
    if (btn.dataset.preset === active) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

function changeAnalyticsPage(dir) {
  const totalPages = Math.max(1, Math.ceil(analyticsRows.length / ANALYTICS_PAGE_SIZE));
  const next = Math.min(totalPages, Math.max(1, analyticsPage + dir));
  if (next === analyticsPage) return;
  analyticsPage = next;
  renderAnalyticsPage();
}

const ANALYTICS_TX_LABELS = {
  sub_affitto: 'Sub-affitto',
  sub_affitto_annullato: 'Sub-affitto annullato',
  credito_ricevuto: 'Credito ricevuto',
  credito_usato: 'Credito utilizzato',
  credito_revocato: 'Credito revocato',
};

const ANALYTICS_TX_COLORS = {
  sub_affitto: 'var(--ocean)',
  sub_affitto_annullato: 'var(--text-light)',
  credito_ricevuto: 'var(--ocean)',
  credito_usato: 'var(--coral)',
  credito_revocato: 'var(--text-light)',
};

function renderAnalyticsPage() {
  const tb = document.getElementById('analytics-table');
  const empty = document.getElementById('analytics-empty');
  const pag = document.getElementById('analytics-pagination');
  if (!tb) return;
  if (!analyticsRows.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    pag.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');

  const total = analyticsRows.length;
  const totalPages = Math.max(1, Math.ceil(total / ANALYTICS_PAGE_SIZE));
  if (analyticsPage > totalPages) analyticsPage = totalPages;
  const startIdx = (analyticsPage - 1) * ANALYTICS_PAGE_SIZE;
  const pageRows = analyticsRows.slice(startIdx, startIdx + ANALYTICS_PAGE_SIZE);
  const { ombById, cliById } = analyticsCtx;

  tb.innerHTML = pageRows.map(t => {
    const o = t.ombrellone_id ? ombById[t.ombrellone_id] : null;
    const c = t.cliente_id ? cliById[t.cliente_id] : null;
    const ombStr = o
      ? `Fila ${o.fila} N°${o.numero}`
      : (t.ombrellone_id ? '<span style="color:var(--text-light)">— ombrellone rimosso</span>' : '<span style="color:var(--text-light)">—</span>');
    const cliStr = c ? `${c.nome} ${c.cognome}` : '<span style="color:var(--text-light)">—</span>';
    const tipoLabel = ANALYTICS_TX_LABELS[t.tipo] || t.tipo;
    const importo = parseFloat(t.importo || 0);
    const importoColor = ANALYTICS_TX_COLORS[t.tipo] || 'var(--text-mid)';
    const importoStr = importo > 0 ? formatCoin(importo) : '<span style="color:var(--text-light)">—</span>';
    const nota = t.nota ? String(t.nota).replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m])) : '<span style="color:var(--text-light)">—</span>';
    return `<tr>
      <td>${formatDateShort(t.created_at)}</td>
      <td><strong>${tipoLabel}</strong></td>
      <td>${cliStr}</td>
      <td>${ombStr}</td>
      <td style="text-align:right;color:${importoColor};font-weight:600">${importoStr}</td>
      <td style="color:var(--text-mid);font-size:13px">${nota}</td>
    </tr>`;
  }).join('');

  if (total > ANALYTICS_PAGE_SIZE) {
    pag.classList.remove('hidden');
    const info = document.getElementById('analytics-page-info');
    const fromN = startIdx + 1;
    const toN = Math.min(total, startIdx + ANALYTICS_PAGE_SIZE);
    info.textContent = `${fromN}–${toN} di ${total} · pagina ${analyticsPage} di ${totalPages}`;
    document.getElementById('analytics-page-prev').disabled = analyticsPage <= 1;
    document.getElementById('analytics-page-next').disabled = analyticsPage >= totalPages;
  } else {
    pag.classList.add('hidden');
  }
}

async function loadCreditiAnalytics() {
  if (!currentStabilimento) return;
  const from = document.getElementById('analytics-date-from').value;
  const to = document.getElementById('analytics-date-to').value;
  if (!from || !to) return;
  if (from > to) { showAlert('crediti-alert', 'Periodo non valido: la data iniziale è successiva a quella finale', 'error'); return; }
  showAlert('crediti-alert', '', null);

  const fromIso = new Date(from + 'T00:00:00').toISOString();
  const toIso = new Date(to + 'T23:59:59.999').toISOString();

  const { data: txs, error } = await sb.from('transazioni')
    .select('id, ombrellone_id, cliente_id, tipo, importo, nota, created_at')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('tipo', ['sub_affitto', 'sub_affitto_annullato', 'credito_ricevuto', 'credito_usato', 'credito_revocato'])
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); showAlert('crediti-alert', 'Errore nel caricamento delle transazioni', 'error'); return; }

  const ombById = {};
  ombrelloniList.forEach(o => { ombById[o.id] = o; });
  const cliById = {};
  clientiList.forEach(c => { cliById[c.id] = c; });

  let totRic = 0, totSpe = 0, totSub = 0;
  (txs || []).forEach(t => {
    const importo = parseFloat(t.importo || 0);
    if (t.tipo === 'sub_affitto')          totSub += 1;
    else if (t.tipo === 'sub_affitto_annullato') totSub = Math.max(0, totSub - 1);
    else if (t.tipo === 'credito_ricevuto') totRic += importo;
    else if (t.tipo === 'credito_revocato') totRic = Math.max(0, totRic - importo);
    else if (t.tipo === 'credito_usato')    totSpe += importo;
  });

  document.getElementById('analytics-tot-ricevuti').textContent = formatCoin(totRic);
  document.getElementById('analytics-tot-spesi').textContent = formatCoin(totSpe);
  document.getElementById('analytics-tot-subaffitti').textContent = totSub;
  document.getElementById('analytics-tot-subaffitti-sub').textContent = totSub === 1 ? 'giornata sub-affittata' : 'giornate sub-affittate';

  analyticsRows = txs || [];
  analyticsCtx = { ombById, cliById };
  analyticsPage = 1;
  renderAnalyticsPage();
}

function ombById() {
  const map = {};
  (ombrelloniList || []).forEach(o => { map[o.id] = o; });
  return map;
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
    regola_forzata_aggiunta: {e:'🛠️',c:'blue'},
    regola_forzata_rimossa: {e:'🛠️',c:'blue'},
  };
  const labels = {
    disponibilita_aggiunta: 'Disponibilità dichiarata',
    disponibilita_rimossa: 'Disponibilità rimossa',
    sub_affitto: 'Sub-affitto confermato',
    sub_affitto_annullato: 'Sub-affitto annullato',
    credito_ricevuto: 'Credito ricevuto',
    credito_usato: 'Credito utilizzato',
    credito_revocato: 'Credito revocato',
    regola_forzata_aggiunta: 'Regola gestore: impostata',
    regola_forzata_rimossa: 'Regola gestore: revocata',
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

function toggleSidebarAltro(btn) {
  const items = document.getElementById('sidebar-altro-items');
  if (!items) return;
  const open = items.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const chevron = btn.querySelector('.sidebar-altro-chevron');
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}

function managerTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('mtab-' + tab);
  panel.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const altroTabs = ['transazioni', 'comunicazioni', 'config', 'log'];
  const altroItems = document.getElementById('sidebar-altro-items');
  const altroToggle = document.querySelector('.sidebar-altro-toggle');
  if (altroTabs.includes(tab)) {
    if (altroItems) altroItems.classList.add('open');
    if (altroToggle) {
      altroToggle.setAttribute('aria-expanded', 'true');
      const chevron = altroToggle.querySelector('.sidebar-altro-chevron');
      if (chevron) chevron.textContent = '▾';
      altroToggle.classList.add('active');
    }
  } else {
    if (altroToggle) altroToggle.classList.remove('active');
  }

  if (tab === 'panoramica' && typeof panoramicaInit === 'function') {
    try { panoramicaInit(); } catch (e) { console.error('panoramicaInit failed:', e); }
  }
  if (tab === 'config') {
    loadEmailTemplates();
    if (typeof loadStagione === 'function') loadStagione();
    if (typeof loadRegoleStato === 'function') loadRegoleStato();
    if (typeof loadBackupList === 'function') loadBackupList();
  }
  if (tab === 'prenotazioni') loadPrenotazioni();
  if (tab === 'crediti') refreshCreditoCliente();
  if (tab === 'transazioni' && typeof txTabInit === 'function') txTabInit();
  if (tab === 'log') {
    // Default: ultimi 7 giorni, size 30.
    if (!document.getElementById('audit-date-from').value) {
      document.getElementById('audit-date-from').value = auditDaysAgoIso(7);
      document.getElementById('audit-date-to').value   = auditTodayIso();
    }
    auditState.page = 1;
    loadAuditLog();
  }
  if (tab === 'comunicazioni' && typeof comunicazioniInit === 'function') {
    try { comunicazioniInit(); } catch (e) { console.error('comunicazioniInit failed:', e); }
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
  const defaultName = generateDefaultBookingName();
  const nomePrenotazione = rawName ? `${defaultName} — ${rawName}` : defaultName;

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
        importo: cliente ? p.omb.credito_giornaliero : null,
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
  const n = document.getElementById('pren-filter-nome');
  const o = document.getElementById('pren-filter-ombrellone');
  const f = document.getElementById('pren-filter-from');
  const to = document.getElementById('pren-filter-to');
  if (n) n.value = '';
  if (o) o.value = '';
  if (f) f.value = '';
  if (to) to.value = '';
  if (prenRangePickerInstance) prenRangePickerInstance.clear();
  renderPrenotazioni();
}

function matchesOmbrelloneQuery(omb, query) {
  const fila = String(omb.fila || '').toLowerCase();
  const num  = String(omb.numero || '').toLowerCase();
  const compact = `${fila}${num}`;
  const label = `fila ${fila} n°${num}`;
  return num === query || compact === query || compact.includes(query) || label.includes(query) || num.includes(query);
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
  } else if (preset === 'next30') {
    const end = new Date(today + 'T00:00:00'); end.setDate(end.getDate() + 29);
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
      else if (diff === 30) active = 'next30';
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
let prenViewMode = 'lista';

function prenViewStorageKey() {
  return `pren-view-mode:${currentStabilimento?.id || 'default'}`;
}

function loadPrenViewMode() {
  try {
    const v = localStorage.getItem(prenViewStorageKey());
    prenViewMode = (v === 'tabella') ? 'tabella' : 'lista';
  } catch (_) { prenViewMode = 'lista'; }
  syncPrenViewToggleUI();
}

function syncPrenViewToggleUI() {
  document.querySelectorAll('.pren-view-btn').forEach(btn => {
    const active = btn.dataset.view === prenViewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const listEl = document.getElementById('prenotazioni-list');
  const tabEl = document.getElementById('prenotazioni-tabella');
  if (listEl) listEl.classList.toggle('hidden', prenViewMode !== 'lista');
  if (tabEl) tabEl.classList.toggle('hidden', prenViewMode !== 'tabella');
}

function setPrenViewMode(mode) {
  prenViewMode = (mode === 'tabella') ? 'tabella' : 'lista';
  try { localStorage.setItem(prenViewStorageKey(), prenViewMode); } catch (_) {}
  syncPrenViewToggleUI();
  renderPrenotazioni();
}

async function loadPrenotazioni() {
  const listEl = document.getElementById('prenotazioni-list');
  if (!listEl) return;
  loadPrenViewMode();
  listEl.innerHTML = '<div class="tx-empty">Caricamento...</div>';
  const tabEl0 = document.getElementById('prenotazioni-tabella');
  if (tabEl0) tabEl0.innerHTML = '<div class="tx-empty">Caricamento...</div>';
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
  if (typeof dispViewInvalidate === 'function') dispViewInvalidate();
}

function renderPrenotazioni() {
  const listEl = document.getElementById('prenotazioni-list');
  const countEl = document.getElementById('pren-count-label');
  if (!listEl) return;

  syncPrenViewToggleUI();
  updatePrenPresetActive();

  const qNome = (document.getElementById('pren-filter-nome')?.value || '').trim().toLowerCase();
  const qOmb  = (document.getElementById('pren-filter-ombrellone')?.value || '').trim().toLowerCase();
  const from = document.getElementById('pren-filter-from')?.value || '';
  const to = document.getElementById('pren-filter-to')?.value || '';
  if (from && to && from > to) {
    if (countEl) countEl.textContent = '';
    const msg = '<div class="tx-empty">Periodo non valido: la data iniziale è successiva a quella finale</div>';
    listEl.innerHTML = msg;
    const tabEl = document.getElementById('prenotazioni-tabella');
    if (tabEl) tabEl.innerHTML = msg;
    return;
  }

  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  const rows = (prenotazioniList || []).filter(p => {
    if (from && p.data < from) return false;
    if (to && p.data > to) return false;
    if (qNome && !(p.nome_prenotazione || '').toLowerCase().includes(qNome)) return false;
    if (qOmb) {
      const omb = ombsMap[p.ombrellone_id];
      if (!omb) return false;
      if (!matchesOmbrelloneQuery(omb, qOmb)) return false;
    }
    return true;
  });

  if (!rows.length) {
    if (countEl) countEl.textContent = '';
    listEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione trovata</div>';
    const tabEl = document.getElementById('prenotazioni-tabella');
    if (tabEl) tabEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione trovata</div>';
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

  const today = todayStr();
  const groupSortKeys = (g) => {
    const dates = g.items.map(x => x.data);
    const upcoming = dates.filter(d => d >= today).sort();
    const nextUpcoming = upcoming[0] || null;
    const maxDate = dates.reduce((m, d) => d > m ? d : m, '');
    const minCreated = g.items.reduce((m, x) => {
      if (!x.created_at) return m;
      return (m === '' || x.created_at < m) ? x.created_at : m;
    }, '');
    return { nextUpcoming, maxDate, minCreated };
  };
  const ordered = Array.from(groups.values()).sort((a, b) => {
    const ka = groupSortKeys(a);
    const kb = groupSortKeys(b);
    if (ka.nextUpcoming && !kb.nextUpcoming) return -1;
    if (!ka.nextUpcoming && kb.nextUpcoming) return 1;
    if (ka.nextUpcoming && kb.nextUpcoming) {
      if (ka.nextUpcoming !== kb.nextUpcoming) return ka.nextUpcoming < kb.nextUpcoming ? -1 : 1;
    } else {
      if (ka.maxDate !== kb.maxDate) return ka.maxDate < kb.maxDate ? 1 : -1;
    }
    if (ka.minCreated !== kb.minCreated) return ka.minCreated < kb.minCreated ? -1 : 1;
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

  renderPrenotazioniTabella(ordered, { from, to });
}

function renderPrenotazioniTabella(ordered, filterRange) {
  const tabEl = document.getElementById('prenotazioni-tabella');
  if (!tabEl) return;

  if (!ordered.length) {
    tabEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione trovata</div>';
    return;
  }

  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  let rangeFrom = filterRange.from || '';
  let rangeTo = filterRange.to || '';
  if (!rangeFrom || !rangeTo) {
    let minD = null, maxD = null;
    ordered.forEach(g => g.items.forEach(i => {
      if (!minD || i.data < minD) minD = i.data;
      if (!maxD || i.data > maxD) maxD = i.data;
    }));
    if (!rangeFrom) rangeFrom = minD;
    if (!rangeTo) rangeTo = maxD;
  }
  if (!rangeFrom || !rangeTo) {
    tabEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione trovata</div>';
    return;
  }

  const dayList = [];
  {
    const start = new Date(rangeFrom + 'T00:00:00');
    const end = new Date(rangeTo + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dayList.push(toLocalDateStr(new Date(d)));
    }
  }

  const today = todayStr();

  const groupsWithCells = ordered.map((g, gi) => {
    const byDay = new Map();
    g.items.forEach(it => {
      if (!byDay.has(it.data)) byDay.set(it.data, []);
      byDay.get(it.data).push(it);
    });
    let firstInRange = null;
    for (const d of dayList) {
      if (byDay.has(d)) { firstInRange = d; break; }
    }
    const minCreated = g.items.reduce((m, x) => {
      if (!x.created_at) return m;
      return (m === '' || x.created_at < m) ? x.created_at : m;
    }, '');
    return { g, gi, byDay, firstInRange, minCreated };
  }).filter(x => x.firstInRange);

  groupsWithCells.sort((a, b) => {
    if (a.firstInRange !== b.firstInRange) return a.firstInRange < b.firstInRange ? -1 : 1;
    if (a.minCreated !== b.minCreated) return a.minCreated < b.minCreated ? -1 : 1;
    return 0;
  });

  if (!groupsWithCells.length) {
    tabEl.innerHTML = '<div class="tx-empty">Nessuna prenotazione nel periodo selezionato</div>';
    return;
  }

  const monthName = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('it-IT', { month: 'short' });
  };
  const dayNum = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.getDate();
  };
  const dayWeek = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('it-IT', { weekday: 'narrow' });
  };

  const headerCells = dayList.map(d => {
    const isToday = d === today;
    const cls = ['pren-tab-day-th'];
    if (isToday) cls.push('today');
    return `<th class="${cls.join(' ')}" title="${formatDate(d)}">
      <div class="pren-tab-day-week">${dayWeek(d)}</div>
      <div class="pren-tab-day-num">${dayNum(d)}</div>
      <div class="pren-tab-day-mon">${monthName(d)}</div>
    </th>`;
  }).join('');

  const rowsHtml = groupsWithCells.map(({ g, gi, byDay }) => {
    const title = g.nome
      ? escapeHtml(g.nome)
      : '<span style="color:var(--text-light);font-style:italic">Senza nome</span>';

    const summaryCell = `<th class="pren-tab-row-th" onclick="openPrenDettagliModal('g-${gi}')">
      <div class="pren-tab-row-title">📖 ${title}</div>
    </th>`;

    const dayCells = dayList.map(d => {
      const isToday = d === today;
      const list = byDay.get(d);
      const baseCls = ['pren-tab-cell'];
      if (isToday) baseCls.push('today');
      if (!list || !list.length) {
        return `<td class="${baseCls.join(' ')}"></td>`;
      }
      baseCls.push('booked');
      const labels = list.map(it => {
        const o = ombsMap[it.ombrellone_id];
        const ombStr = o ? `Fila ${o.fila} N°${o.numero}` : 'ombrellone rimosso';
        const cli = it.cliente_id ? cliById[it.cliente_id] : null;
        const cliStr = cli ? `${cli.nome} ${cli.cognome}` : '—';
        return `${ombStr} · Stagionale: ${cliStr}`;
      });
      const tooltip = `${formatDate(d)}\n${labels.join('\n')}`;
      const first = list[0];
      const o = ombsMap[first.ombrellone_id];
      const cellLabel = o ? `${o.fila}${o.numero}` : '?';
      const extra = list.length > 1 ? `<span class="pren-tab-cell-badge">+${list.length - 1}</span>` : '';
      if (list.length > 1) baseCls.push('multi');
      return `<td class="${baseCls.join(' ')}" title="${escapeHtmlAttr(tooltip)}" onclick="openPrenDettagliModal('g-${gi}')"><span class="pren-tab-cell-label">${escapeHtml(cellLabel)}</span>${extra}</td>`;
    }).join('');

    return `<tr>${summaryCell}${dayCells}</tr>`;
  }).join('');

  tabEl.innerHTML = `<div class="pren-tab-wrap"><table class="pren-tab-table">
    <thead><tr><th class="pren-tab-corner-th">Prenotazione</th>${headerCells}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

function escapeHtmlAttr(s) {
  return escapeHtml(s);
}

function openPrenDettagliModal(gid) {
  const group = cancelBookingGroups.get(gid);
  if (!group) return;
  const ombsMap = ombById();
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });

  const items = group.items.slice().sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
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

  const title = group.nome
    ? `📖 ${escapeHtml(group.nome)}`
    : '📖 <span style="color:var(--text-light);font-style:italic">Prenotazione senza nome</span>';

  document.getElementById('pren-dettagli-title').innerHTML = title;
  document.getElementById('pren-dettagli-sub').innerHTML = `
    <div><strong>Periodo:</strong> ${dateLabel}</div>
    <div style="margin-top:4px"><strong>Cliente Stagionale:</strong> ${clientiLabel}</div>
    <div style="margin-top:4px"><strong>Totale:</strong> ${formatCoin(totImporto, currentStabilimento)}</div>
  `;

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
  document.getElementById('pren-dettagli-rows').innerHTML = rowsHtml;

  document.getElementById('pren-dettagli-modifica').onclick = () => {
    closeModal('modal-pren-dettagli');
    openModifyBookingModal(gid);
  };
  document.getElementById('pren-dettagli-annulla').onclick = () => {
    closeModal('modal-pren-dettagli');
    openCancelBookingModal(gid);
  };

  document.getElementById('modal-pren-dettagli').classList.remove('hidden');
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
  await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, cliente_id: clienteId, ombrellone_id: cliente.ombrellone_id || null, tipo: 'credito_usato', importo, nota: notaFinale });
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

// Calcola gli effetti dell'assegnazione di un cliente a un ombrellone:
// - sub-affitti futuri (data >= oggi, cliente_id IS NULL) che saranno promossi
//   al cliente con accredito coin
// - data del primo sub-affitto futuro
// Usato per il confirm dialog prima dell'UPDATE.
async function previewAssignmentEffect(ombId) {
  if (!ombId) return { count: 0, total: 0, fromDate: null };
  const today = todayStr();
  const omb = (ombrelloniList || []).find(o => o.id === ombId);
  const credito = parseFloat(omb?.credito_giornaliero || 0);
  const { data, error } = await sb.from('disponibilita')
    .select('data')
    .eq('ombrellone_id', ombId)
    .eq('stato', 'sub_affittato')
    .is('cliente_id', null)
    .gte('data', today)
    .order('data', { ascending: true });
  if (error || !data) return { count: 0, total: 0, fromDate: null };
  return {
    count: data.length,
    total: data.length * credito,
    fromDate: data[0]?.data || null,
  };
}

let assignConfirmResolver = null;
function resolveAssignConfirm(yes) {
  document.getElementById('modal-assign-confirm').classList.add('hidden');
  if (assignConfirmResolver) {
    const r = assignConfirmResolver; assignConfirmResolver = null; r(!!yes);
  }
}
async function confirmAssignmentDialog(ombId, clienteLabel) {
  const omb = (ombrelloniList || []).find(o => o.id === ombId);
  const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : 'l\'ombrellone';
  const eff = await previewAssignmentEffect(ombId);
  const parts = [];
  parts.push(`Assegnare <strong>${ombStr}</strong> a <strong>${escapeHtml(clienteLabel || 'il cliente')}</strong>?`);
  if (eff.count > 0) {
    parts.push(
      `Verranno accreditati <strong>${eff.count} sub-affitt${eff.count === 1 ? 'o' : 'i'} futur${eff.count === 1 ? 'o' : 'i'}</strong>` +
      (eff.fromDate ? ` (dal ${formatDate(eff.fromDate)})` : '') +
      ` al saldo del cliente per un totale di <strong>${formatCoin(eff.total.toFixed(2), currentStabilimento)}</strong>.`
    );
  }
  parts.push('I giorni rimanenti della stagione saranno marcati come non liberi: il cliente potrà dichiararli liberi dalla sua app.');
  document.getElementById('assign-confirm-msg').innerHTML = parts.map(p => `<p style="margin:8px 0">${p}</p>`).join('');
  document.getElementById('modal-assign-confirm').classList.remove('hidden');
  return new Promise(resolve => { assignConfirmResolver = resolve; });
}

async function saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito, skipAssignConfirm }) {
  const now = new Date().toISOString();
  const { data: existing } = await sb.from('clienti_stagionali')
    .select('id,invito_token,user_id,ombrellone_id')
    .eq('stabilimento_id', currentStabilimento.id)
    .eq('email', email)
    .maybeSingle();

  // Confirm dialog: assegnazione (nuovo ombId, oppure cambio ombrellone su cliente esistente).
  if (!skipAssignConfirm && ombId && (!existing || existing.ombrellone_id !== ombId)) {
    const ok = await confirmAssignmentDialog(ombId, `${nome} ${cognome}`.trim() || email);
    if (!ok) return;
  }

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

let editRowOmbSnapshot = null;
let editRowCltSnapshot = null;
const EDIT_ROW_OMB_FIELDS = ['fila','numero','credito'];
const EDIT_ROW_CLT_FIELDS = ['nome','cognome','email','telefono'];
const EDIT_ROW_OMB_LABELS = { fila:'Fila', numero:'Numero', credito:'Credito giornaliero' };
const EDIT_ROW_CLT_LABELS = { nome:'Nome', cognome:'Cognome', email:'Email', telefono:'Telefono' };

function getEditRowOmbValues() {
  const v = {};
  EDIT_ROW_OMB_FIELDS.forEach(f => { v[f] = (document.getElementById(`edit-row-${f}`)?.value || '').trim(); });
  return v;
}
function getEditRowCltValues() {
  const v = {};
  EDIT_ROW_CLT_FIELDS.forEach(f => { v[f] = (document.getElementById(`edit-row-${f}`)?.value || '').trim(); });
  return v;
}
function isEditRowOmbDirty() {
  if (!editRowOmbSnapshot) return false;
  const cur = getEditRowOmbValues();
  return EDIT_ROW_OMB_FIELDS.some(f => cur[f] !== editRowOmbSnapshot[f]);
}
function isEditRowCltDirty() {
  if (!editRowCltSnapshot) return false;
  const cur = getEditRowCltValues();
  return EDIT_ROW_CLT_FIELDS.some(f => cur[f] !== editRowCltSnapshot[f]);
}

function checkEditRowDirty() {
  const btn = document.getElementById('edit-row-close-btn');
  if (!btn) return;
  const ombDirty = isEditRowOmbDirty();
  const cltDirty = isEditRowCltDirty();
  const dirty = ombDirty || cltDirty;
  btn.classList.toggle('btn-unsaved', dirty);
  if (dirty) {
    const changes = [];
    if (ombDirty) { const c = getEditRowOmbValues(), s = editRowOmbSnapshot; EDIT_ROW_OMB_FIELDS.forEach(f => { if (c[f] !== s[f]) changes.push(EDIT_ROW_OMB_LABELS[f]); }); }
    if (cltDirty) { const c = getEditRowCltValues(), s = editRowCltSnapshot; EDIT_ROW_CLT_FIELDS.forEach(f => { if (c[f] !== s[f]) changes.push(EDIT_ROW_CLT_LABELS[f]); }); }
    btn.textContent = `⚠️ Chiudi (${changes.length} non salvat${changes.length === 1 ? 'o' : 'i'})`;
    btn.title = `Campi non salvati: ${changes.join(', ')}`;
  } else {
    btn.textContent = 'Chiudi';
    btn.title = '';
  }
}

function closeEditRowModal() {
  const ombDirty = isEditRowOmbDirty();
  const cltDirty = isEditRowCltDirty();
  if (!ombDirty && !cltDirty) { closeModal('modal-edit-row'); return; }
  const changes = [];
  if (ombDirty) { const c = getEditRowOmbValues(), s = editRowOmbSnapshot; EDIT_ROW_OMB_FIELDS.forEach(f => { if (c[f] !== s[f]) changes.push(`• ${EDIT_ROW_OMB_LABELS[f]}: "${s[f]||'—'}" → "${c[f]||'—'}"`); }); }
  if (cltDirty) { const c = getEditRowCltValues(), s = editRowCltSnapshot; EDIT_ROW_CLT_FIELDS.forEach(f => { if (c[f] !== s[f]) changes.push(`• ${EDIT_ROW_CLT_LABELS[f]}: "${s[f]||'—'}" → "${c[f]||'—'}"`); }); }
  if (confirm(`Hai modifiche non salvate:\n\n${changes.join('\n')}\n\nChiudere senza salvare?`)) closeModal('modal-edit-row');
}

function populateEditRowFromData(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return false;
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
  editRowOmbSnapshot = getEditRowOmbValues();
  editRowCltSnapshot = getEditRowCltValues();
  // Clear per-section notes and alerts
  ['edit-row-omb-note','edit-row-clt-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['edit-row-omb-alert','edit-row-clt-alert','edit-row-saldo-alert','edit-row-disp-alert'].forEach(id => showAlert(id, '', ''));
  // Saldo section: visible only when a client exists
  const hasCl = !!cliente;
  document.getElementById('edit-row-saldo-section').classList.toggle('hidden', !hasCl);
  document.getElementById('edit-row-saldo-wrap').classList.toggle('hidden', !hasCl);
  if (hasCl) {
    document.getElementById('edit-row-saldo-attuale').textContent = formatCoin(cliente.credito_saldo, currentStabilimento);
    document.getElementById('edit-row-saldo-nuovo').value = parseFloat(cliente.credito_saldo || 0).toFixed(2);
    document.getElementById('edit-row-saldo-nota').value = '';
  }
  return true;
}

async function refreshEditRowAfterSave(ombId, { skipReload = false, alertId = 'edit-row-alert' } = {}) {
  if (!skipReload) await loadManagerData();
  if (!populateEditRowFromData(ombId)) { closeModal('modal-edit-row'); return; }
  checkEditRowDirty();
  showAlert(alertId, '✅ Salvato con successo', 'success');
  setTimeout(() => showAlert(alertId, '', ''), 3000);
}

function openEditRowModal(ombId) {
  if (!populateEditRowFromData(ombId)) return;
  showAlert('edit-row-alert', '', '');
  checkEditRowDirty();
  // Event delegation: aggiorna Chiudi su qualsiasi input nel modal
  const _modal = document.getElementById('modal-edit-row');
  _modal.removeEventListener('input', checkEditRowDirty);
  _modal.addEventListener('input', checkEditRowDirty);
  // Input date nativi — nessun auto-open, nessun stato sporco tra aperture
  const dispFrom = document.getElementById('edit-row-disp-from');
  const dispTo   = document.getElementById('edit-row-disp-to');
  if (dispFrom && dispTo) {
    dispFrom.value = '';
    dispTo.value   = '';
    const inizio = currentStabilimento?.data_inizio_stagione;
    const fine   = currentStabilimento?.data_fine_stagione;
    if (inizio) { dispFrom.min = inizio; dispTo.min = inizio; }
    if (fine)   { dispFrom.max = fine;   dispTo.max = fine;   }
  }
  document.getElementById('modal-edit-row').classList.remove('hidden');
}

async function saveEditRowOmbrellone() {
  if (!isEditRowOmbDirty()) { showAlert('edit-row-omb-alert', 'Nessuna modifica da salvare.', 'info'); return; }
  const ombId = document.getElementById('edit-row-omb-id').value;
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const fila = document.getElementById('edit-row-fila').value.trim().toUpperCase();
  const numero = parseInt(document.getElementById('edit-row-numero').value);
  const credito = parseFloat(document.getElementById('edit-row-credito').value);
  const nota = (document.getElementById('edit-row-omb-note')?.value || '').trim();
  if (!fila || !numero) { showAlert('edit-row-omb-alert', 'Fila e numero sono obbligatori.', 'error'); return; }
  const snap = editRowOmbSnapshot;
  const cur = getEditRowOmbValues();
  const lines = EDIT_ROW_OMB_FIELDS.filter(f => cur[f] !== snap[f]).map(f => `• ${EDIT_ROW_OMB_LABELS[f]}: "${snap[f]||'—'}" → "${cur[f]||'—'}"`);
  if (nota) lines.push(`• Nota: ${nota}`);
  if (!confirm(`Confermi le modifiche all'ombrellone?\n\n${lines.join('\n')}`)) return;
  const { error } = await sb.from('ombrelloni').update({ fila, numero, credito_giornaliero: isNaN(credito) ? omb.credito_giornaliero : credito }).eq('id', ombId);
  if (error) { showAlert('edit-row-omb-alert', error.message, 'error'); return; }
  await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-omb-alert' });
}

async function saveEditRowCliente() {
  const ombId = document.getElementById('edit-row-omb-id').value;
  const clId  = document.getElementById('edit-row-cl-id').value || null;
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const nome = document.getElementById('edit-row-nome').value.trim();
  const cognome = document.getElementById('edit-row-cognome').value.trim();
  const email = document.getElementById('edit-row-email').value.trim();
  const telefono = document.getElementById('edit-row-telefono').value.trim();
  const nota = (document.getElementById('edit-row-clt-note')?.value || '').trim();
  const hasCliente = !!(nome || cognome || email || telefono);
  const existing = clId ? (clientiList || []).find(c => c.id === clId) : null;
  if (!isEditRowCltDirty() && hasCliente) { showAlert('edit-row-clt-alert', 'Nessuna modifica da salvare.', 'info'); return; }

  if (!hasCliente && existing) {
    if (existing.user_id) { showAlert('edit-row-clt-alert', 'Impossibile rimuovere un cliente già attivo. Usa 🗑️ per eliminarlo.', 'error'); return; }
    if (!confirm(`Rimuovere il cliente "${existing.nome} ${existing.cognome}" da questo ombrellone?`)) return;
    await sb.from('clienti_stagionali').delete().eq('id', existing.id);
    await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-clt-alert' });
    return;
  }
  if (hasCliente) {
    if (!email || !EMAIL_RE.test(email)) { showAlert('edit-row-clt-alert', 'Email cliente non valida.', 'error'); return; }
    const snap = editRowCltSnapshot;
    const cur = getEditRowCltValues();
    const lines = EDIT_ROW_CLT_FIELDS.filter(f => cur[f] !== snap[f]).map(f => `• ${EDIT_ROW_CLT_LABELS[f]}: "${snap[f]||'—'}" → "${cur[f]||'—'}"`);
    if (nota) lines.push(`• Nota: ${nota}`);
    if (lines.length && !confirm(`Confermi le modifiche al cliente?\n\n${lines.join('\n')}`)) return;
    if (existing) {
      if (existing.ombrellone_id !== ombId) {
        const ok = await confirmAssignmentDialog(ombId, `${nome} ${cognome}`.trim() || email);
        if (!ok) return;
      }
      const update = { nome, cognome, telefono, ombrellone_id: ombId };
      if (!existing.user_id) update.email = email;
      const { error } = await sb.from('clienti_stagionali').update(update).eq('id', existing.id);
      if (error) { showAlert('edit-row-clt-alert', error.message, 'error'); return; }
    } else {
      const occupant = findOmbOccupant(ombId, email);
      if (occupant) {
        pendingConflict = {
          kind: 'edit',
          payload: { id: null, nome, cognome, email, telefono, ombId },
          occupantId: occupant.id,
          ombLabel: `Fila ${omb.fila} N°${omb.numero}`,
          occupantName: `${occupant.nome || ''} ${occupant.cognome || ''}`.trim() || occupant.email,
        };
        document.getElementById('conflict-msg').innerHTML =
          `L'ombrellone <strong>${pendingConflict.ombLabel}</strong> è già assegnato a <strong>${escapeHtml(pendingConflict.occupantName)}</strong>. Chi vuoi tenere su questo ombrellone?`;
        document.getElementById('modal-conflict-cliente').classList.remove('hidden');
        return;
      }
      await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito: false });
      await refreshEditRowAfterSave(ombId, { skipReload: true, alertId: 'edit-row-clt-alert' });
      return;
    }
  }
  await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-clt-alert' });
}

async function applyEditRowSaldo() {
  const clId = document.getElementById('edit-row-cl-id').value;
  const ombId = document.getElementById('edit-row-omb-id').value;
  if (!clId) return;
  const cliente = (clientiList || []).find(c => c.id === clId);
  if (!cliente) return;
  const nuovo = parseFloat(document.getElementById('edit-row-saldo-nuovo').value);
  if (isNaN(nuovo) || nuovo < 0) { showAlert('edit-row-alert', 'Inserisci un saldo valido (≥ 0).', 'error'); return; }
  const attuale = parseFloat(cliente.credito_saldo || 0);
  if (Math.abs(nuovo - attuale) < 0.001) { showAlert('edit-row-alert', 'Il saldo è già pari al valore inserito.', 'error'); return; }
  const nota = (document.getElementById('edit-row-saldo-nota').value || '').trim() || 'Rettifica manuale gestore';
  const nome = `${cliente.nome || ''} ${cliente.cognome || ''}`.trim() || cliente.email;
  const ok = confirm(`Rettificare il saldo di ${nome} da ${formatCoin(attuale, currentStabilimento)} a ${formatCoin(nuovo, currentStabilimento)}?\nNota: ${nota}`);
  if (!ok) return;
  const tipo = nuovo > attuale ? 'credito_ricevuto' : 'credito_usato';
  const delta = Math.abs(nuovo - attuale).toFixed(2);
  const { error: txErr } = await sb.from('transazioni').insert({
    stabilimento_id: currentStabilimento.id, cliente_id: clId,
    ombrellone_id: cliente.ombrellone_id || null, tipo, importo: delta, nota,
  });
  if (txErr) { showAlert('edit-row-saldo-alert', 'Errore transazione: ' + txErr.message, 'error'); return; }
  const { error: clErr } = await sb.from('clienti_stagionali').update({ credito_saldo: nuovo.toFixed(2) }).eq('id', clId);
  if (clErr) { showAlert('edit-row-saldo-alert', 'Errore aggiornamento saldo: ' + clErr.message, 'error'); return; }
  await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-saldo-alert' });
}

async function applyEditRowAddDisp() {
  const from = document.getElementById('edit-row-disp-from').value;
  const to = document.getElementById('edit-row-disp-to').value;
  const ombId = document.getElementById('edit-row-omb-id').value;
  const nota = (document.getElementById('edit-row-disp-note')?.value || '').trim();
  if (!from || !to) { showAlert('edit-row-disp-alert', 'Seleziona prima un periodo.', 'error'); return; }
  const dates = getDatesInRange(from, to);
  let msg = `Aggiungere ${dates.length} giorno${dates.length !== 1 ? 'i' : ''} di disponibilità (${formatDate(from)} → ${formatDate(to)})?`;
  if (nota) msg += `\nNota: ${nota}`;
  if (!confirm(msg)) return;
  await applyForceDisponibile([ombId], dates, 'edit-row-disp-alert');
  await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-disp-alert' });
}

async function applyEditRowRemoveDisp() {
  const from = document.getElementById('edit-row-disp-from').value;
  const to = document.getElementById('edit-row-disp-to').value;
  const ombId = document.getElementById('edit-row-omb-id').value;
  const nota = (document.getElementById('edit-row-disp-note')?.value || '').trim();
  if (!from || !to) { showAlert('edit-row-disp-alert', 'Seleziona prima un periodo.', 'error'); return; }
  const { data: subAffitti, error: saErr } = await sb.from('disponibilita')
    .select('id, data, nome_prenotazione')
    .eq('ombrellone_id', ombId)
    .gte('data', from).lte('data', to)
    .eq('stato', 'sub_affittato');
  if (saErr) { showAlert('edit-row-disp-alert', 'Errore lettura prenotazioni: ' + saErr.message, 'error'); return; }
  const subAffittiIds = (subAffitti || []).map(r => r.id);
  let msg = `Rimuovere la disponibilità dal ${formatDate(from)} al ${formatDate(to)}?`;
  if (nota) msg += `\nNota: ${nota}`;
  if (subAffittiIds.length > 0) {
    const byName = {};
    subAffitti.forEach(r => {
      const k = r.nome_prenotazione || '(senza nome)';
      if (!byName[k]) byName[k] = [];
      byName[k].push(r.data);
    });
    const lines = Object.entries(byName).map(([nome, dates]) => {
      const sorted = dates.sort();
      const dal = formatDate(sorted[0]), al = formatDate(sorted[sorted.length - 1]);
      return `• "${nome}": ${dal === al ? dal : dal + ' → ' + al}`;
    }).join('\n');
    msg += `\n\nATTENZIONE: le seguenti prenotazioni verranno annullate:\n${lines}\n\nI clienti riceveranno il rimborso dei coin. Procedere?`;
  }
  if (!confirm(msg)) return;
  if (subAffittiIds.length > 0) {
    const { error: cancelErr } = await sb.rpc('cancel_booking', { p_disp_ids: subAffittiIds });
    if (cancelErr) { showAlert('edit-row-disp-alert', 'Errore annullamento prenotazioni: ' + cancelErr.message, 'error'); return; }
  }
  await applyRemoveDisponibilita([ombId], from, to, 'edit-row-disp-alert');
  await refreshEditRowAfterSave(ombId, { alertId: 'edit-row-disp-alert' });
}

// Explicit global exports for HTML inline handlers
window.checkEditRowDirty    = checkEditRowDirty;
window.closeEditRowModal    = closeEditRowModal;
window.openEditRowModal     = openEditRowModal;
window.saveEditRowOmbrellone = saveEditRowOmbrellone;
window.saveEditRowCliente   = saveEditRowCliente;
window.applyEditRowSaldo    = applyEditRowSaldo;
window.applyEditRowAddDisp  = applyEditRowAddDisp;
window.applyEditRowRemoveDisp = applyEditRowRemoveDisp;

async function saveEditedCliente({ id, nome, cognome, email, telefono, ombId }) {
  if (id) {
    const c = (clientiList || []).find(x => x.id === id);
    if (c && c.ombrellone_id !== ombId) {
      const ok = await confirmAssignmentDialog(ombId, `${nome} ${cognome}`.trim() || email);
      if (!ok) return;
    }
    const update = { nome, cognome, telefono, ombrellone_id: ombId };
    if (!c?.user_id) update.email = email;
    const { error } = await sb.from('clienti_stagionali').update(update).eq('id', id);
    if (error) { showAlert('edit-row-alert', error.message, 'error'); return; }
    await refreshEditRowAfterSave(ombId);
  } else {
    await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito: false });
    await refreshEditRowAfterSave(ombId, { skipReload: true });
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
  const [{ data: disp }, { data: txs }] = await Promise.all([
    sb.from('disponibilita').select('data, stato').eq('ombrellone_id', ombId).order('data', { ascending: true }),
    sb.from('transazioni').select('*').eq('ombrellone_id', ombId).order('created_at', { ascending: false }),
  ]);
  viewOmbDispMap = {};
  (disp || []).forEach(d => { viewOmbDispMap[d.data] = d.stato; });
  hideLoading();

  renderViewOmbrelloneCalendar();
  renderViewOmbrelloneDaysLists(disp || []);
  renderViewOmbrelloneTxList(txs || []);
  document.getElementById('modal-view-ombrellone').classList.remove('hidden');
}

function renderViewOmbrelloneDaysLists(disp) {
  const liberi = disp.filter(d => d.stato === 'libero').map(d => d.data).sort();
  const subaff = disp.filter(d => d.stato === 'sub_affittato').map(d => d.data).sort();
  const liberiEl = document.getElementById('view-omb-liberi-list');
  const subEl = document.getElementById('view-omb-sub-list');
  const liberiCount = document.getElementById('view-omb-liberi-count');
  const subCount = document.getElementById('view-omb-sub-count');
  if (liberiCount) liberiCount.textContent = liberi.length ? `(${liberi.length})` : '';
  if (subCount) subCount.textContent = subaff.length ? `(${subaff.length})` : '';
  const renderDays = arr => arr.length
    ? arr.map(d => `<div style="font-size:12px;padding:3px 6px;display:inline-block;margin:2px;background:var(--sand);border-radius:4px">${formatDate(d)}</div>`).join('')
    : '<div style="font-size:12px;color:var(--text-light);padding:4px">Nessun giorno</div>';
  if (liberiEl) liberiEl.innerHTML = renderDays(liberi);
  if (subEl) subEl.innerHTML = renderDays(subaff);
}

function renderViewOmbrelloneTxList(txs) {
  const listEl = document.getElementById('view-omb-tx-list');
  const countEl = document.getElementById('view-omb-tx-count');
  if (countEl) countEl.textContent = txs.length ? `(${txs.length})` : '';
  if (!listEl) return;
  listEl.innerHTML = renderTxList(txs, currentStabilimento, ombById());
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
