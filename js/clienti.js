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

function renderPendingRequests(pending, listRecords, ombs) {
  const container = document.getElementById('pending-container');
  if (!pending.length) { container.innerHTML = '<div class="pending-empty">Nessuna richiesta in attesa ✓</div>'; return; }
  const ombById = {};
  ombs.forEach(o => ombById[o.id] = o);
  container.innerHTML = pending.map(p => {
    const match = calcolaMatch(p, listRecords, ombById);
    const ombPLabel = p.ombrellone_id ? ombById[p.ombrellone_id] : null;

    const conflittoOmb = p.ombrellone_id
      ? listRecords.find(c => c.ombrellone_id === p.ombrellone_id && (c.email || '').toLowerCase() !== (p.email || '').toLowerCase())
      : null;

    const richiedenteInfo = `
      <div style="padding:12px 18px;background:var(--sand);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-light);margin-bottom:8px">Dati del richiedente</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 18px;font-size:13px">
          <div><span style="color:var(--text-light)">Nome:</span> <strong>${p.nome} ${p.cognome}</strong></div>
          <div><span style="color:var(--text-light)">Email:</span> ${p.email}</div>
          <div><span style="color:var(--text-light)">Telefono:</span> ${p.telefono || '–'}</div>
          <div><span style="color:var(--text-light)">Ombrellone richiesto:</span> <strong>${ombPLabel ? 'Fila ' + ombPLabel.fila + ' N°' + ombPLabel.numero : '–'}</strong></div>
        </div>
      </div>`;

    let badge, body, actions;

    if (conflittoOmb) {
      badge = '<span class="match-badge match-parziale">⚠ Ombrellone già assegnato</span>';
      body = `
        <div style="padding:12px 18px;background:var(--yellow-light);border-bottom:1px solid var(--border);font-size:13px">
          <div style="font-weight:600;color:#B07000;margin-bottom:8px">⚠ Questo ombrellone è già assegnato a un altro cliente</div>
          <div style="background:var(--white);padding:10px 12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
            <div><strong>${conflittoOmb.nome} ${conflittoOmb.cognome}</strong></div>
            <div style="color:var(--text-mid);font-size:12px">${conflittoOmb.email || '–'} · ${conflittoOmb.telefono || '–'}</div>
          </div>
          <div style="margin-top:10px;color:var(--text-mid)">Scegli quale cliente mantenere per questo ombrellone:</div>
        </div>`;
      actions = `
        <button class="btn btn-green btn-sm" onclick="approvaConMerge('${p.id}','${conflittoOmb.id}')">Sostituisci con il nuovo</button>
        <button class="btn btn-outline btn-sm" onclick="rifiutaCliente('${p.id}')">Mantieni esistente</button>`;
    } else if (match.tipo === 'completo') {
      badge = '<span class="match-badge match-100">✓ Corrispondenza trovata</span>';
      body = renderMatchFields(p, match.record, ombById);
      actions = `<button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">✓ Approva subito</button>`;
    } else if (match.tipo === 'parziale') {
      badge = '<span class="match-badge match-parziale">⚠ Match parziale</span>';
      body = renderMatchFields(p, match.record, ombById);
      actions = `
        <button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">Approva</button>
        ${match.record ? `<button class="btn btn-outline btn-sm" onclick="approvaConMerge('${p.id}','${match.record.id}')">Approva e aggiorna dati esistenti</button>` : ''}`;
    } else {
      badge = '<span class="match-badge match-nessuno">+ Nuovo cliente</span>';
      body = `<div style="padding:12px 18px;font-size:13px;color:var(--text-light)">
        Il cliente non risulta nell'elenco clienti stagionali. Puoi approvarlo manualmente.
      </div>`;
      actions = `<button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">Approva comunque</button>`;
    }

    return `<div class="match-card">
      <div class="match-card-header">
        <div><strong>${p.nome} ${p.cognome}</strong></div>
        ${badge}
      </div>
      ${richiedenteInfo}
      ${body}
      <div class="match-actions">
        ${actions}
        <button class="btn btn-danger btn-sm" onclick="rifiutaCliente('${p.id}')">Rifiuta</button>
      </div>
    </div>`;
  }).join('');
}

