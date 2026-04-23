async function loadCSVClienti(e) {
  const file = e.target.files[0];
  if (!file) return;
  showAlert('csv-clienti-alert', '', '');
  const parsed = await readCSVFile(file, 1);
  if (parsed.length > 1000) {
    showAlert('csv-clienti-alert', `❌ Il file contiene ${parsed.length} righe. Il limite massimo è 1000 righe. Riduci il file e riprova.`, 'error');
    e.target.value = '';
    return;
  }
  const rows = [];
  parsed.forEach(parts => {
    if (parts.length < 4) return;
    const fila = (parts[0] || '').toUpperCase();
    const numero = parseInt(parts[1]);
    const nome = parts[2] || '';
    const cognome = parts[3] || '';
    const telefono = parts[4] || '';
    const email = parts[5] || '';
    if (!fila || !numero || !nome) return;
    rows.push({ fila, numero, nome, cognome, telefono, email });
  });
  if (!rows.length) {
    showAlert('csv-clienti-alert', 'Nessuna riga valida trovata nel CSV', 'error');
    e.target.value = '';
    return;
  }
  csvClientiRows = rows;
  renderCSVAnteprima(rows);
  showAlert('csv-clienti-alert', `✅ ${rows.length} clienti caricati dal CSV`, 'success');
  e.target.value = '';
}

function renderCSVAnteprima(rows) {
  const wrap = document.getElementById('csv-clienti-preview');
  const actions = document.getElementById('csv-invito-actions');
  const ombByKey = {};
  (ombrelloniList || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });
  const clienteByOmb = {};
  (clientiList || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });

  const seenEmails = new Set();
  const seenOmbInCSV = new Map();
  rows.forEach((r, i) => {
    const k = `${r.fila}|${r.numero}`;
    if (!seenOmbInCSV.has(k)) seenOmbInCSV.set(k, []);
    seenOmbInCSV.get(k).push(i);
  });

  const statuses = rows.map((r, idx) => {
    const email = (r.email || '').trim().toLowerCase();
    if (!email) return { kind: 'block', label: 'email mancante' };
    if (!EMAIL_RE.test(email)) return { kind: 'block', label: 'email non valida' };
    if (seenEmails.has(email)) return { kind: 'block', label: 'email duplicata' };
    seenEmails.add(email);

    const omb = ombByKey[`${r.fila}|${r.numero}`];
    if (!omb) return { kind: 'warn', label: 'ombrellone non esiste' };

    const csvDups = seenOmbInCSV.get(`${r.fila}|${r.numero}`);
    if (csvDups.length > 1 && csvDups[0] !== idx) {
      return { kind: 'block', label: `ombrellone duplicato nel CSV (riga ${csvDups[0] + 1})` };
    }

    const existing = clienteByOmb[omb.id];
    if (existing && (existing.email || '').toLowerCase() !== email) {
      const name = `${existing.nome || ''} ${existing.cognome || ''}`.trim() || existing.email;
      return { kind: 'conflict', label: `sostituirà ${name}` };
    }
    return { kind: 'ok', label: 'ok' };
  });

  const blocked = statuses.filter(s => s.kind === 'block').length;
  const warned = statuses.filter(s => s.kind === 'warn').length;
  const conflicts = statuses.filter(s => s.kind === 'conflict').length;

  wrap.innerHTML = `
    <div class="csv-preview-wrap">
      <div class="csv-check-all">
        <input type="checkbox" id="csv-check-all" onchange="toggleAllCSV(this.checked)" checked>
        <label for="csv-check-all">Seleziona tutti (${rows.length - blocked})</label>
        <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          ${blocked ? `<span style="color:var(--red);font-size:12px;font-weight:600">${blocked} non importabili</span>` : ''}
          ${warned ? `<span style="color:#B07000;font-size:12px;font-weight:600">${warned} avvisi</span>` : ''}
          ${conflicts ? `<span style="color:#B07000;font-size:12px;font-weight:600">${conflicts} conflitti ombrellone</span>` : ''}
        </span>
      </div>
      <div class="csv-row header"><div></div><div>Ombrellone</div><div>Nome</div><div>Cognome</div><div>Telefono</div><div>Email</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const s = statuses[i];
        const badgeColor = s.kind === 'ok' ? 'var(--green)'
          : s.kind === 'conflict' ? '#B07000'
          : s.kind === 'warn' ? '#B07000'
          : 'var(--red)';
        const attrs = s.kind === 'block' ? 'disabled' : 'checked';
        return `
        <div class="csv-row">
          <input type="checkbox" class="csv-check" data-idx="${i}" ${attrs} onchange="updateCSVCount()">
          <div>${escapeHtml(r.fila)} ${r.numero}</div>
          <div>${escapeHtml(r.nome)}</div>
          <div>${escapeHtml(r.cognome)}</div>
          <div>${escapeHtml(r.telefono) || '–'}</div>
          <div>${escapeHtml(r.email) || '–'}</div>
          <div style="color:${badgeColor};font-size:11px;font-weight:600">${escapeHtml(s.label)}</div>
        </div>`;
      }).join('')}
    </div>`;
  actions.classList.remove('hidden');
  actions.style.display = 'flex';
  updateCSVCount();
}

