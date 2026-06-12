// js/comunicazioni.js — Tab "Comunicazioni" del proprietario
//
// Tre sotto-tab:
//   • Email   — broadcast email ai clienti tramite Edge Function `invia-email`
//               (tipo 'comunicazione', template standard SpiaggiaMia).
//   • WhatsApp — banner stato wa_enabled + registro read-only degli ultimi
//               200 messaggi inviati (`wa_messages_log`, filtri client-side).
//   • SMS      — placeholder UI con banner "Stiamo lavorando…".
//
// Per ogni email inviata con successo viene inserita una riga
// `transazioni.tipo='comunicazione_ricevuta'` (importo=0) col cliente
// destinatario, così l'evento è visibile nelle transazioni del cliente.
// A fine batch viene scritto un evento aggregato in `audit_log`
// (`entity_type='email'`, `action='email_batch_sent'`).

const COMM_THROTTLE_MS = 110;          // ~9 req/sec, sotto al limite 10/sec di Resend

let commBozze = [];                    // cache delle bozze caricate
let commBozzaCorrenteId = null;        // id della bozza attualmente caricata (per "Sovrascrivi")
let commClientiCache = [];             // clienti con email + ombrellone (id, nome, cognome, email, ombrellone_label, codice)
let commManualSelected = new Set();    // id clienti selezionati nel modo "Selezione manuale"
let commIsSending = false;
let commCurrentTab = 'email';
let commWaLog = [];                    // cache messaggi WhatsApp caricati da wa_messages_log
let commWaLogExpanded = new Set();     // id righe con testo espanso

/* ---------- Init ---------- */

async function comunicazioniInit() {
  if (!currentStabilimento) return;
  comunicazioniSwitchTab('email');
  await Promise.all([loadCommBozze(), loadCommClienti()]);
  // Default: tutti
  const radioAll = document.querySelector('input[name="comm-recipients"][value="all"]');
  if (radioAll) radioAll.checked = true;
  comunicazioniRefreshRecipients();
  comunicazioniContentChanged();
}

function comunicazioniSwitchTab(tab, btn) {
  commCurrentTab = tab;
  document.querySelectorAll('.comm-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.commTab === tab);
  });
  document.querySelectorAll('.comm-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('comm-pane-' + tab);
  if (pane) pane.classList.add('active');
  if (tab === 'whatsapp') _renderCommWaStatus();
}

function _renderCommWaStatus() {
  const el = document.getElementById('comm-wa-status-body');
  if (!el || !currentStabilimento) return;
  const enabled = !!currentStabilimento.wa_enabled;
  const banner = enabled
    ? `<div class="alert" style="background:#e8f5e9;border-left:3px solid #4caf50;padding:12px;border-radius:6px;font-size:13px">
         ✅ <strong>WhatsApp attivo</strong> — i messaggi automatici vengono inviati ai clienti con consenso.
       </div>`
    : `<div class="alert alert-info" style="font-size:13px">
         ⚠️ WhatsApp non è ancora attivo per questo stabilimento. Attivalo in <strong>Configurazioni → WhatsApp</strong>.
       </div>`;
  el.innerHTML = `
    ${banner}
    <div style="margin-top:18px">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">📒 Registro messaggi inviati</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <select id="comm-wa-f-tipo" onchange="renderCommWaLogTable()" style="font-size:13px;padding:6px 8px">
          <option value="">Tutti i tipi</option>
          <option value="invito">Invito</option>
          <option value="benvenuto">Benvenuto</option>
          <option value="variazione_credito">Variazione credito</option>
          <option value="recupero_password">Recupero password</option>
        </select>
        <select id="comm-wa-f-stato" onchange="renderCommWaLogTable()" style="font-size:13px;padding:6px 8px">
          <option value="">Tutti gli stati</option>
          <option value="queued">In coda (queued)</option>
          <option value="sent">Inviato (sent)</option>
          <option value="delivered">Consegnato (delivered)</option>
          <option value="read">Letto (read)</option>
          <option value="failed">Fallito (failed)</option>
          <option value="undelivered">Non consegnato (undelivered)</option>
        </select>
        <input id="comm-wa-f-search" type="text" placeholder="Cerca nome o numero…"
               oninput="renderCommWaLogTable()" style="font-size:13px;padding:6px 8px;flex:1;min-width:160px">
        <button class="btn btn-outline btn-sm" type="button" onclick="loadCommWaLog()">🔄 Aggiorna</button>
      </div>
      <div id="comm-wa-log-body"><div class="comm-empty">Caricamento…</div></div>
    </div>`;
  loadCommWaLog();
}

