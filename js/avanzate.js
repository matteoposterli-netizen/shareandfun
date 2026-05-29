// js/avanzate.js — Configurazioni → Avanzate
//
// Mappa interattiva degli ombrelloni con azioni gestore:
//   • forza disponibile per sub-affitto (per ombrellone o massa)
//   • rimuovi disponibilità (per ombrellone o massa)
//   • modifica anagrafica (riusa #modal-edit-row di manager.js)
//   • cancella ombrellone (riusa deleteRow() di manager.js)
//   • rettifica saldo coin (insert transazione + update clienti_stagionali)
//
// Opera direttamente via PostgREST con le RLS esistenti del proprietario.
// Niente RPC nuove. Audit log degli INSERT/DELETE è coperto dai trigger esistenti.

let avanzateRangePickerInstance = null;
let avanzateCurrentRange = null;     // { from, to, dates, dispByOmbDate, rangeDispMap }
let avanzateOmbCurrent = null;       // { id, codice, credito_giornaliero }
let avanzateClienteCurrent = null;   // { id, nome, ..., credito_saldo } | null
let avanzateSaldoOrigin = null;      // 'omb' (modal scheda) | 'mirata' (pane mirata)
let avanzateSelection = new Set();   // ombrellone IDs selezionati per azione massiva

/* ---------- Init / range picker ---------- */

function avanzateInit() {
  if (!currentStabilimento) return;
  // First-time init of flatpickr (no-op if already instantiated)
  if (!avanzateRangePickerInstance) initAvanzateRangePicker(todayStr());
  // Default: oggi → +6gg, così l'input mostra subito un range e non una data singola.
  // setAvanzateRangePreset triggera il refresh della mappa.
  setAvanzateRangePreset(7);
  // Popola il nome stabilimento nella sezione Zona pericolosa
  const dangerNome = document.getElementById('danger-stab-nome');
  if (dangerNome) dangerNome.textContent = currentStabilimento.nome;
}

function initAvanzateRangePicker(fromDate) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('avanzate-range-picker');
  if (!input) return;
  const startDate = new Date(fromDate + 'T00:00:00');
  const endDefault = new Date(fromDate + 'T00:00:00');
  endDefault.setDate(endDefault.getDate() + 6);
  if (avanzateRangePickerInstance) {
    avanzateRangePickerInstance.set('minDate', currentStabilimento?.data_inizio_stagione || undefined);
    avanzateRangePickerInstance.set('maxDate', currentStabilimento?.data_fine_stagione || undefined);
    avanzateRangePickerInstance.setDate([startDate, endDefault], false);
    return;
  }
  avanzateRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [startDate, endDefault],
    showMonths: 1,
    disableMobile: true,
    minDate: currentStabilimento?.data_inizio_stagione || undefined,
    maxDate: currentStabilimento?.data_fine_stagione || undefined,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        document.getElementById('avanzate-date-from').value = toLocalDateStr(selectedDates[0]);
        document.getElementById('avanzate-date-to').value = toLocalDateStr(selectedDates[1]);
        refreshAvanzateMap();
      } else if (selectedDates.length === 1) {
        const from = toLocalDateStr(selectedDates[0]);
        document.getElementById('avanzate-date-from').value = from;
        document.getElementById('avanzate-date-to').value = from;
      }
    },
  });
}

function setAvanzateRangePreset(days) {
  const today = todayStr();
  const startDate = new Date(today + 'T00:00:00');
  const endDate = new Date(today + 'T00:00:00');
  endDate.setDate(endDate.getDate() + days - 1);
  document.getElementById('avanzate-date-from').value = today;
  document.getElementById('avanzate-date-to').value = toLocalDateStr(endDate);
  if (avanzateRangePickerInstance) avanzateRangePickerInstance.setDate([startDate, endDate], false);
  refreshAvanzateMap();
}

function setAvanzateRangeStagione() {
  if (!currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) {
    showAlert('avanzate-save-alert', 'Date di stagione non impostate. Vai in Configurazioni → Stagione.', 'error');
    setTimeout(() => showAlert('avanzate-save-alert', '', ''), 4000);
    return;
  }
  const startDate = new Date(inizio + 'T00:00:00');
  const endDate = new Date(fine + 'T00:00:00');
  document.getElementById('avanzate-date-from').value = inizio;
  document.getElementById('avanzate-date-to').value = fine;
  if (avanzateRangePickerInstance) avanzateRangePickerInstance.setDate([startDate, endDate], false);
  refreshAvanzateMap();
}

