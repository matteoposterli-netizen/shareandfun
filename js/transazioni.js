// js/transazioni.js — Tab "Transazioni" del menu manager.
//
// Mostra l'elenco completo delle transazioni dello stabilimento con filtri:
// arco temporale (date range), cliente (select), numero ombrellone (text match
// fila/numero), tipo. Riusa ombrelloniList/clientiList già caricati da
// loadGestione() in manager.js (i dati restano in memoria fino al cambio
// stabilimento) — niente fetch aggiuntivi per le anagrafiche.

const TX_TAB_PAGE_SIZE = 25;

const txTabState = {
  rows: [],
  page: 1,
  ombById: {},
  cliById: {},
};

const TX_TAB_LABELS = {
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

const TX_TAB_COLORS = {
  sub_affitto: 'var(--ocean)',
  sub_affitto_annullato: 'var(--text-light)',
  credito_ricevuto: 'var(--ocean)',
  credito_usato: 'var(--coral)',
  credito_revocato: 'var(--text-light)',
  disponibilita_aggiunta: 'var(--text-mid)',
  disponibilita_rimossa: 'var(--text-mid)',
  regola_forzata_aggiunta: 'var(--text-mid)',
  regola_forzata_rimossa: 'var(--text-mid)',
};

function txTabPopulateClienteSelect() {
  const sel = document.getElementById('tx-tab-cliente');
  if (!sel) return;
  const current = sel.value;
  const sorted = (clientiList || []).slice().sort((a, b) => {
    const ac = (a.cognome || '').toLowerCase();
    const bc = (b.cognome || '').toLowerCase();
    if (ac !== bc) return ac.localeCompare(bc);
    return (a.nome || '').toLowerCase().localeCompare((b.nome || '').toLowerCase());
  });
  sel.innerHTML = '<option value="">Tutti i clienti</option>' +
    sorted.map(c => {
      const ombId = c.ombrellone_id;
      const omb = ombId ? (ombrelloniList || []).find(o => o.id === ombId) : null;
      const ombLabel = omb ? ` · Fila ${omb.fila} N°${omb.numero}` : '';
      const nomeFull = `${c.cognome || ''} ${c.nome || ''}`.trim() || '(senza nome)';
      return `<option value="${c.id}">${escapeHtml(nomeFull)}${escapeHtml(ombLabel)}</option>`;
    }).join('');
  if (current && sorted.some(c => c.id === current)) sel.value = current;
}

function txTabUpdatePresetActive() {
  const from = document.getElementById('tx-tab-date-from')?.value || '';
  const to = document.getElementById('tx-tab-date-to')?.value || '';
  const today = todayStr();
  let active = null;
  if (!from && !to) {
    active = 'all';
  } else if (from && to === today) {
    const start = new Date(from + 'T00:00:00');
    const endD = new Date(to + 'T00:00:00');
    const diff = Math.round((endD - start) / 86400000) + 1;
    if (diff === 7) active = '7';
    else if (diff === 30) active = '30';
    else if (diff === 90) active = '90';
  }
  document.querySelectorAll('.tx-tab-preset-btn').forEach(btn => {
    if (btn.dataset.preset === active) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
}

function setTxTabRange(preset) {
  const fromEl = document.getElementById('tx-tab-date-from');
  const toEl = document.getElementById('tx-tab-date-to');
  if (preset === 'all') {
    fromEl.value = '';
    toEl.value = '';
  } else {
    const days = parseInt(preset, 10);
    const today = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    setDateInputValue(fromEl, from);
    setDateInputValue(toEl, today);
  }
  loadTxTab();
}

function txTabResetFilters() {
  document.getElementById('tx-tab-date-from').value = '';
  document.getElementById('tx-tab-date-to').value = '';
  document.getElementById('tx-tab-cliente').value = '';
  document.getElementById('tx-tab-ombrellone').value = '';
  document.getElementById('tx-tab-tipo').value = '';
  setTxTabRange(30);
}

function changeTxTabPage(dir) {
  const total = txTabState.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / TX_TAB_PAGE_SIZE));
  const next = Math.min(totalPages, Math.max(1, txTabState.page + dir));
  if (next === txTabState.page) return;
  txTabState.page = next;
  renderTxTab();
}

async function loadTxTab() {
  if (!currentStabilimento) return;
  txTabPopulateClienteSelect();
  txTabUpdatePresetActive();

  const from = document.getElementById('tx-tab-date-from').value;
  const to = document.getElementById('tx-tab-date-to').value;
  const clienteId = document.getElementById('tx-tab-cliente').value;
  const tipo = document.getElementById('tx-tab-tipo').value;
  const tbody = document.getElementById('tx-tab-tbody');
  const empty = document.getElementById('tx-tab-empty');
  const pag = document.getElementById('tx-tab-pagination');
  const countEl = document.getElementById('tx-tab-count-label');

  if (from && to && from > to) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'Periodo non valido: la data iniziale è successiva a quella finale';
    pag.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }
  empty.textContent = 'Nessuna transazione corrispondente ai filtri';

  let q = sb.from('transazioni').select('*').eq('stabilimento_id', currentStabilimento.id);
  if (clienteId) q = q.eq('cliente_id', clienteId);
  if (tipo) q = q.eq('tipo', tipo);
  if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
  if (to) q = q.lte('created_at', new Date(to + 'T23:59:59.999').toISOString());
  q = q.order('created_at', { ascending: false }).limit(2000);

  const { data, error } = await q;
  if (error) {
    console.error(error);
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'Errore nel caricamento delle transazioni';
    pag.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }

  const ombById = {};
  (ombrelloniList || []).forEach(o => { ombById[o.id] = o; });
  const cliById = {};
  (clientiList || []).forEach(c => { cliById[c.id] = c; });
  txTabState.ombById = ombById;
  txTabState.cliById = cliById;
  txTabState.rows = data || [];
  txTabState.page = 1;
  renderTxTab();
}