async function loadCommWaLog() {
  const container = document.getElementById('comm-wa-log-body');
  if (!container || !currentStabilimento?.id) return;
  const { data, error } = await sb.from('wa_messages_log')
    .select('id, created_at, tipo, to_number, status, error_code, error_message, body, clienti_stagionali:cliente_id(nome,cognome)')
    .eq('stabilimento_id', currentStabilimento.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('loadCommWaLog:', error);
    container.innerHTML = '<div class="alert alert-error" style="font-size:13px">Errore nel caricamento del registro messaggi.</div>';
    return;
  }
  commWaLog = data || [];
  renderCommWaLogTable();
}

const COMM_WA_TIPO_LABELS = {
  invito: 'Invito',
  benvenuto: 'Benvenuto',
  variazione_credito: 'Variazione credito',
  recupero_password: 'Recupero password',
};

const COMM_WA_STATUS_BADGES = {
  queued:      { label: 'In coda',        bg: '#eceff1', fg: '#455a64' },
  sent:        { label: 'Inviato',        bg: '#eceff1', fg: '#455a64' },
  delivered:   { label: 'Consegnato',     bg: '#e8f5e9', fg: '#2e7d32' },
  read:        { label: 'Letto',          bg: '#e3f2fd', fg: '#1565c0' },
  failed:      { label: 'Fallito',        bg: '#ffebee', fg: '#c62828' },
  undelivered: { label: 'Non consegnato', bg: '#ffebee', fg: '#c62828' },
};

