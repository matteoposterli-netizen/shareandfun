function getDatesInRange(from, to) {
  const dates = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function changeMapDate(dir) {
  const d = new Date(currentMapDate + 'T00:00:00');
  d.setDate(d.getDate() + dir);
  currentMapDate = d.toISOString().split('T')[0];
  document.getElementById('map-date').value = currentMapDate;
  refreshMap();
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

  const rangeDispMap = {};
  ombrelloniList.forEach(o => {
    const ombDisp = dispByOmbDate[o.id] || {};
    const allFree = dates.every(d => ombDisp[d] === 'libero');
    const anySub = dates.some(d => ombDisp[d] === 'sub_affittato');
    if (anySub) rangeDispMap[o.id] = 'sub_affittato';
    else if (allFree) rangeDispMap[o.id] = 'libero';
    else rangeDispMap[o.id] = 'occupied';
  });

  const isSingleDay = from === to;
  const isToday = isSingleDay && from === todayStr();
  const label = isSingleDay
    ? (isToday ? 'oggi' : formatDate(from))
    : `${formatDate(from)} → ${formatDate(to)}`;

  document.getElementById('map-range-label').textContent = label;

  const free = ombrelloniList.filter(o => rangeDispMap[o.id] === 'libero').length;
  const subleased = ombrelloniList.filter(o => rangeDispMap[o.id] === 'sub_affittato').length;

  if (isToday) {
    document.getElementById('stat-liberi').textContent = free;
    document.getElementById('stat-subaffittati').textContent = subleased;
  }

  renderManagerMap(ombrelloniList, rangeDispMap);

  const freeEl = document.getElementById('map-free-count');
  if (free > 0) {
    freeEl.innerHTML = `<span style="background:var(--green-light);color:var(--green);padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">✓ ${free} ombrellone${free > 1 ? 'i' : ''} liber${free > 1 ? 'i' : 'o'} per tutto il periodo</span>`;
  } else {
    freeEl.innerHTML = `<span style="background:var(--red-light);color:var(--red);padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Nessun ombrellone libero per tutto il periodo</span>`;
  }
}

async function loadManagerData() {
  const today = todayStr();
  currentMapDate = today;
  document.getElementById('map-date-from').value = today;
  document.getElementById('map-date-to').value = today;
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

  const free = ombrelloniList.filter(o => dispMap[o.id] === 'libero').length;
  const subleased = ombrelloniList.filter(o => dispMap[o.id] === 'sub_affittato').length;
  document.getElementById('stat-totali').textContent = ombrelloniList.length;
  document.getElementById('stat-liberi').textContent = free;
  document.getElementById('stat-subaffittati').textContent = subleased;

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const { data: txWeek } = await sb.from('transazioni').select('importo').eq('stabilimento_id', currentStabilimento.id).eq('tipo', 'credito_ricevuto').gte('created_at', weekAgo.toISOString());
  const totCrediti = (txWeek || []).reduce((s, t) => s + parseFloat(t.importo), 0);
  document.getElementById('stat-crediti').textContent = formatCoin(totCrediti);

  renderManagerMap(ombrelloniList, dispMap);
  renderOmbrelloniTable(ombrelloniList, dispMap, clientiList);
  renderClientiTable(clientiList, ombrelloniList);
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
      el2.className = 'ombrellone ' + (stato === 'libero' ? 'free' : stato === 'sub_affittato' ? 'subleased' : 'occupied');
      el2.textContent = '☂️';
      el2.title = `${fila}${o.numero} — ${formatCoin(o.credito_giornaliero)}/gg`;
      row.appendChild(el2);
    });
    el.appendChild(row);
  });
}

function renderOmbrelloniTable(ombs, dispMap, clienti) {
  const tb = document.getElementById('ombrelloni-table');
  if (!ombs.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-light);padding:24px">Nessun ombrellone. Aggiungine uno!</td></tr>'; return; }
  const clienteByOmb = {};
  clienti.forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });
  tb.innerHTML = ombs.map(o => {
    const cl = clienteByOmb[o.id];
    const stato = dispMap?.[o.id] || 'occupied';
    const pillClass = stato === 'libero' ? 'pill-green' : stato === 'sub_affittato' ? 'pill-yellow' : 'pill-blue';
    const pillText = stato === 'libero' ? 'Libero' : stato === 'sub_affittato' ? 'Sub-affittato' : 'Stagionale presente';
    return `<tr>
      <td><strong>${o.fila}</strong></td>
      <td>${o.numero}</td>
      <td>${formatCoin(o.credito_giornaliero)}</td>
      <td>${cl ? cl.nome + ' ' + cl.cognome : '<span style="color:var(--text-light)">–</span>'}</td>
      <td><span class="pill ${pillClass}">${pillText}</span></td>
      <td><button class="btn btn-outline btn-sm" onclick="editOmbrellone('${o.id}')">Modifica</button></td>
    </tr>`;
  }).join('');
}