function toggleAllCSV(checked) {
  document.querySelectorAll('.csv-check:not(:disabled)').forEach(cb => cb.checked = checked);
  updateCSVCount();
}

function updateCSVCount() {
  const total = document.querySelectorAll('.csv-check:checked').length;
  document.getElementById('csv-invito-count').textContent = `${total} selezionati`;
}

async function importaCSVClienti() {
  const selected = [];
  document.querySelectorAll('.csv-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(csvClientiRows[idx]);
  });
  if (!selected.length) { showAlert('csv-clienti-alert', 'Seleziona almeno una riga', 'error'); return; }

  const byEmail = new Map();
  for (const r of selected) {
    if (!r.email) continue;
    const k = r.email.trim().toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, r);
  }
  const skipped = selected.length - byEmail.size;
  if (!byEmail.size) { showAlert('csv-clienti-alert', 'Nessuna riga con email valida selezionata', 'error'); return; }

  const inviaInviti = document.getElementById('csv-invia-inviti')?.checked;
  const btn = document.querySelector('#csv-invito-actions button');
  if (btn) btn.disabled = true;

  const ombByKey = {};
  (ombrelloniList || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });
  const clienteByOmb = {};
  (clientiList || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });

  renderProgressInAlert('csv-clienti-alert', 'Preparazione…', 0, byEmail.size);

  const displacedIds = new Set();
  for (const [k, row] of byEmail) {
    const omb = ombByKey[`${row.fila}|${row.numero}`];
    if (!omb) continue;
    const existing = clienteByOmb[omb.id];
    if (existing && (existing.email || '').toLowerCase() !== k) displacedIds.add(existing.id);
  }
  if (displacedIds.size) {
    const { error: dispErr } = await sb.from('clienti_stagionali').update({ ombrellone_id: null }).in('id', [...displacedIds]);
    if (dispErr) {
      if (btn) btn.disabled = false;
      showAlert('csv-clienti-alert', `Errore rimozione ombrelloni precedenti: ${dispErr.message}`, 'error');
      return;
    }
  }

  const emails = [...byEmail.keys()];
  const { data: existingList, error: selErr } = await sb.from('clienti_stagionali')
    .select('id,email,invito_token')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('email', emails);
  if (selErr) {
    if (btn) btn.disabled = false;
    showAlert('csv-clienti-alert', `Errore lettura clienti: ${selErr.message}`, 'error');
    return;
  }
  const existingByEmail = new Map();
  (existingList || []).forEach(c => existingByEmail.set((c.email || '').toLowerCase(), c));

  const now = new Date().toISOString();
  const toUpdate = [], toInsert = [];
  for (const [k, row] of byEmail) {
    const omb = ombByKey[`${row.fila}|${row.numero}`];
    const base = {
      nome: row.nome, cognome: row.cognome, telefono: row.telefono,
      ombrellone_id: omb?.id || null,
    };
    if (inviaInviti) base.invitato_at = now;
    const existing = existingByEmail.get(k);
    if (existing) toUpdate.push({ id: existing.id, token: existing.invito_token, row, update: base, ombStr: omb ? `Fila ${omb.fila} N°${omb.numero}` : '' });
    else toInsert.push({ stabilimento_id: currentStabilimento.id, email: row.email, fonte: 'csv', approvato: false, ...base, _row: row, _ombStr: omb ? `Fila ${omb.fila} N°${omb.numero}` : '' });
  }

  const targets = [];
  if (toInsert.length) {
    const payload = toInsert.map(({ _row, _ombStr, ...rest }) => rest);
    const { data: inserted, error: insErr } = await sb.from('clienti_stagionali').insert(payload).select('id,email,invito_token');
    if (insErr) {
      if (btn) btn.disabled = false;
      showAlert('csv-clienti-alert', `Errore inserimento: ${insErr.message}`, 'error');
      return;
    }
    const insByEmail = new Map();
    (inserted || []).forEach(c => insByEmail.set((c.email || '').toLowerCase(), c));
    for (const ti of toInsert) {
      const ins = insByEmail.get((ti.email || '').toLowerCase());
      if (ins?.invito_token) targets.push({ email: ti.email, nome: ti._row.nome, cognome: ti._row.cognome, ombrellone: ti._ombStr, token: ins.invito_token });
    }
  }

  await runWithConcurrency(toUpdate, 5, async (u) => {
    await sb.from('clienti_stagionali').update(u.update).eq('id', u.id);
    if (u.token) targets.push({ email: u.row.email, nome: u.row.nome, cognome: u.row.cognome, ombrellone: u.ombStr, token: u.token });
  });

  let sent = 0, failed = 0;
  if (inviaInviti) {
    await runWithConcurrency(targets, 5, async (t) => {
      const inviteLink = `${window.location.origin}/?invito=${t.token}`;
      const ok = await retryUntilTrue(
        () => inviaEmail('invito', { email: t.email, nome: t.nome, cognome: t.cognome, ombrellone: t.ombrellone, invite_link: inviteLink }, currentStabilimento),
        3, 500
      );
      if (ok) sent++; else failed++;
    }, (done, total) => renderProgressInAlert('csv-clienti-alert', 'Invio email…', done, total));
  }

  if (btn) btn.disabled = false;
  await loadManagerData();
  annullaCSVClienti();

  const parts = [];
  if (skipped) parts.push(`${skipped} righe saltate (email duplicata nel CSV)`);
  if (displacedIds.size) parts.push(`${displacedIds.size} clienti precedenti rimossi dall'ombrellone`);
  if (inviaInviti && failed) parts.push(`${failed} email fallite (vedi console)`);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  const type = failed ? 'error' : 'success';
  const action = inviaInviti
    ? `✅ ${byEmail.size} clienti importati · inviti inviati: ${sent}`
    : `✅ ${byEmail.size} clienti importati`;
  showAlert('csv-clienti-alert', `${failed ? '⚠️' : '✅'} ${action}${suffix}`, type);
}