function renderCommWaLogTable() {
  const container = document.getElementById('comm-wa-log-body');
  if (!container) return;
  const fTipo = document.getElementById('comm-wa-f-tipo')?.value || '';
  const fStato = document.getElementById('comm-wa-f-stato')?.value || '';
  const fSearch = (document.getElementById('comm-wa-f-search')?.value || '').trim().toLowerCase();

  const rows = commWaLog.filter(m => {
    if (fTipo && m.tipo !== fTipo) return false;
    if (fStato && m.status !== fStato) return false;
    if (fSearch) {
      const cliente = m.clienti_stagionali
        ? `${m.clienti_stagionali.nome || ''} ${m.clienti_stagionali.cognome || ''}` : '';
      const hay = `${cliente} ${m.to_number || ''}`.toLowerCase();
      if (!hay.includes(fSearch)) return false;
    }
    return true;
  });

  if (!rows.length) {
    container.innerHTML = '<div class="comm-empty">Nessun messaggio trovato.</div>';
    return;
  }

  const thStyle = 'padding:6px 8px;text-align:left;font-weight:600;font-size:12px;color:var(--text-mid);white-space:nowrap';
  const tdStyle = 'padding:6px 8px;vertical-align:top;border-top:1px solid var(--border)';

  const trs = rows.map(m => {
    const dt = new Date(m.created_at);
    const quando = `${dt.toLocaleDateString('it-IT')} ${dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    const cliente = m.clienti_stagionali
      ? `${m.clienti_stagionali.cognome || ''} ${m.clienti_stagionali.nome || ''}`.trim() || '—'
      : '—';
    const tipo = COMM_WA_TIPO_LABELS[m.tipo] || m.tipo || '—';
    const badge = COMM_WA_STATUS_BADGES[m.status] || { label: m.status || '—', bg: '#eceff1', fg: '#455a64' };
    const errore = m.error_code
      ? `<div style="font-size:11px;color:#c62828;margin-top:3px">err ${escapeHtml(String(m.error_code))}: ${escapeHtml(m.error_message || '')}</div>`
      : '';
    const expanded = commWaLogExpanded.has(m.id);
    const bodyRow = expanded
      ? `<tr><td colspan="6" style="${tdStyle};background:#fafafa">${
          m.body != null
            ? `<div style="white-space:pre-wrap;font-size:13px">${escapeHtml(m.body)}</div>`
            : '<em style="font-size:13px;color:var(--text-mid)">Testo non disponibile (messaggio precedente al 12/06/2026)</em>'
        }</td></tr>`
      : '';
    return `<tr>
      <td style="${tdStyle};white-space:nowrap">${escapeHtml(quando)}</td>
      <td style="${tdStyle}">${escapeHtml(cliente)}</td>
      <td style="${tdStyle}">${escapeHtml(tipo)}</td>
      <td style="${tdStyle};white-space:nowrap">${escapeHtml(m.to_number || '—')}</td>
      <td style="${tdStyle}">
        <span style="display:inline-block;border-radius:10px;padding:2px 8px;font-size:12px;background:${badge.bg};color:${badge.fg}">${escapeHtml(badge.label)}</span>
        ${errore}
      </td>
      <td style="${tdStyle};text-align:center">
        <button class="btn btn-outline btn-sm" type="button" title="${expanded ? 'Nascondi testo' : 'Mostra testo'}"
                onclick="commWaLogToggleBody('${escapeHtml(m.id)}')">📄</button>
      </td>
    </tr>${bodyRow}`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="${thStyle}">Data/ora</th>
            <th style="${thStyle}">Cliente</th>
            <th style="${thStyle}">Tipo</th>
            <th style="${thStyle}">Numero</th>
            <th style="${thStyle}">Stato</th>
            <th style="${thStyle}"></th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
}

function commWaLogToggleBody(id) {
  if (commWaLogExpanded.has(id)) commWaLogExpanded.delete(id);
  else commWaLogExpanded.add(id);
  renderCommWaLogTable();
}

/* ---------- Bozze ---------- */

async function loadCommBozze() {
  if (!currentStabilimento?.id) return;
  const { data, error } = await sb.from('email_bozze')
    .select('*')
    .eq('stabilimento_id', currentStabilimento.id)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('loadCommBozze:', error);
    commBozze = [];
  } else {
    commBozze = data || [];
  }
  renderCommBozzeSelect();
}

function renderCommBozzeSelect() {
  const sel = document.getElementById('comm-email-bozza-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Nessuna bozza selezionata —</option>' +
    commBozze.map(b => `<option value="${b.id}">${escapeHtml(b.etichetta)}</option>`).join('');
  if (current && commBozze.some(b => b.id === current)) sel.value = current;
}

function comunicazioniBozzaCambiata() {
  const sel = document.getElementById('comm-email-bozza-select');
  const id = sel.value;
  if (!id) {
    commBozzaCorrenteId = null;
    document.getElementById('comm-btn-sovrascrivi').disabled = true;
    document.getElementById('comm-bozza-info').textContent = '';
    return;
  }
  const b = commBozze.find(x => x.id === id);
  if (!b) return;
  commBozzaCorrenteId = b.id;
  document.getElementById('comm-email-oggetto').value = b.oggetto || '';
  document.getElementById('comm-email-corpo').value = b.corpo || '';
  document.getElementById('comm-btn-sovrascrivi').disabled = false;
  const dt = new Date(b.updated_at);
  document.getElementById('comm-bozza-info').textContent =
    `Caricata: "${b.etichetta}" (ultimo aggiornamento ${dt.toLocaleDateString('it-IT')} ${dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })})`;
  comunicazioniContentChanged();
}

function comunicazioniSalvaBozza() {
  document.getElementById('comm-bozza-etichetta').value = '';
  document.getElementById('comm-bozza-alert').innerHTML = '';
  document.getElementById('modal-comm-bozza').classList.remove('hidden');
}

async function comunicazioniBozzaConferma() {
  const etichetta = document.getElementById('comm-bozza-etichetta').value.trim();
  const oggetto = document.getElementById('comm-email-oggetto').value;
  const corpo = document.getElementById('comm-email-corpo').value;
  if (!etichetta) {
    showAlert('comm-bozza-alert', 'Inserisci un\'etichetta', 'error');
    return;
  }
  if (etichetta.length > 80) {
    showAlert('comm-bozza-alert', 'Etichetta troppo lunga (max 80 caratteri)', 'error');
    return;
  }
  // UNIQUE (stabilimento_id, etichetta) → upsert by composite key.
  const { data, error } = await sb.from('email_bozze')
    .upsert(
      { stabilimento_id: currentStabilimento.id, etichetta, oggetto, corpo },
      { onConflict: 'stabilimento_id,etichetta' }
    )
    .select()
    .single();
  if (error) {
    showAlert('comm-bozza-alert', 'Errore salvataggio: ' + error.message, 'error');
    return;
  }
  closeModal('modal-comm-bozza');
  await loadCommBozze();
  if (data?.id) {
    document.getElementById('comm-email-bozza-select').value = data.id;
    comunicazioniBozzaCambiata();
  }
}

async function comunicazioniSovrascriviBozza() {
  if (!commBozzaCorrenteId) return;
  const b = commBozze.find(x => x.id === commBozzaCorrenteId);
  if (!b) return;
  if (!confirm(`Sovrascrivere la bozza "${b.etichetta}" con il contenuto attuale?`)) return;
  const oggetto = document.getElementById('comm-email-oggetto').value;
  const corpo = document.getElementById('comm-email-corpo').value;
  const { error } = await sb.from('email_bozze')
    .update({ oggetto, corpo })
    .eq('id', commBozzaCorrenteId);
  if (error) {
    alert('Errore aggiornamento bozza: ' + error.message);
    return;
  }
  await loadCommBozze();
  document.getElementById('comm-email-bozza-select').value = commBozzaCorrenteId;
  comunicazioniBozzaCambiata();
}

/* ---------- Clienti / destinatari ---------- */

async function loadCommClienti() {
  if (!currentStabilimento?.id) return;
  const { data, error } = await sb.from('clienti_stagionali')
    .select('id,nome,cognome,email,ombrellone_id,ombrelloni:ombrellone_id(codice)')
    .eq('stabilimento_id', currentStabilimento.id);
  if (error) {
    console.error('loadCommClienti:', error);
    commClientiCache = [];
    return;
  }
  commClientiCache = (data || []).map(c => {
    const codice = c.ombrelloni?.codice ?? null;
    return {
      id: c.id,
      nome: c.nome || '',
      cognome: c.cognome || '',
      email: (c.email || '').trim(),
      codice,
      ombrellone_label: codice ?? '—',
    };
  }).sort((a, b) => {
    // Ordina per codice ombrellone, poi per nome.
    if (a.codice && b.codice) return a.codice.localeCompare(b.codice, 'it');
    if (a.codice) return -1;
    if (b.codice) return 1;
    return (a.cognome + a.nome).localeCompare(b.cognome + b.nome, 'it');
  });

  const singleSel = document.getElementById('comm-single-select');
  if (singleSel) {
    const opts = commClientiCache
      .filter(c => c.email)
      .map(c => `<option value="${c.id}">${escapeHtml(c.cognome)} ${escapeHtml(c.nome)} — ${escapeHtml(c.ombrellone_label)} — ${escapeHtml(c.email)}</option>`)
      .join('');
    singleSel.innerHTML = '<option value="">— Seleziona un cliente —</option>' + opts;
  }
  comunicazioniManualRender();
}

function comunicazioniManualRender() {
  const list = document.getElementById('comm-manual-list');
  if (!list) return;
  const q = (document.getElementById('comm-manual-search')?.value || '').trim().toLowerCase();
  const visibili = commClientiCache.filter(c => {
    if (!c.email) return false;
    if (!q) return true;
    const hay = `${c.nome} ${c.cognome} ${c.email} ${c.codice ?? ''} ${c.ombrellone_label}`.toLowerCase();
    return hay.includes(q);
  });
  if (!visibili.length) {
    list.innerHTML = '<div class="comm-empty">Nessun cliente con email corrispondente.</div>';
    return;
  }
  list.innerHTML = visibili.map(c => {
    const checked = commManualSelected.has(c.id) ? 'checked' : '';
    return `<label class="comm-manual-row">
      <input type="checkbox" data-id="${c.id}" ${checked} onchange="comunicazioniManualToggle('${c.id}', this.checked)">
      <span class="comm-manual-name">${escapeHtml(c.cognome)} ${escapeHtml(c.nome)}</span>
      <span class="comm-manual-omb">${escapeHtml(c.ombrellone_label)}</span>
      <span class="comm-manual-email">${escapeHtml(c.email)}</span>
    </label>`;
  }).join('');
}

function comunicazioniManualToggle(id, checked) {
  if (checked) commManualSelected.add(id);
  else commManualSelected.delete(id);
  comunicazioniRefreshRecipients();
}

function comunicazioniManualSelectAll(value) {
  const q = (document.getElementById('comm-manual-search')?.value || '').trim().toLowerCase();
  commClientiCache.forEach(c => {
    if (!c.email) return;
    if (q) {
      const hay = `${c.nome} ${c.cognome} ${c.email} ${c.codice ?? ''} ${c.ombrellone_label}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    if (value) commManualSelected.add(c.id);
    else commManualSelected.delete(c.id);
  });
  comunicazioniManualRender();
  comunicazioniRefreshRecipients();
}