function renderMatchFields(p, csv, ombById) {
  if (!csv) return '';
  const ombP = p.ombrellone_id ? ombById[p.ombrellone_id] : null;
  const ombC = csv.ombrellone_id ? ombById[csv.ombrellone_id] : null;
  const fields = [
    { label: 'Nome', pVal: p.nome, cVal: csv.nome },
    { label: 'Cognome', pVal: p.cognome, cVal: csv.cognome },
    { label: 'Email', pVal: p.email, cVal: csv.email },
    { label: 'Telefono', pVal: p.telefono || '–', cVal: csv.telefono || '–' },
    { label: 'Ombrellone', pVal: ombP ? `Fila ${ombP.fila} N°${ombP.numero}` : '–', cVal: ombC ? `Fila ${ombC.fila} N°${ombC.numero}` : '–' },
  ];
  return `<div style="padding:0 0 0 0">
    <div style="display:grid;grid-template-columns:1fr 1fr;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-light);padding:8px 16px;background:var(--sand);border-bottom:1px solid var(--border)">
      <div>Dati del cliente</div><div>Dati nell'elenco</div>
    </div>
    <div class="match-fields">
      ${fields.map(f => {
        const ok = f.pVal?.toLowerCase() === f.cVal?.toLowerCase();
        return `<div class="match-field ${ok ? 'ok' : 'diff'}">
          <div class="match-field-label">${f.label}</div>
          <div class="match-field-val">👤 ${f.pVal}</div>
        </div>
        <div class="match-field ${ok ? 'ok' : 'diff'}">
          <div class="match-field-label">${f.label} elenco</div>
          <div class="match-field-val">📋 ${f.cVal}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function calcolaMatch(diretta, listRecords, ombById) {
  if (!listRecords.length) return { tipo: 'nessuno', record: null };
  const exact = listRecords.find(c =>
    c.email?.toLowerCase() === diretta.email?.toLowerCase() &&
    (c.ombrellone_id === diretta.ombrellone_id || !c.ombrellone_id)
  );
  if (exact) return { tipo: 'completo', record: exact };
  const partial = listRecords.find(c =>
    c.email?.toLowerCase() === diretta.email?.toLowerCase() ||
    (c.nome?.toLowerCase() === diretta.nome?.toLowerCase() && c.cognome?.toLowerCase() === diretta.cognome?.toLowerCase())
  );
  if (partial) return { tipo: 'parziale', record: partial };
  return { tipo: 'nessuno', record: null };
}

async function approvaCliente(id) {
  await sb.from('clienti_stagionali').update({ approvato: true }).eq('id', id);
  const { data: c } = await sb.from('clienti_stagionali').select('email,nome,cognome,stabilimento_id').eq('id', id).single();
  if (c) {
    const { data: stab } = await sb.from('stabilimenti').select('nome,telefono,email,email_approvazione_oggetto,email_approvazione_testo').eq('id', c.stabilimento_id).single();
    await inviaEmail('approvazione', { email: c.email, nome: c.nome, cognome: c.cognome }, stab);
  }
  await loadManagerData();
}

async function approvaConMerge(direttaId, csvId) {
  const { data: diretta } = await sb.from('clienti_stagionali').select('*').eq('id', direttaId).single();
  if (!diretta) return;
  await sb.from('clienti_stagionali').update({
    user_id: diretta.user_id, approvato: true,
    nome: diretta.nome, cognome: diretta.cognome,
    email: diretta.email, telefono: diretta.telefono,
    ombrellone_id: diretta.ombrellone_id || undefined
  }).eq('id', csvId);
  await sb.from('clienti_stagionali').delete().eq('id', direttaId);
  const { data: stab } = await sb.from('stabilimenti').select('nome,telefono,email,email_approvazione_oggetto,email_approvazione_testo').eq('id', diretta.stabilimento_id).single();
  await inviaEmail('approvazione', { email: diretta.email, nome: diretta.nome, cognome: diretta.cognome }, stab);
  await loadManagerData();
}

async function rifiutaCliente(id) {
  if (!confirm('Vuoi rifiutare questa richiesta di iscrizione?')) return;
  await sb.from('clienti_stagionali').update({ rifiutato: true }).eq('id', id);
  await loadManagerData();
}