function annullaCSVClienti() {
  csvClientiRows = [];
  const prev = document.getElementById('csv-clienti-preview');
  const actions = document.getElementById('csv-invito-actions');
  const file = document.getElementById('csv-clienti-file');
  if (prev) prev.innerHTML = '';
  if (actions) { actions.classList.add('hidden'); actions.style.display = 'none'; }
  if (file) file.value = '';
}

function openBulkInviteModal() {
  if (!selectedClienteIds.size) return;
  bulkInviteTargets = clientiList.filter(c => selectedClienteIds.has(c.id) && !c.user_id && c.invito_token);
  const skipped = selectedClienteIds.size - bulkInviteTargets.length;

  const listEl = document.getElementById('bulk-dest-list');
  listEl.innerHTML = bulkInviteTargets.length
    ? bulkInviteTargets.map(c => `<div>• ${escapeHtml(c.nome || '')} ${escapeHtml(c.cognome || '')} — ${escapeHtml(c.email || '')}</div>`).join('')
    : '<div style="color:var(--red)">Nessun destinatario valido selezionato.</div>';
  document.getElementById('bulk-dest-count').textContent = bulkInviteTargets.length;

  document.getElementById('bulk-invite-oggetto').value = currentStabilimento?.email_invito_oggetto || '';
  document.getElementById('bulk-invite-testo').value = currentStabilimento?.email_invito_testo || '';
  document.getElementById('bulk-invite-save-template').checked = false;
  showAlert('bulk-invite-alert', skipped ? `⚠ ${skipped} clienti saltati (già attivi o senza token)` : '', skipped ? 'error' : '');

  const btn = document.getElementById('btn-bulk-invite');
  btn.disabled = !bulkInviteTargets.length;
  btn.textContent = `Invia a ${bulkInviteTargets.length} clienti`;

  document.getElementById('modal-bulk-invite').classList.remove('hidden');
}

