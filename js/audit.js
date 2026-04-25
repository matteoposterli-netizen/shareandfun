// Audit log (tab "Log attività" lato proprietario).
// - Carica eventi dalla tabella public.audit_log (RLS: proprietario vede solo i
//   propri eventi).
// - Filtri: range date, attore (tipo + label), entità, azione, testo libero,
//   nome/cognome cliente coinvolto e numero ombrellone coinvolto (risolti
//   client-side dalle anagrafiche locali in liste di id passate al server
//   come or() su entity_id + JSONB before/after, combinate in AND quando
//   entrambi i filtri sono valorizzati).
// - Colonna "Coinvolto" mostra ombrellone + cliente estratti dal payload
//   before/after di ogni riga.
// - Paginazione keyset su created_at DESC con size selezionabile (default 30).
// - Export Excel dei risultati filtrati (tutti i match, non solo la pagina).

const AUDIT_ENTITY_LABELS = {
  transazione: 'Transazione credito',
  disponibilita: 'Prenotazione / Disponibilità',
  cliente_stagionale: 'Cliente stagionale',
  ombrellone: 'Ombrellone',
  stabilimento: 'Stabilimento',
  profile: 'Profilo utente',
  email: 'Email inviata',
  auth: 'Accesso',
  import: 'Import batch',
  regola_stato: 'Regola calendario',
};

const AUDIT_ACTION_LABELS = {
  insert: 'Creazione',
  update: 'Modifica',
  delete: 'Eliminazione',
  login: 'Login',
  email_sent: 'Email inviata',
  import_batch: 'Import batch',
};

const AUDIT_ACTOR_LABELS = {
  proprietario: 'Proprietario',
  stagionale: 'Cliente stagionale',
  admin: 'Admin',
  sistema: 'Sistema / automazione',
};

const auditState = {
  page: 1,
  pageSize: 30,
  totalMatches: 0,
  rows: [],
  expanded: new Set(),
};

// Lookup maps per stabilimento corrente, popolate da auditLoadLookups().
// Servono sia per renderizzare la colonna "Coinvolto" sia per risolvere il
// filtro "Cliente / Ombrellone" in lista di id da passare al server.
const auditMaps = {
  stabilimentoId: null,
  ombrelloni: new Map(), // id -> { fila, numero, label }
  clienti:    new Map(), // id -> { nome, cognome, email, label }
};

async function auditLoadLookups(force = false) {
  if (!currentStabilimento?.id) return;
  if (!force && auditMaps.stabilimentoId === currentStabilimento.id) return;
  auditMaps.stabilimentoId = currentStabilimento.id;
  auditMaps.ombrelloni.clear();
  auditMaps.clienti.clear();
  const [ombRes, cliRes] = await Promise.all([
    sb.from('ombrelloni').select('id, fila, numero').eq('stabilimento_id', currentStabilimento.id),
    sb.from('clienti_stagionali').select('id, nome, cognome, email').eq('stabilimento_id', currentStabilimento.id),
  ]);
  (ombRes.data || []).forEach(o => {
    auditMaps.ombrelloni.set(o.id, {
      fila: o.fila, numero: o.numero,
      label: `Fila ${o.fila} N°${o.numero}`,
    });
  });
  (cliRes.data || []).forEach(c => {
    const full = `${c.nome || ''} ${c.cognome || ''}`.trim();
    auditMaps.clienti.set(c.id, {
      nome: c.nome, cognome: c.cognome, email: c.email,
      label: full || c.email || '–',
    });
  });
}

// Estrae l'id ombrellone e l'id cliente coinvolti in un evento di audit.
function auditExtractInvolvedIds(row) {
  const a = row.after  || {};
  const b = row.before || {};
  let ombrelloneId = a.ombrellone_id || b.ombrellone_id || null;
  let clienteId    = a.cliente_id    || b.cliente_id    || null;
  if (row.entity_type === 'ombrellone'         && row.entity_id) ombrelloneId = ombrelloneId || row.entity_id;
  if (row.entity_type === 'cliente_stagionale' && row.entity_id) clienteId    = clienteId    || row.entity_id;
  return { ombrelloneId, clienteId };
}

