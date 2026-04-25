// js/gestione-transazioni.js — sotto-tab "Transazioni" della pagina Ombrelloni e Clienti.
//
// Mostra un sottoinsieme di public.audit_log filtrato alle entità rilevanti
// per la pagina di gestione anagrafica: ombrelloni, clienti stagionali, email
// inviate, import batch. Replica la UX del log generale (paginazione, filtri,
// dettagli espandibili, export Excel) ma su un dataset più ristretto.

const GEST_TX_ENTITIES = ['cliente_stagionale', 'ombrellone', 'email', 'import'];

const gestTxState = {
  page: 1,
  pageSize: 30,
  totalMatches: 0,
  rows: [],
  expanded: new Set(),
  initialized: false,
};

function gestTxResetFilters() {
  document.getElementById('gest-tx-date-from').value = auditDaysAgoIso(30);
  document.getElementById('gest-tx-date-to').value   = auditTodayIso();
  document.getElementById('gest-tx-entity-type').value = '';
  document.getElementById('gest-tx-action').value = '';
  document.getElementById('gest-tx-search').value = '';
  document.getElementById('gest-tx-page-size').value = '30';
  gestTxState.page = 1;
  gestTxState.pageSize = 30;
  loadGestTxLog();
}

function gestTxReadFilters() {
  const from = document.getElementById('gest-tx-date-from')?.value || null;
  const to   = document.getElementById('gest-tx-date-to')?.value   || null;
  const entityType = document.getElementById('gest-tx-entity-type')?.value || '';
  const action = document.getElementById('gest-tx-action')?.value || '';
  const search = (document.getElementById('gest-tx-search')?.value || '').trim();
  return { from, to, entityType, action, search };
}

function gestTxBuildBaseQuery(filters) {
  let q = sb.from('audit_log')
    .select('*', { count: 'exact' })
    .eq('stabilimento_id', currentStabilimento.id);
  if (filters.entityType) q = q.eq('entity_type', filters.entityType);
  else                    q = q.in('entity_type', GEST_TX_ENTITIES);
  if (filters.from)       q = q.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to)         q = q.lte('created_at', `${filters.to}T23:59:59.999`);
  if (filters.action)     q = q.eq('action', filters.action);
  if (filters.search) {
    const s = filters.search.replace(/[%_]/g, m => '\\' + m);
    q = q.or(`description.ilike.%${s}%,actor_label.ilike.%${s}%`);
  }
  return q.order('created_at', { ascending: false });
}

async function loadGestTxLog() {
  if (!currentStabilimento?.id) return;
  const tbody = document.getElementById('gest-tx-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light)">Caricamento…</td></tr>`;

  const filters = gestTxReadFilters();
  const size = parseInt(document.getElementById('gest-tx-page-size')?.value || gestTxState.pageSize) || 30;
  gestTxState.pageSize = size;

  const from = (gestTxState.page - 1) * size;
  const to   = from + size - 1;

  const { data, count, error } = await gestTxBuildBaseQuery(filters).range(from, to);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--red)">Errore: ${error.message}</td></tr>`;
    return;
  }

  gestTxState.rows = data || [];
  gestTxState.totalMatches = count || 0;
  gestTxState.expanded.clear();
  renderGestTxRows();
  renderGestTxPager();
}

function renderGestTxRows() {
  const tbody = document.getElementById('gest-tx-tbody');
  if (!gestTxState.rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light)">Nessuna attività nel periodo/filtri selezionati</td></tr>`;
    return;
  }
  tbody.innerHTML = gestTxState.rows.map(row => {
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
    const expanded = gestTxState.expanded.has(row.id);
    const detailsBtn = `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px" onclick="toggleGestTxDetail('${row.id}')">${expanded ? '▴ Nascondi' : '▾ Dettagli'}</button>`;
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

function toggleGestTxDetail(id) {
  if (gestTxState.expanded.has(id)) gestTxState.expanded.delete(id);
  else gestTxState.expanded.add(id);
  renderGestTxRows();
}

function renderGestTxPager() {
  const total = gestTxState.totalMatches;
  const size  = gestTxState.pageSize;
  const page  = gestTxState.page;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to   = Math.min(page * size, total);
  document.getElementById('gest-tx-count-label').textContent = `${from}–${to} di ${total} eventi`;
  const prev = document.getElementById('gest-tx-prev');
  const next = document.getElementById('gest-tx-next');
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  document.getElementById('gest-tx-page-label').textContent = `Pagina ${page} / ${totalPages}`;
}

function gestTxPrevPage() {
  if (gestTxState.page > 1) { gestTxState.page--; loadGestTxLog(); }
}
function gestTxNextPage() {
  const totalPages = Math.max(1, Math.ceil(gestTxState.totalMatches / gestTxState.pageSize));
  if (gestTxState.page < totalPages) { gestTxState.page++; loadGestTxLog(); }
}
function gestTxApplyFilters() {
  gestTxState.page = 1;
  loadGestTxLog();
}

async function exportGestTxXlsx() {
  if (!currentStabilimento?.id) return;
  const filters = gestTxReadFilters();
  const btn = document.getElementById('gest-tx-export-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Export in corso…'; }
  try {
    const CHUNK = 1000;
    let offset = 0;
    const all = [];
    while (true) {
      const { data, error } = await gestTxBuildBaseQuery(filters).range(offset, offset + CHUNK - 1);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data);
      if (data.length < CHUNK) break;
      offset += CHUNK;
      if (all.length > 50000) break;
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
    XLSX.utils.book_append_sheet(wb, ws, 'Transazioni');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    XLSX.writeFile(wb, `transazioni-anagrafica-${ts}.xlsx`);
  } catch (e) {
    console.error('export gestione transazioni failed', e);
    alert('Export fallito: ' + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Esporta Excel'; }
  }
}

function switchGestioneSubtab(sub, btn) {
  document.querySelectorAll('#mtab-gestione > .config-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('gestione-sub-' + sub);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('#mtab-gestione > .config-subtabs .config-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'transazioni') {
    if (!gestTxState.initialized) {
      const fromEl = document.getElementById('gest-tx-date-from');
      const toEl   = document.getElementById('gest-tx-date-to');
      if (fromEl && !fromEl.value) fromEl.value = auditDaysAgoIso(30);
      if (toEl && !toEl.value)     toEl.value   = auditTodayIso();
      gestTxState.initialized = true;
    }
    gestTxState.page = 1;
    loadGestTxLog();
  }
}

window.switchGestioneSubtab = switchGestioneSubtab;
window.gestTxResetFilters = gestTxResetFilters;
window.gestTxApplyFilters = gestTxApplyFilters;
window.gestTxPrevPage = gestTxPrevPage;
window.gestTxNextPage = gestTxNextPage;
window.toggleGestTxDetail = toggleGestTxDetail;
window.exportGestTxXlsx = exportGestTxXlsx;
