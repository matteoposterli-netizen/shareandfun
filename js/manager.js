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
  const end = new Date(today + 'T00:00:00');
  end.setDate(end.getDate() + days - 1);
  const endStr = toLocalDateStr(end);
  document.getElementById('map-date-from').value = today;
  document.getElementById('map-date-to').value = endStr;
  if (mapRangePickerInstance) mapRangePickerInstance.setDate([today, endStr], false);
  refreshMap();
}

let mapRangePickerInstance = null;
function initMapRangePicker(today) {
  if (typeof flatpickr === 'undefined') return;
  const input = document.getElementById('map-range-picker');
  if (!input) return;
  if (mapRangePickerInstance) {
    mapRangePickerInstance.setDate([today, today], false);
    return;
  }
  mapRangePickerInstance = flatpickr(input, {
    mode: 'range',
    locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
    dateFormat: 'd/m/Y',
    defaultDate: [today, today],
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

  currentMapRange = { from, to, dispByOmbDate, dates, combinationCovers, combinationValid };

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

  renderManagerMap(ombrelloniList, rangeDispMap);

  const freeEl = document.getElementById('map-free-count');
  const pill = (bg, fg, text) => `<span style="background:${bg};color:${fg};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block;margin:2px 0">${text}</span>`;
  const pills = [];
  if (isSingleDay) {
    if (free > 0) {
      pills.push(pill('var(--green-light)', 'var(--green)', `✓ ${free} ombrellone${free > 1 ? 'i' : ''} liber${free > 1 ? 'i' : 'o'}`));
    } else {
      pills.push(pill('var(--red-light)', 'var(--red)', 'Nessun ombrellone libero'));
    }
  } else {
    if (free > 0) {
      pills.push(pill('var(--green-light)', 'var(--green)', `✓ ${free} ombrellone${free > 1 ? 'i' : ''} liber${free > 1 ? 'i' : 'o'} per tutto il periodo`));
    }
    if (combinationValid) {
      pills.push(pill('var(--coral-light)', 'var(--coral)', `⚡ Combinazione: ${combo} ombrelloni coprono l'intero periodo`));
    }
    if (!free && !combinationValid) {
      if (partial > 0) {
        pills.push(pill('var(--yellow-light)', '#9C7A1F', `${partial} ombrellone${partial > 1 ? 'i' : ''} liber${partial > 1 ? 'i' : 'o'} solo in parte — nessuna combinazione copre l'intero periodo`));
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

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const { data: txWeek } = await sb.from('transazioni').select('importo').eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto').gte('created_at', weekAgo.toISOString());
  const totCrediti = (txWeek || []).reduce((s, t) => s + parseFloat(t.importo), 0);
  document.getElementById('stat-crediti').textContent = parseFloat(totCrediti || 0).toFixed(2);
  document.getElementById('stat-crediti-unit').textContent = coinName(currentStabilimento);

  await refreshMap();
  renderGestioneTable(ombrelloniList, dispMap, clientiList);
  renderCreditiTable(clientiList, ombrelloniList);
  await loadManagerTx();
  await loadAllTx();
  populateClienteSelect();
  if (!document.getElementById('analytics-date-from').value) {
    setAnalyticsRange(30);
  } else {
    await loadCreditiAnalytics();
  }
}

function renderManagerMap(ombs, dispMap) {
  const el = document.getElementById('manager-map');
  el.innerHTML = '';
  const byRow = {};
  ombs.forEach(o => { if (!byRow[o.fila]) byRow[o.fila] = []; byRow[o.fila].push(o); });
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
      el2.className = 'ombrellone ' + cls;
      el2.textContent = '☂️';
      let hint = '';
      const fmtDay = d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
      };
      const freeDays = (currentMapRange?.dates || []).filter(d => (currentMapRange?.dispByOmbDate?.[o.id] || {})[d] === 'libero');
      if (stato === 'libero') {
        hint = ' — libero per tutto il periodo — clicca per bloccarlo';
      } else if (stato === 'combinazione') {
        const covers = (currentMapRange?.combinationCovers || {})[o.id] || [];
        const days = covers.map(fmtDay).join(', ');
        const extra = freeDays.filter(d => !covers.includes(d));
        const extraTxt = extra.length ? ` (libero anche ${extra.map(fmtDay).join(', ')})` : '';
        hint = ` — copre ${covers.length} giorn${covers.length === 1 ? 'o' : 'i'}: ${days}${extraTxt} — clicca per bloccarlo`;
      } else if (stato === 'parziale') {
        const days = freeDays.map(fmtDay).join(', ');
        hint = ` — libero ${freeDays.length} giorn${freeDays.length === 1 ? 'o' : 'i'}: ${days} — clicca per bloccarlo`;
      } else if (stato === 'sub_affittato') {
        hint = ' — sub-affittato';
      }
      el2.title = `${fila}${o.numero} — ${formatCoin(o.credito_giornaliero)}/gg${hint}`;
      el2.onclick = () => handleMapOmbClick(o, stato);
      row.appendChild(el2);
    });
    el.appendChild(row);
  });
}