function auditInvolvedHtml(row) {
  const { ombrelloneId, clienteId } = auditExtractInvolvedIds(row);
  const parts = [];
  if (ombrelloneId) {
    const o = auditMaps.ombrelloni.get(ombrelloneId);
    parts.push(`<div style="font-size:12px"><span style="color:var(--text-light)">⛱</span> ${escapeHtml(o ? o.label : 'Ombrellone eliminato')}</div>`);
  }
  if (clienteId) {
    const c = auditMaps.clienti.get(clienteId);
    parts.push(`<div style="font-size:12px"><span style="color:var(--text-light)">👤</span> ${escapeHtml(c ? c.label : 'Cliente eliminato')}</div>`);
  }
  return parts.length ? parts.join('') : '<span style="color:var(--text-light);font-size:12px">–</span>';
}

function auditInvolvedText(row) {
  const { ombrelloneId, clienteId } = auditExtractInvolvedIds(row);
  const parts = [];
  if (ombrelloneId) {
    const o = auditMaps.ombrelloni.get(ombrelloneId);
    parts.push(o ? o.label : `Ombrellone ${ombrelloneId.slice(0, 8)}`);
  }
  if (clienteId) {
    const c = auditMaps.clienti.get(clienteId);
    parts.push(c ? c.label : `Cliente ${clienteId.slice(0, 8)}`);
  }
  return parts.join(' · ');
}

// Risolve i filtri "Nome e cognome" / "Numero ombrellone" contro le mappe
// locali: ritornano gli id che matchano. Usati per costruire OR server-side
// senza bisogno di nuovi indici / colonne sull'audit_log.
function auditResolveClienteIds(searchText) {
  const s = (searchText || '').trim().toLowerCase();
  if (!s) return null;
  const ids = [];
  for (const [id, c] of auditMaps.clienti) {
    const blob = `${c.nome || ''} ${c.cognome || ''} ${c.email || ''}`.toLowerCase();
    if (blob.includes(s)) ids.push(id);
  }
  return ids;
}

function auditResolveOmbrelloneIds(searchText) {
  const s = (searchText || '').trim().toLowerCase();
  if (!s) return null;
  const ids = [];
  for (const [id, o] of auditMaps.ombrelloni) {
    const fila = String(o.fila || '').toLowerCase();
    const num  = String(o.numero || '').toLowerCase();
    const compact = `fila${fila}n${num}`;
    if (num === s || num.includes(s) || o.label.toLowerCase().includes(s) || compact.includes(s)) {
      ids.push(id);
    }
  }
  return ids;
}

function auditTodayIso() {
  return new Date().toISOString().slice(0, 10);
}
function auditDaysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function auditResetFilters() {
  document.getElementById('audit-date-from').value = auditDaysAgoIso(7);
  document.getElementById('audit-date-to').value   = auditTodayIso();
  document.getElementById('audit-actor-type').value = '';
  document.getElementById('audit-entity-type').value = '';
  document.getElementById('audit-action').value = '';
  document.getElementById('audit-search').value = '';
  const cli = document.getElementById('audit-search-cliente');
  if (cli) cli.value = '';
  const omb = document.getElementById('audit-search-ombrellone');
  if (omb) omb.value = '';
  document.getElementById('audit-page-size').value = '30';
  auditState.page = 1;
  auditState.pageSize = 30;
  loadAuditLog();
}

function auditReadFilters() {
  const from = document.getElementById('audit-date-from')?.value || null;
  const to   = document.getElementById('audit-date-to')?.value   || null;
  const actorType = document.getElementById('audit-actor-type')?.value || '';
  const entityType = document.getElementById('audit-entity-type')?.value || '';
  const action = document.getElementById('audit-action')?.value || '';
  const search = (document.getElementById('audit-search')?.value || '').trim();
  const searchCliente    = (document.getElementById('audit-search-cliente')?.value    || '').trim();
  const searchOmbrellone = (document.getElementById('audit-search-ombrellone')?.value || '').trim();
  return { from, to, actorType, entityType, action, search, searchCliente, searchOmbrellone };
}