function comunicazioniSelectedMode() {
  return document.querySelector('input[name="comm-recipients"]:checked')?.value || 'all';
}

function comunicazioniRefreshRecipients() {
  const mode = comunicazioniSelectedMode();
  document.getElementById('comm-rec-filter').style.display = mode === 'filter' ? '' : 'none';
  document.getElementById('comm-rec-manual').style.display = mode === 'manual' ? '' : 'none';
  document.getElementById('comm-rec-single').style.display = mode === 'single' ? '' : 'none';
  const summary = document.getElementById('comm-recipients-summary');
  const { reachable, unreachable, scope } = comunicazioniComputeRecipients();
  let scopeLabel = '';
  if (mode === 'all') scopeLabel = 'Tutti i clienti';
  else if (mode === 'filter') scopeLabel = scope || 'Filtro non applicato';
  else if (mode === 'manual') scopeLabel = `${commManualSelected.size} ${commManualSelected.size === 1 ? 'cliente selezionato' : 'clienti selezionati'}`;
  else if (mode === 'single') scopeLabel = scope || 'Nessun cliente scelto';
  summary.innerHTML = `
    <div class="comm-summary-row"><strong>Ambito:</strong> ${escapeHtml(scopeLabel)}</div>
    <div class="comm-summary-row"><strong>Raggiungibili:</strong> <span class="comm-pill comm-pill-ok">${reachable.length}</span>
      <strong style="margin-left:14px">Non raggiungibili:</strong> <span class="comm-pill comm-pill-warn">${unreachable.length}</span>
      ${unreachable.length ? '<span style="margin-left:8px;font-size:12px;color:var(--text-mid)">(senza email — esclusi)</span>' : ''}
    </div>
  `;
}