function updateAvanzatePresetActive() {
  const from = document.getElementById('avanzate-date-from').value;
  const to = document.getElementById('avanzate-date-to').value || from;
  const today = todayStr();
  let activeDays = null;
  let isStagione = false;
  if (currentStabilimento && from === currentStabilimento.data_inizio_stagione && to === currentStabilimento.data_fine_stagione) {
    isStagione = true;
  } else if (from === today) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if ([1, 2, 3, 7].includes(diff)) activeDays = diff;
  }
  document.querySelectorAll('.avanzate-preset-btn').forEach(btn => {
    const days = parseInt(btn.dataset.days, 10);
    const preset = btn.dataset.preset;
    const active = (preset === 'stagione' && isStagione) || (!isNaN(days) && days === activeDays);
    if (active) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

/* ---------- Refresh & render ---------- */

async function refreshAvanzateMap() {
  avanzateSelection.clear();
  updateAvanzateSelectionBar();
  const from = document.getElementById('avanzate-date-from').value;
  const to = document.getElementById('avanzate-date-to').value || from;
  if (!from || !ombrelloniList || ombrelloniList.length === 0) {
    document.getElementById('avanzate-map').innerHTML = '<div style="color:var(--text-light);font-size:13px;padding:8px">Nessun ombrellone configurato.</div>';
    return;
  }
  const dates = getDatesInRange(from, to);
  if (dates.length === 0) return;

  const ombIds = ombrelloniList.map(o => o.id);
  const { data: disp } = await fetchAllPaginated(() => sb.from('disponibilita')
    .select('ombrellone_id, data, stato')
    .gte('data', from)
    .lte('data', to)
    .in('ombrellone_id', ombIds));

  const dispByOmbDate = {};
  (disp || []).forEach(d => {
    if (!dispByOmbDate[d.ombrellone_id]) dispByOmbDate[d.ombrellone_id] = {};
    dispByOmbDate[d.ombrellone_id][d.data] = d.stato;
  });

  const rangeDispMap = {};
  let countLibero = 0, countSub = 0, countParziale = 0, countOccupied = 0;
  ombrelloniList.forEach(o => {
    const ombDisp = dispByOmbDate[o.id] || {};
    const liberoDays = dates.filter(d => ombDisp[d] === 'libero').length;
    const subDays = dates.filter(d => ombDisp[d] === 'sub_affittato').length;
    let stato;
    if (liberoDays === dates.length) { stato = 'libero'; countLibero++; }
    else if (subDays > 0) { stato = 'sub_affittato'; countSub++; }
    else if (liberoDays > 0) { stato = 'parziale'; countParziale++; }
    else { stato = 'occupied'; countOccupied++; }
    rangeDispMap[o.id] = stato;
  });

  avanzateCurrentRange = { from, to, dates, dispByOmbDate, rangeDispMap };

  const isSingleDay = from === to;
  const isToday = isSingleDay && from === todayStr();
  document.getElementById('avanzate-range-label').textContent = isSingleDay
    ? (isToday ? 'oggi' : formatDate(from))
    : `${formatDate(from)} → ${formatDate(to)}`;

  const summaryEl = document.getElementById('avanzate-summary');
  const parts = [];
  if (countLibero) parts.push(`<strong>${countLibero}</strong> liberi`);
  if (countParziale) parts.push(`<strong>${countParziale}</strong> parzial${countParziale === 1 ? 'e' : 'i'}`);
  if (countSub) parts.push(`<strong>${countSub}</strong> sub-affittat${countSub === 1 ? 'o' : 'i'}`);
  if (countOccupied) parts.push(`<strong>${countOccupied}</strong> occupat${countOccupied === 1 ? 'o' : 'i'}`);
  summaryEl.innerHTML = parts.join(' · ');

  renderAvanzateMap(ombrelloniList, rangeDispMap);
  updateAvanzatePresetActive();
}

function renderAvanzateMap(ombs, dispMap) {
  const el = document.getElementById('avanzate-map');
  el.innerHTML = '';
  if (!ombs.length) return;

  const buildCell = (o) => {
    const stato = dispMap[o.id] || 'occupied';
    const cls = stato === 'libero' ? 'free'
      : stato === 'parziale' ? 'partial'
      : stato === 'sub_affittato' ? 'subleased'
      : 'occupied';
    const hasCliente = (clientiList || []).some(c => !c.rifiutato && c.ombrellone_id === o.id);
    const noClienteCls = !hasCliente ? ' no-cliente' : '';
    const cell = document.createElement('div');
    cell.className = 'ombrellone ' + cls + noClienteCls;
    cell.textContent = '☂️';
    const stateLabel = stato === 'libero' && !hasCliente ? 'subaffittabile (nessun cliente assegnato)'
      : stato === 'libero' ? 'libero per tutto il periodo'
      : stato === 'parziale' ? 'libero in parte del periodo'
      : stato === 'sub_affittato' ? 'sub-affittato in parte del periodo'
      : 'occupato dal cliente stagionale';
    cell.title = `${o.codice} — ${formatCoin(o.credito_giornaliero)}/gg — ${stateLabel} · clicca per selezionare`;
    if (avanzateSelection.has(o.id)) cell.classList.add('selected');
    cell.onclick = () => toggleAvanzateSelection(o.id, cell);
    return cell;
  };

  const uniquePos = new Set(ombs.map(o => `${o.pos_x || 0}_${o.pos_y || 0}`));
  const hasGrid = uniquePos.size > 1 || ombs.length === 1;

  if (hasGrid) {
    const byPos = {};
    ombs.forEach(o => { byPos[`${o.pos_x || 0}_${o.pos_y || 0}`] = o; });
    const passerelle = (currentStabilimento?.mappa_passerelle || []);
    const passerelleSet = new Set(passerelle.map(p => `${p.x}_${p.y}`));
    const xs = ombs.map(o => o.pos_x || 0).concat(passerelle.map(p => p.x || 0));
    const ys = ombs.map(o => o.pos_y || 0).concat(passerelle.map(p => p.y || 0));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    for (let y = minY; y <= maxY; y++) {
      const row = document.createElement('div');
      row.className = 'map-row';
      for (let x = minX; x <= maxX; x++) {
        const key = `${x}_${y}`;
        const o = byPos[key];
        if (o) {
          row.appendChild(buildCell(o));
        } else if (passerelleSet.has(key)) {
          const cell = document.createElement('div');
          cell.className = 'map-passerella';
          row.appendChild(cell);
        } else {
          const cell = document.createElement('div');
          cell.className = 'map-empty';
          row.appendChild(cell);
        }
      }
      el.appendChild(row);
    }
  } else {
    // Fallback: lista ordinata per codice
    const sorted = ombs.slice().sort((a, b) => (a.codice || '').localeCompare(b.codice || '', 'it', { numeric: true }));
    const row = document.createElement('div');
    row.className = 'map-row';
    sorted.forEach(o => row.appendChild(buildCell(o)));
    el.appendChild(row);
  }
}

/* ---------- Selezione ombrelloni (azione massiva) ---------- */

function toggleAvanzateSelection(ombId, cell) {
  if (avanzateSelection.has(ombId)) {
    avanzateSelection.delete(ombId);
    if (cell) cell.classList.remove('selected');
  } else {
    avanzateSelection.add(ombId);
    if (cell) cell.classList.add('selected');
  }
  updateAvanzateSelectionBar();
}

function avanzateSelectAll() {
  (ombrelloniList || []).forEach(o => avanzateSelection.add(o.id));
  document.querySelectorAll('#avanzate-map .ombrellone').forEach(c => c.classList.add('selected'));
  updateAvanzateSelectionBar();
}

function avanzateClearSelection() {
  avanzateSelection.clear();
  document.querySelectorAll('#avanzate-map .ombrellone').forEach(c => c.classList.remove('selected'));
  updateAvanzateSelectionBar();
}

function updateAvanzateSelectionBar() {
  const n = avanzateSelection.size;
  const countEl = document.getElementById('avanzate-selection-count');
  if (countEl) countEl.textContent = n === 0 ? '0 selezionati' : `${n} selezionat${n === 1 ? 'o' : 'i'}`;
  const forceBtn = document.getElementById('avanzate-bulk-force-btn');
  const removeBtn = document.getElementById('avanzate-bulk-remove-btn');
  if (forceBtn) forceBtn.disabled = n === 0;
  if (removeBtn) removeBtn.disabled = n === 0;

  // Warning sub-affitti: conta ombrelloni selezionati con almeno un giorno sub-affittato nel range
  const warnEl = document.getElementById('avanzate-booking-warning');
  const warnText = document.getElementById('avanzate-booking-warning-text');
  if (!warnEl || !warnText) return;
  if (n === 0 || !avanzateCurrentRange?.dispByOmbDate) {
    warnEl.classList.add('hidden');
    return;
  }
  let countWithBookings = 0;
  avanzateSelection.forEach(ombId => {
    const days = avanzateCurrentRange.dispByOmbDate[ombId] || {};
    if (Object.values(days).some(s => s === 'sub_affittato')) countWithBookings++;
  });
  if (countWithBookings > 0) {
    warnText.textContent = `⚠️ ${countWithBookings} ${countWithBookings === 1 ? 'ombrellone selezionato ha' : 'ombrelloni selezionati hanno'} prenotazioni (sub-affitti) nel periodo — quelle date non verranno toccate.`;
    warnEl.classList.remove('hidden');
  } else {
    warnEl.classList.add('hidden');
  }
}

/* ---------- Modal: scheda ombrellone ---------- */

function openAvanzateOmbModal(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;
  avanzateOmbCurrent = omb;
  avanzateClienteCurrent = cliente;

  document.getElementById('avanzate-omb-title').textContent = `☂️ Ombrellone ${omb.codice}`;
  document.getElementById('avanzate-omb-credito').textContent = formatCoin(omb.credito_giornaliero);
  document.getElementById('avanzate-omb-cliente').innerHTML = cliente
    ? `${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}${cliente.email ? ' · ' + escapeHtml(cliente.email) : ''}`
    : '<span style="color:var(--text-light)">Nessun cliente associato</span>';
  document.getElementById('avanzate-omb-saldo').textContent = cliente ? formatCoin(cliente.credito_saldo) : '–';

  const saldoBtn = document.getElementById('avanzate-saldo-btn');
  if (saldoBtn) saldoBtn.disabled = !cliente;

  const range = avanzateCurrentRange;
  const rangeLabel = document.getElementById('avanzate-omb-range-label');
  if (range) {
    rangeLabel.textContent = range.from === range.to
      ? formatDate(range.from)
      : `${formatDate(range.from)} → ${formatDate(range.to)}`;
  } else rangeLabel.textContent = '';

  const dayList = document.getElementById('avanzate-omb-day-list');
  dayList.innerHTML = '';
  const dispForOmb = (range?.dispByOmbDate?.[omb.id]) || {};
  (range?.dates || []).forEach(d => {
    const stato = dispForOmb[d] || 'occupied';
    const stateText = stato === 'libero' ? 'Disponibile sub-affitto'
      : stato === 'sub_affittato' ? 'Sub-affittato'
      : 'Occupato dal cliente';
    const row = document.createElement('div');
    row.className = 'avanzate-day-row';
    row.innerHTML = `<span>${formatDate(d)}</span><span class="avanzate-day-state ${stato}">${stateText}</span>`;
    dayList.appendChild(row);
  });
  if (!(range?.dates || []).length) {
    dayList.innerHTML = '<div style="color:var(--text-light);font-size:12px;padding:6px">Seleziona un periodo per vedere lo stato giornaliero.</div>';
  }

  showAlert('avanzate-omb-alert', '', '');
  document.getElementById('modal-avanzate-omb').classList.remove('hidden');
}

/* ---------- Azioni: forza / rimuovi disponibilità (singolo) ---------- */

async function avanzateForceCurrentRange() {
  if (!avanzateOmbCurrent || !avanzateCurrentRange) return;
  await applyForceDisponibile([avanzateOmbCurrent.id], avanzateCurrentRange.dates, 'avanzate-omb-alert');
  await reloadAfterMutation();
  openAvanzateOmbModal(avanzateOmbCurrent.id);
}

async function avanzateRemoveCurrentRange() {
  if (!avanzateOmbCurrent || !avanzateCurrentRange) return;
  await applyRemoveDisponibilita([avanzateOmbCurrent.id], avanzateCurrentRange.from, avanzateCurrentRange.to, 'avanzate-omb-alert');
  await reloadAfterMutation();
  openAvanzateOmbModal(avanzateOmbCurrent.id);
}

/* ---------- Azioni di massa ---------- */

async function bulkAvanzateForceDisponibile() {
  if (!avanzateCurrentRange || avanzateSelection.size === 0) return;
  const ids = Array.from(avanzateSelection);
  const ok = confirm(`Rendere disponibili per sub-affitto i ${ids.length} ombrelloni selezionati nel periodo indicato? Le date già sub-affittate non verranno toccate.`);
  if (!ok) return;
  await applyForceDisponibile(ids, avanzateCurrentRange.dates, 'avanzate-save-alert');
  await reloadAfterMutation();
}

async function bulkAvanzateRemoveDisponibilita() {
  if (!avanzateCurrentRange || avanzateSelection.size === 0) return;
  const ids = Array.from(avanzateSelection);

  // Cerca sub-affitti nel range per gli ombrelloni selezionati
  const { data: subAffitti, error: saErr } = await sb.from('disponibilita')
    .select('id, ombrellone_id, data, nome_prenotazione')
    .in('ombrellone_id', ids)
    .gte('data', avanzateCurrentRange.from)
    .lte('data', avanzateCurrentRange.to)
    .eq('stato', 'sub_affittato');

  if (saErr) {
    showAlert('avanzate-save-alert', 'Errore lettura prenotazioni: ' + saErr.message, 'error');
    return;
  }

  let confirmMsg = `Rimuovere lo stato 'libero per sub-affitto' dai ${ids.length} ombrelloni selezionati nel periodo?`;

  const subAffittiIds = (subAffitti || []).map(r => r.id);

  if (subAffittiIds.length > 0) {
    // Raggruppa per nome_prenotazione per mostrare prenotazioni specifiche
    const byName = {};
    (subAffitti || []).forEach(r => {
      const key = r.nome_prenotazione || '(senza nome)';
      if (!byName[key]) byName[key] = { dates: [], ombIds: new Set() };
      byName[key].dates.push(r.data);
      byName[key].ombIds.add(r.ombrellone_id);
    });

    const bookingLines = Object.entries(byName).map(([nome, info]) => {
      const sortedDates = info.dates.sort();
      const dal = formatDate(sortedDates[0]);
      const al = formatDate(sortedDates[sortedDates.length - 1]);
      const nOmb = info.ombIds.size;
      const suffix = nOmb > 1 ? ` (${nOmb} ombrelloni)` : '';
      const rangeStr = dal === al ? dal : `${dal} → ${al}`;
      return `• "${nome}": ${rangeStr}${suffix}`;
    }).join('\n');

    confirmMsg += `\n\nATTENZIONE: le seguenti prenotazioni verranno annullate perché coprono giorni nel periodo selezionato:\n${bookingLines}\n\nI clienti coinvolti riceveranno il rimborso dei coin. Procedere?`;
  }

  const ok = confirm(confirmMsg);
  if (!ok) return;

  // Annulla sub-affitti prima di rimuovere le disponibilità
  if (subAffittiIds.length > 0) {
    const { error: cancelErr } = await sb.rpc('cancel_booking', { p_disp_ids: subAffittiIds });
    if (cancelErr) {
      showAlert('avanzate-save-alert', 'Errore annullamento prenotazioni: ' + cancelErr.message, 'error');
      return;
    }
  }

  await applyRemoveDisponibilita(ids, avanzateCurrentRange.from, avanzateCurrentRange.to, 'avanzate-save-alert');
  await reloadAfterMutation();
}

async function applyForceDisponibile(ombIds, dates, alertId) {
  if (!ombIds.length || !dates.length) return;

  // 1. Leggi le righe esistenti nel range per scartare quelle già presenti
  //    (libero o sub_affittato): sono trattate come "no-op" e non generano transazione.
  const sortedDates = [...dates].sort();
  const fromD = sortedDates[0];
  const toD = sortedDates[sortedDates.length - 1];
  const { data: existing, error: readErr } = await fetchAllPaginated(() => sb.from('disponibilita')
    .select('ombrellone_id, data')
    .in('ombrellone_id', ombIds)
    .gte('data', fromD)
    .lte('data', toD));
  if (readErr) {
    showAlert(alertId, 'Errore lettura disponibilità: ' + readErr.message, 'error');
    return false;
  }
  const existingSet = new Set((existing || []).map(r => `${r.ombrellone_id}|${r.data}`));

  // 2. Costruisci righe da inserire (solo le coppie davvero nuove) + transazioni gemelle
  const dispRows = [];
  const txRows = [];
  const dateSet = new Set(dates);
  ombIds.forEach(id => {
    const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === id) || null;
    sortedDates.forEach(d => {
      if (!dateSet.has(d)) return;
      if (existingSet.has(`${id}|${d}`)) return;
      const row = { ombrellone_id: id, data: d, stato: 'libero' };
      if (cliente) row.cliente_id = cliente.id;
      dispRows.push(row);
      txRows.push({
        stabilimento_id: currentStabilimento.id,
        ombrellone_id: id,
        cliente_id: cliente?.id || null,
        tipo: 'disponibilita_aggiunta',
        importo: null,
        nota: `Disponibilità impostata dal gestore per ${formatDate(d)}`,
      });
    });
  });

  if (!dispRows.length) {
    showAlert(alertId, 'Tutte le date erano già impostate: nessuna modifica.', 'info');
    setTimeout(() => showAlert(alertId, '', ''), 3000);
    return true;
  }

  const { error: dispErr } = await sb.from('disponibilita').insert(dispRows);
  if (dispErr) {
    showAlert(alertId, 'Errore disponibilità: ' + dispErr.message, 'error');
    return false;
  }
  const { error: txErr } = await sb.from('transazioni').insert(txRows);
  if (txErr) {
    // Best effort: la disponibilità è in piedi, segnaliamo solo lo storico mancante.
    showAlert(alertId, `✓ ${dispRows.length} disponibilità impostate (transazioni non registrate: ${txErr.message})`, 'error');
    return true;
  }
  showAlert(alertId, `✓ ${dispRows.length} disponibilità impostate.`, 'info');
  setTimeout(() => showAlert(alertId, '', ''), 3000);
  return true;
}

async function applyRemoveDisponibilita(ombIds, from, to, alertId) {
  if (!ombIds.length) return;

  // 1. Leggi le righe libero che verranno cancellate (per generare le transazioni)
  const { data: toDelete, error: readErr } = await fetchAllPaginated(() => sb.from('disponibilita')
    .select('ombrellone_id, data, cliente_id')
    .in('ombrellone_id', ombIds)
    .gte('data', from)
    .lte('data', to)
    .eq('stato', 'libero'));
  if (readErr) {
    showAlert(alertId, 'Errore lettura disponibilità: ' + readErr.message, 'error');
    return false;
  }
  if (!toDelete || toDelete.length === 0) {
    showAlert(alertId, 'Nessuna disponibilità da rimuovere nel periodo.', 'info');
    setTimeout(() => showAlert(alertId, '', ''), 3000);
    return true;
  }

  // 2. DELETE
  const { error: delErr } = await sb.from('disponibilita')
    .delete()
    .in('ombrellone_id', ombIds)
    .gte('data', from)
    .lte('data', to)
    .eq('stato', 'libero');
  if (delErr) {
    showAlert(alertId, 'Errore: ' + delErr.message, 'error');
    return false;
  }

  // 3. Transazioni gemelle (cliente_id risolto da clientiList se non era valorizzato)
  const txRows = toDelete.map(r => {
    const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === r.ombrellone_id) || null;
    return {
      stabilimento_id: currentStabilimento.id,
      ombrellone_id: r.ombrellone_id,
      cliente_id: r.cliente_id || cliente?.id || null,
      tipo: 'disponibilita_rimossa',
      importo: null,
      nota: `Disponibilità rimossa dal gestore per ${formatDate(r.data)}`,
    };
  });
  const { error: txErr } = await sb.from('transazioni').insert(txRows);
  if (txErr) {
    showAlert(alertId, `✓ Rimosse ${toDelete.length} disponibilità (transazioni non registrate: ${txErr.message})`, 'error');
    return true;
  }
  showAlert(alertId, `✓ Rimosse ${toDelete.length} disponibilità.`, 'info');
  setTimeout(() => showAlert(alertId, '', ''), 3000);
  return true;
}