function clienteStato(c) {
  if (c.user_id) return 'attivo';
  if (c.invitato_at) return 'invitato';
  return 'mai';
}

function renderClientiTable(clienti, ombs) {
  for (const id of Array.from(selectedClienteIds)) {
    if (!clienti.find(c => c.id === id)) selectedClienteIds.delete(id);
  }
  renderClientiFiltered();
}

function renderClientiFiltered() {
  const tb = document.getElementById('clienti-table');
  if (!tb) return;
  const q = (document.getElementById('clienti-filter')?.value || '').trim().toLowerCase();
  const statoF = document.getElementById('clienti-stato-filter')?.value || '';
  const ombById = {};
  (ombrelloniList || []).forEach(o => ombById[o.id] = o);

  const visibili = (clientiList || []).filter(c => !c.rifiutato);
  const filtrati = visibili.filter(c => {
    if (statoF && clienteStato(c) !== statoF) return false;
    if (!q) return true;
    const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    const ombStr = o ? `fila ${o.fila} n°${o.numero} ${o.fila}${o.numero}` : '';
    const hay = `${c.nome || ''} ${c.cognome || ''} ${c.email || ''} ${c.telefono || ''} ${ombStr}`.toLowerCase();
    return hay.includes(q);
  });

  const countLbl = document.getElementById('clienti-count-label');
  if (countLbl) {
    countLbl.textContent = filtrati.length === visibili.length
      ? `${visibili.length} clienti`
      : `${filtrati.length} di ${visibili.length} clienti`;
  }

  if (!filtrati.length) {
    const empty = visibili.length
      ? 'Nessun cliente corrisponde al filtro.'
      : 'Nessun cliente ancora. Aggiungine uno o importa un CSV.';
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:24px">${empty}</td></tr>`;
    updateClientiBulkToolbar();
    syncCheckAllClienti(filtrati);
    return;
  }

  tb.innerHTML = filtrati.map(c => {
    const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    const stato = clienteStato(c);
    const pill = stato === 'attivo'
      ? '<span class="pill pill-green">Attivo</span>'
      : stato === 'invitato'
        ? '<span class="pill pill-yellow">Invito inviato</span>'
        : '<span class="pill pill-gray">Mai invitato</span>';
    const azioniInvito = c.user_id
      ? ''
      : `<button class="btn btn-outline btn-sm" onclick="invitaSingolo('${c.id}')" title="Invia/reinvia invito" style="margin-right:4px">✉️</button>`;
    const checked = selectedClienteIds.has(c.id) ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" class="clienti-check" data-id="${c.id}" ${checked} onchange="toggleCliente('${c.id}', this.checked)"></td>
      <td><strong>${escapeHtml(c.nome || '')} ${escapeHtml(c.cognome || '')}</strong></td>
      <td>${escapeHtml(c.email || '')}</td>
      <td>${escapeHtml(c.telefono || '') || '–'}</td>
      <td>${o ? `Fila ${escapeHtml(o.fila)} N°${o.numero}` : '<span style="color:var(--text-light)">–</span>'}</td>
      <td>${formatCoin(c.credito_saldo)}</td>
      <td>${pill}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="openEditClienteModal('${c.id}')" title="Modifica" style="margin-right:4px">✏️</button>
        ${azioniInvito}
        <button class="btn btn-danger btn-sm" onclick="deleteCliente('${c.id}')" title="Rimuovi">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  updateClientiBulkToolbar();
  syncCheckAllClienti(filtrati);
}

function syncCheckAllClienti(filtrati) {
  const chk = document.getElementById('clienti-check-all');
  if (!chk) return;
  const ids = filtrati.map(c => c.id);
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
  const filtrati = getFiltratiClienti();
  syncCheckAllClienti(filtrati);
}

function getFiltratiClienti() {
  const q = (document.getElementById('clienti-filter')?.value || '').trim().toLowerCase();
  const statoF = document.getElementById('clienti-stato-filter')?.value || '';
  const ombById = {};
  (ombrelloniList || []).forEach(o => ombById[o.id] = o);
  return (clientiList || []).filter(c => !c.rifiutato).filter(c => {
    if (statoF && clienteStato(c) !== statoF) return false;
    if (!q) return true;
    const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    const ombStr = o ? `fila ${o.fila} n°${o.numero} ${o.fila}${o.numero}` : '';
    const hay = `${c.nome || ''} ${c.cognome || ''} ${c.email || ''} ${c.telefono || ''} ${ombStr}`.toLowerCase();
    return hay.includes(q);
  });
}

function clearClientiSelection() {
  selectedClienteIds.clear();
  renderClientiFiltered();
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
  document.getElementById('analytics-date-from').value = from.toISOString().split('T')[0];
  document.getElementById('analytics-date-to').value = to.toISOString().split('T')[0];
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
  document.getElementById('manager-tx-list').innerHTML = renderTxList(data || []);
}

async function loadAllTx() {
  const { data } = await sb.from('transazioni').select('*').eq('stabilimento_id', currentStabilimento.id).order('created_at', { ascending: false }).limit(50);
  document.getElementById('all-tx-list').innerHTML = renderTxList(data || []);
}

function renderTxList(txs, stab) {
  if (!txs.length) return '<div class="tx-empty">Nessuna transazione ancora</div>';
  const icons = { disponibilita_aggiunta: {e:'📅',c:'green'}, disponibilita_rimossa: {e:'🗑️',c:'red'}, sub_affitto: {e:'💰',c:'yellow'}, credito_ricevuto: {e:'⭐',c:'yellow'}, credito_usato: {e:'🎉',c:'coral'} };
  const labels = { disponibilita_aggiunta: 'Disponibilità dichiarata', disponibilita_rimossa: 'Disponibilità rimossa', sub_affitto: 'Sub-affitto confermato', credito_ricevuto: 'Credito ricevuto', credito_usato: 'Credito utilizzato' };
  return txs.map(t => {
    const ic = icons[t.tipo] || {e:'📌',c:'blue'};
    return `<div class="tx-item">
      <div class="tx-dot ${ic.c}">${ic.e}</div>
      <div class="tx-info">
        <div class="tx-title">${labels[t.tipo] || t.tipo}${t.importo ? ` — ${formatCoin(t.importo, stab)}` : ''}</div>
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
    await sb.from('clienti_stagionali').update({ credito_saldo: (parseFloat(cliente.credito_saldo) + parseFloat(omb.credito_giornaliero)).toFixed(2) }).eq('id', cliente.id);
    await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, ombrellone_id: ombId, cliente_id: cliente.id, tipo: 'credito_ricevuto', importo: omb.credito_giornaliero, nota: `Credito per sub-affitto ${omb.fila}${omb.numero}` });
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
  await sb.from('clienti_stagionali').update({ credito_saldo: (parseFloat(cliente.credito_saldo) - importo).toFixed(2) }).eq('id', clienteId);
  await sb.from('transazioni').insert({ stabilimento_id: currentStabilimento.id, cliente_id: clienteId, tipo: 'credito_usato', importo, nota: nota || 'Utilizzo credito' });
  showAlert('crediti-alert', `Credito di ${formatCoin(importo)} registrato per ${cliente.nome}`, 'success');
  document.getElementById('credito-importo').value = '';
  document.getElementById('credito-nota').value = '';
  await loadManagerData();
}

function openAddOmbModal() {
  document.getElementById('modal-omb-fila').value = '';
  document.getElementById('modal-omb-numero').value = '';
  document.getElementById('modal-omb-credito').value = '';
  document.getElementById('modal-add-omb').classList.remove('hidden');
}

async function confirmAddOmb() {
  const fila = document.getElementById('modal-omb-fila').value.trim().toUpperCase();
  const numero = parseInt(document.getElementById('modal-omb-numero').value);
  const credito = parseFloat(document.getElementById('modal-omb-credito').value) || 10;
  if (!fila || !numero) { showAlert('add-omb-alert', 'Fila e numero sono obbligatori', 'error'); return; }
  const { error } = await sb.from('ombrelloni').insert({ stabilimento_id: currentStabilimento.id, fila, numero, credito_giornaliero: credito });
  if (error) { showAlert('add-omb-alert', error.message, 'error'); return; }
  closeModal('modal-add-omb');
  await loadManagerData();
}

function openAddClienteModal() {
  ['cl-nome','cl-cognome','cl-email','cl-telefono'].forEach(id => document.getElementById(id).value = '');
  const sel = document.getElementById('cl-ombrellone');
  sel.innerHTML = '<option value="">– Nessuno (lo assegnerai dopo) –</option>' + ombrelloniList.map(o => `<option value="${o.id}">Fila ${o.fila} N°${o.numero}</option>`).join('');
  const chk = document.getElementById('cl-invia-invito');
  if (chk) chk.checked = true;
  showAlert('add-cliente-alert', '', '');
  document.getElementById('modal-add-cliente').classList.remove('hidden');
}

function findOmbOccupant(ombId, excludeEmail) {
  if (!ombId) return null;
  const lo = (excludeEmail || '').toLowerCase();
  return (clientiList || []).find(c => c.ombrellone_id === ombId && (c.email || '').toLowerCase() !== lo) || null;
}

async function confirmAddCliente() {
  const nome = document.getElementById('cl-nome').value.trim();
  const cognome = document.getElementById('cl-cognome').value.trim();
  const email = document.getElementById('cl-email').value.trim();
  const telefono = document.getElementById('cl-telefono').value.trim();
  const ombId = document.getElementById('cl-ombrellone').value || null;
  const inviaInvito = document.getElementById('cl-invia-invito')?.checked;
  if (!nome || !email) { showAlert('add-cliente-alert', 'Nome ed email sono obbligatori', 'error'); return; }
  if (!EMAIL_RE.test(email)) { showAlert('add-cliente-alert', 'Email non valida', 'error'); return; }

  const occupant = findOmbOccupant(ombId, email);
  if (occupant) {
    const omb = ombrelloniList.find(o => o.id === ombId);
    pendingConflict = {
      kind: 'add',
      payload: { nome, cognome, email, telefono, ombId, inviaInvito },
      occupantId: occupant.id,
      ombLabel: omb ? `Fila ${omb.fila} N°${omb.numero}` : 'ombrellone',
      occupantName: `${occupant.nome || ''} ${occupant.cognome || ''}`.trim() || occupant.email,
    };
    document.getElementById('conflict-msg').innerHTML =
      `L'ombrellone <strong>${pendingConflict.ombLabel}</strong> è già assegnato a <strong>${escapeHtml(pendingConflict.occupantName)}</strong>. Chi vuoi tenere su questo ombrellone?`;
    document.getElementById('modal-conflict-cliente').classList.remove('hidden');
    return;
  }

  await saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito });
}

async function saveCliente({ nome, cognome, email, telefono, ombId, inviaInvito }) {
  const btn = document.getElementById('btn-invita-singolo');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  const now = new Date().toISOString();
  const { data: existing } = await sb.from('clienti_stagionali')
    .select('id,invito_token,user_id')
    .eq('stabilimento_id', currentStabilimento.id)
    .eq('email', email)
    .maybeSingle();

  let token, clienteId;
  const baseUpdate = { nome, cognome, telefono, ombrellone_id: ombId };
  if (inviaInvito) baseUpdate.invitato_at = now;

  if (existing) {
    if (existing.user_id) {
      showAlert('add-cliente-alert', 'Questo cliente ha già completato la registrazione. Usa "Modifica" dalla tabella per cambiargli ombrellone.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salva cliente'; }
      return;
    }
    const { error: upErr } = await sb.from('clienti_stagionali').update(baseUpdate).eq('id', existing.id);
    if (upErr) {
      showAlert('add-cliente-alert', upErr.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salva cliente'; }
      return;
    }
    token = existing.invito_token;
    clienteId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await sb.from('clienti_stagionali')
      .insert({ stabilimento_id: currentStabilimento.id, email, fonte: 'csv', approvato: false, ...baseUpdate })
      .select('id,invito_token')
      .single();
    if (insErr) {
      showAlert('add-cliente-alert', insErr.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salva cliente'; }
      return;
    }
    token = inserted?.invito_token;
    clienteId = inserted?.id;
  }

  if (inviaInvito && token) {
    const omb = ombId ? ombrelloniList.find(o => o.id === ombId) : null;
    const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : '';
    const inviteLink = `${window.location.origin}/?invito=${token}`;
    const ok = await retryUntilTrue(
      () => inviaEmail('invito', { email, nome, cognome, ombrellone: ombStr, invite_link: inviteLink }, currentStabilimento),
      3, 500
    );
    if (!ok) {
      showAlert('add-cliente-alert', '⚠ Cliente salvato ma invio email fallito. Riprova dalla tabella.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salva cliente'; }
      await loadManagerData();
      return;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Salva cliente'; }
  closeModal('modal-add-cliente');
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

function openEditClienteModal(id) {
  const c = clientiList.find(x => x.id === id);
  if (!c) return;
  document.getElementById('edit-cl-id').value = c.id;
  document.getElementById('edit-cl-nome').value = c.nome || '';
  document.getElementById('edit-cl-cognome').value = c.cognome || '';
  document.getElementById('edit-cl-email').value = c.email || '';
  document.getElementById('edit-cl-telefono').value = c.telefono || '';
  const emailInput = document.getElementById('edit-cl-email');
  emailInput.disabled = !!c.user_id;
  emailInput.title = c.user_id ? 'Email non modificabile: il cliente è già attivo.' : '';
  const sel = document.getElementById('edit-cl-ombrellone');
  sel.innerHTML = '<option value="">– Nessuno –</option>' + ombrelloniList.map(o => `<option value="${o.id}" ${c.ombrellone_id === o.id ? 'selected' : ''}>Fila ${o.fila} N°${o.numero}</option>`).join('');
  showAlert('edit-cliente-alert', '', '');
  document.getElementById('modal-edit-cliente').classList.remove('hidden');
}

async function confirmEditCliente() {
  const id = document.getElementById('edit-cl-id').value;
  const c = clientiList.find(x => x.id === id);
  if (!c) return;
  const nome = document.getElementById('edit-cl-nome').value.trim();
  const cognome = document.getElementById('edit-cl-cognome').value.trim();
  const email = (document.getElementById('edit-cl-email').value || c.email).trim();
  const telefono = document.getElementById('edit-cl-telefono').value.trim();
  const ombId = document.getElementById('edit-cl-ombrellone').value || null;
  if (!nome || !email) { showAlert('edit-cliente-alert', 'Nome ed email sono obbligatori', 'error'); return; }
  if (!EMAIL_RE.test(email)) { showAlert('edit-cliente-alert', 'Email non valida', 'error'); return; }

  const payload = { id, nome, cognome, email, telefono, ombId };
  if (ombId && ombId !== c.ombrellone_id) {
    const occupant = findOmbOccupant(ombId, email);
    if (occupant && occupant.id !== id) {
      const omb = ombrelloniList.find(o => o.id === ombId);
      pendingConflict = {
        kind: 'edit',
        payload,
        occupantId: occupant.id,
        ombLabel: omb ? `Fila ${omb.fila} N°${omb.numero}` : 'ombrellone',
        occupantName: `${occupant.nome || ''} ${occupant.cognome || ''}`.trim() || occupant.email,
      };
      document.getElementById('conflict-msg').innerHTML =
        `L'ombrellone <strong>${pendingConflict.ombLabel}</strong> è già assegnato a <strong>${escapeHtml(pendingConflict.occupantName)}</strong>. Chi vuoi tenere su questo ombrellone?`;
      document.getElementById('modal-conflict-cliente').classList.remove('hidden');
      return;
    }
  }
  await saveEditedCliente(payload);
}

async function saveEditedCliente({ id, nome, cognome, email, telefono, ombId }) {
  const c = clientiList.find(x => x.id === id);
  const update = { nome, cognome, telefono, ombrellone_id: ombId };
  if (!c?.user_id) update.email = email;
  const { error } = await sb.from('clienti_stagionali').update(update).eq('id', id);
  if (error) { showAlert('edit-cliente-alert', error.message, 'error'); return; }
  closeModal('modal-edit-cliente');
  await loadManagerData();
}

async function loadCSVOmbrelloniManager(e) {
  const file = e.target.files[0];
  if (!file) return;
  showAlert('mgr-csv-omb-alert', '', '');
  const parsed = await readCSVFile(file, 1);
  const rows = [];
  parsed.forEach(parts => {
    if (parts.length < 2) return;
    const fila = (parts[0] || '').toUpperCase();
    const numero = parseInt(parts[1]);
    const credito = parseFloat((parts[2] || '').replace(',', '.')) || 0;
    if (!fila || !numero) return;
    rows.push({ fila, numero, credito });
  });
  if (!rows.length) {
    showAlert('mgr-csv-omb-alert', 'Nessuna riga valida trovata nel CSV', 'error');
    e.target.value = '';
    return;
  }
  csvOmbrelloniRows = rows;
  const existing = new Set((ombrelloniList || []).map(o => `${o.fila}|${o.numero}`));
  const wrap = document.getElementById('mgr-csv-omb-preview');
  const statuses = rows.map(r => existing.has(`${r.fila}|${r.numero}`) ? 'dup' : 'ok');
  const dup = statuses.filter(s => s === 'dup').length;
  wrap.innerHTML = `
    <div class="csv-preview-wrap" style="margin-top:12px">
      <div class="csv-check-all">
        <input type="checkbox" id="mgr-csv-omb-check-all" onchange="toggleAllOmbCSV(this.checked)" checked>
        <label for="mgr-csv-omb-check-all">Seleziona tutti (${rows.length - dup})</label>
        ${dup ? `<span style="color:#B07000;font-size:12px;font-weight:600;margin-left:auto">${dup} già esistenti</span>` : ''}
      </div>
      <div class="csv-row header" style="grid-template-columns:32px 1fr 1fr 1fr 1fr"><div></div><div>Fila</div><div>Numero</div><div>Credito/gg</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const isDup = statuses[i] === 'dup';
        const attrs = isDup ? 'disabled' : 'checked';
        const col = isDup ? '#B07000' : 'var(--green)';
        const lbl = isDup ? 'già presente' : 'ok';
        return `<div class="csv-row" style="grid-template-columns:32px 1fr 1fr 1fr 1fr">
          <input type="checkbox" class="mgr-csv-omb-check" data-idx="${i}" ${attrs} onchange="updateOmbCSVCount()">
          <div>${escapeHtml(r.fila)}</div>
          <div>${r.numero}</div>
          <div>${formatCoin(r.credito)}</div>
          <div style="color:${col};font-size:11px;font-weight:600">${lbl}</div>
        </div>`;
      }).join('')}
    </div>`;
  document.getElementById('mgr-csv-omb-actions').classList.remove('hidden');
  document.getElementById('mgr-csv-omb-actions').style.display = 'flex';
  updateOmbCSVCount();
  showAlert('mgr-csv-omb-alert', `✅ ${rows.length} righe caricate dal CSV`, 'success');
  e.target.value = '';
}

function toggleAllOmbCSV(checked) {
  document.querySelectorAll('.mgr-csv-omb-check:not(:disabled)').forEach(cb => cb.checked = checked);
  updateOmbCSVCount();
}

function updateOmbCSVCount() {
  const total = document.querySelectorAll('.mgr-csv-omb-check:checked').length;
  document.getElementById('mgr-csv-omb-count').textContent = `${total} selezionati`;
}

function annullaCSVOmbrelloniManager() {
  csvOmbrelloniRows = [];
  document.getElementById('mgr-csv-omb-preview').innerHTML = '';
  document.getElementById('mgr-csv-omb-actions').classList.add('hidden');
  showAlert('mgr-csv-omb-alert', '', '');
}

async function confermaCSVOmbrelloniManager() {
  const selected = [];
  document.querySelectorAll('.mgr-csv-omb-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(csvOmbrelloniRows[idx]);
  });
  if (!selected.length) { showAlert('mgr-csv-omb-alert', 'Seleziona almeno una riga', 'error'); return; }
  const payload = selected.map(r => ({ stabilimento_id: currentStabilimento.id, fila: r.fila, numero: r.numero, credito_giornaliero: r.credito }));
  const { error } = await sb.from('ombrelloni').insert(payload);
  if (error) { showAlert('mgr-csv-omb-alert', error.message, 'error'); return; }
  showAlert('mgr-csv-omb-alert', `✅ ${selected.length} ombrelloni aggiunti`, 'success');
  annullaCSVOmbrelloniManager();
  await loadManagerData();
}

async function deleteCliente(id) {
  if (!confirm('Rimuovere questo cliente?')) return;
  await sb.from('clienti_stagionali').delete().eq('id', id);
  await loadManagerData();
}

async function editOmbrellone(id) {
  const o = ombrelloniList.find(x => x.id === id);
  const newCredito = prompt(`Credito giornaliero per Fila ${o.fila} N°${o.numero} in ${coinName()} (attuale: ${formatCoin(o.credito_giornaliero)}):`, o.credito_giornaliero);
  if (newCredito === null) return;
  const val = parseFloat(newCredito);
  if (isNaN(val) || val < 0) { alert('Valore non valido'); return; }
  await sb.from('ombrelloni').update({ credito_giornaliero: val }).eq('id', id);
  await loadManagerData();
}
