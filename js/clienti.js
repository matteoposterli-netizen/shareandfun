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

function fieldDiffHtml(label, before, after) {
  const b = (before == null ? '' : String(before)).trim();
  const a = (after == null ? '' : String(after)).trim();
  if (b === a) return '';
  const beforeStr = b || '∅';
  const afterStr = a || '∅';
  return `<div style="font-size:11px;line-height:1.4"><span style="color:var(--text-light)">${escapeHtml(label)}:</span> <span style="text-decoration:line-through;color:var(--text-light)">${escapeHtml(beforeStr)}</span> → <span style="color:#B07000;font-weight:600">${escapeHtml(afterStr)}</span></div>`;
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
      return { kind: 'block', label: `ombrellone duplicato (riga ${dupOmb[0] + 2})`, diffs: [], requiresExplicit: false };
    }
    const omb = ombByKey[`${r.fila}|${r.numero}`];
    const ombExists = !!omb;
    const email = (r.email || '').trim().toLowerCase();
    const hasClienteFields = !!(r.nome || r.cognome || r.email || r.telefono);

    if (hasClienteFields) {
      if (!email) return { kind: 'block', label: 'email cliente mancante', diffs: [], requiresExplicit: false };
      if (!EMAIL_RE.test(email)) return { kind: 'block', label: 'email non valida', diffs: [], requiresExplicit: false };
      if (seenEmails.has(email)) return { kind: 'block', label: 'email duplicata nel file', diffs: [], requiresExplicit: false };
      seenEmails.add(email);
    }

    const diffs = [];
    let requiresExplicit = false;
    let kind = ombExists ? 'ok' : 'new';
    let label = ombExists ? (hasClienteFields ? 'aggiorna' : 'solo ombrellone') : 'nuovo';

    if (ombExists) {
      const existingCredito = parseFloat(omb.credito_giornaliero);
      if (!isNaN(existingCredito) && existingCredito !== r.credito) {
        diffs.push(fieldDiffHtml('Credito', existingCredito.toFixed(2), r.credito.toFixed(2)));
      }
      if (hasClienteFields) {
        const existingCl = clienteByOmb[omb.id];
        if (existingCl && (existingCl.email || '').toLowerCase() !== email) {
          const name = `${existingCl.nome || ''} ${existingCl.cognome || ''}`.trim() || existingCl.email;
          kind = 'conflict';
          label = `sostituirà ${name}`;
          if (existingCl.user_id) {
            requiresExplicit = true;
            label = `sostituirà ${name} (CLIENTE ATTIVO)`;
          }
          diffs.push(fieldDiffHtml('Email cliente', existingCl.email, email));
          if ((existingCl.nome || '') !== (r.nome || '')) diffs.push(fieldDiffHtml('Nome', existingCl.nome, r.nome));
          if ((existingCl.cognome || '') !== (r.cognome || '')) diffs.push(fieldDiffHtml('Cognome', existingCl.cognome, r.cognome));
          if ((existingCl.telefono || '') !== (r.telefono || '')) diffs.push(fieldDiffHtml('Telefono', existingCl.telefono, r.telefono));
        } else if (existingCl && (existingCl.email || '').toLowerCase() === email) {
          if ((existingCl.nome || '') !== (r.nome || '')) diffs.push(fieldDiffHtml('Nome', existingCl.nome, r.nome));
          if ((existingCl.cognome || '') !== (r.cognome || '')) diffs.push(fieldDiffHtml('Cognome', existingCl.cognome, r.cognome));
          if ((existingCl.telefono || '') !== (r.telefono || '')) diffs.push(fieldDiffHtml('Telefono', existingCl.telefono, r.telefono));
          if (existingCl.user_id && diffs.length) {
            requiresExplicit = true;
            label = 'aggiorna (CLIENTE ATTIVO)';
          } else if (diffs.length) {
            label = 'aggiorna cliente';
          } else {
            label = 'nessuna modifica';
          }
        } else if (!existingCl) {
          label = 'aggiunge cliente';
        }
      } else if (diffs.length) {
        label = 'aggiorna credito';
      } else {
        label = 'nessuna modifica';
      }
    }
    return { kind, label, diffs: diffs.filter(Boolean), requiresExplicit };
  });

  const blocked = statuses.filter(s => s.kind === 'block').length;
  const conflicts = statuses.filter(s => s.kind === 'conflict').length;
  const explicits = statuses.filter(s => s.requiresExplicit).length;

  // DB rows missing from file: candidate deletions
  const fileKeys = new Set(rows.map(r => `${r.fila}|${r.numero}`));
  const missing = (ombrelloniList || []).filter(o => !fileKeys.has(`${o.fila}|${o.numero}`));

  wrap.innerHTML = `
    <div class="csv-preview-wrap">
      <div class="csv-check-all">
        <input type="checkbox" id="xlsx-check-all" onchange="toggleAllExcel(this.checked)">
        <label for="xlsx-check-all">Seleziona tutte le righe importabili</label>
        <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          ${blocked ? `<span style="color:var(--red);font-size:12px;font-weight:600">${blocked} non importabili</span>` : ''}
          ${conflicts ? `<span style="color:#B07000;font-size:12px;font-weight:600">${conflicts} conflitti cliente</span>` : ''}
          ${explicits ? `<span style="color:var(--red);font-size:12px;font-weight:600">${explicits} clienti attivi (conferma esplicita)</span>` : ''}
        </span>
      </div>
      <div class="csv-row header" style="grid-template-columns:32px 60px 60px 1fr 1fr 1fr 160px"><div></div><div>Fila</div><div>N°</div><div>Cliente</div><div>Email</div><div>Modifiche</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const s = statuses[i];
        const badgeColor = s.kind === 'ok' || s.kind === 'new' ? 'var(--green)'
          : s.kind === 'conflict' ? '#B07000'
          : 'var(--red)';
        const disabled = s.kind === 'block';
        const checked = !disabled && !s.requiresExplicit;
        const attrs = `${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''}`;
        const nomeStr = `${r.nome || ''} ${r.cognome || ''}`.trim() || '<span style="color:var(--text-light)">–</span>';
        const diffStr = s.diffs.length ? s.diffs.join('') : '<span style="color:var(--text-light);font-size:11px">–</span>';
        return `
        <div class="csv-row" style="grid-template-columns:32px 60px 60px 1fr 1fr 1fr 160px;align-items:start">
          <input type="checkbox" class="xlsx-check" data-idx="${i}" ${attrs} onchange="updateExcelCount()">
          <div>${escapeHtml(r.fila)}</div>
          <div>${r.numero}</div>
          <div>${nomeStr}</div>
          <div>${escapeHtml(r.email) || '<span style="color:var(--text-light)">–</span>'}</div>
          <div>${diffStr}</div>
          <div style="color:${badgeColor};font-size:11px;font-weight:600">${escapeHtml(s.label)}</div>
        </div>`;
      }).join('')}
      ${missing.length ? `
        <div class="section-divider" style="margin-top:18px">🗑 Righe in DB non presenti nel file (${missing.length})</div>
        <div style="font-size:12px;color:var(--text-mid);margin:0 0 8px">
          Spunta gli ombrelloni che vuoi <strong>cancellare</strong>. La cancellazione rimuove anche cliente assegnato, disponibilità e transazioni storiche collegate. Default: nessuna cancellazione.
        </div>
        <div class="csv-row header" style="grid-template-columns:32px 60px 60px 1fr 1fr 160px"><div></div><div>Fila</div><div>N°</div><div>Cliente attuale</div><div>Storico</div><div>Azione</div></div>
        ${missing.map(o => {
          const cl = clienteByOmb[o.id];
          const cliStr = cl ? `${cl.nome || ''} ${cl.cognome || ''}`.trim() + (cl.email ? ` <span style="color:var(--text-light);font-size:11px">${escapeHtml(cl.email)}</span>` : '') + (cl.user_id ? ' <span style="color:var(--red);font-size:10px;font-weight:700">[ATTIVO]</span>' : '') : '<span style="color:var(--text-light)">–</span>';
          return `
          <div class="csv-row" style="grid-template-columns:32px 60px 60px 1fr 1fr 160px;align-items:start">
            <input type="checkbox" class="xlsx-delete" data-omb-id="${o.id}" data-cli-id="${cl?.id || ''}" data-cli-active="${cl?.user_id ? '1' : '0'}" onchange="updateExcelCount()">
            <div>${escapeHtml(o.fila)}</div>
            <div>${o.numero}</div>
            <div>${cliStr}</div>
            <div style="font-size:11px;color:var(--text-light)">credito ${formatCoin(o.credito_giornaliero)}</div>
            <div style="color:var(--red);font-size:11px;font-weight:600">candidato cancellazione</div>
          </div>`;
        }).join('')}
      ` : ''}
    </div>`;

  const allBox = document.getElementById('xlsx-check-all');
  if (allBox) allBox.checked = statuses.some(s => s.kind !== 'block' && !s.requiresExplicit);

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
  const dels = document.querySelectorAll('.xlsx-delete:checked').length;
  const parts = [`${total} import${total === 1 ? 'azione' : 'azioni'}`];
  if (dels) parts.push(`${dels} cancellazion${dels === 1 ? 'e' : 'i'}`);
  document.getElementById('xlsx-count').textContent = parts.join(' · ');
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