/* ---------- Anagrafica + cancellazione ---------- */

function avanzateOpenEdit() {
  if (!avanzateOmbCurrent) return;
  closeModal('modal-avanzate-omb');
  if (typeof openEditRowModal !== 'function') return;
  openEditRowModal(avanzateOmbCurrent.id);
  // Quando il modal edit si chiude, rinfresco la mappa avanzata
  const editModal = document.getElementById('modal-edit-row');
  if (!editModal) return;
  const observer = new MutationObserver(() => {
    if (editModal.classList.contains('hidden')) {
      observer.disconnect();
      refreshAvanzateMap();
    }
  });
  observer.observe(editModal, { attributes: true, attributeFilter: ['class'] });
}

async function avanzateDeleteOmbrellone() {
  if (!avanzateOmbCurrent) return;
  const id = avanzateOmbCurrent.id;
  closeModal('modal-avanzate-omb');
  if (typeof deleteRow === 'function') {
    await deleteRow(id);
  }
  await refreshAvanzateMap();
}

/* ---------- Rettifica saldo coin ---------- */

function avanzateAdjustSaldo() {
  if (!avanzateClienteCurrent) {
    showAlert('avanzate-omb-alert', 'Nessun cliente associato a questo ombrellone.', 'error');
    return;
  }
  if (!avanzateSaldoOrigin) avanzateSaldoOrigin = 'omb';
  const c = avanzateClienteCurrent;
  document.getElementById('avanzate-saldo-sub').innerHTML = `Cliente: <strong>${escapeHtml((c.nome || '') + ' ' + (c.cognome || ''))}</strong>. La modifica viene tracciata come transazione di rettifica nello storico.`;
  document.getElementById('avanzate-saldo-corrente').textContent = formatCoin(c.credito_saldo);
  document.getElementById('avanzate-saldo-nuovo').value = parseFloat(c.credito_saldo || 0).toFixed(2);
  document.getElementById('avanzate-saldo-nota').value = '';
  showAlert('avanzate-saldo-alert', '', '');
  document.getElementById('modal-avanzate-saldo').classList.remove('hidden');
}

