// Admin section: CRUD over all business tables. Access via ?admin=1.
// Admin users are rows in public.admins and do NOT have a profile.
// All DB access goes through Supabase RLS (policies added in
// 20260424000000_admin_section.sql grant admins full access).

const ADMIN_TABLES = {
  profiles: {
    label: 'profiles',
    desc: 'Utenti (proprietario o stagionale), FK ad auth.users.',
    pk: 'id',
    list: ['id', 'nome', 'cognome', 'telefono', 'ruolo', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true, help: 'UUID da auth.users (per nuovi record, creare prima l\'utente in Authentication).' },
      { name: 'nome', type: 'text', required: true },
      { name: 'cognome', type: 'text', required: true },
      { name: 'telefono', type: 'text' },
      { name: 'ruolo', type: 'select', options: ['proprietario', 'stagionale'], required: true },
    ],
    orderBy: { column: 'created_at', ascending: false },
  },
  stabilimenti: {
    label: 'stabilimenti',
    desc: 'Stabilimento balneare + template email.',
    pk: 'id',
    list: ['id', 'nome', 'citta', 'proprietario_id', 'telefono', 'email', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true, help: 'Lascia vuoto in creazione: auto-generato.' },
      { name: 'proprietario_id', type: 'text', help: 'UUID del profilo proprietario.' },
      { name: 'nome', type: 'text', required: true },
      { name: 'indirizzo', type: 'text' },
      { name: 'citta', type: 'text' },
      { name: 'telefono', type: 'text' },
      { name: 'email', type: 'text' },
      { name: 'email_benvenuto_oggetto', type: 'text' },
      { name: 'email_benvenuto_testo', type: 'textarea' },
      { name: 'email_invito_oggetto', type: 'text' },
      { name: 'email_invito_testo', type: 'textarea' },
      { name: 'email_credito_accreditato_oggetto', type: 'text' },
      { name: 'email_credito_accreditato_testo', type: 'textarea' },
      { name: 'email_credito_ritirato_oggetto', type: 'text' },
      { name: 'email_credito_ritirato_testo', type: 'textarea' },
    ],
    orderBy: { column: 'created_at', ascending: false },
  },
  ombrelloni: {
    label: 'ombrelloni',
    desc: 'Ombrelloni di uno stabilimento.',
    pk: 'id',
    list: ['id', 'stabilimento_id', 'fila', 'numero', 'credito_giornaliero', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true },
      { name: 'stabilimento_id', type: 'text', required: true },
      { name: 'fila', type: 'text', required: true },
      { name: 'numero', type: 'number', required: true },
      { name: 'credito_giornaliero', type: 'number', step: '0.01' },
    ],
    orderBy: { column: 'created_at', ascending: false },
  },
  clienti_stagionali: {
    label: 'clienti_stagionali',
    desc: 'Clienti stagionali e stato invito.',
    pk: 'id',
    list: ['id', 'stabilimento_id', 'ombrellone_id', 'user_id', 'nome', 'cognome', 'email', 'telefono', 'credito_saldo', 'approvato', 'rifiutato', 'fonte', 'invitato_at', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true },
      { name: 'stabilimento_id', type: 'text', required: true },
      { name: 'ombrellone_id', type: 'text' },
      { name: 'user_id', type: 'text', help: 'UUID del profile (popolato quando il cliente completa l\'invito).' },
      { name: 'nome', type: 'text', required: true },
      { name: 'cognome', type: 'text', required: true },
      { name: 'email', type: 'text', required: true },
      { name: 'telefono', type: 'text' },
      { name: 'credito_saldo', type: 'number', step: '0.01' },
      { name: 'approvato', type: 'bool' },
      { name: 'rifiutato', type: 'bool' },
      { name: 'fonte', type: 'select', options: ['csv', 'diretta'] },
      { name: 'invito_token', type: 'text', readonly: true },
      { name: 'invitato_at', type: 'text', help: 'ISO timestamp (es. 2026-04-24T10:00:00Z).' },
      { name: 'note_match', type: 'textarea' },
    ],
    orderBy: { column: 'created_at', ascending: false },
  },
  disponibilita: {
    label: 'disponibilita',
    desc: 'Giornate in cui un ombrellone è libero o sub-affittato.',
    pk: 'id',
    list: ['id', 'ombrellone_id', 'cliente_id', 'data', 'stato', 'nome_prenotazione', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true },
      { name: 'ombrellone_id', type: 'text', required: true },
      { name: 'cliente_id', type: 'text' },
      { name: 'data', type: 'date', required: true },
      { name: 'stato', type: 'select', options: ['libero', 'sub_affittato'] },
      { name: 'nome_prenotazione', type: 'text', help: 'Etichetta opzionale per raggruppare sub-affitti multi-giorno / multi-ombrellone.' },
    ],
    orderBy: { column: 'data', ascending: false },
  },
  transazioni: {
    label: 'transazioni',
    desc: 'Storico contabile (crediti, sub-affitti, disponibilità).',
    pk: 'id',
    list: ['id', 'stabilimento_id', 'ombrellone_id', 'cliente_id', 'tipo', 'importo', 'nota', 'created_at'],
    fields: [
      { name: 'id', type: 'text', readonly: true },
      { name: 'stabilimento_id', type: 'text', required: true },
      { name: 'ombrellone_id', type: 'text' },
      { name: 'cliente_id', type: 'text' },
      { name: 'tipo', type: 'select', required: true, options: ['disponibilita_aggiunta', 'disponibilita_rimossa', 'sub_affitto', 'credito_ricevuto', 'credito_usato'] },
      { name: 'importo', type: 'number', step: '0.01' },
      { name: 'nota', type: 'textarea' },
    ],
    orderBy: { column: 'created_at', ascending: false },
  },
};