let pendingImportPlan = null;

async function importaExcel() {
  const selected = [];
  document.querySelectorAll('.xlsx-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(xlsxRows[idx]);
  });

  const ombDeleteIds = [];
  const cliDeleteIds = [];
  let activeDeletions = 0;
  document.querySelectorAll('.xlsx-delete:checked').forEach(cb => {
    ombDeleteIds.push(cb.dataset.ombId);
    if (cb.dataset.cliId) cliDeleteIds.push(cb.dataset.cliId);
    if (cb.dataset.cliActive === '1') activeDeletions++;
  });

  if (!selected.length && !ombDeleteIds.length) {
    showAlert('xlsx-alert', 'Seleziona almeno una riga da importare o cancellare', 'error'); return;
  }

  // Compute counts for the summary
  const ombByKey = {};
  (ombrelloniList || []).forEach(o => { ombByKey[`${o.fila}|${o.numero}`] = o; });
  const clienteByOmb = {};
  (clientiList || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });
  const clienteByEmail = {};
  (clientiList || []).forEach(c => { if (c.email) clienteByEmail[c.email.toLowerCase()] = c; });

  let ombNew = 0, ombCreditUpdate = 0;
  let cliNew = 0, cliUpdate = 0, cliReplace = 0, cliActiveTouched = 0;
  for (const r of selected) {
    const existing = ombByKey[`${r.fila}|${r.numero}`];
    if (!existing) ombNew++;
    else if (parseFloat(existing.credito_giornaliero) !== r.credito) ombCreditUpdate++;

    const email = (r.email || '').trim().toLowerCase();
    if (!email) continue;
    const existingCl = existing ? clienteByOmb[existing.id] : null;
    if (existingCl && existingCl.email && existingCl.email.toLowerCase() !== email) {
      cliReplace++;
      if (existingCl.user_id) cliActiveTouched++;
    } else {
      const sameEmail = clienteByEmail[email];
      if (sameEmail) {
        cliUpdate++;
        if (sameEmail.user_id) cliActiveTouched++;
      } else {
        cliNew++;
      }
    }
  }

  // Fetch storico impact for deletions
  let txImpact = 0, dispImpact = 0;
  if (ombDeleteIds.length) {
    const [{ count: tc }, { count: dc }] = await Promise.all([
      sb.from('transazioni').select('id', { count: 'exact', head: true }).in('ombrellone_id', ombDeleteIds),
      sb.from('disponibilita').select('id', { count: 'exact', head: true }).in('ombrellone_id', ombDeleteIds),
    ]);
    txImpact = tc || 0;
    dispImpact = dc || 0;
  }
  if (cliDeleteIds.length) {
    const { count: tcc } = await sb.from('transazioni').select('id', { count: 'exact', head: true }).in('cliente_id', cliDeleteIds);
    txImpact += tcc || 0;
  }

  const inviaInviti = document.getElementById('xlsx-invia-inviti')?.checked;
  pendingImportPlan = { selected, ombDeleteIds, cliDeleteIds, inviaInviti };

  // Build summary HTML
  const lines = [];
  if (ombNew) lines.push(`☂️ <strong>${ombNew}</strong> nuovi ombrelloni`);
  if (ombCreditUpdate) lines.push(`💰 <strong>${ombCreditUpdate}</strong> ombrelloni con credito aggiornato`);
  if (cliNew) lines.push(`👤 <strong>${cliNew}</strong> nuovi clienti`);
  if (cliUpdate) lines.push(`✏️ <strong>${cliUpdate}</strong> clienti aggiornati`);
  if (cliReplace) lines.push(`🔄 <strong>${cliReplace}</strong> clienti sostituiti su ombrellone`);
  if (cliActiveTouched) lines.push(`<span style="color:var(--red)">⚠️ <strong>${cliActiveTouched}</strong> clienti già attivi (con login) verranno modificati</span>`);
  if (ombDeleteIds.length) lines.push(`<span style="color:var(--red)">🗑 <strong>${ombDeleteIds.length}</strong> ombrelloni cancellati</span>`);
  if (cliDeleteIds.length) lines.push(`<span style="color:var(--red)">🗑 <strong>${cliDeleteIds.length}</strong> clienti cancellati (insieme agli ombrelloni)</span>`);
  if (activeDeletions) lines.push(`<span style="color:var(--red)">⚠️ <strong>${activeDeletions}</strong> clienti attivi (con login) verranno cancellati</span>`);
  if (txImpact) lines.push(`<span style="color:var(--red)">📊 <strong>${txImpact}</strong> transazioni dello storico verranno rimosse</span>`);
  if (dispImpact) lines.push(`<span style="color:var(--red)">📅 <strong>${dispImpact}</strong> disponibilità future/passate verranno rimosse</span>`);
  if (!lines.length) lines.push('Nessuna modifica rilevata.');

  document.getElementById('import-confirm-summary').innerHTML = lines.map(l => `<div style="margin:6px 0">${l}</div>`).join('');
  document.getElementById('import-confirm-warning').style.display =
    (ombDeleteIds.length || cliDeleteIds.length || cliActiveTouched || activeDeletions) ? 'block' : 'none';

  document.getElementById('modal-import-confirm').classList.remove('hidden');
}