async function confirmAvanzateSaldo() {
  if (!avanzateClienteCurrent) { closeModal('modal-avanzate-saldo'); return; }
  const cliente = avanzateClienteCurrent;
  const nuovoStr = document.getElementById('avanzate-saldo-nuovo').value;
  const nuovo = parseFloat(nuovoStr);
  if (isNaN(nuovo) || nuovo < 0) {
    showAlert('avanzate-saldo-alert', 'Inserisci un importo valido (≥ 0).', 'error');
    return;
  }
  const corrente = parseFloat(cliente.credito_saldo || 0);
  const delta = +(nuovo - corrente).toFixed(2);
  if (delta === 0) {
    showAlert('avanzate-saldo-alert', 'Il saldo è già pari al valore inserito.', 'error');
    return;
  }
  const notaUtente = (document.getElementById('avanzate-saldo-nota').value || '').trim();
  const nota = ('Rettifica manuale gestore' + (notaUtente ? ' · ' + notaUtente : '')).slice(0, 200);
  const tipo = delta > 0 ? 'credito_ricevuto' : 'credito_usato';
  const importo = Math.abs(delta);

  const { error: txErr } = await sb.from('transazioni').insert({
    stabilimento_id: currentStabilimento.id,
    cliente_id: cliente.id,
    tipo,
    importo,
    nota,
  });
  if (txErr) { showAlert('avanzate-saldo-alert', 'Errore transazione: ' + txErr.message, 'error'); return; }

  const { error: clErr } = await sb.from('clienti_stagionali')
    .update({ credito_saldo: nuovo })
    .eq('id', cliente.id);
  if (clErr) { showAlert('avanzate-saldo-alert', 'Errore aggiornamento saldo: ' + clErr.message, 'error'); return; }

  closeModal('modal-avanzate-saldo');
  const origin = avanzateSaldoOrigin;
  avanzateSaldoOrigin = null;
  await reloadAfterMutation();
  if (origin === 'mirata' && mirataOmbId) {
    await mirataLoadOmb(mirataOmbId);
  } else if (avanzateOmbCurrent) {
    openAvanzateOmbModal(avanzateOmbCurrent.id);
  }
}