function renderTxTab() {
  const tbody = document.getElementById('tx-tab-tbody');
  const empty = document.getElementById('tx-tab-empty');
  const pag = document.getElementById('tx-tab-pagination');
  const countEl = document.getElementById('tx-tab-count-label');
  if (!tbody) return;

  txTabUpdatePresetActive();

  const qOmb = (document.getElementById('tx-tab-ombrellone')?.value || '').trim().toLowerCase();
  const { ombById, cliById } = txTabState;

  const filtered = qOmb
    ? txTabState.rows.filter(t => {
        if (!t.ombrellone_id) return false;
        const o = ombById[t.ombrellone_id];
        if (!o) return false;
        return matchesOmbrelloneQuery(o, qOmb);
      })
    : txTabState.rows;

  if (countEl) {
    const n = filtered.length;
    countEl.textContent = n
      ? `${n} transazion${n === 1 ? 'e' : 'i'} trovat${n === 1 ? 'a' : 'e'}`
      : '';
  }

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    pag.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / TX_TAB_PAGE_SIZE));
  if (txTabState.page > totalPages) txTabState.page = totalPages;
  const startIdx = (txTabState.page - 1) * TX_TAB_PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + TX_TAB_PAGE_SIZE);

  tbody.innerHTML = pageRows.map(t => {
    const o = t.ombrellone_id ? ombById[t.ombrellone_id] : null;
    const c = t.cliente_id ? cliById[t.cliente_id] : null;
    const ombStr = o
      ? `Fila ${escapeHtml(String(o.fila))} N°${escapeHtml(String(o.numero))}`
      : (t.ombrellone_id
        ? '<span style="color:var(--text-light)">— ombrellone rimosso</span>'
        : '<span style="color:var(--text-light)">—</span>');
    const cliStr = c
      ? escapeHtml(`${c.nome || ''} ${c.cognome || ''}`.trim() || '(senza nome)')
      : (t.cliente_id
        ? '<span style="color:var(--text-light)">— cliente rimosso</span>'
        : '<span style="color:var(--text-light)">—</span>');
    const tipoLabel = TX_TAB_LABELS[t.tipo] || t.tipo;
    const importo = parseFloat(t.importo || 0);
    const importoColor = TX_TAB_COLORS[t.tipo] || 'var(--text-mid)';
    const importoStr = importo > 0
      ? formatCoin(importo, currentStabilimento)
      : '<span style="color:var(--text-light)">—</span>';
    const nota = t.nota
      ? escapeHtml(String(t.nota))
      : '<span style="color:var(--text-light)">—</span>';
    return `<tr>
      <td>${formatDateShort(t.created_at)}</td>
      <td><strong>${escapeHtml(tipoLabel)}</strong></td>
      <td>${cliStr}</td>
      <td>${ombStr}</td>
      <td style="text-align:right;color:${importoColor};font-weight:600">${importoStr}</td>
      <td style="color:var(--text-mid);font-size:13px">${nota}</td>
    </tr>`;
  }).join('');

  if (total > TX_TAB_PAGE_SIZE) {
    pag.classList.remove('hidden');
    const fromN = startIdx + 1;
    const toN = Math.min(total, startIdx + TX_TAB_PAGE_SIZE);
    document.getElementById('tx-tab-page-info').textContent =
      `${fromN}–${toN} di ${total} · pagina ${txTabState.page} di ${totalPages}`;
    document.getElementById('tx-tab-page-prev').disabled = txTabState.page <= 1;
    document.getElementById('tx-tab-page-next').disabled = txTabState.page >= totalPages;
  } else {
    pag.classList.add('hidden');
  }
}

function txTabInit() {
  if (!currentStabilimento) return;
  txTabPopulateClienteSelect();
  // Default: ultimi 30 giorni se non c'è già un range impostato.
  const fromEl = document.getElementById('tx-tab-date-from');
  if (fromEl && !fromEl.value) {
    setTxTabRange(30);
  } else {
    loadTxTab();
  }
}