function auditBuildBaseQuery(filters) {
  let q = sb.from('audit_log')
    .select('*', { count: 'exact' })
    .eq('stabilimento_id', currentStabilimento.id);
  if (filters.from)       q = q.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to)         q = q.lte('created_at', `${filters.to}T23:59:59.999`);
  if (filters.actorType)  q = q.eq('actor_type', filters.actorType);
  if (filters.entityType) q = q.eq('entity_type', filters.entityType);
  if (filters.action)     q = q.eq('action', filters.action);
  if (filters.search) {
    // Cerco nel testo descrittivo e nella label attore (ILIKE).
    const s = filters.search.replace(/[%_]/g, m => '\\' + m);
    q = q.or(`description.ilike.%${s}%,actor_label.ilike.%${s}%`);
  }
  if (filters.searchCliente) {
    const cliIds = auditResolveClienteIds(filters.searchCliente) || [];
    if (cliIds.length === 0) {
      // Nessun match nelle anagrafiche: forzo zero risultati senza colpire il DB inutilmente.
      q = q.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      const list = `(${cliIds.join(',')})`;
      q = q.or([
        `and(entity_type.eq.cliente_stagionale,entity_id.in.${list})`,
        `after->>cliente_id.in.${list}`,
        `before->>cliente_id.in.${list}`,
      ].join(','));
    }
  }
  if (filters.searchOmbrellone) {
    const ombIds = auditResolveOmbrelloneIds(filters.searchOmbrellone) || [];
    if (ombIds.length === 0) {
      q = q.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      const list = `(${ombIds.join(',')})`;
      q = q.or([
        `and(entity_type.eq.ombrellone,entity_id.in.${list})`,
        `after->>ombrellone_id.in.${list}`,
        `before->>ombrellone_id.in.${list}`,
      ].join(','));
    }
  }
  return q.order('created_at', { ascending: false });
}

async function loadAuditLog() {
  if (!currentStabilimento?.id) return;
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light)">Caricamento…</td></tr>`;

  await auditLoadLookups();

  const filters = auditReadFilters();
  const size = parseInt(document.getElementById('audit-page-size')?.value || auditState.pageSize) || 30;
  auditState.pageSize = size;

  const from = (auditState.page - 1) * size;
  const to   = from + size - 1;

  const { data, count, error } = await auditBuildBaseQuery(filters).range(from, to);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--red)">Errore: ${error.message}</td></tr>`;
    return;
  }

  auditState.rows = data || [];
  auditState.totalMatches = count || 0;
  auditState.expanded.clear();
  renderAuditRows();
  renderAuditPager();
}

function renderAuditRows() {
  const tbody = document.getElementById('audit-tbody');
  if (!auditState.rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light)">Nessun evento nel periodo/filtri selezionati</td></tr>`;
    return;
  }
  tbody.innerHTML = auditState.rows.map(row => {
    const dt = new Date(row.created_at);
    const dtStr = dt.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const actor = escapeHtml(row.actor_label || AUDIT_ACTOR_LABELS[row.actor_type] || '–');
    const actorBadge = `<span style="font-size:11px;color:var(--text-light)">${AUDIT_ACTOR_LABELS[row.actor_type] || row.actor_type}</span>`;
    const entityLbl = AUDIT_ENTITY_LABELS[row.entity_type] || row.entity_type;
    const actionLbl = AUDIT_ACTION_LABELS[row.action] || row.action;
    const actionColor = row.action === 'delete' ? 'var(--red)'
      : row.action === 'insert' ? 'var(--green)'
      : row.action === 'email_sent' ? 'var(--ocean)'
      : 'var(--text-mid)';
    const expanded = auditState.expanded.has(row.id);
    const detailsBtn = `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px" onclick="toggleAuditDetail('${row.id}')">${expanded ? '▴ Nascondi' : '▾ Dettagli'}</button>`;
    const involvedHtml = auditInvolvedHtml(row);
    const mainTr = `
      <tr>
        <td style="white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-mid)">${dtStr}</td>
        <td style="font-size:13px"><div>${actor}</div>${actorBadge}</td>
        <td style="font-size:13px"><div>${escapeHtml(entityLbl)}</div><span style="color:${actionColor};font-size:11px;font-weight:600">${escapeHtml(actionLbl)}</span></td>
        <td style="font-size:13px">${involvedHtml}</td>
        <td style="font-size:13px">${escapeHtml(row.description || '–')}</td>
        <td style="text-align:right;white-space:nowrap">${detailsBtn}</td>
      </tr>`;
    if (!expanded) return mainTr;
    const detailTr = `
      <tr><td colspan="6" style="background:var(--sand);padding:12px 16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace">
          ${row.diff   ? `<div><strong>Diff</strong><pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:#fff;padding:8px;border-radius:4px;border:1px solid var(--border)">${escapeHtml(JSON.stringify(row.diff, null, 2))}</pre></div>` : ''}
          ${row.before ? `<div><strong>Before</strong><pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:#fff;padding:8px;border-radius:4px;border:1px solid var(--border)">${escapeHtml(JSON.stringify(row.before, null, 2))}</pre></div>` : ''}
          ${row.after  ? `<div><strong>After</strong><pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:#fff;padding:8px;border-radius:4px;border:1px solid var(--border)">${escapeHtml(JSON.stringify(row.after, null, 2))}</pre></div>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-light);margin-top:6px">ID evento: ${row.id}${row.entity_id ? ` · ID entità: ${row.entity_id}` : ''}</div>
      </td></tr>`;
    return mainTr + detailTr;
  }).join('');
}