/* ---------- Helpers ---------- */

async function reloadAfterMutation() {
  if (!currentStabilimento) return;
  const ombIds = ombrelloniList.map(o => o.id);
  const { data: clienti } = await sb.from('clienti_stagionali').select('*').eq('stabilimento_id', currentStabilimento.id);
  if (clienti) clientiList = clienti;
  await refreshAvanzateMap();
  // Mantieni allineata anche la mappa di Prenotazioni se la function è disponibile
  if (typeof refreshMap === 'function') {
    try { await refreshMap(); } catch (_) {}
  }
  // Tieni allineato anche il selettore della tab "Gestione Credito"
  if (typeof populateClienteSelect === 'function') {
    try { populateClienteSelect(); } catch (_) {}
  }
}

/* ---------- Inner subtabs (massiva / mirata) ---------- */

function switchAvanzateSubtab(sub, btn) {
  document.querySelectorAll('#pren-sub-disponibilita-omb .avanzate-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('avanzate-pane-' + sub);
  if (pane) pane.classList.add('active');
  document.querySelectorAll('#pren-sub-disponibilita-omb .avanzate-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'massiva') {
    refreshAvanzateMap();
  } else if (sub === 'mirata') {
    mirataInit();
  }
}

/* ---------- MIRATA — azione su un singolo ombrellone ---------- */

let mirataOmbId = null;
let mirataDayMap = {};   // dateStr -> { id, data, stato, cliente_id }
let mirataRules = [];    // regole_stato_ombrelloni del periodo

function mirataInit() {
  populateMirataSelector();
  const sel = document.getElementById('mirata-omb-select');
  if (mirataOmbId && ombrelloniList.find(o => o.id === mirataOmbId)) {
    if (sel) sel.value = mirataOmbId;
    mirataLoadOmb(mirataOmbId);
  } else {
    mirataOmbId = null;
    if (sel) sel.value = '';
    document.getElementById('mirata-detail').classList.add('hidden');
  }
}

function populateMirataSelector() {
  const sel = document.getElementById('mirata-omb-select');
  if (!sel) return;
  const prev = sel.value;
  const opts = (ombrelloniList || []).slice().sort((a, b) =>
    (a.codice || '').localeCompare(b.codice || '', 'it'));
  sel.innerHTML = '<option value="">— Seleziona un ombrellone —</option>' + opts.map(o => {
    const cl = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === o.id);
    const lbl = cl ? ` · ${(cl.nome || '').trim()} ${(cl.cognome || '').trim()}`.replace(/\s+$/,'') : '';
    return `<option value="${o.id}">${escapeHtml(o.codice || '')}${escapeHtml(lbl)}</option>`;
  }).join('');
  if (prev && opts.find(o => o.id === prev)) sel.value = prev;
}

