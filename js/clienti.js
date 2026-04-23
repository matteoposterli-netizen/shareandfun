async function loadExcelFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  showAlert('xlsx-alert', '', '');
  let rows;
  try {
    rows = await readExcelFile(file);
  } catch (err) {
    console.error(err);
    showAlert('xlsx-alert', '❌ Impossibile leggere il file Excel. Verifica il formato e riprova.', 'error');
    e.target.value = '';
    return;
  }
  if (rows.length > 1000) {
    showAlert('xlsx-alert', `❌ Il file contiene ${rows.length} righe. Il limite massimo è 1000 righe.`, 'error');
    e.target.value = '';
    return;
  }
  if (!rows.length) {
    showAlert('xlsx-alert', 'Nessuna riga valida trovata. Controlla che il file abbia le intestazioni corrette (scarica il template Excel).', 'error');
    e.target.value = '';
    return;
  }
  xlsxRows = rows;
  renderExcelAnteprima(rows);
  showAlert('xlsx-alert', `✅ ${rows.length} righe caricate dall'Excel`, 'success');
  e.target.value = '';
}

function renderExcelAnteprima(rows) {
  const wrap = document.getElementById('xlsx-preview');
  const actions = document.getElementById('xlsx-actions');
  const ombByKey = {};
  (ombrelloniList || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });
  const clienteByOmb = {};
  (clientiList || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });

  const seenEmails = new Set();
  const seenOmbInFile = new Map();
  rows.forEach((r, i) => {
    const k = `${r.fila}|${r.numero}`;
    if (!seenOmbInFile.has(k)) seenOmbInFile.set(k, []);
    seenOmbInFile.get(k).push(i);
  });

  const statuses = rows.map((r, idx) => {
    const dupOmb = seenOmbInFile.get(`${r.fila}|${r.numero}`);
    if (dupOmb.length > 1 && dupOmb[0] !== idx) {
      return { kind: 'block', label: `ombrellone duplicato (riga ${dupOmb[0] + 2})` };
    }
    const ombExists = !!ombByKey[`${r.fila}|${r.numero}`];
    const email = (r.email || '').trim().toLowerCase();
    const hasClienteFields = !!(r.nome || r.cognome || r.email || r.telefono);
    if (hasClienteFields) {
      if (!email) return { kind: 'block', label: 'email cliente mancante' };
      if (!EMAIL_RE.test(email)) return { kind: 'block', label: 'email non valida' };
      if (seenEmails.has(email)) return { kind: 'block', label: 'email duplicata nel file' };
      seenEmails.add(email);
      const omb = ombByKey[`${r.fila}|${r.numero}`];
      if (omb) {
        const existingCl = clienteByOmb[omb.id];
        if (existingCl && (existingCl.email || '').toLowerCase() !== email) {
          const name = `${existingCl.nome || ''} ${existingCl.cognome || ''}`.trim() || existingCl.email;
          return { kind: 'conflict', label: `sostituirà ${name}` };
        }
      }
    }
    return { kind: ombExists ? 'ok' : 'new', label: ombExists ? (hasClienteFields ? 'ok' : 'solo ombrellone') : 'nuovo' };
  });

  const blocked = statuses.filter(s => s.kind === 'block').length;
  const conflicts = statuses.filter(s => s.kind === 'conflict').length;

  wrap.innerHTML = `
    <div class="csv-preview-wrap">
      <div class="csv-check-all">
        <input type="checkbox" id="xlsx-check-all" onchange="toggleAllExcel(this.checked)" checked>
        <label for="xlsx-check-all">Seleziona tutti (${rows.length - blocked})</label>
        <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          ${blocked ? `<span style="color:var(--red);font-size:12px;font-weight:600">${blocked} non importabili</span>` : ''}
          ${conflicts ? `<span style="color:#B07000;font-size:12px;font-weight:600">${conflicts} conflitti ombrellone</span>` : ''}
        </span>
      </div>
      <div class="csv-row header" style="grid-template-columns:32px 60px 60px 80px 1fr 1fr 100px 120px"><div></div><div>Fila</div><div>N°</div><div>Credito</div><div>Nome cliente</div><div>Email</div><div>Telefono</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const s = statuses[i];
        const badgeColor = s.kind === 'ok' || s.kind === 'new' ? 'var(--green)'
          : s.kind === 'conflict' ? '#B07000'
          : 'var(--red)';
        const attrs = s.kind === 'block' ? 'disabled' : 'checked';
        const nomeStr = `${r.nome || ''} ${r.cognome || ''}`.trim() || '<span style="color:var(--text-light)">–</span>';
        return `
        <div class="csv-row" style="grid-template-columns:32px 60px 60px 80px 1fr 1fr 100px 120px">
          <input type="checkbox" class="xlsx-check" data-idx="${i}" ${attrs} onchange="updateExcelCount()">
          <div>${escapeHtml(r.fila)}</div>
          <div>${r.numero}</div>
          <div>${formatCoin(r.credito)}</div>
          <div>${nomeStr}</div>
          <div>${escapeHtml(r.email) || '<span style="color:var(--text-light)">–</span>'}</div>
          <div>${escapeHtml(r.telefono) || '–'}</div>
          <div style="color:${badgeColor};font-size:11px;font-weight:600">${escapeHtml(s.label)}</div>
        </div>`;
      }).join('')}
    </div>`;
  actions.classList.remove('hidden');
  actions.style.display = 'flex';
  updateExcelCount();
}

function toggleAllExcel(checked) {
  document.querySelectorAll('.xlsx-check:not(:disabled)').forEach(cb => cb.checked = checked);
  updateExcelCount();
}

function updateExcelCount() {
  const total = document.querySelectorAll('.xlsx-check:checked').length;
  document.getElementById('xlsx-count').textContent = `${total} selezionati`;
}