let currentAdminTable = 'profiles';
let currentAdminRows = [];
let adminEditingRow = null;
let adminIsAuthenticated = false;

async function showAdminLogin() {
  document.getElementById('topnav').style.display = 'none';
  document.getElementById('admin-login-email').value = '';
  document.getElementById('admin-login-password').value = '';
  showAlert('admin-login-alert', '', '');
  showView('admin-login');
}

async function doAdminLogin() {
  // Normalize email: Supabase stores emails lowercase server-side; sending
  // mixed-case is fine but normalizing avoids any client-side typos.
  const email = document.getElementById('admin-login-email').value.trim().toLowerCase();
  const password = document.getElementById('admin-login-password').value;
  const btn = document.getElementById('btn-admin-login');
  if (!email || !password) { showAlert('admin-login-alert', 'Compila tutti i campi', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Accesso in corso…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    // Surface the real cause (wrong password vs unconfirmed email vs unknown
    // user) instead of a generic message — otherwise diagnosing provisioning
    // problems requires Supabase dashboard access.
    const msg = (error.message || '').toLowerCase();
    let human = `Accesso fallito: ${error.message}`;
    if (msg.includes('invalid login')) {
      human = 'Credenziali non valide. Verifica che l\'utente esista in Supabase Authentication e che la password sia corretta.';
    } else if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      human = 'Email non confermata. Apri il dashboard Supabase → Authentication → Users e conferma l\'utente (Auto Confirm).';
    } else if (msg.includes('rate limit') || msg.includes('too many')) {
      human = 'Troppi tentativi. Riprova fra qualche minuto.';
    }
    showAlert('admin-login-alert', human, 'error');
    btn.disabled = false; btn.textContent = 'Accedi come admin';
    return;
  }
  // Verify the user is in public.admins. Admins_self_select policy returns
  // the row only if user_id = auth.uid().
  const { data: adminRow, error: adminErr } = await sb.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (adminErr) {
    // Distinguish "table missing" (migration not applied yet) from other
    // RLS/network errors so we can guide the operator to the right fix.
    await sb.auth.signOut();
    const m = (adminErr.message || '').toLowerCase();
    const tableMissing = m.includes('relation') && m.includes('admins') || adminErr.code === '42P01';
    const human = tableMissing
      ? 'La tabella public.admins non esiste ancora. Applica la migration supabase/migrations/20260424000000_admin_section.sql sul progetto Supabase.'
      : `Errore verifica admin: ${adminErr.message}`;
    showAlert('admin-login-alert', human, 'error');
    btn.disabled = false; btn.textContent = 'Accedi come admin';
    return;
  }
  if (!adminRow) {
    await sb.auth.signOut();
    showAlert('admin-login-alert', 'Login riuscito ma questo account non è registrato come admin. Esegui in SQL Editor: INSERT INTO public.admins (user_id) VALUES (\'' + data.user.id + '\');', 'error');
    btn.disabled = false; btn.textContent = 'Accedi come admin';
    return;
  }
  currentUser = data.user;
  adminIsAuthenticated = true;
  btn.disabled = false; btn.textContent = 'Accedi come admin';
  await enterAdminDashboard();
}

async function doAdminLogout() {
  await sb.auth.signOut();
  currentUser = null;
  adminIsAuthenticated = false;
  currentAdminRows = [];
  // Redirect to clean URL (remove ?admin=1) and back to landing.
  window.location.href = '/';
}