async function mirataOnSelect() {
  const sel = document.getElementById('mirata-omb-select');
  const id = sel ? sel.value : '';
  if (!id) {
    mirataOmbId = null;
    document.getElementById('mirata-detail').classList.add('hidden');
    return;
  }
  await mirataLoadOmb(id);
}

async function mirataLoadOmb(ombId) {
  if (!currentStabilimento) return;
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  mirataOmbId = ombId;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;

  const inizio = currentStabilimento.data_inizio_stagione;
  const fine   = currentStabilimento.data_fine_stagione;
  const detail = document.getElementById('mirata-detail');
  if (!inizio || !fine) {
    detail.classList.remove('hidden');
    showAlert('mirata-alert', 'Date di stagione non impostate. Vai in Configurazioni → Stagione.', 'error');
    document.getElementById('mirata-day-list').innerHTML = '';
    return;
  }

  const [{ data: disp, error: dispErr }, { data: rules, error: rulesErr }] = await Promise.all([
    sb.from('disponibilita').select('id, data, stato, cliente_id')
      .eq('ombrellone_id', ombId)
      .gte('data', inizio).lte('data', fine)
      .order('data', { ascending: true }),
    sb.from('regole_stato_ombrelloni').select('*')
      .eq('stabilimento_id', currentStabilimento.id)
      .gte('data_a', inizio).lte('data_da', fine),
  ]);
  if (dispErr || rulesErr) {
    showAlert('mirata-alert', 'Errore caricamento dati: ' + ((dispErr || rulesErr).message), 'error');
  }

  mirataDayMap = {};
  (disp || []).forEach(d => { mirataDayMap[d.data] = d; });
  mirataRules = rules || [];

  detail.classList.remove('hidden');
  document.getElementById('mirata-omb-title').textContent = omb.codice;
  document.getElementById('mirata-omb-credito').textContent = formatCoin(omb.credito_giornaliero);
  document.getElementById('mirata-omb-cliente').innerHTML = cliente
    ? `${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}${cliente.email ? ' · ' + escapeHtml(cliente.email) : ''}`
    : '<span style="color:var(--text-light)">Nessun cliente associato</span>';
  document.getElementById('mirata-omb-saldo').textContent = cliente ? formatCoin(cliente.credito_saldo) : '–';
  const saldoBtn = document.getElementById('mirata-saldo-btn');
  if (saldoBtn) saldoBtn.disabled = !cliente;

  const _infoEl = document.getElementById('mirata-stagione-info');
  if (_infoEl) _infoEl.innerHTML =
    `Stagione <strong>${formatDate(inizio)} → ${formatDate(fine)}</strong>. I sub-affitti già confermati non sono modificabili da qui (annullali dalla tab "Prenotazioni").`;

  mirataRenderDayList();
}