async function confirmImportaExcelExecute() {
  if (!pendingImportPlan) return;
  const { selected, ombDeleteIds, cliDeleteIds, inviaInviti } = pendingImportPlan;
  closeModal('modal-import-confirm');

  const btn = document.querySelector('#xlsx-actions button');
  if (btn) btn.disabled = true;

  // Timestamp per aggregare i log per-riga di questo import in un unico evento.
  const auditSince = new Date().toISOString();

  // ============ CASCADE DELETIONS (best-effort sequenziale) ============
  let deletedOmb = 0, deletedCli = 0, deletedTx = 0, deletedDisp = 0;
  let deleteErrors = [];
  if (ombDeleteIds.length) {
    renderProgressInAlert('xlsx-alert', 'Cancellazione storico…', 0, ombDeleteIds.length);
    // 1. Delete transazioni linked to ombrelloni
    const txOmb = await sb.from('transazioni').delete({ count: 'exact' }).in('ombrellone_id', ombDeleteIds);
    if (txOmb.error) deleteErrors.push(`transazioni(ombrellone): ${txOmb.error.message}`);
    else deletedTx += txOmb.count || 0;
    // 2. Delete transazioni linked to clienti about to be removed
    if (cliDeleteIds.length) {
      const txCli = await sb.from('transazioni').delete({ count: 'exact' }).in('cliente_id', cliDeleteIds);
      if (txCli.error) deleteErrors.push(`transazioni(cliente): ${txCli.error.message}`);
      else deletedTx += txCli.count || 0;
    }
    // 3. Delete disponibilita
    const dd = await sb.from('disponibilita').delete({ count: 'exact' }).in('ombrellone_id', ombDeleteIds);
    if (dd.error) deleteErrors.push(`disponibilita: ${dd.error.message}`);
    else deletedDisp += dd.count || 0;
    // 4. Delete clienti
    if (cliDeleteIds.length) {
      const cd = await sb.from('clienti_stagionali').delete({ count: 'exact' }).in('id', cliDeleteIds);
      if (cd.error) deleteErrors.push(`clienti: ${cd.error.message}`);
      else deletedCli += cd.count || 0;
    }
    // 5. Delete ombrelloni
    const od = await sb.from('ombrelloni').delete({ count: 'exact' }).in('id', ombDeleteIds);
    if (od.error) deleteErrors.push(`ombrelloni: ${od.error.message}`);
    else deletedOmb += od.count || 0;
  }

  if (deleteErrors.length) {
    if (btn) btn.disabled = false;
    await loadManagerData();
    showAlert('xlsx-alert', `❌ Errori cancellazione: ${deleteErrors.join(' · ')}`, 'error');
    return;
  }

  // ============ UPSERTS (logica esistente) ============
  if (!selected.length) {
    await coalesceImportAudit(auditSince, {
      ombAggiunti: 0, ombAggiornati: 0, clientiImportati: 0,
      invitiInviati: 0, invitiFalliti: 0, invitiAttesi: false,
      deletedOmb, deletedCli, deletedTx, deletedDisp,
    });
    if (btn) btn.disabled = false;
    await loadManagerData();
    annullaExcel();
    const parts = [];
    if (deletedOmb) parts.push(`${deletedOmb} ombrelloni cancellati`);
    if (deletedCli) parts.push(`${deletedCli} clienti cancellati`);
    if (deletedTx) parts.push(`${deletedTx} transazioni rimosse`);
    if (deletedDisp) parts.push(`${deletedDisp} disponibilità rimosse`);
    showAlert('xlsx-alert', `✅ ${parts.join(' · ') || 'Nessuna modifica'}`, 'success');
    return;
  }

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
    await coalesceImportAudit(auditSince, {
      ombAggiunti, ombAggiornati, clientiImportati: 0,
      invitiInviati: 0, invitiFalliti: 0, invitiAttesi: false,
      deletedOmb, deletedCli, deletedTx, deletedDisp,
    });
    if (btn) btn.disabled = false;
    await loadManagerData();
    annullaExcel();
    const partsNoCli = [];
    if (deletedOmb) partsNoCli.push(`${deletedOmb} ombrelloni cancellati`);
    if (deletedCli) partsNoCli.push(`${deletedCli} clienti cancellati`);
    if (deletedTx) partsNoCli.push(`${deletedTx} transazioni rimosse`);
    if (deletedDisp) partsNoCli.push(`${deletedDisp} disponibilità rimosse`);
    if (ombAggiunti) partsNoCli.push(`${ombAggiunti} ombrelloni aggiunti`);
    if (ombAggiornati) partsNoCli.push(`${ombAggiornati} ombrelloni aggiornati`);
    showAlert('xlsx-alert', `✅ ${partsNoCli.join(' · ') || 'Nessuna modifica'}`, 'success');
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

  await coalesceImportAudit(auditSince, {
    ombAggiunti, ombAggiornati, clientiImportati: byEmail.size,
    invitiInviati: sent, invitiFalliti: failed, invitiAttesi: !!inviaInviti,
    displaced: displacedIds.size, skipped,
    deletedOmb, deletedCli, deletedTx, deletedDisp,
  });

  if (btn) btn.disabled = false;
  await loadManagerData();
  annullaExcel();

  const parts = [];
  if (deletedOmb) parts.push(`${deletedOmb} ombrelloni cancellati`);
  if (deletedCli) parts.push(`${deletedCli} clienti cancellati`);
  if (deletedTx) parts.push(`${deletedTx} transazioni rimosse`);
  if (deletedDisp) parts.push(`${deletedDisp} disponibilità rimosse`);
  if (ombAggiunti) parts.push(`${ombAggiunti} ombrelloni aggiunti`);
  if (ombAggiornati) parts.push(`${ombAggiornati} ombrelloni aggiornati`);
  parts.push(`${byEmail.size} clienti importati`);
  if (skipped) parts.push(`${skipped} righe saltate (email duplicata)`);
  if (displacedIds.size) parts.push(`${displacedIds.size} clienti precedenti rimossi dall'ombrellone`);
  if (inviaInviti) parts.push(`inviti inviati: ${sent}${failed ? ` · falliti: ${failed}` : ''}`);
  const type = failed ? 'error' : 'success';
  showAlert('xlsx-alert', `${failed ? '⚠️' : '✅'} ${parts.join(' · ')}`, type);
}

