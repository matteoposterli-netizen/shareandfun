// Audit log (tab "Log attività" lato proprietario).
// - Carica eventi dalla tabella public.audit_log (RLS: proprietario vede solo i
//   propri eventi).
// - Filtri: range date, attore (tipo + label), entità, azione, testo libero.
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
  return { from, to, actorType, entityType, action, search };
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
  return q.order('created_at', { ascending: false });
}

async function loadAuditLog() {
  if (!currentStabilimento?.id) return;
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light)">Caricamento…</td></tr>`;

  const filters = auditReadFilters();
  const size = parseInt(document.getElementById('audit-page-size')?.value || auditState.pageSize) || 30;
  auditState.pageSize = size;

  const from = (auditState.page - 1) * size;
  const to   = from + size - 1;

  const { data, count, error } = await auditBuildBaseQuery(filters).range(from, to);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--red)">Errore: ${error.message}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light)">Nessun evento nel periodo/filtri selezionati</td></tr>`;
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
    const mainTr = `
      <tr>
        <td style="white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-mid)">${dtStr}</td>
        <td style="font-size:13px"><div>${actor}</div>${actorBadge}</td>
        <td style="font-size:13px"><div>${escapeHtml(entityLbl)}</div><span style="color:${actionColor};font-size:11px;font-weight:600">${escapeHtml(actionLbl)}</span></td>
        <td style="font-size:13px">${escapeHtml(row.description || '–')}</td>
        <td style="text-align:right;white-space:nowrap">${detailsBtn}</td>
      </tr>`;
    if (!expanded) return mainTr;
    const detailTr = `
      <tr><td colspan="5" style="background:var(--sand);padding:12px 16px">
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