function mirataRuleForDate(dateStr) {
  // Precedenza: chiusura_speciale > mai_libero > sempre_libero
  const matching = (mirataRules || []).filter(r => dateStr >= r.data_da && dateStr <= r.data_a);
  if (matching.some(r => r.tipo === 'chiusura_speciale')) return { type: 'chiusura_speciale', label: 'Bagno chiuso' };
  if (matching.some(r => r.tipo === 'mai_libero'))        return { type: 'mai_libero',        label: 'Mai subaffittabile' };
  if (matching.some(r => r.tipo === 'sempre_libero'))     return { type: 'sempre_libero',     label: 'Sempre subaffittabile' };
  return null;
}

function mirataRenderDayList() {
  const el = document.getElementById('mirata-day-list');
  if (!el || !currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine   = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) { el.innerHTML = ''; return; }
  const dates = getDatesInRange(inizio, fine);
  if (!dates.length) {
    el.innerHTML = '<div style="color:var(--text-light);font-size:13px;padding:14px">Nessun giorno nel range stagione.</div>';
    return;
  }

  let lastMonth = '';
  const parts = [];
  for (const d of dates) {
    const month = d.slice(0, 7);
    if (month !== lastMonth) {
      const dt = new Date(d + 'T00:00:00');
      const monthName = dt.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      parts.push(`<div class="mirata-month-header">${escapeHtml(monthName.charAt(0).toUpperCase() + monthName.slice(1))}</div>`);
      lastMonth = month;
    }
    const rec = mirataDayMap[d];
    const stato = rec?.stato || 'occupied';
    const rule = mirataRuleForDate(d);

    const stateLabel = stato === 'libero' ? 'Disponibile sub-affitto'
      : stato === 'sub_affittato' ? 'Sub-affittato'
      : 'Occupato dal cliente';

    let ruleBadge = '';
    if (rule) {
      ruleBadge = `<span class="mirata-rule-badge mirata-rule-${rule.type}">${escapeHtml(rule.label)}</span>`;
    }

    let actions;
    if (rule && rule.type === 'chiusura_speciale') {
      actions = `<span class="mirata-day-note">Bloccato</span>`;
    } else if (stato === 'sub_affittato') {
      actions = `<span class="mirata-day-note">Sub-affittato</span>`;
    } else if (stato === 'libero') {
      actions = `<button class="btn btn-outline btn-sm" onclick="mirataToggleDay('${d}','remove')">✗ Rimuovi</button>`;
    } else {
      actions = `<button class="btn btn-outline btn-sm" onclick="mirataToggleDay('${d}','force')">✓ Rendi libero</button>`;
    }

    parts.push(`<div class="mirata-day-row">
      <div class="mirata-day-date">${formatDate(d)}</div>
      <div class="mirata-day-badges">${ruleBadge}<span class="avanzate-day-state ${stato}">${stateLabel}</span></div>
      <div class="mirata-day-actions">${actions}</div>
    </div>`);
  }
  el.innerHTML = parts.join('');
}