async function coalesceImportAudit(sinceIso, info) {
  if (!currentStabilimento?.id) return;
  const parts = [];
  if (info.deletedOmb)        parts.push(`${info.deletedOmb} ombrelloni cancellati`);
  if (info.deletedCli)        parts.push(`${info.deletedCli} clienti cancellati`);
  if (info.deletedTx)         parts.push(`${info.deletedTx} transazioni rimosse`);
  if (info.deletedDisp)       parts.push(`${info.deletedDisp} disponibilità rimosse`);
  if (info.ombAggiunti)       parts.push(`${info.ombAggiunti} ombrelloni aggiunti`);
  if (info.ombAggiornati)     parts.push(`${info.ombAggiornati} ombrelloni aggiornati`);
  if (info.clientiImportati)  parts.push(`${info.clientiImportati} clienti importati`);
  if (info.displaced)         parts.push(`${info.displaced} clienti rimossi dall'ombrellone precedente`);
  if (info.skipped)           parts.push(`${info.skipped} righe saltate`);
  if (info.invitiAttesi)      parts.push(`${info.invitiInviati} inviti inviati${info.invitiFalliti ? ` (${info.invitiFalliti} falliti)` : ''}`);
  const summary = 'Import Excel: ' + (parts.length ? parts.join(' · ') : 'nessuna modifica');
  try {
    await sb.rpc('audit_coalesce_import', {
      p_stabilimento_id: currentStabilimento.id,
      p_since: sinceIso,
      p_summary: summary,
      p_metadata: info,
    });
  } catch (e) { console.error('audit coalesce import failed', e); }
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

  document.getElementById('bulk-invite-oggetto').value = currentStabilimento?.email_invito_oggetto || DEFAULT_EMAIL_TEMPLATES?.invito_oggetto || '';
  document.getElementById('bulk-invite-testo').value = currentStabilimento?.email_invito_testo || DEFAULT_EMAIL_TEMPLATES?.invito_testo || '';
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