async function handleMapOmbClick(omb, stato) {
  if (!currentMapRange) return;
  const label = `Fila ${omb.fila} N°${omb.numero}`;
  if (stato === 'sub_affittato') {
    alert(`${label} è già sub-affittato in parte del periodo. Annullalo dalla tabella "Ombrelloni e clienti" se necessario.`);
    return;
  }
  if (stato === 'occupied') {
    alert(`${label} non risulta libero nel periodo selezionato: nulla da bloccare.`);
    return;
  }
  const { from, to, dispByOmbDate } = currentMapRange;
  const ombDisp = dispByOmbDate[omb.id] || {};
  const liberoDates = Object.keys(ombDisp).filter(d => ombDisp[d] === 'libero').sort();
  if (!liberoDates.length) return;
  const periodo = from === to ? formatDate(from) : `${formatDate(from)} → ${formatDate(to)}`;
  const nGiorni = liberoDates.length;
  const msg = `Bloccare ${label}?\n\nVerranno rimosse ${nGiorni} giornata${nGiorni > 1 ? 'e' : ''} di disponibilità nel periodo ${periodo}.`;
  if (!confirm(msg)) return;
  showLoading();
  try {
    const { error } = await sb.from('disponibilita')
      .delete()
      .eq('ombrellone_id', omb.id)
      .eq('stato', 'libero')
      .gte('data', from)
      .lte('data', to);
    if (error) { alert('Errore durante il blocco: ' + error.message); return; }
    const cliente = (clientiList || []).find(c => c.ombrellone_id === omb.id) || null;
    const txs = liberoDates.map(d => ({
      stabilimento_id: currentStabilimento.id,
      ombrellone_id: omb.id,
      cliente_id: cliente?.id || null,
      tipo: 'disponibilita_rimossa',
      nota: `${label} bloccato dal proprietario per ${formatDate(d)}`,
    }));
    if (txs.length) await sb.from('transazioni').insert(txs);
    const today = todayStr();
    if (liberoDates.includes(today) && currentDispMap[omb.id] === 'libero') {
      delete currentDispMap[omb.id];
      renderGestioneFiltered();
    }
  } finally {
    hideLoading();
  }
  await refreshMap();
  await loadManagerTx();
  await loadAllTx();
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

async function loadManagerTx() {
  const { data } = await sb.from('transazioni').select('*').eq('stabilimento_id', currentStabilimento.id).order('created_at', { ascending: false }).limit(8);
  document.getElementById('manager-tx-list').innerHTML = renderTxList(data || [], currentStabilimento, ombById());
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
  loadAllTx();
}

function clearTxRange() {
  document.getElementById('tx-filter-from').value = '';
  document.getElementById('tx-filter-to').value = '';
  loadAllTx();
}

async function loadAllTx() {
  populateTxOmbrelloneSelect();
  updateTxPresetActive();
  const ombId = document.getElementById('tx-filter-ombrellone')?.value || '';
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
  if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
  if (to) q = q.lte('created_at', new Date(to + 'T23:59:59.999').toISOString());
  q = q.order('created_at', { ascending: false });
  if (!from && !to) q = q.limit(50);
  const { data, error } = await q;
  if (error) { console.error(error); listEl.innerHTML = '<div class="tx-empty">Errore nel caricamento</div>'; return; }
  const rows = data || [];
  if (countEl) {
    if (!from && !to && !ombId) {
      countEl.textContent = rows.length ? `Ultime ${rows.length} transazioni` : '';
    } else {
      countEl.textContent = `${rows.length} transazion${rows.length === 1 ? 'e' : 'i'} trovat${rows.length === 1 ? 'a' : 'e'}`;
    }
  }
  listEl.innerHTML = renderTxList(rows, currentStabilimento, ombById());
}

function renderTxList(txs, stab, ombsMap) {
  if (!txs.length) return '<div class="tx-empty">Nessuna transazione ancora</div>';
  const icons = { disponibilita_aggiunta: {e:'📅',c:'green'}, disponibilita_rimossa: {e:'🗑️',c:'red'}, sub_affitto: {e:'💰',c:'yellow'}, credito_ricevuto: {e:'⭐',c:'yellow'}, credito_usato: {e:'🎉',c:'coral'} };
  const labels = { disponibilita_aggiunta: 'Disponibilità dichiarata', disponibilita_rimossa: 'Disponibilità rimossa', sub_affitto: 'Sub-affitto confermato', credito_ricevuto: 'Credito ricevuto', credito_usato: 'Credito utilizzato' };
  return txs.map(t => {
    const ic = icons[t.tipo] || {e:'📌',c:'blue'};
    let ombStr = '';
    if (ombsMap && t.ombrellone_id) {
      const o = ombsMap[t.ombrellone_id];
      ombStr = o
        ? `<span class="tx-omb">Fila ${o.fila} N°${o.numero}</span>`
        : `<span class="tx-omb tx-omb-missing">ombrellone rimosso</span>`;
    }
    return `<div class="tx-item">
      <div class="tx-dot ${ic.c}">${ic.e}</div>
      <div class="tx-info">
        <div class="tx-title">${labels[t.tipo] || t.tipo}${t.importo ? ` — ${formatCoin(t.importo, stab)}` : ''}${ombStr ? ' ' + ombStr : ''}</div>
        <div class="tx-sub">${t.nota || ''}</div>
      </div>
      <div class="tx-time">${formatDateShort(t.created_at)}</div>
    </div>`;
  }).join('');
}

function managerTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('mtab-' + tab).classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'email') loadEmailTemplates();
}