async function mirataToggleDay(date, action) {
  if (!mirataOmbId) return;
  if (action === 'force') {
    await applyForceDisponibile([mirataOmbId], [date], 'mirata-alert');
  } else if (action === 'remove') {
    await applyRemoveDisponibilita([mirataOmbId], date, date, 'mirata-alert');
  }
  await reloadAfterMutation();
  if (mirataOmbId) await mirataLoadOmb(mirataOmbId);
}

async function mirataBulkForce() {
  if (!mirataOmbId || !currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine   = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) return;
  const dates = getDatesInRange(inizio, fine);
  if (!confirm(`Rendere disponibile per sub-affitto questo ombrellone per tutta la stagione (${dates.length} ${dates.length === 1 ? 'giorno' : 'giorni'})? Le date già sub-affittate non verranno toccate.`)) return;
  await applyForceDisponibile([mirataOmbId], dates, 'mirata-alert');
  await reloadAfterMutation();
  if (mirataOmbId) await mirataLoadOmb(mirataOmbId);
}

async function mirataBulkRemove() {
  if (!mirataOmbId || !currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine   = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) return;
  if (!confirm(`Rimuovere lo stato 'libero per sub-affitto' da questo ombrellone per tutta la stagione? I sub-affitti già confermati non verranno toccati.`)) return;
  await applyRemoveDisponibilita([mirataOmbId], inizio, fine, 'mirata-alert');
  await reloadAfterMutation();
  if (mirataOmbId) await mirataLoadOmb(mirataOmbId);
}

function mirataAdjustSaldo() {
  if (!mirataOmbId) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === mirataOmbId) || null;
  if (!cliente) {
    showAlert('mirata-alert', 'Nessun cliente associato a questo ombrellone.', 'error');
    setTimeout(() => showAlert('mirata-alert', '', ''), 3000);
    return;
  }
  // Riusa il modal esistente di Avanzate impostando i suoi globals.
  avanzateClienteCurrent = cliente;
  avanzateOmbCurrent = ombrelloniList.find(o => o.id === mirataOmbId) || null;
  avanzateSaldoOrigin = 'mirata';
  avanzateAdjustSaldo();
}

function mirataOpenEdit() {
  if (!mirataOmbId || typeof openEditRowModal !== 'function') return;
  openEditRowModal(mirataOmbId);
  const editModal = document.getElementById('modal-edit-row');
  if (!editModal) return;
  const observer = new MutationObserver(async () => {
    if (editModal.classList.contains('hidden')) {
      observer.disconnect();
      populateMirataSelector();
      if (mirataOmbId && ombrelloniList.find(o => o.id === mirataOmbId)) {
        await mirataLoadOmb(mirataOmbId);
      } else {
        mirataOmbId = null;
        document.getElementById('mirata-detail').classList.add('hidden');
      }
    }
  });
  observer.observe(editModal, { attributes: true, attributeFilter: ['class'] });
}

async function mirataDelete() {
  if (!mirataOmbId || typeof deleteRow !== 'function') return;
  const id = mirataOmbId;
  await deleteRow(id);
  // deleteRow chiama loadManagerData() che rinfresca ombrelloniList. Se l'utente
  // ha confermato l'eliminazione l'ombrellone non c'è più: ripulisci la vista.
  populateMirataSelector();
  if (!ombrelloniList.find(o => o.id === id)) {
    mirataOmbId = null;
    const sel = document.getElementById('mirata-omb-select');
    if (sel) sel.value = '';
    document.getElementById('mirata-detail').classList.add('hidden');
  } else {
    await mirataLoadOmb(id);
  }
}

/* ---------- Esposizione globale ---------- */

window.avanzateInit = avanzateInit;
window.setAvanzateRangePreset = setAvanzateRangePreset;
window.setAvanzateRangeStagione = setAvanzateRangeStagione;
window.refreshAvanzateMap = refreshAvanzateMap;
window.openAvanzateOmbModal = openAvanzateOmbModal;
window.avanzateForceCurrentRange = avanzateForceCurrentRange;
window.avanzateRemoveCurrentRange = avanzateRemoveCurrentRange;
window.bulkAvanzateForceDisponibile = bulkAvanzateForceDisponibile;
window.bulkAvanzateRemoveDisponibilita = bulkAvanzateRemoveDisponibilita;
window.avanzateSelectAll = avanzateSelectAll;
window.avanzateClearSelection = avanzateClearSelection;
window.avanzateOpenEdit = avanzateOpenEdit;
window.avanzateDeleteOmbrellone = avanzateDeleteOmbrellone;
window.avanzateAdjustSaldo = avanzateAdjustSaldo;
window.confirmAvanzateSaldo = confirmAvanzateSaldo;
window.switchAvanzateSubtab = switchAvanzateSubtab;
window.mirataInit = mirataInit;
window.mirataOnSelect = mirataOnSelect;
window.mirataLoadOmb = mirataLoadOmb;
window.mirataToggleDay = mirataToggleDay;
window.mirataBulkForce = mirataBulkForce;
window.mirataBulkRemove = mirataBulkRemove;
window.mirataAdjustSaldo = mirataAdjustSaldo;
window.mirataOpenEdit = mirataOpenEdit;
window.mirataDelete = mirataDelete;