async function confirmBulkInvite() {
  if (!bulkInviteTargets.length) return;
  const oggetto = document.getElementById('bulk-invite-oggetto').value.trim();
  const testo = document.getElementById('bulk-invite-testo').value.trim();
  const saveTemplate = document.getElementById('bulk-invite-save-template').checked;

  const btn = document.getElementById('btn-bulk-invite');
  btn.disabled = true;
  btn.textContent = 'Invio…';

  if (saveTemplate) {
    const { error } = await sb.from('stabilimenti').update({
      email_invito_oggetto: oggetto,
      email_invito_testo: testo,
    }).eq('id', currentStabilimento.id);
    if (error) {
      showAlert('bulk-invite-alert', `Errore salvataggio template: ${error.message}`, 'error');
      btn.disabled = false;
      btn.textContent = `Invia a ${bulkInviteTargets.length} clienti`;
      return;
    }
    currentStabilimento.email_invito_oggetto = oggetto;
    currentStabilimento.email_invito_testo = testo;
  }

  const ombById = {};
  (ombrelloniList || []).forEach(o => ombById[o.id] = o);
  renderProgressInAlert('bulk-invite-alert', 'Invio email…', 0, bulkInviteTargets.length);

  let sent = 0, failed = 0;
  const now = new Date().toISOString();
  await runWithConcurrency(bulkInviteTargets, 5, async (c) => {
    const omb = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
    const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : '';
    const inviteLink = `${window.location.origin}/?invito=${c.invito_token}`;
    const ok = await retryUntilTrue(
      () => inviaEmail('invito',
        { email: c.email, nome: c.nome, cognome: c.cognome, ombrellone: ombStr, invite_link: inviteLink },
        currentStabilimento,
        { oggetto, testo }
      ),
      3, 500
    );
    if (ok) { sent++; await sb.from('clienti_stagionali').update({ invitato_at: now }).eq('id', c.id); }
    else failed++;
  }, (done, total) => renderProgressInAlert('bulk-invite-alert', 'Invio email…', done, total));

  btn.disabled = false;
  btn.textContent = `Invia a ${bulkInviteTargets.length} clienti`;
  if (!failed) {
    closeModal('modal-bulk-invite');
    selectedClienteIds.clear();
    await loadManagerData();
  } else {
    showAlert('bulk-invite-alert', `⚠ ${sent} inviati, ${failed} falliti. Vedi console.`, 'error');
    await loadManagerData();
  }
}
