// js/transazioni.js — Tab "Transazioni" del menu manager.
//
// Mostra l'elenco unificato degli eventi dello stabilimento: transazioni
// (tabella `transazioni`) + email inviate + completamenti di registrazione
// invito (entrambi letti dall'`audit_log`).
//
// Filtri: arco temporale (date range), cliente (select), numero ombrellone
// (text match fila/numero), tipo. Riusa ombrelloniList/clientiList già
// caricati da loadGestione() in manager.js per risolvere id → label senza
// fetch aggiuntivi delle anagrafiche.

const TX_TAB_PAGE_SIZE = 25;

const txTabState = {
  rows: [],     // unified event shape (vedi normalize* sotto)
  page: 1,
  ombById: {},
  cliById: {},
  cliByEmail: {},
};

const TX_TAB_LABELS = {
  // Tipi della tabella `transazioni`.
  disponibilita_aggiunta: 'Disponibilità dichiarata',
  disponibilita_rimossa: 'Disponibilità rimossa',
  sub_affitto: 'Sub-affitto confermato',
  sub_affitto_annullato: 'Sub-affitto annullato',
  credito_ricevuto: 'Credito ricevuto',
  credito_usato: 'Credito utilizzato',
  credito_revocato: 'Credito revocato',
  regola_forzata_aggiunta: 'Regola gestore: impostata',
  regola_forzata_rimossa: 'Regola gestore: revocata',
  comunicazione_ricevuta: 'Comunicazione ricevuta',
  // Eventi sintetici dall'audit_log.
  email_sent: 'Email inviata',
  registrazione_completata: 'Registrazione completata',
};

const TX_TAB_COLORS = {
  sub_affitto: 'var(--ocean)',
  sub_affitto_annullato: 'var(--text-light)',
  credito_ricevuto: 'var(--ocean)',
  credito_usato: 'var(--coral)',
  credito_revocato: 'var(--text-light)',
  email_sent: 'var(--ocean)',
  registrazione_completata: 'var(--green)',
};

