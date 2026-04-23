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
  const known = new Set((ombrelloniList || []).map(o => `${o.fila}|${o.numero}`));
  const seenEmails = new Set();
  const statuses = rows.map(r => {
    const email = (r.email || '').trim().toLowerCase();
    if (!email) return { kind: 'block', label: 'email mancante' };
    if (!EMAIL_RE.test(email)) return { kind: 'block', label: 'email non valida' };
    if (seenEmails.has(email)) return { kind: 'block', label: 'email duplicata' };
    seenEmails.add(email);
    if (!known.has(`${r.fila}|${r.numero}`)) return { kind: 'warn', label: 'ombrellone non esiste' };
    return { kind: 'ok', label: 'ok' };
  });
  const blocked = statuses.filter(s => s.kind === 'block').length;
  const warned = statuses.filter(s => s.kind === 'warn').length;
  wrap.innerHTML = `
    <div class="csv-preview-wrap">
      <div class="csv-check-all">
        <input type="checkbox" id="csv-check-all" onchange="toggleAllCSV(this.checked)" checked>
        <label for="csv-check-all">Seleziona tutti (${rows.length - blocked})</label>
        ${blocked ? `<span style="color:var(--red);font-size:12px;font-weight:600;margin-left:auto">${blocked} non invitabili</span>` : ''}
        ${warned ? `<span style="color:#B07000;font-size:12px;font-weight:600;margin-left:${blocked?'8px':'auto'}">${warned} con avviso</span>` : ''}
      </div>
      <div class="csv-row header"><div></div><div>Ombrellone</div><div>Nome</div><div>Cognome</div><div>Telefono</div><div>Email</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const s = statuses[i];
        const badgeColor = s.kind === 'ok' ? 'var(--green)' : s.kind === 'warn' ? '#B07000' : 'var(--red)';
        const attrs = s.kind === 'block' ? 'disabled' : 'checked';
        return `
        <div class="csv-row">
          <input type="checkbox" class="csv-check" data-idx="${i}" ${attrs} onchange="updateCSVCount()">
          <div>${escapeHtml(r.fila)} ${r.numero}</div>
          <div>${escapeHtml(r.nome)}</div>
          <div>${escapeHtml(r.cognome)}</div>
          <div>${escapeHtml(r.telefono) || '–'}</div>
          <div>${escapeHtml(r.email) || '–'}</div>
          <div style="color:${badgeColor};font-size:11px;font-weight:600">${s.label}</div>
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

async function inviaInvitiSelezionati() {
  const selected = [];
  document.querySelectorAll('.csv-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(csvClientiRows[idx]);
  });
  if (!selected.length) { showAlert('csv-clienti-alert', 'Seleziona almeno un cliente', 'error'); return; }

  const byEmail = new Map();
  for (const r of selected) {
    if (!r.email) continue;
    const k = r.email.trim().toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, r);
  }
  const skipped = selected.length - byEmail.size;
  if (!byEmail.size) { showAlert('csv-clienti-alert', 'Nessun cliente con email valida selezionato', 'error'); return; }

  const btn = document.querySelector('#csv-invito-actions button');
  if (btn) btn.disabled = true;

  const ombByKey = {};
  ombrelloniList.forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });

  renderProgressInAlert('csv-clienti-alert', 'Preparazione…', 0, byEmail.size);

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
      ombrellone_id: omb?.id || null, invitato_at: now,
    };
    const existing = existingByEmail.get(k);
    if (existing) toUpdate.push({ id: existing.id, token: existing.invito_token, row, update: base });
    else toInsert.push({ stabilimento_id: currentStabilimento.id, email: row.email, fonte: 'csv', approvato: false, ...base });
  }

  const targets = [];
  if (toInsert.length) {
    const { data: inserted, error: insErr } = await sb.from('clienti_stagionali')
      .insert(toInsert)
      .select('id,email,invito_token');
    if (insErr) {
      if (btn) btn.disabled = false;
      showAlert('csv-clienti-alert', `Errore inserimento: ${insErr.message}`, 'error');
      return;
    }
    const insByEmail = new Map();
    (inserted || []).forEach(c => insByEmail.set((c.email || '').toLowerCase(), c));
    for (const [k, row] of byEmail) {
      const ins = insByEmail.get(k);
      if (ins?.invito_token) targets.push({ email: row.email, nome: row.nome, cognome: row.cognome, token: ins.invito_token });
    }
  }

  await runWithConcurrency(toUpdate, 5, async (u) => {
    await sb.from('clienti_stagionali').update(u.update).eq('id', u.id);
    if (u.token) targets.push({ email: u.row.email, nome: u.row.nome, cognome: u.row.cognome, token: u.token });
  });

  let sent = 0, failed = 0;
  await runWithConcurrency(targets, 5, async (t) => {
    const inviteLink = `${window.location.origin}/?invito=${t.token}`;
    const ok = await retryUntilTrue(
      () => inviaEmail('invito', { email: t.email, nome: t.nome, cognome: t.cognome, invite_link: inviteLink }, currentStabilimento),
      3, 500
    );
    if (ok) sent++; else failed++;
  }, (done, total) => renderProgressInAlert('csv-clienti-alert', 'Invio email…', done, total));

  if (btn) btn.disabled = false;
  await loadManagerData();
  const parts = [];
  if (skipped) parts.push(`${skipped} saltati nel CSV`);
  if (failed) parts.push(`${failed} email fallite (vedi console)`);
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  const type = failed ? 'error' : 'success';
  showAlert('csv-clienti-alert', `${failed ? '⚠️' : '✅'} Inviti inviati a ${sent} clienti${suffix}`, type);
}

