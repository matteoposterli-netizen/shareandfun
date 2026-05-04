// js/comunicazioni.js — Tab "Comunicazioni" del proprietario
//
// Tre sotto-tab:
//   • Email   — broadcast email ai clienti tramite Edge Function `invia-email`
//               (tipo 'comunicazione', template standard SpiaggiaMia).
//   • WhatsApp — placeholder UI con banner "Stiamo lavorando…".
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
let commClientiCache = [];             // clienti con email + ombrellone (id, nome, cognome, email, ombrellone_label, fila, numero)
let commManualSelected = new Set();    // id clienti selezionati nel modo "Selezione manuale"
let commIsSending = false;
let commCurrentTab = 'email';

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
    .select('id,nome,cognome,email,ombrellone_id,ombrelloni:ombrellone_id(fila,numero)')
    .eq('stabilimento_id', currentStabilimento.id);
  if (error) {
    console.error('loadCommClienti:', error);
    commClientiCache = [];
    return;
  }
  commClientiCache = (data || []).map(c => {
    const fila = c.ombrelloni?.fila ?? null;
    const numero = c.ombrelloni?.numero ?? null;
    return {
      id: c.id,
      nome: c.nome || '',
      cognome: c.cognome || '',
      email: (c.email || '').trim(),
      fila,
      numero,
      ombrellone_label: (fila != null && numero != null) ? `Fila ${fila} N°${numero}` : '—',
    };
  }).sort((a, b) => {
    // Ordina per fila/numero quando disponibile, poi per nome.
    if (a.fila !== b.fila) return String(a.fila || '').localeCompare(String(b.fila || ''));
    if ((a.numero || 0) !== (b.numero || 0)) return (a.numero || 0) - (b.numero || 0);
    return (a.cognome + a.nome).localeCompare(b.cognome + b.nome);
  });

  // Popola dropdown filtri
  const fileSel = document.getElementById('comm-filter-file');
  if (fileSel) {
    const file = Array.from(new Set(commClientiCache.map(c => c.fila).filter(f => f != null))).sort();
    fileSel.innerHTML = file.map(f => `<option value="${escapeHtml(String(f))}">Fila ${escapeHtml(String(f))}</option>`).join('');
  }
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
    const hay = `${c.nome} ${c.cognome} ${c.email} fila ${c.fila ?? ''} ${c.numero ?? ''} ${c.ombrellone_label}`.toLowerCase();
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
      const hay = `${c.nome} ${c.cognome} ${c.email} fila ${c.fila ?? ''} ${c.numero ?? ''} ${c.ombrellone_label}`.toLowerCase();
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
    const fileEl = document.getElementById('comm-filter-file');
    const file = fileEl ? Array.from(fileEl.selectedOptions).map(o => o.value) : [];
    const da = parseInt(document.getElementById('comm-filter-num-da').value, 10);
    const a = parseInt(document.getElementById('comm-filter-num-a').value, 10);
    pool = pool.filter(c => {
      if (file.length && !file.includes(String(c.fila))) return false;
      if (!Number.isNaN(da) && (c.numero == null || c.numero < da)) return false;
      if (!Number.isNaN(a) && (c.numero == null || c.numero > a)) return false;
      return true;
    });
    const parts = [];
    if (file.length) parts.push(`File: ${file.join(', ')}`);
    if (!Number.isNaN(da) || !Number.isNaN(a)) {
      parts.push(`N° ${Number.isNaN(da) ? '∞' : da} → ${Number.isNaN(a) ? '∞' : a}`);
    }
    scope = parts.length ? parts.join(' · ') : 'Tutti gli ombrelloni';
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