// Etichette user-facing del campo `metadata.tipo` delle email (vedi
// supabase/functions/invia-email/index.ts).
const TX_TAB_EMAIL_TIPO_LABELS = {
  invito: 'Invito',
  benvenuto: 'Benvenuto',
  credito_accreditato: 'Credito accreditato',
  credito_ritirato: 'Credito ritirato',
  chiusura_stagione: 'Chiusura stagione',
  attesa: 'In attesa di approvazione',
  approvazione: 'Approvazione',
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

// Normalizza una riga di public.transazioni nel formato unificato.
function txTabNormalizeTx(t) {
  return {
    id: 't:' + t.id,
    ts: t.created_at,
    tipo: t.tipo,
    cliente_id: t.cliente_id || null,
    ombrellone_id: t.ombrellone_id || null,
    importo: parseFloat(t.importo || 0) || 0,
    nota: t.nota || '',
  };
}

// Normalizza un evento email_sent dell'audit_log. Risolve il cliente via
// l'email registrata nei metadata e ne eredita l'ombrellone.
// Nota: `audit_log_write` salva i metadata nella colonna `after` (l'audit_log
// non ha una colonna `metadata` separata), quindi leggiamo da lì.
function txTabNormalizeEmail(row, cliByEmail) {
  const meta = row.after || {};
  const toEmail = String(meta.to || '').trim().toLowerCase();
  const emailTipo = meta.tipo ? (TX_TAB_EMAIL_TIPO_LABELS[meta.tipo] || meta.tipo) : '';
  const cli = toEmail ? cliByEmail[toEmail] : null;
  const subject = meta.subject ? ` — "${meta.subject}"` : '';
  const dest = toEmail ? ` a ${toEmail}` : '';
  return {
    id: 'a:' + row.id,
    ts: row.created_at,
    tipo: 'email_sent',
    sottotipo: emailTipo,
    cliente_id: cli?.id || null,
    ombrellone_id: cli?.ombrellone_id || null,
    importo: 0,
    nota: `${emailTipo ? emailTipo : 'Email'}${dest}${subject}`,
  };
}

// Normalizza un evento di completamento registrazione: UPDATE su
// clienti_stagionali in cui user_id passa da NULL a un uuid.
function txTabNormalizeRegistrazione(row, cliById) {
  const cliId = row.entity_id || (row.after && row.after.id) || null;
  const cli = cliId ? cliById[cliId] : null;
  return {
    id: 'a:' + row.id,
    ts: row.created_at,
    tipo: 'registrazione_completata',
    cliente_id: cliId,
    ombrellone_id: cli?.ombrellone_id || null,
    importo: 0,
    nota: cli
      ? `Cliente ${(cli.nome || '') + ' ' + (cli.cognome || '')}`.trim() + ' ha completato l\'invito'
      : 'Cliente ha completato l\'invito',
  };
}

// True se la riga audit rappresenta una registrazione completata: UPDATE su
// clienti_stagionali con before.user_id NULL e after.user_id valorizzato.
function txTabIsRegistrationRow(row) {
  if (row.entity_type !== 'cliente_stagionale' || row.action !== 'update') return false;
  const before = row.before || {};
  const after = row.after || {};
  return !before.user_id && !!after.user_id;
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
  empty.textContent = 'Nessun evento corrispondente ai filtri';

  const fromIso = from ? new Date(from + 'T00:00:00').toISOString() : null;
  const toIso = to ? new Date(to + 'T23:59:59.999').toISOString() : null;

  // Gli array di tipi tx vs eventi audit (i nuovi tipi sintetici stanno
  // nell'audit_log, non in `transazioni`).
  const isAuditOnly = tipo === 'email_sent' || tipo === 'registrazione_completata';
  const isTxOnly = tipo && !isAuditOnly;

  // Query 1 — `transazioni` (skippata se il filtro tipo è solo audit).
  const txPromise = isAuditOnly
    ? Promise.resolve({ data: [] })
    : (() => {
        let q = sb.from('transazioni').select('*').eq('stabilimento_id', currentStabilimento.id);
        if (clienteId) q = q.eq('cliente_id', clienteId);
        if (isTxOnly) q = q.eq('tipo', tipo);
        if (fromIso) q = q.gte('created_at', fromIso);
        if (toIso) q = q.lte('created_at', toIso);
        return q.order('created_at', { ascending: false }).limit(2000);
      })();

  // Query 2 — `audit_log` per email_sent + completamenti registrazione.
  // Filtro lato server su entity_type ed action; raffino client-side per
  // tenere solo le UPDATE che rappresentano davvero una registrazione
  // (transizione user_id NULL → uuid).
  const auditPromise = isTxOnly
    ? Promise.resolve({ data: [] })
    : (() => {
        let q = sb.from('audit_log').select('*').eq('stabilimento_id', currentStabilimento.id);
        if (tipo === 'email_sent') {
          q = q.eq('entity_type', 'email').eq('action', 'email_sent');
        } else if (tipo === 'registrazione_completata') {
          q = q.eq('entity_type', 'cliente_stagionale').eq('action', 'update');
        } else {
          q = q.in('entity_type', ['email', 'cliente_stagionale']);
        }
        if (fromIso) q = q.gte('created_at', fromIso);
        if (toIso) q = q.lte('created_at', toIso);
        return q.order('created_at', { ascending: false }).limit(2000);
      })();

  const [{ data: txData, error: txErr }, { data: auditData, error: auErr }] =
    await Promise.all([txPromise, auditPromise]);
  if (txErr || auErr) {
    console.error(txErr || auErr);
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'Errore nel caricamento delle transazioni';
    pag.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }

  // Lookup maps (le anagrafiche restano valide finché non cambia stabilimento).
  const ombById = {};
  (ombrelloniList || []).forEach(o => { ombById[o.id] = o; });
  const cliById = {};
  const cliByEmail = {};
  (clientiList || []).forEach(c => {
    cliById[c.id] = c;
    if (c.email) cliByEmail[String(c.email).trim().toLowerCase()] = c;
  });
  txTabState.ombById = ombById;
  txTabState.cliById = cliById;
  txTabState.cliByEmail = cliByEmail;

  const txEvents = (txData || []).map(txTabNormalizeTx);
  const auditEvents = (auditData || []).flatMap(row => {
    if (row.entity_type === 'email' && row.action === 'email_sent') {
      return [txTabNormalizeEmail(row, cliByEmail)];
    }
    if (txTabIsRegistrationRow(row)) {
      return [txTabNormalizeRegistrazione(row, cliById)];
    }
    return [];
  });

  // Filtro cliente per gli eventi audit (per le tx il filtro è già lato
  // server). Email senza cliente_id risolto e registrazioni di altri clienti
  // vengono escluse quando il filtro è attivo.
  const auditFiltered = clienteId
    ? auditEvents.filter(e => e.cliente_id === clienteId)
    : auditEvents;

  const merged = txEvents.concat(auditFiltered)
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  txTabState.rows = merged;
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
      ? `${n} event${n === 1 ? 'o' : 'i'} trovat${n === 1 ? 'o' : 'i'}`
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
    const sottotipo = t.sottotipo ? `<div style="color:var(--text-light);font-size:11px;font-weight:500">${escapeHtml(t.sottotipo)}</div>` : '';
    const importo = parseFloat(t.importo || 0);
    const importoColor = TX_TAB_COLORS[t.tipo] || 'var(--text-mid)';
    const importoStr = importo > 0
      ? formatCoin(importo, currentStabilimento)
      : '<span style="color:var(--text-light)">—</span>';
    const nota = t.nota
      ? escapeHtml(String(t.nota))
      : '<span style="color:var(--text-light)">—</span>';
    return `<tr>
      <td>${formatDateShort(t.ts)}</td>
      <td><strong>${escapeHtml(tipoLabel)}</strong>${sottotipo}</td>
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