async function enterAdminDashboard() {
  document.getElementById('topnav').style.display = 'none';
  showView('admin');
  // Restore last-selected tab highlight on first render.
  const first = document.querySelector('#view-admin .sidebar-item');
  if (first) first.classList.add('active');
  currentAdminTable = 'profiles';
  await loadAdminTable();
}

function adminTab(tableName, btn) {
  document.querySelectorAll('#view-admin .sidebar-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  currentAdminTable = tableName;
  document.getElementById('admin-search').value = '';
  loadAdminTable();
}

async function loadAdminTable() {
  const schema = ADMIN_TABLES[currentAdminTable];
  if (!schema) return;
  document.getElementById('admin-table-title').textContent = schema.label;
  document.getElementById('admin-table-sub').textContent = schema.desc + ' · caricamento…';
  showAlert('admin-alert', '', '');
  let q = sb.from(currentAdminTable).select('*');
  if (schema.orderBy) q = q.order(schema.orderBy.column, { ascending: schema.orderBy.ascending });
  q = q.limit(1000);
  const { data, error } = await q;
  if (error) {
    showAlert('admin-alert', `Errore caricamento: ${error.message}`, 'error');
    currentAdminRows = [];
    renderAdminTable();
    return;
  }
  currentAdminRows = data || [];
  document.getElementById('admin-table-sub').textContent = `${schema.desc} · ${currentAdminRows.length} ${currentAdminRows.length === 1 ? 'riga' : 'righe'} (max 1000)`;
  renderAdminTable();
}

function renderAdminTable() {
  const schema = ADMIN_TABLES[currentAdminTable];
  if (!schema) return;
  const searchTerm = document.getElementById('admin-search').value.trim().toLowerCase();
  const head = document.getElementById('admin-table-head');
  const body = document.getElementById('admin-table-body');
  head.innerHTML = '<tr>' + schema.list.map(c => `<th>${c}</th>`).join('') + '<th style="width:140px;text-align:right">Azioni</th></tr>';

  const rows = searchTerm
    ? currentAdminRows.filter(r => schema.list.some(c => String(r[c] ?? '').toLowerCase().includes(searchTerm)))
    : currentAdminRows;

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="${schema.list.length + 1}" style="text-align:center;padding:24px;color:var(--text-light)">Nessuna riga</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r, idx) => {
    const origIdx = currentAdminRows.indexOf(r);
    const cells = schema.list.map(c => `<td title="${escapeAttr(String(r[c] ?? ''))}">${formatAdminCell(r[c])}</td>`).join('');
    return `<tr>${cells}<td style="text-align:right;white-space:nowrap">
      <button class="btn btn-outline btn-sm" onclick="openAdminEditModal(${origIdx})">Modifica</button>
      <button class="btn btn-outline btn-sm" style="color:var(--red,#c0392b);border-color:var(--red,#c0392b)" onclick="deleteAdminRow(${origIdx})">Elimina</button>
    </td></tr>`;
  }).join('');
}