function annullaExcel() {
  xlsxRows = [];
  const prev = document.getElementById('xlsx-preview');
  const actions = document.getElementById('xlsx-actions');
  const file = document.getElementById('xlsx-file');
  if (prev) prev.innerHTML = '';
  if (actions) { actions.classList.add('hidden'); actions.style.display = 'none'; }
  if (file) file.value = '';
  showAlert('xlsx-alert', '', '');
}

async function importaExcel() {
  const selected = [];
  document.querySelectorAll('.xlsx-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(xlsxRows[idx]);
  });
  if (!selected.length) { showAlert('xlsx-alert', 'Seleziona almeno una riga', 'error'); return; }

  const inviaInviti = document.getElementById('xlsx-invia-inviti')?.checked;
  const btn = document.querySelector('#xlsx-actions button');
  if (btn) btn.disabled = true;

  renderProgressInAlert('xlsx-alert', 'Preparazione ombrelloni…', 0, selected.length);

  const ombByKey = {};
  (ombrelloniList || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });

  const ombToUpdate = [];
  const ombToInsert = [];
  for (const r of selected) {
    const existing = ombByKey[`${r.fila}|${r.numero}`];
    if (existing) {
      if (parseFloat(existing.credito_giornaliero) !== r.credito) ombToUpdate.push({ id: existing.id, credito_giornaliero: r.credito });
    } else {
      ombToInsert.push({ stabilimento_id: currentStabilimento.id, fila: r.fila, numero: r.numero, credito_giornaliero: r.credito });
    }
  }

  if (ombToInsert.length) {
    const { data: insertedOmb, error } = await sb.from('ombrelloni').insert(ombToInsert).select('id,fila,numero');
    if (error) { if (btn) btn.disabled = false; showAlert('xlsx-alert', `Errore inserimento ombrelloni: ${error.message}`, 'error'); return; }
    (insertedOmb || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });
  }
  await runWithConcurrency(ombToUpdate, 5, async (u) => {
    await sb.from('ombrelloni').update({ credito_giornaliero: u.credito_giornaliero }).eq('id', u.id);
  });

  const clientiRows = selected.filter(r => r.email && EMAIL_RE.test(r.email));
  const byEmail = new Map();
  for (const r of clientiRows) {
    const k = r.email.trim().toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, r);
  }
  const skipped = clientiRows.length - byEmail.size;
  const ombAggiunti = ombToInsert.length;
  const ombAggiornati = ombToUpdate.length;

  if (!byEmail.size) {
    if (btn) btn.disabled = false;
    await loadManagerData();
    annullaExcel();
    showAlert('xlsx-alert', `✅ Ombrelloni aggiunti: ${ombAggiunti}, aggiornati: ${ombAggiornati}`, 'success');
    return;
  }

  const clienteByOmb = {};
  (clientiList || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });

  const displacedIds = new Set();
  for (const [k, row] of byEmail) {
    const omb = ombByKey[`${row.fila}|${row.numero}`];
    if (!omb) continue;
    const existing = clienteByOmb[omb.id];
    if (existing && (existing.email || '').toLowerCase() !== k) displacedIds.add(existing.id);
  }
  if (displacedIds.size) {
    const { error: dispErr } = await sb.from('clienti_stagionali').update({ ombrellone_id: null }).in('id', [...displacedIds]);
    if (dispErr) { if (btn) btn.disabled = false; showAlert('xlsx-alert', `Errore rimozione precedenti: ${dispErr.message}`, 'error'); return; }
  }

  const emails = [...byEmail.keys()];
  const { data: existingList, error: selErr } = await sb.from('clienti_stagionali')
    .select('id,email,invito_token')
    .eq('stabilimento_id', currentStabilimento.id)
    .in('email', emails);
  if (selErr) { if (btn) btn.disabled = false; showAlert('xlsx-alert', `Errore lettura clienti: ${selErr.message}`, 'error'); return; }
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
    const ombStr = omb ? `Fila ${omb.fila} N°${omb.numero}` : '';
    if (existing) toUpdate.push({ id: existing.id, token: existing.invito_token, row, update: base, ombStr });
    else toInsert.push({ stabilimento_id: currentStabilimento.id, email: row.email, fonte: 'csv', approvato: false, ...base, _row: row, _ombStr: ombStr });
  }

  const targets = [];
  if (toInsert.length) {
    const payload = toInsert.map(({ _row, _ombStr, ...rest }) => rest);
    const { data: inserted, error: insErr } = await sb.from('clienti_stagionali').insert(payload).select('id,email,invito_token');
    if (insErr) { if (btn) btn.disabled = false; showAlert('xlsx-alert', `Errore inserimento clienti: ${insErr.message}`, 'error'); return; }
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
    }, (done, total) => renderProgressInAlert('xlsx-alert', 'Invio email…', done, total));
  }

  if (btn) btn.disabled = false;
  await loadManagerData();
  annullaExcel();

  const parts = [];
  if (ombAggiunti) parts.push(`${ombAggiunti} ombrelloni aggiunti`);
  if (ombAggiornati) parts.push(`${ombAggiornati} ombrelloni aggiornati`);
  parts.push(`${byEmail.size} clienti importati`);
  if (skipped) parts.push(`${skipped} righe saltate (email duplicata)`);
  if (displacedIds.size) parts.push(`${displacedIds.size} clienti precedenti rimossi dall'ombrellone`);
  if (inviaInviti) parts.push(`inviti inviati: ${sent}${failed ? ` · falliti: ${failed}` : ''}`);
  const type = failed ? 'error' : 'success';
  showAlert('xlsx-alert', `${failed ? '⚠️' : '✅'} ${parts.join(' · ')}`, type);
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
