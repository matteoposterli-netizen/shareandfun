// js/reset-stagione.js — Reset stagione + backup ripristinabili
//
// UI in Configurazioni → Stagione: card "Reset stagione" + lista backup.
// Tutte le mutazioni passano dalle RPC SECURITY DEFINER:
//   * crea_backup_stagione(stabilimento_id, etichetta?)
//   * reset_stagione(stabilimento_id, mantieni_cb)
//   * ripristina_backup(backup_id)
// Backup salvati in `stagioni_backup` con cap FIFO 10 per stabilimento.

let resetTipoCorrente = 'mantieni'; // 'mantieni' | 'totale'
let restoreBackupCorrente = null;   // { id, created_at, etichetta } | null
let backupListCache = [];           // cached server response, indicizzato lato JS

/* ---------- Lista backup ---------- */

async function loadBackupList() {
  const el = document.getElementById('backup-list');
  if (!el || !currentStabilimento) return;
  el.innerHTML = '<div style="font-size:13px;color:var(--text-light);padding:12px 0">Caricamento…</div>';
  const { data, error } = await sb.from('stagioni_backup')
    .select('id, etichetta, created_at, payload')
    .eq('stabilimento_id', currentStabilimento.id)
    .order('created_at', { ascending: false });
  if (error) {
    el.innerHTML = `<div class="alert alert-coral">Errore: ${escapeHtml(error.message)}</div>`;
    return;
  }
  backupListCache = data || [];
  if (backupListCache.length === 0) {
    el.innerHTML = '<div class="backup-empty">Nessun backup disponibile.</div>';
    return;
  }
  el.innerHTML = backupListCache.map(b => {
    const counts = backupCounts(b.payload);
    const created = new Date(b.created_at);
    const dateStr = created.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="backup-row">
      <div class="backup-row-info">
        <div class="backup-row-title">${escapeHtml(b.etichetta || 'Backup')}</div>
        <div class="backup-row-meta">${dateStr} · ${counts.clienti} clienti · ${counts.ombrelloni} ombrelloni · ${counts.disponibilita} disponibilità · ${counts.transazioni} transazioni</div>
      </div>
      <div class="backup-row-actions">
        <button class="btn btn-outline btn-sm" onclick="scaricaBackupJson('${b.id}')">📥 JSON</button>
        <button class="btn btn-primary btn-sm" onclick="apriRipristinoModal('${b.id}')">♻️ Ripristina</button>
      </div>
    </div>`;
  }).join('');
}

function backupCounts(payload) {
  const safe = (k) => Array.isArray(payload?.[k]) ? payload[k].length : 0;
  return {
    clienti: safe('clienti_stagionali'),
    ombrelloni: safe('ombrelloni'),
    disponibilita: safe('disponibilita'),
    transazioni: safe('transazioni'),
  };
}

/* ---------- Backup manuale ---------- */

async function creaBackupManuale() {
  if (!currentStabilimento) return;
  const etichetta = prompt('Etichetta del backup (facoltativa):', 'Backup manuale ' + new Date().toLocaleString('it-IT'));
  if (etichetta === null) return; // cancel
  const { error } = await sb.rpc('crea_backup_stagione', {
    p_stabilimento_id: currentStabilimento.id,
    p_etichetta: etichetta || null,
  });
  if (error) {
    alert('Errore creazione backup: ' + error.message);
    return;
  }
  await loadBackupList();
}

/* ---------- Scarica JSON ---------- */

async function scaricaBackupJson(backupId) {
  const { data, error } = await sb.from('stagioni_backup')
    .select('etichetta, created_at, payload')
    .eq('id', backupId)
    .single();
  if (error || !data) {
    alert('Errore download: ' + (error?.message || 'backup non trovato'));
    return;
  }
  const blob = new Blob([JSON.stringify(data.payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const tsLabel = new Date(data.created_at).toISOString().slice(0, 19).replace(/[T:]/g, '-');
  link.href = url;
  link.download = `backup-stagione-${tsLabel}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------- Wizard reset ---------- */

function apriResetWizard() {
  if (!currentStabilimento) return;
  resetWizardShowStep(1);
  document.getElementById('reset-stab-nome').textContent = currentStabilimento.nome || '';
  document.getElementById('reset-stab-input').value = '';
  document.getElementById('reset-confirm-btn').disabled = true;
  showAlert('reset-wizard-alert', '', '');
  document.getElementById('modal-reset-wizard').classList.remove('hidden');
}

function resetWizardShowStep(step) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('reset-step-' + i);
    if (el) el.classList.toggle('hidden', i !== step);
  }
}

function resetWizardNext(step) {
  if (step === 2) {
    const radio = document.querySelector('input[name="reset-tipo"]:checked');
    resetTipoCorrente = radio ? radio.value : 'mantieni';
    renderResetSummary();
    refreshChiusuraEmailCount();
  }
  resetWizardShowStep(step);
}

async function refreshChiusuraEmailCount() {
  const el = document.getElementById('reset-send-chiusura-count');
  if (!el || !currentStabilimento) return;
  el.textContent = '';
  const { count } = await sb.from('clienti_stagionali')
    .select('id', { count: 'exact', head: true })
    .eq('stabilimento_id', currentStabilimento.id)
    .not('user_id', 'is', null)
    .not('email', 'is', null);
  if (typeof count === 'number') {
    el.textContent = count > 0
      ? `(${count} ${count === 1 ? 'cliente' : 'clienti'} riceveranno l'email)`
      : '(nessun cliente attualmente registrato — nessuna email da inviare)';
  }
}

function renderResetSummary() {
  const mantieniCb = resetTipoCorrente === 'mantieni';
  const rows = [];
  rows.push({ kind: 'kill', icon: '🗑️', text: 'Cancella tutte le disponibilità dichiarate' });
  rows.push({ kind: 'kill', icon: '🗑️', text: 'Cancella tutte le transazioni' });
  if (mantieniCb) {
    rows.push({ kind: 'kill', icon: '🗑️', text: 'Azzera i saldi coin di tutti i clienti' });
    rows.push({ kind: 'kill', icon: '🔄', text: 'Resetta lo stato di registrazione: i clienti tornano "Mai invitato" e dovranno essere reinvitati' });
    rows.push({ kind: 'keep', icon: '✓',  text: 'Mantiene anagrafiche clienti (nome, cognome, email, telefono, ombrellone) e mappa' });
  } else {
    rows.push({ kind: 'kill', icon: '🗑️', text: 'Cancella tutti i clienti stagionali' });
    rows.push({ kind: 'kill', icon: '🗑️', text: 'Cancella tutti gli ombrelloni della mappa' });
  }
  rows.push({ kind: 'keep', icon: '✓', text: 'Mantiene date stagione, template email e audit log' });
  rows.push({ kind: 'keep', icon: '💾', text: 'Crea automaticamente un backup completo prima di procedere' });
  document.getElementById('reset-summary').innerHTML = rows.map(r =>
    `<div class="reset-summary-row ${r.kind}"><span class="icon">${r.icon}</span><span>${escapeHtml(r.text)}</span></div>`
  ).join('');
}

function resetWizardCheckMatch() {
  const expected = (currentStabilimento?.nome || '').trim();
  const input = (document.getElementById('reset-stab-input').value || '').trim();
  document.getElementById('reset-confirm-btn').disabled = !(expected && input === expected);
}

async function resetWizardExecute() {
  if (!currentStabilimento) return;
  const btn = document.getElementById('reset-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Esecuzione…';
  showAlert('reset-wizard-alert', '', '');

  const sendEmails = !!document.getElementById('reset-send-chiusura-email')?.checked;
  let emailStats = { sent: 0, failed: 0, total: 0 };
  if (sendEmails) {
    btn.textContent = 'Invio email…';
    try {
      emailStats = await sendChiusuraStagioneEmails();
    } catch (e) {
      console.error('Invio email chiusura stagione fallito:', e);
      // Non blocchiamo il reset: l'utente ha già confermato l'irreversibile.
    }
  }

  btn.textContent = 'Reset in corso…';
  const { error } = await sb.rpc('reset_stagione', {
    p_stabilimento_id: currentStabilimento.id,
    p_mantieni_cb: resetTipoCorrente === 'mantieni',
  });
  if (error) {
    btn.disabled = false;
    btn.textContent = 'Conferma reset';
    showAlert('reset-wizard-alert', 'Errore: ' + error.message, 'error');
    return;
  }
  closeModal('modal-reset-wizard');
  if (typeof loadManagerData === 'function') await loadManagerData();
  await loadBackupList();
  btn.textContent = 'Conferma reset';
  let msg = 'Reset completato. Il backup automatico è disponibile nella lista.';
  if (sendEmails && emailStats.total > 0) {
    msg += `\n\nEmail di chiusura: ${emailStats.sent}/${emailStats.total} inviate`;
    if (emailStats.failed > 0) msg += ` (${emailStats.failed} fallite, vedi console)`;
    msg += '.';
  }
  alert(msg);
}

// Calcola il riepilogo per ogni cliente registrato e invia l'email di chiusura
// stagione PRIMA che il reset cancelli disponibilità e transazioni. Bulk-fetch
// per evitare N+1 e aggregazione client-side.
async function sendChiusuraStagioneEmails() {
  const stab = currentStabilimento;
  if (!stab) return { sent: 0, failed: 0, total: 0 };

  // 1. Clienti registrati (user_id valorizzato) con email
  const { data: clienti, error: cErr } = await sb.from('clienti_stagionali')
    .select('id, nome, cognome, email, ombrellone_id')
    .eq('stabilimento_id', stab.id)
    .not('user_id', 'is', null)
    .not('email', 'is', null);
  if (cErr) throw cErr;
  const targets = (clienti || []).filter(c => c.email && c.email.trim());
  if (targets.length === 0) return { sent: 0, failed: 0, total: 0 };

  // 2. Mappa ombrelloni per label
  const ombIds = Array.from(new Set(targets.map(c => c.ombrellone_id).filter(Boolean)));
  let ombMap = {};
  if (ombIds.length > 0) {
    const { data: omb } = await sb.from('ombrelloni').select('id, fila, numero').in('id', ombIds);
    (omb || []).forEach(o => { ombMap[o.id] = `Fila ${o.fila} N°${o.numero}`; });
  }

  // 3. Disponibilità raggruppate per cliente
  const ggDisp = {}, ggSub = {};
  targets.forEach(c => { ggDisp[c.id] = 0; ggSub[c.id] = 0; });
  if (ombIds.length > 0) {
    const { data: disps } = await sb.from('disponibilita')
      .select('ombrellone_id, stato')
      .in('ombrellone_id', ombIds);
    const cliByOmb = {};
    targets.forEach(c => { if (c.ombrellone_id) cliByOmb[c.ombrellone_id] = c.id; });
    (disps || []).forEach(d => {
      const cid = cliByOmb[d.ombrellone_id];
      if (!cid) return;
      // gg_disponibilita = totale disponibilità (libero + sub_affittato)
      ggDisp[cid] = (ggDisp[cid] || 0) + 1;
      if (d.stato === 'sub_affittato') ggSub[cid] = (ggSub[cid] || 0) + 1;
    });
  }

  // 4. Transazioni coin per cliente
  const coinIn = {}, coinOut = {};
  targets.forEach(c => { coinIn[c.id] = 0; coinOut[c.id] = 0; });
  const cIds = targets.map(c => c.id);
  if (cIds.length > 0) {
    const { data: txs } = await sb.from('transazioni')
      .select('cliente_id, tipo, importo')
      .in('cliente_id', cIds)
      .in('tipo', ['credito_ricevuto', 'credito_usato']);
    (txs || []).forEach(t => {
      const amt = parseFloat(t.importo || 0);
      if (t.tipo === 'credito_ricevuto') coinIn[t.cliente_id] = (coinIn[t.cliente_id] || 0) + amt;
      else if (t.tipo === 'credito_usato') coinOut[t.cliente_id] = (coinOut[t.cliente_id] || 0) + amt;
    });
  }

  // 5. Invio sequenziale (più affidabile rispetto al parallelo per Resend)
  let sent = 0, failed = 0;
  for (const c of targets) {
    const ok = await inviaEmail('chiusura_stagione', {
      email: c.email,
      nome: c.nome || '',
      cognome: c.cognome || '',
      ombrellone: c.ombrellone_id ? (ombMap[c.ombrellone_id] || '') : '',
      gg_disponibilita: ggDisp[c.id] || 0,
      gg_subaffittato: ggSub[c.id] || 0,
      coin_ricevuti_formatted: formatCoin(coinIn[c.id] || 0, stab),
      coin_spesi_formatted: formatCoin(coinOut[c.id] || 0, stab),
    }, stab);
    if (ok) sent++; else failed++;
  }
  return { sent, failed, total: targets.length };
}

/* ---------- Ripristino ---------- */

function apriRipristinoModal(backupId) {
  if (!currentStabilimento) return;
  const b = backupListCache.find(x => x.id === backupId);
  if (!b) return;
  restoreBackupCorrente = { id: b.id, created_at: b.created_at, etichetta: b.etichetta };
  const created = new Date(b.created_at);
  const dateStr = created.toLocaleString('it-IT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('restore-backup-sub').innerHTML =
    `Stai per ripristinare lo stato di <strong>${escapeHtml(b.etichetta || 'Backup')}</strong> del <strong>${dateStr}</strong>. Lo stato attuale verrà sostituito.`;
  document.getElementById('restore-stab-nome').textContent = currentStabilimento.nome || '';
  document.getElementById('restore-stab-input').value = '';
  document.getElementById('restore-confirm-btn').disabled = true;
  showAlert('restore-backup-alert', '', '');
  document.getElementById('modal-restore-backup').classList.remove('hidden');
}

function restoreCheckMatch() {
  const expected = (currentStabilimento?.nome || '').trim();
  const input = (document.getElementById('restore-stab-input').value || '').trim();
  document.getElementById('restore-confirm-btn').disabled = !(expected && input === expected);
}

async function confirmRestoreBackup() {
  if (!restoreBackupCorrente) return;
  const btn = document.getElementById('restore-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Esecuzione…';
  showAlert('restore-backup-alert', '', '');
  const { error } = await sb.rpc('ripristina_backup', { p_backup_id: restoreBackupCorrente.id });
  if (error) {
    btn.disabled = false;
    btn.textContent = 'Conferma ripristino';
    showAlert('restore-backup-alert', 'Errore: ' + error.message, 'error');
    return;
  }
  closeModal('modal-restore-backup');
  if (typeof loadManagerData === 'function') await loadManagerData();
  await loadBackupList();
  btn.textContent = 'Conferma ripristino';
  alert('Ripristino completato. È stato creato un nuovo backup con lo stato pre-ripristino.');
}

/* ---------- Scarica clienti attuali (Excel) ---------- */

function scaricaClientiAttualiExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Libreria Excel non caricata.');
    return;
  }
  const ombById = {};
  (ombrelloniList || []).forEach(o => { ombById[o.id] = o; });
  const rows = (clientiList || [])
    .filter(c => !c.rifiutato)
    .map(c => {
      const o = c.ombrellone_id ? ombById[c.ombrellone_id] : null;
      return {
        fila: o?.fila || '',
        numero: o?.numero || '',
        credito_giornaliero: o?.credito_giornaliero || '',
        nome: c.nome || '',
        cognome: c.cognome || '',
        email: c.email || '',
        telefono: c.telefono || '',
        credito_saldo: c.credito_saldo || 0,
      };
    });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clienti');
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  XLSX.writeFile(wb, `clienti-attuali-${ts}.xlsx`);
}

/* ---------- Esposizione globale ---------- */

window.loadBackupList = loadBackupList;
window.creaBackupManuale = creaBackupManuale;
window.scaricaBackupJson = scaricaBackupJson;
window.apriResetWizard = apriResetWizard;
window.resetWizardNext = resetWizardNext;
window.resetWizardCheckMatch = resetWizardCheckMatch;
window.resetWizardExecute = resetWizardExecute;
window.apriRipristinoModal = apriRipristinoModal;
window.restoreCheckMatch = restoreCheckMatch;
window.confirmRestoreBackup = confirmRestoreBackup;
window.scaricaClientiAttualiExcel = scaricaClientiAttualiExcel;
window.refreshChiusuraEmailCount = refreshChiusuraEmailCount;