function comunicazioniComputeRecipients() {
  const mode = comunicazioniSelectedMode();
  let pool = commClientiCache.slice();
  let scope = '';
  if (mode === 'filter') {
    const raw = (document.getElementById('comm-filter-codice')?.value || '').trim();
    const codici = raw ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    if (codici.length) {
      pool = pool.filter(c => c.codice != null && codici.includes(c.codice.toLowerCase()));
      scope = `Codici: ${codici.join(', ')}`;
    } else {
      scope = 'Tutti gli ombrelloni';
    }
  } else if (mode === 'manual') {
    pool = pool.filter(c => commManualSelected.has(c.id));
  } else if (mode === 'single') {
    const id = document.getElementById('comm-single-select').value;
    pool = pool.filter(c => c.id === id);
    if (pool.length) scope = `${pool[0].cognome} ${pool[0].nome} (${pool[0].ombrellone_label})`;
  }
  const reachable = pool.filter(c => c.email);
  const unreachable = pool.filter(c => !c.email);
  return { reachable, unreachable, scope };
}

/* ---------- Contenuto / counters ---------- */

function comunicazioniContentChanged() {
  const o = document.getElementById('comm-email-oggetto').value;
  const c = document.getElementById('comm-email-corpo').value;
  document.getElementById('comm-counter-oggetto').textContent = o.length;
  document.getElementById('comm-counter-corpo').textContent = c.length;
}

/* ---------- Anteprima ---------- */

