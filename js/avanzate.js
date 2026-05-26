// js/avanzate.js — Configurazioni → Avanzate + Prenotazioni → Disponibilità Ombrelloni
//
// Context-aware: avanzateCtx='avanzate' per config-sub-avanzate,
//                avanzateCtx='prenomb' per pren-sub-disponibilita-omb.
// avId(suffix)  → getElementById(ctx + '-' + suffix)
// avIds(suffix) → querySelectorAll('.' + suffix) dentro il container di contesto

let avanzateCtx = 'avanzate'; // 'avanzate' | 'prenomb'
let avanzateClienteCurrent = null;   // { id, nome, ..., credito_saldo } | null
let avanzateSaldoOrigin = null;      // 'omb' | 'mirata'
let avanzateSelection = new Set();   // ombrellone IDs selezionati per azione massiva

// Stato per contesto
const avanzateRangePickerInstances = {};
const avanzateCurrentRangeByCtx = {};
const avanzateOmbCurrentByCtx = {};

function avId(suffix) {
  return document.getElementById(avanzateCtx + '-' + suffix);
}
function avIds(suffix) {
  const container = document.getElementById(avanzateCtx + '-container');
  if (!container) return document.querySelectorAll('.' + suffix);
  return container.querySelectorAll('.' + suffix);
}
function getAvanzatePickerInstance() { return avanzateRangePickerInstances[avanzateCtx] || null; }
function setAvanzatePickerInstance(inst) { avanzateRangePickerInstances[avanzateCtx] = inst; }
function getAvanzateCurrentRange() { return avanzateCurrentRangeByCtx[avanzateCtx] || null; }
function setAvanzateCurrentRange(v) { avanzateCurrentRangeByCtx[avanzateCtx] = v; }
function getAvanzateOmbCurrent() { return avanzateOmbCurrentByCtx[avanzateCtx] || null; }
function setAvanzateOmbCurrent(v) { avanzateOmbCurrentByCtx[avanzateCtx] = v; }

/* ---------- Init / range picker ---------- */

function avanzateInit(ctx) {
  if (ctx) avanzateCtx = ctx;
  if (!currentStabilimento) return;
  if (!getAvanzatePickerInstance()) initAvanzateRangePicker(todayStr());
  setAvanzateRangePreset(7);
  const dangerNome = document.getElementById('danger-stab-nome');
  if (dangerNome) dangerNome.textContent = currentStabilimento.nome;
}

function prenOmbInit() {
  avanzateInit('prenomb');
}

function initAvanzateRangePicker(fromDate) {
  if (typeof flatpickr === 'undefined') return;
  const input = avId('range-picker');
  if (!input) return;
  const startDate = new Date(fromDate + 'T00:00:00');
  const endDefault = new Date(fromDate + 'T00:00:00');
  endDefault.setDate(endDefault.getDate() + 6);
  if (getAvanzatePickerInstance()) {
    getAvanzatePickerInstance().setDate([startDate, endDefault], false);
    return;
  }
  setAvanzatePickerInstance(flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [startDate, endDefault],
    showMonths: 1,
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 2) {
        avId('date-from').value = toLocalDateStr(selectedDates[0]);
        avId('date-to').value = toLocalDateStr(selectedDates[1]);
        refreshAvanzateMap();
      } else if (selectedDates.length === 1) {
        const from = toLocalDateStr(selectedDates[0]);
        avId('date-from').value = from;
        avId('date-to').value = from;
      }
    },
  }));
}

function setAvanzateRangePreset(days) {
  const today = todayStr();
  const startDate = new Date(today + 'T00:00:00');
  const endDate = new Date(today + 'T00:00:00');
  endDate.setDate(endDate.getDate() + days - 1);
  avId('date-from').value = today;
  avId('date-to').value = toLocalDateStr(endDate);
  if (getAvanzatePickerInstance()) getAvanzatePickerInstance().setDate([startDate, endDate], false);
  refreshAvanzateMap();
}

function setAvanzateRangeStagione() {
  if (!currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) {
    showAlert(avanzateCtx + '-save-alert', 'Date di stagione non impostate. Vai in Configurazioni → Stagione.', 'error');
    setTimeout(() => showAlert(avanzateCtx + '-save-alert', '', ''), 4000);
    return;
  }
  const startDate = new Date(inizio + 'T00:00:00');
  const endDate = new Date(fine + 'T00:00:00');
  avId('date-from').value = inizio;
  avId('date-to').value = fine;
  if (getAvanzatePickerInstance()) getAvanzatePickerInstance().setDate([startDate, endDate], false);
  refreshAvanzateMap();
}