function toggleAuditDetail(id) {
  if (auditState.expanded.has(id)) auditState.expanded.delete(id);
  else auditState.expanded.add(id);
  renderAuditRows();
}

function renderAuditPager() {
  const total = auditState.totalMatches;
  const size  = auditState.pageSize;
  const page  = auditState.page;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to   = Math.min(page * size, total);
  document.getElementById('audit-count-label').textContent = `${from}–${to} di ${total} eventi`;
  const prev = document.getElementById('audit-prev');
  const next = document.getElementById('audit-next');
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  document.getElementById('audit-page-label').textContent = `Pagina ${page} / ${totalPages}`;
}

function auditPrevPage() {
  if (auditState.page > 1) { auditState.page--; loadAuditLog(); }
}
function auditNextPage() {
  const totalPages = Math.max(1, Math.ceil(auditState.totalMatches / auditState.pageSize));
  if (auditState.page < totalPages) { auditState.page++; loadAuditLog(); }
}
function auditApplyFilters() {
  auditState.page = 1;
  loadAuditLog();
}

async function exportAuditXlsx() {
  if (!currentStabilimento?.id) return;
  await auditLoadLookups();
  const filters = auditReadFilters();
  const btn = document.getElementById('audit-export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Export in corso…'; }
  try {
    // Export completo: sfoglio in chunk di 1000 per non saturare memoria.
    const CHUNK = 1000;
    let offset = 0;
    const all = [];
    while (true) {
      const { data, error } = await auditBuildBaseQuery(filters).range(offset, offset + CHUNK - 1);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data);
      if (data.length < CHUNK) break;
      offset += CHUNK;
      if (all.length > 50000) break; // safety cap
    }
    const rows = all.map(r => ({
      Data: new Date(r.created_at).toLocaleString('it-IT'),
      Attore: r.actor_label || '',
      'Tipo attore': AUDIT_ACTOR_LABELS[r.actor_type] || r.actor_type,
      Entità: AUDIT_ENTITY_LABELS[r.entity_type] || r.entity_type,
      Azione: AUDIT_ACTION_LABELS[r.action] || r.action,
      Coinvolto: auditInvolvedText(r),
      Descrizione: r.description || '',
      'ID entità': r.entity_id || '',
      Before: r.before ? JSON.stringify(r.before) : '',
      After:  r.after  ? JSON.stringify(r.after)  : '',
      Diff:   r.diff   ? JSON.stringify(r.diff)   : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log attività');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    XLSX.writeFile(wb, `audit-log-${ts}.xlsx`);
  } catch (e) {
    console.error('export audit failed', e);
    alert('Export fallito: ' + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Esporta Excel'; }
  }
}