function comunicazioniAnteprima() {
  const oggetto = document.getElementById('comm-email-oggetto').value.trim();
  const corpo = document.getElementById('comm-email-corpo').value.trim();
  if (!oggetto || !corpo) {
    alert('Inserisci oggetto e corpo prima di vedere l\'anteprima.');
    return;
  }
  const { reachable } = comunicazioniComputeRecipients();
  const sample = reachable[0] || {
    nome: 'Mario', cognome: 'Rossi', email: 'mario.rossi@example.com',
    ombrellone_label: 'Fila A N°12'
  };
  const placeholders = {
    nome: sample.nome,
    cognome: sample.cognome,
    ombrellone: sample.ombrellone_label,
    stabilimento_nome: currentStabilimento?.nome || '',
  };
  const oggettoFinal = substitutePlaceholders(oggetto, placeholders);
  const corpoFinal = substitutePlaceholders(corpo, placeholders).replace(/\n/g, '<br>');
  document.getElementById('comm-anteprima-sub').innerHTML =
    `Anteprima generata sui dati di <strong>${escapeHtml(sample.cognome)} ${escapeHtml(sample.nome)}</strong> (${escapeHtml(sample.email)})`;
  const stabNome = escapeHtml(currentStabilimento?.nome || '');
  const stabTel = currentStabilimento?.telefono ? escapeHtml(currentStabilimento.telefono) : '';
  const stabMail = currentStabilimento?.email ? escapeHtml(currentStabilimento.email) : '';
  const contatti = [
    stabTel ? `📞 ${stabTel}` : '',
    stabMail ? `✉️ ${stabMail}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  document.getElementById('comm-anteprima-frame').innerHTML = `
    <div class="comm-mail">
      <div class="comm-mail-meta"><strong>Oggetto:</strong> ${escapeHtml(oggettoFinal)}</div>
      <div class="comm-mail-card">
        <div class="comm-mail-header">
          <div class="comm-mail-emoji">📣 ☂️</div>
          <div class="comm-mail-brand">SpiaggiaMia</div>
          <div class="comm-mail-sub">Comunicazione da ${stabNome}</div>
        </div>
        <div class="comm-mail-body">
          <div class="comm-mail-greeting">Ciao,</div>
          <div class="comm-mail-name">${escapeHtml(sample.nome)}!</div>
          <p>Hai ricevuto un messaggio da <strong>${stabNome}</strong>:</p>
          <div class="comm-mail-box">
            <div class="comm-mail-box-title">${escapeHtml(oggettoFinal)}</div>
            <div class="comm-mail-box-text">${corpoFinal}</div>
          </div>
          <p style="font-size:13px;color:#5A6A7A">Per qualsiasi domanda contatta direttamente <strong>${stabNome}</strong> ai recapiti qui sotto.</p>
        </div>
        <div class="comm-mail-footer">
          <div>🏖️ <strong>${stabNome}</strong></div>
          ${contatti ? `<div style="margin-top:6px">${contatti}</div>` : ''}
          <div style="margin-top:10px;font-size:11px;color:#9AAABB">Email automatica da indirizzo no-reply: le risposte non vengono lette.</div>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-comm-anteprima').classList.remove('hidden');
}

/* ---------- Invio ---------- */

async function comunicazioniInvia() {
  if (commIsSending) return;
  const oggetto = document.getElementById('comm-email-oggetto').value.trim();
  const corpo = document.getElementById('comm-email-corpo').value.trim();
  if (!oggetto) { alert('Inserisci l\'oggetto della email.'); return; }
  if (!corpo) { alert('Inserisci il corpo della email.'); return; }
  const { reachable, unreachable } = comunicazioniComputeRecipients();
  if (!reachable.length) {
    alert('Nessun destinatario raggiungibile (con email).');
    return;
  }
  const conferma = `Stai per inviare una email a ${reachable.length} ${reachable.length === 1 ? 'destinatario' : 'destinatari'}.` +
    (unreachable.length ? `\n${unreachable.length} cliente/i senza email saranno esclusi.` : '') +
    `\n\nProcedere?`;
  if (!confirm(conferma)) return;

  commIsSending = true;
  document.getElementById('comm-btn-invia').disabled = true;
  const closeBtn = document.getElementById('comm-invio-close');
  closeBtn.disabled = true;
  document.getElementById('comm-invio-summary').style.display = 'none';
  document.getElementById('comm-invio-summary').innerHTML = '';
  document.getElementById('comm-invio-title').textContent = 'Invio email in corso…';
  document.getElementById('comm-invio-sub').textContent = `Oggetto: ${oggetto}`;
  document.getElementById('comm-progress-bar').style.width = '0%';
  document.getElementById('comm-progress-meta').textContent = `0 / ${reachable.length}`;
  document.getElementById('modal-comm-invio').classList.remove('hidden');

  let inviati = 0, falliti = 0;
  const erroriList = [];

  for (let i = 0; i < reachable.length; i++) {
    const c = reachable[i];
    const placeholders = {
      nome: c.nome,
      cognome: c.cognome,
      ombrellone: c.ombrellone_label,
      stabilimento_nome: currentStabilimento?.nome || '',
    };
    const oggettoFinal = substitutePlaceholders(oggetto, placeholders);
    const corpoFinal = substitutePlaceholders(corpo, placeholders);

    let ok = false;
    try {
      ok = await inviaEmail(
        'comunicazione',
        { email: c.email, nome: c.nome, cognome: c.cognome, ombrellone: c.ombrellone_label },
        currentStabilimento,
        { oggetto: oggettoFinal, testo: corpoFinal }
      );
    } catch (e) {
      console.error('Comunicazione: invio fallito', c, e);
      ok = false;
    }

    if (ok) {
      inviati++;
      // Inserisco la riga "comunicazione_ricevuta" (importo=0).
      // Salvo oggetto + estratto corpo (max 200 char) in `nota` — il render
      // della lista cliente prende la prima riga come oggetto.
      const estratto = corpoFinal.length > 200 ? corpoFinal.slice(0, 200) + '…' : corpoFinal;
      const nota = `${oggettoFinal}\n${estratto}`;
      const { error: txErr } = await sb.from('transazioni').insert({
        stabilimento_id: currentStabilimento.id,
        cliente_id: c.id,
        tipo: 'comunicazione_ricevuta',
        importo: 0,
        nota,
      });
      if (txErr) console.warn('Insert transazione comunicazione_ricevuta fallito:', txErr);
    } else {
      falliti++;
      erroriList.push(`${c.cognome} ${c.nome} (${c.email})`);
    }

    const done = i + 1;
    const pct = Math.round((done / reachable.length) * 100);
    document.getElementById('comm-progress-bar').style.width = pct + '%';
    document.getElementById('comm-progress-meta').textContent = `${done} / ${reachable.length}`;

    if (i < reachable.length - 1) await new Promise(r => setTimeout(r, COMM_THROTTLE_MS));
  }

  // Audit log aggregato lato proprietario.
  try {
    await sb.rpc('audit_log_write', {
      p_stabilimento_id: currentStabilimento.id,
      p_entity_type: 'email',
      p_action: 'email_batch_sent',
      p_description: `Comunicazione "${oggetto}" inviata a ${inviati} destinatari` +
        (falliti ? ` (${falliti} falliti)` : '') +
        (unreachable.length ? ` — ${unreachable.length} esclusi senza email` : ''),
      p_metadata: {
        tipo: 'comunicazione',
        oggetto,
        inviati,
        falliti,
        esclusi_senza_email: unreachable.length,
        falliti_lista: erroriList,
      },
    });
  } catch (e) {
    console.warn('audit_log_write batch fallito:', e);
  }

  // Riepilogo finale
  document.getElementById('comm-invio-title').textContent = falliti
    ? `Invio completato con ${falliti} ${falliti === 1 ? 'errore' : 'errori'}`
    : 'Invio completato';
  const summary = document.getElementById('comm-invio-summary');
  summary.style.display = '';
  let html = `<div class="comm-summary-row"><strong>Inviate con successo:</strong> ${inviati}</div>`;
  if (falliti) {
    html += `<div class="comm-summary-row"><strong>Falliti:</strong> ${falliti}</div>`;
    html += `<details style="margin-top:8px"><summary>Dettaglio errori</summary><ul style="margin:6px 0 0 18px">${erroriList.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></details>`;
  }
  if (unreachable.length) {
    html += `<div class="comm-summary-row" style="margin-top:8px"><strong>Esclusi (senza email):</strong> ${unreachable.length}</div>`;
  }
  summary.innerHTML = html;
  closeBtn.disabled = false;
  document.getElementById('comm-btn-invia').disabled = false;
  commIsSending = false;
}
