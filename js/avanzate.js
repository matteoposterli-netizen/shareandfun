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
let avanzateOmbCurrent = null;       // { id, fila, numero, credito_giornaliero }
let avanzateClienteCurrent = null;   // { id, nome, ..., credito_saldo } | null

/* ---------- Init / range picker ---------- */

function avanzateInit() {
  if (!currentStabilimento) return;
  // First-time init of flatpickr (no-op if already instantiated)
  if (!avanzateRangePickerInstance) initAvanzateRangePicker(todayStr());
  // Default: oggi → +6gg, così l'input mostra subito un range e non una data singola.
  // setAvanzateRangePreset triggera il refresh della mappa.
  setAvanzateRangePreset(7);
}

function initAvanzateRangePicker(fromDate) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('avanzate-range-picker');
  if (!input) return;
  const startDate = new Date(fromDate + 'T00:00:00');
  const endDefault = new Date(fromDate + 'T00:00:00');
  endDefault.setDate(endDefault.getDate() + 6);
  if (avanzateRangePickerInstance) {
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

function updateAvanzatePresetActive() {
  const from = document.getElementById('avanzate-date-from').value;
  const to = document.getElementById('avanzate-date-to').value || from;
  const today = todayStr();
  let activeDays = null;
  if (from === today) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if ([1, 2, 3, 7].includes(diff)) activeDays = diff;
  }
  document.querySelectorAll('.avanzate-preset-btn').forEach(btn => {
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

/* ---------- Refresh & render ---------- */

async function refreshAvanzateMap() {
  const from = document.getElementById('avanzate-date-from').value;
  const to = document.getElementById('avanzate-date-to').value || from;
  if (!from || !ombrelloniList || ombrelloniList.length === 0) {
    document.getElementById('avanzate-map').innerHTML = '<div style="color:var(--text-light);font-size:13px;padding:8px">Nessun ombrellone configurato.</div>';
    return;
  }
  const dates = getDatesInRange(from, to);
  if (dates.length === 0) return;

  const ombIds = ombrelloniList.map(o => o.id);
  const { data: disp } = await sb.from('disponibilita')
    .select('ombrellone_id, data, stato')
    .gte('data', from)
    .lte('data', to)
    .in('ombrellone_id', ombIds);

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
  const byRow = {};
  ombs.forEach(o => { if (!byRow[o.fila]) byRow[o.fila] = []; byRow[o.fila].push(o); });
  const colNumbers = Array.from(new Set(ombs.map(o => o.numero))).sort((a, b) => a - b);
  Object.keys(byRow).sort().reverse().forEach(fila => {
    const row = document.createElement('div'); row.className = 'map-row';
    const lbl = document.createElement('div'); lbl.className = 'row-label'; lbl.textContent = fila;
    row.appendChild(lbl);
    byRow[fila].sort((a, b) => a.numero - b.numero).forEach(o => {
      const stato = dispMap[o.id] || 'occupied';
      const cls = stato === 'libero' ? 'free'
        : stato === 'parziale' ? 'partial'
        : stato === 'sub_affittato' ? 'subleased'
        : 'occupied';
      const cell = document.createElement('div');
      cell.className = 'ombrellone ' + cls;
      cell.textContent = '☂️';
      const stateLabel = stato === 'libero' ? 'libero per tutto il periodo'
        : stato === 'parziale' ? 'libero in parte del periodo'
        : stato === 'sub_affittato' ? 'sub-affittato in parte del periodo'
        : 'occupato dal cliente stagionale';
      cell.title = `${fila}${o.numero} — ${formatCoin(o.credito_giornaliero)}/gg — ${stateLabel} · clicca per gestire`;
      cell.onclick = () => openAvanzateOmbModal(o.id);
      row.appendChild(cell);
    });
    el.appendChild(row);
  });
  if (colNumbers.length) {
    const numRow = document.createElement('div');
    numRow.className = 'map-row map-col-numbers';
    const spacer = document.createElement('div'); spacer.className = 'row-label';
    numRow.appendChild(spacer);
    colNumbers.forEach(n => {
      const c = document.createElement('div'); c.className = 'col-label'; c.textContent = n;
      numRow.appendChild(c);
    });
    el.appendChild(numRow);
  }
}

/* ---------- Modal: scheda ombrellone ---------- */

function openAvanzateOmbModal(ombId) {
  const omb = ombrelloniList.find(o => o.id === ombId);
  if (!omb) return;
  const cliente = (clientiList || []).find(c => !c.rifiutato && c.ombrellone_id === ombId) || null;
  avanzateOmbCurrent = omb;
  avanzateClienteCurrent = cliente;

  document.getElementById('avanzate-omb-title').textContent = `☂️ Ombrellone Fila ${omb.fila} · N°${omb.numero}`;
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
  if (!avanzateCurrentRange || !ombrelloniList.length) return;
  const ok = confirm(`Rendere disponibili per sub-affitto TUTTI i ${ombrelloniList.length} ombrelloni nel periodo selezionato? Le date già sub-affittate non verranno toccate.`);
  if (!ok) return;
  await applyForceDisponibile(ombrelloniList.map(o => o.id), avanzateCurrentRange.dates, 'avanzate-save-alert');
  await reloadAfterMutation();
}

async function bulkAvanzateRemoveDisponibilita() {
  if (!avanzateCurrentRange || !ombrelloniList.length) return;
  const ok = confirm(`Rimuovere lo stato 'libero per sub-affitto' da TUTTI gli ombrelloni nel periodo? I sub-affitti già confermati non verranno toccati.`);
  if (!ok) return;
  await applyRemoveDisponibilita(ombrelloniList.map(o => o.id), avanzateCurrentRange.from, avanzateCurrentRange.to, 'avanzate-save-alert');
  await reloadAfterMutation();
}

async function applyForceDisponibile(ombIds, dates, alertId) {
  if (!ombIds.length || !dates.length) return;
  const rows = [];
  ombIds.forEach(id => dates.forEach(d => rows.push({ ombrellone_id: id, data: d, stato: 'libero' })));
  const { error } = await sb.from('disponibilita')
    .upsert(rows, { onConflict: 'ombrellone_id,data', ignoreDuplicates: true });
  if (error) {
    showAlert(alertId, 'Errore: ' + error.message, 'error');
    return false;
  }
  showAlert(alertId, `✓ Disponibilità impostata su ${rows.length} righ${rows.length === 1 ? 'a' : 'e'}.`, 'info');
  setTimeout(() => showAlert(alertId, '', ''), 3000);
  return true;
}

async function applyRemoveDisponibilita(ombIds, from, to, alertId) {
  if (!ombIds.length) return;
  const { error, count } = await sb.from('disponibilita')
    .delete({ count: 'exact' })
    .in('ombrellone_id', ombIds)
    .gte('data', from)
    .lte('data', to)
    .eq('stato', 'libero');
  if (error) {
    showAlert(alertId, 'Errore: ' + error.message, 'error');
    return false;
  }
  showAlert(alertId, `✓ Rimosse ${count || 0} disponibilità.`, 'info');
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
  await reloadAfterMutation();
  if (avanzateOmbCurrent) openAvanzateOmbModal(avanzateOmbCurrent.id);
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
}

/* ---------- Esposizione globale ---------- */

window.avanzateInit = avanzateInit;
window.setAvanzateRangePreset = setAvanzateRangePreset;
window.refreshAvanzateMap = refreshAvanzateMap;
window.openAvanzateOmbModal = openAvanzateOmbModal;
window.avanzateForceCurrentRange = avanzateForceCurrentRange;
window.avanzateRemoveCurrentRange = avanzateRemoveCurrentRange;
window.bulkAvanzateForceDisponibile = bulkAvanzateForceDisponibile;
window.bulkAvanzateRemoveDisponibilita = bulkAvanzateRemoveDisponibilita;
window.avanzateOpenEdit = avanzateOpenEdit;
window.avanzateDeleteOmbrellone = avanzateDeleteOmbrellone;
window.avanzateAdjustSaldo = avanzateAdjustSaldo;
window.confirmAvanzateSaldo = confirmAvanzateSaldo;