function openSubaffittoModal() {
  const today = todayStr();
  document.getElementById('sa-data').value = today;
  document.getElementById('sa-ombrellone').innerHTML = ombrelloniList.map(o =>
    `<option value="${o.id}">Fila ${o.fila} N°${o.numero} — ${formatCoin(o.credito_giornaliero)}/gg</option>`
  ).join('');
  document.getElementById('modal-subaffitto').classList.remove('hidden');
}

async function confirmSubaffitto() {
  const ombId = document.getElementById('sa-ombrellone').value;
  const data = document.getElementById('sa-data').value;
  if (!ombId || !data) { showAlert('subaffitto-alert', 'Compila tutti i campi', 'error'); return; }
  const omb = ombrelloniList.find(o => o.id === ombId);
  const cliente = clientiList.find(c => c.ombrellone_id === ombId);

  const { error } = await sb.from('disponibilita').upsert({ ombrellone_id: ombId, cliente_id: cliente?.id || null, data, stato: 'sub_affittato' }, { onConflict: 'ombrellone_id,data' });
  if (error) { showAlert('subaffitto-alert', error.message, 'error'); return; }

  await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, ombrellone_id: ombId, cliente_id: cliente?.id || null, tipo: 'sub_affitto', importo: omb.credito_giornaliero, nota: `Ombrellone ${omb.fila}${omb.numero} sub-affittato il ${formatDate(data)}` });

  if (cliente) {
    const nuovoSaldo = (parseFloat(cliente.credito_saldo) + parseFloat(omb.credito_giornaliero)).toFixed(2);
    await sb.from('clienti_stagionali').update({ credito_saldo: nuovoSaldo }).eq('id', cliente.id);
    const nota = `Credito per sub-affitto ${omb.fila}${omb.numero}`;
    await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, ombrellone_id: ombId, cliente_id: cliente.id, tipo: 'credito_ricevuto', importo: omb.credito_giornaliero, nota });
    if (cliente.email) {
      inviaEmail('credito_accreditato', {
        email: cliente.email,
        nome: cliente.nome,
        cognome: cliente.cognome,
        ombrellone: `Fila ${omb.fila} N°${omb.numero}`,
        importo_formatted: formatCoin(omb.credito_giornaliero, currentStabilimento),
        saldo_formatted: formatCoin(nuovoSaldo, currentStabilimento),
        nota,
      }, currentStabilimento);
    }
  }

  closeModal('modal-subaffitto');
  await loadManagerData();
  showAlert('', '', '');
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