function updateAvanzatePresetActive() {
  const fromEl = avId('date-from');
  const toEl = avId('date-to');
  if (!fromEl) return;
  const from = fromEl.value;
  const to = (toEl ? toEl.value : '') || from;
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
  avIds('avanzate-preset-btn').forEach(btn => {
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
  const fromEl = avId('date-from');
  const toEl = avId('date-to');
  if (!fromEl) return;
  const from = fromEl.value;
  const to = (toEl ? toEl.value : '') || from;
  if (!from || !ombrelloniList || ombrelloniList.length === 0) {
    const mapEl = avId('map');
    if (mapEl) mapEl.innerHTML = '<div style="color:var(--text-light);font-size:13px;padding:8px">Nessun ombrellone configurato.</div>';
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

  setAvanzateCurrentRange({ from, to, dates, dispByOmbDate, rangeDispMap });

  const isSingleDay = from === to;
  const isToday = isSingleDay && from === todayStr();
  const rangeLabelEl = avId('range-label');
  if (rangeLabelEl) rangeLabelEl.textContent = isSingleDay
    ? (isToday ? 'oggi' : formatDate(from))
    : `${formatDate(from)} → ${formatDate(to)}`;

  const summaryEl = avId('summary');
  if (summaryEl) {
    const parts = [];
    if (countLibero) parts.push(`<strong>${countLibero}</strong> liberi`);
    if (countParziale) parts.push(`<strong>${countParziale}</strong> parzial${countParziale === 1 ? 'e' : 'i'}`);
    if (countSub) parts.push(`<strong>${countSub}</strong> sub-affittat${countSub === 1 ? 'o' : 'i'}`);
    if (countOccupied) parts.push(`<strong>${countOccupied}</strong> occupat${countOccupied === 1 ? 'o' : 'i'}`);
    summaryEl.innerHTML = parts.join(' · ');
  }

  renderAvanzateMap(ombrelloniList, rangeDispMap);
  updateAvanzatePresetActive();
}

function renderAvanzateMap(ombs, dispMap) {
  const el = avId('map');
  if (!el) return;
  el.innerHTML = '';
  const sorted = ombs.slice().sort((a, b) => (a.codice || '').localeCompare(b.codice || '', 'it'));
  const mapRow = document.createElement('div'); mapRow.className = 'map-row';
  sorted.forEach(o => {
    const stato = dispMap[o.id] || 'occupied';
    const cls = stato === 'libero' ? 'free'
      : stato === 'parziale' ? 'partial'
      : stato === 'sub_affittato' ? 'subleased'
      : 'occupied';
    const hasCliente = (clientiList || []).some(c => !c.rifiutato && c.ombrellone_id === o.id);
    const noClienteCls = !hasCliente ? ' no-cliente' : '';
    const cell = document.createElement('div');
    cell.className = 'ombrellone ' + cls + noClienteCls;
    const stateLabel = stato === 'libero' && !hasCliente ? 'subaffittabile (nessun cliente assegnato)'
      : stato === 'libero' ? 'libero per tutto il periodo'
      : stato === 'parziale' ? 'libero in parte del periodo'
      : stato === 'sub_affittato' ? 'sub-affittato in parte del periodo'
      : 'occupato dal cliente stagionale';
    cell.title = `${o.codice} — ${formatCoin(o.credito_giornaliero)}/gg — ${stateLabel} · clicca per selezionare`;
    cell.textContent = o.codice || '☂️';
    if (avanzateSelection.has(o.id)) cell.classList.add('selected');
    cell.onclick = () => toggleAvanzateSelection(o.id, cell);
    mapRow.appendChild(cell);
  });
  el.appendChild(mapRow);
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
  const mapEl = avId('map');
  if (mapEl) mapEl.querySelectorAll('.ombrellone').forEach(c => c.classList.add('selected'));
  updateAvanzateSelectionBar();
}

function avanzateClearSelection() {
  avanzateSelection.clear();
  const mapEl = avId('map');
  if (mapEl) mapEl.querySelectorAll('.ombrellone').forEach(c => c.classList.remove('selected'));
  updateAvanzateSelectionBar();
}

function updateAvanzateSelectionBar() {
  const n = avanzateSelection.size;
  const countEl = avId('selection-count');
  if (countEl) countEl.textContent = n === 0 ? '0 selezionati' : `${n} selezionat${n === 1 ? 'o' : 'i'}`;
  const forceBtn = avId('bulk-force-btn');
  const removeBtn = avId('bulk-remove-btn');
  if (forceBtn) forceBtn.disabled = n === 0;
  if (removeBtn) removeBtn.disabled = n === 0;

  const warnEl = avId('booking-warning');
  const warnText = avId('booking-warning-text');
  if (!warnEl || !warnText) return;
  const range = getAvanzateCurrentRange();
  if (n === 0 || !range?.dispByOmbDate) {
    warnEl.classList.add('hidden');
    return;
  }
  let countWithBookings = 0;
  avanzateSelection.forEach(ombId => {
    const days = range.dispByOmbDate[ombId] || {};
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
  setAvanzateOmbCurrent(omb);
  avanzateClienteCurrent = cliente;

  document.getElementById('avanzate-omb-title').textContent = `☂️ Ombrellone ${omb.codice}`;
  document.getElementById('avanzate-omb-credito').textContent = formatCoin(omb.credito_giornaliero);
  document.getElementById('avanzate-omb-cliente').innerHTML = cliente
    ? `${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}${cliente.email ? ' · ' + escapeHtml(cliente.email) : ''}`
    : '<span style="color:var(--text-light)">Nessun cliente associato</span>';
  document.getElementById('avanzate-omb-saldo').textContent = cliente ? formatCoin(cliente.credito_saldo) : '–';

  const saldoBtn = document.getElementById('avanzate-saldo-btn');
  if (saldoBtn) saldoBtn.disabled = !cliente;

  const range = getAvanzateCurrentRange();
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
  if (!getAvanzateOmbCurrent() || !getAvanzateCurrentRange()) return;
  await applyForceDisponibile([getAvanzateOmbCurrent().id], getAvanzateCurrentRange().dates, 'avanzate-omb-alert');
  await reloadAfterMutation();
  openAvanzateOmbModal(getAvanzateOmbCurrent().id);
}

async function avanzateRemoveCurrentRange() {
  if (!getAvanzateOmbCurrent() || !getAvanzateCurrentRange()) return;
  await applyRemoveDisponibilita([getAvanzateOmbCurrent().id], getAvanzateCurrentRange().from, getAvanzateCurrentRange().to, 'avanzate-omb-alert');
  await reloadAfterMutation();
  openAvanzateOmbModal(getAvanzateOmbCurrent().id);
}

/* ---------- Azioni di massa ---------- */

async function bulkAvanzateForceDisponibile() {
  const range = getAvanzateCurrentRange();
  if (!range || avanzateSelection.size === 0) return;
  const ids = Array.from(avanzateSelection);
  const ok = confirm(`Rendere disponibili per sub-affitto i ${ids.length} ombrelloni selezionati nel periodo indicato? Le date già sub-affittate non verranno toccate.`);
  if (!ok) return;
  await applyForceDisponibile(ids, range.dates, avanzateCtx + '-save-alert');
  await reloadAfterMutation();
}

async function bulkAvanzateRemoveDisponibilita() {
  const range = getAvanzateCurrentRange();
  if (!range || avanzateSelection.size === 0) return;
  const ids = Array.from(avanzateSelection);

  const { data: subAffitti, error: saErr } = await sb.from('disponibilita')
    .select('id, ombrellone_id, data, nome_prenotazione')
    .in('ombrellone_id', ids)
    .gte('data', range.from)
    .lte('data', range.to)
    .eq('stato', 'sub_affittato');

  if (saErr) {
    showAlert(avanzateCtx + '-save-alert', 'Errore lettura prenotazioni: ' + saErr.message, 'error');
    return;
  }

  let confirmMsg = `Rimuovere lo stato 'libero per sub-affitto' dai ${ids.length} ombrelloni selezionati nel periodo?`;

  const subAffittiIds = (subAffitti || []).map(r => r.id);

  if (subAffittiIds.length > 0) {
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

  if (subAffittiIds.length > 0) {
    const { error: cancelErr } = await sb.rpc('cancel_booking', { p_disp_ids: subAffittiIds });
    if (cancelErr) {
      showAlert(avanzateCtx + '-save-alert', 'Errore annullamento prenotazioni: ' + cancelErr.message, 'error');
      return;
    }
  }

  await applyRemoveDisponibilita(ids, range.from, range.to, avanzateCtx + '-save-alert');
  await reloadAfterMutation();
}

async function applyForceDisponibile(ombIds, dates, alertId) {
  if (!ombIds.length || !dates.length) return;

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
    showAlert(alertId, `✓ ${dispRows.length} disponibilità impostate (transazioni non registrate: ${txErr.message})`, 'error');
    return true;
  }
  showAlert(alertId, `✓ ${dispRows.length} disponibilità impostate.`, 'info');
  setTimeout(() => showAlert(alertId, '', ''), 3000);
  return true;
}

async function applyRemoveDisponibilita(ombIds, from, to, alertId) {
  if (!ombIds.length) return;

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
  if (!getAvanzateOmbCurrent()) return;
  closeModal('modal-avanzate-omb');
  if (typeof openEditRowModal !== 'function') return;
  openEditRowModal(getAvanzateOmbCurrent().id);
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
  if (!getAvanzateOmbCurrent()) return;
  const id = getAvanzateOmbCurrent().id;
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
  } else if (getAvanzateOmbCurrent()) {
    openAvanzateOmbModal(getAvanzateOmbCurrent().id);
  }
}

/* ---------- Helpers ---------- */

async function reloadAfterMutation() {
  if (!currentStabilimento) return;
  const { data: clienti } = await sb.from('clienti_stagionali').select('*').eq('stabilimento_id', currentStabilimento.id);
  if (clienti) clientiList = clienti;
  await refreshAvanzateMap();
  if (typeof refreshMap === 'function') {
    try { await refreshMap(); } catch (_) {}
  }
  if (typeof populateClienteSelect === 'function') {
    try { populateClienteSelect(); } catch (_) {}
  }
}

/* ---------- Inner subtabs (massiva / mirata) ---------- */

function switchAvanzateSubtab(name, btn) {
  avIds('avanzate-pane').forEach(p => p.classList.remove('active'));
  avIds('avanzate-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const el = (document.getElementById(avanzateCtx + '-container') || document)
      .querySelector(`.avanzate-subtab[data-avanzate-subtab="${name}"]`);
    if (el) el.classList.add('active');
  }
  const pane = avId('pane-' + name);
  if (pane) pane.classList.add('active');
  if (name === 'mirata') mirataInit();
  else if (name === 'massiva') refreshAvanzateMap();
}

/* ---------- MIRATA — azione su un singolo ombrellone ---------- */

let mirataOmbId = null;
let mirataDayMap = {};
let mirataRules = [];

function mirataInit() {
  populateMirataSelector();
  const sel = avId('mirata-omb-select');
  if (mirataOmbId && ombrelloniList.find(o => o.id === mirataOmbId)) {
    if (sel) sel.value = mirataOmbId;
    mirataLoadOmb(mirataOmbId);
  } else {
    mirataOmbId = null;
    if (sel) sel.value = '';
    const detail = avId('mirata-detail');
    if (detail) detail.classList.add('hidden');
  }
}

function populateMirataSelector() {
  const sel = avId('mirata-omb-select');
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
  const sel = avId('mirata-omb-select');
  const id = sel ? sel.value : '';
  if (!id) {
    mirataOmbId = null;
    const detail = avId('mirata-detail');
    if (detail) detail.classList.add('hidden');
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
  const detail = avId('mirata-detail');
  if (!inizio || !fine) {
    if (detail) detail.classList.remove('hidden');
    showAlert(avanzateCtx + '-mirata-alert', 'Date di stagione non impostate. Vai in Configurazioni → Stagione.', 'error');
    const dayList = avId('mirata-day-list');
    if (dayList) dayList.innerHTML = '';
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
    showAlert(avanzateCtx + '-mirata-alert', 'Errore caricamento dati: ' + ((dispErr || rulesErr).message), 'error');
  }

  mirataDayMap = {};
  (disp || []).forEach(d => { mirataDayMap[d.data] = d; });
  mirataRules = rules || [];

  if (detail) detail.classList.remove('hidden');
  const titleEl = avId('mirata-omb-title');
  if (titleEl) titleEl.textContent = omb.codice;
  const creditoEl = avId('mirata-omb-credito');
  if (creditoEl) creditoEl.textContent = formatCoin(omb.credito_giornaliero);
  const clienteEl = avId('mirata-omb-cliente');
  if (clienteEl) clienteEl.innerHTML = cliente
    ? `${escapeHtml(cliente.nome || '')} ${escapeHtml(cliente.cognome || '')}${cliente.email ? ' · ' + escapeHtml(cliente.email) : ''}`
    : '<span style="color:var(--text-light)">Nessun cliente associato</span>';
  const saldoEl = avId('mirata-omb-saldo');
  if (saldoEl) saldoEl.textContent = cliente ? formatCoin(cliente.credito_saldo) : '–';
  const saldoBtn = avId('mirata-saldo-btn');
  if (saldoBtn) saldoBtn.disabled = !cliente;

  const infoEl = avId('mirata-stagione-info');
  if (infoEl) infoEl.innerHTML =
    `Stagione <strong>${formatDate(inizio)} → ${formatDate(fine)}</strong>. I sub-affitti già confermati non sono modificabili da qui (annullali dalla tab "Prenotazioni").`;

  mirataRenderDayList();
}

function mirataRuleForDate(dateStr) {
  const matching = (mirataRules || []).filter(r => dateStr >= r.data_da && dateStr <= r.data_a);
  if (matching.some(r => r.tipo === 'chiusura_speciale')) return { type: 'chiusura_speciale', label: 'Bagno chiuso' };
  if (matching.some(r => r.tipo === 'mai_libero'))        return { type: 'mai_libero',        label: 'Mai subaffittabile' };
  if (matching.some(r => r.tipo === 'sempre_libero'))     return { type: 'sempre_libero',     label: 'Sempre subaffittabile' };
  return null;
}

function mirataRenderDayList() {
  const el = avId('mirata-day-list');
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
    await applyForceDisponibile([mirataOmbId], [date], avanzateCtx + '-mirata-alert');
  } else if (action === 'remove') {
    await applyRemoveDisponibilita([mirataOmbId], date, date, avanzateCtx + '-mirata-alert');
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
  await applyForceDisponibile([mirataOmbId], dates, avanzateCtx + '-mirata-alert');
  await reloadAfterMutation();
  if (mirataOmbId) await mirataLoadOmb(mirataOmbId);
}

async function mirataBulkRemove() {
  if (!mirataOmbId || !currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione;
  const fine   = currentStabilimento.data_fine_stagione;
  if (!inizio || !fine) return;
  if (!confirm(`Rimuovere lo stato 'libero per sub-affitto' da questo ombrellone per tutta la stagione? I sub-affitti già confermati non verranno toccati.`)) return;
  await applyRemoveDisponibilita([mirataOmbId], inizio, fine, avanzateCtx + '-mirata-alert');
  await reloadAfterMutation();
  if (mirataOmbId) await mirataLoadOmb(mirataOmbId);
}

function mirataAdjustSaldo() {
  if (!mirataOmbId) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === mirataOmbId) || null;
  if (!cliente) {
    showAlert(avanzateCtx + '-mirata-alert', 'Nessun cliente associato a questo ombrellone.', 'error');
    setTimeout(() => showAlert(avanzateCtx + '-mirata-alert', '', ''), 3000);
    return;
  }
  avanzateClienteCurrent = cliente;
  setAvanzateOmbCurrent(ombrelloniList.find(o => o.id === mirataOmbId) || null);
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
        const detail = avId('mirata-detail');
        if (detail) detail.classList.add('hidden');
      }
    }
  });
  observer.observe(editModal, { attributes: true, attributeFilter: ['class'] });
}

async function mirataDelete() {
  if (!mirataOmbId || typeof deleteRow !== 'function') return;
  const id = mirataOmbId;
  await deleteRow(id);
  populateMirataSelector();
  if (!ombrelloniList.find(o => o.id === id)) {
    mirataOmbId = null;
    const sel = avId('mirata-omb-select');
    if (sel) sel.value = '';
    const detail = avId('mirata-detail');
    if (detail) detail.classList.add('hidden');
  } else {
    await mirataLoadOmb(id);
  }
}

/* ---------- Esposizione globale ---------- */

window.avanzateInit = avanzateInit;
window.prenOmbInit = prenOmbInit;
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