function formatAdminCell(v) {
  if (v === null || v === undefined) return '<span style="color:var(--text-light)">—</span>';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  const s = String(v);
  if (s.length > 60) return escapeHtml(s.slice(0, 57)) + '…';
  return escapeHtml(s);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function openAdminAddModal() {
  adminEditingRow = null;
  const schema = ADMIN_TABLES[currentAdminTable];
  document.getElementById('admin-row-title').textContent = `+ Nuova riga in ${schema.label}`;
  document.getElementById('admin-row-sub').textContent = schema.desc;
  renderAdminRowFields({});
  showAlert('admin-row-alert', '', '');
  document.getElementById('modal-admin-row').classList.remove('hidden');
}

function openAdminEditModal(idx) {
  const row = currentAdminRows[idx];
  if (!row) return;
  adminEditingRow = row;
  const schema = ADMIN_TABLES[currentAdminTable];
  document.getElementById('admin-row-title').textContent = `✏️ Modifica ${schema.label}`;
  document.getElementById('admin-row-sub').textContent = `${schema.pk}: ${row[schema.pk]}`;
  renderAdminRowFields(row);
  showAlert('admin-row-alert', '', '');
  document.getElementById('modal-admin-row').classList.remove('hidden');
}

function renderAdminRowFields(row) {
  const schema = ADMIN_TABLES[currentAdminTable];
  const isEdit = !!adminEditingRow;
  const container = document.getElementById('admin-row-fields');
  container.innerHTML = schema.fields.map(f => {
    const val = row[f.name];
    const id = `adminf-${f.name}`;
    const readonly = f.readonly && isEdit ? 'readonly' : '';
    // On create, allow leaving readonly `id` empty (Postgres uses default).
    const showField = !(f.readonly && !isEdit && f.name === schema.pk);
    if (!showField) return '';
    const help = f.help ? `<div style="font-size:12px;color:var(--text-light);margin-top:2px">${escapeHtml(f.help)}</div>` : '';
    const req = f.required ? '<span style="color:var(--red,#c0392b)"> *</span>' : '';
    if (f.type === 'textarea') {
      return `<div class="form-group"><label class="form-label">${f.name}${req}</label>
        <textarea id="${id}" class="form-input" rows="3" ${readonly} style="resize:vertical">${escapeHtml(val ?? '')}</textarea>${help}</div>`;
    }
    if (f.type === 'bool') {
      const checked = val === true ? 'checked' : '';
      return `<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="${id}" ${checked}> <span>${f.name}${req}</span></label>${help}</div>`;
    }
    if (f.type === 'select') {
      const opts = ['<option value="">(null)</option>'].concat(f.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`));
      return `<div class="form-group"><label class="form-label">${f.name}${req}</label>
        <select id="${id}" class="form-select">${opts.join('')}</select>${help}</div>`;
    }
    const inputType = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
    const step = f.step ? `step="${f.step}"` : '';
    const valueAttr = val == null ? '' : `value="${escapeAttr(String(val))}"`;
    return `<div class="form-group"><label class="form-label">${f.name}${req}</label>
      <input type="${inputType}" id="${id}" class="form-input" ${step} ${readonly} ${valueAttr}>${help}</div>`;
  }).join('');
}

function collectAdminRowFromForm() {
  const schema = ADMIN_TABLES[currentAdminTable];
  const isEdit = !!adminEditingRow;
  const payload = {};
  for (const f of schema.fields) {
    const el = document.getElementById(`adminf-${f.name}`);
    if (!el) continue;
    let v;
    if (f.type === 'bool') v = el.checked;
    else if (f.type === 'select') { v = el.value; if (v === '') v = null; }
    else { v = el.value; if (v === '') v = null; }
    // Don't send readonly fields on update; don't send pk if empty on insert.
    if (f.readonly && isEdit) continue;
    if (f.readonly && !isEdit && (v == null || v === '')) continue;
    if (f.type === 'number' && v != null) v = Number(v);
    payload[f.name] = v;
  }
  return payload;
}

async function saveAdminRow() {
  const schema = ADMIN_TABLES[currentAdminTable];
  const isEdit = !!adminEditingRow;
  const btn = document.getElementById('btn-admin-row-save');
  btn.disabled = true; btn.textContent = 'Salvataggio…';
  const payload = collectAdminRowFromForm();
  // Validate required fields.
  for (const f of schema.fields) {
    if (!f.required) continue;
    if (f.readonly && !isEdit) continue;
    const val = payload[f.name];
    if (val === null || val === undefined || val === '') {
      showAlert('admin-row-alert', `Il campo "${f.name}" è obbligatorio.`, 'error');
      btn.disabled = false; btn.textContent = 'Salva';
      return;
    }
  }
  let error;
  if (isEdit) {
    const pkVal = adminEditingRow[schema.pk];
    const { error: e } = await sb.from(currentAdminTable).update(payload).eq(schema.pk, pkVal);
    error = e;
  } else {
    const { error: e } = await sb.from(currentAdminTable).insert(payload);
    error = e;
  }
  if (error) {
    showAlert('admin-row-alert', `Errore: ${error.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Salva';
    return;
  }
  btn.disabled = false; btn.textContent = 'Salva';
  closeModal('modal-admin-row');
  await loadAdminTable();
}

async function deleteAdminRow(idx) {
  const row = currentAdminRows[idx];
  if (!row) return;
  const schema = ADMIN_TABLES[currentAdminTable];
  const pkVal = row[schema.pk];
  if (!confirm(`Eliminare questa riga di ${schema.label}?\n\n${schema.pk}: ${pkVal}\n\nAzione NON reversibile.`)) return;
  const { error } = await sb.from(currentAdminTable).delete().eq(schema.pk, pkVal);
  if (error) {
    showAlert('admin-alert', `Errore eliminazione: ${error.message}`, 'error');
    return;
  }
  showAlert('admin-alert', 'Riga eliminata.', 'success');
  await loadAdminTable();
}

// Called by main.js when ?admin=1 is in the URL.
async function initAdminMode() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    // Verify the existing session belongs to an admin.
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (adminRow) {
      currentUser = session.user;
      adminIsAuthenticated = true;
      await enterAdminDashboard();
      return;
    }
    // Session exists but not admin → sign out and show admin login.
    await sb.auth.signOut();
  }
  await showAdminLogin();
}
