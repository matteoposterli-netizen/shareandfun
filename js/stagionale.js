let stagCurrentStab = null;

async function loadStagionaleData() {
  const { data: cliente } = await sb.from('clienti_stagionali').select('*, ombrelloni(*, stabilimenti(*))').eq('user_id', currentUser.id).single();

  if (!cliente) {
    document.getElementById('stag-nome').textContent = currentProfile?.nome || '';
    document.getElementById('stag-ombrellone').textContent = 'Nessun ombrellone associato. Contatta il tuo stabilimento.';
    document.getElementById('stag-credito').textContent = formatCoin(0);
    document.getElementById('stag-tx-list').innerHTML = '<div class="tx-empty">Nessuna transazione</div>';
    stagStagione = null;
    stagRegole = [];
    stagCurrentStab = null;
    stagOmbrellone = null;
    buildCalendar([],[]);
    return;
  }

  stagClienteId = cliente.id;
  stagOmbrelloneId = cliente.ombrellone_id;
  stagOmbrellone = cliente.ombrelloni || null;
  const omb = stagOmbrellone;
  const stab = omb?.stabilimenti;
  stagCurrentStab = stab;
  stagStabilimentoId = stab?.id || cliente.stabilimento_id;
  stagStagione = stab
    ? { inizio: stab.data_inizio_stagione || null, fine: stab.data_fine_stagione || null }
    : null;
  const firstName = currentProfile?.nome || cliente.nome || '';
  document.getElementById('stag-nome').textContent = firstName;
  document.getElementById('stag-ombrellone').textContent = omb
    ? `☂️ Ombrellone ${omb.codice} · ${stab?.nome || ''}`
    : 'Nessun ombrellone associato. Contatta il tuo stabilimento.';
  document.getElementById('stag-credito').textContent = formatCoin(cliente.credito_saldo, stab);
  const badgeEl = document.querySelector('#view-stagionale .stag-coin-badge');
  if (badgeEl) badgeEl.textContent = (stab?.nome || 'C').trim().charAt(0).toUpperCase();

  const { data: disp } = await sb.from('disponibilita').select('*').eq('ombrellone_id', stagOmbrelloneId);
  const dispMap = {};
  (disp || []).forEach(d => { dispMap[d.data] = d.stato; });

  if (stagStabilimentoId) {
    const { data: regole } = await sb.from('regole_stato_ombrelloni')
      .select('*')
      .eq('stabilimento_id', stagStabilimentoId);
    stagRegole = regole || [];
  } else {
    stagRegole = [];
  }

  const telEl = document.getElementById('stag-wa-telefono');
  const consEl = document.getElementById('stag-wa-consenso');
  if (telEl) telEl.value = cliente.telefono || '';
  if (consEl) consEl.checked = !!cliente.whatsapp_consenso;

  buildCalendar(dispMap, disp || []);
  renderStagioneBanner();

  const { data: txs } = await sb.from('transazioni').select('*').eq('cliente_id', stagClienteId).order('created_at', { ascending: false }).limit(20);
  document.getElementById('stag-tx-list').innerHTML = renderStagTxList(txs || [], stab);
}

function renderStagioneBanner() {
  const el = document.getElementById('stag-stagione-banner');
  if (!el) return;
  // Mostra solo l'avviso "ombrellone non attivo"; la spiegazione testuale della
  // stagione è stata rimossa (il comportamento di range resta nel calendario).
  if (stagOmbrellone && stagOmbrellone.attivo === false) {
    el.innerHTML = `⛔ Il tuo ombrellone è temporaneamente <strong>non attivo</strong>. Non è possibile dichiarare disponibilità. Contatta il gestore per informazioni.`;
    el.style.display = '';
  } else {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

// Restituisce { state, label } dove state ∈ null|'fuori_stagione'|'chiusura_speciale'|'sempre_libero'|'mai_libero'.
// Se nessuna restrizione attiva → null.
function regolaStatoPerData(dateStr) {
  if (stagStagione && stagStagione.inizio && stagStagione.fine) {
    if (dateStr < stagStagione.inizio || dateStr > stagStagione.fine) {
      return { state: 'fuori_stagione', label: 'Fuori stagione' };
    }
  }
  // Precedenza: chiusura_speciale > mai_libero > sempre_libero.
  const matching = (stagRegole || []).filter(r => dateStr >= r.data_da && dateStr <= r.data_a);
  if (matching.some(r => r.tipo === 'chiusura_speciale')) {
    return { state: 'chiusura_speciale', label: 'Bagno chiuso' };
  }
  if (matching.some(r => r.tipo === 'mai_libero')) {
    return { state: 'mai_libero', label: 'Subaffitto disabilitato dal proprietario' };
  }
  if (matching.some(r => r.tipo === 'sempre_libero')) {
    return { state: 'sempre_libero', label: 'Forzato libero dal proprietario' };
  }
  return null;
}

function buildCalendar(dispMap, dispList) {
  currentDispMap = dispMap;
  pendingDispChanges = {};
  renderCalendar();
  renderPendingBar();
}

// Stato effettivo di un giorno tenendo conto delle modifiche pending non ancora salvate.
// 'free' = il giorno risulterà libero dopo il salvataggio; 'sub' = sub-affittato (immutabile);
// 'pending-add' / 'pending-remove' = c'è una modifica in attesa.
// null = giorno senza disponibilità dichiarata.
function stagEffectiveDayStato(dateStr) {
  const stato = currentDispMap[dateStr];
  if (stato === 'sub_affittato') return 'sub';
  const pending = pendingDispChanges[dateStr];
  if (pending === 'add') return 'pending-add';
  if (pending === 'remove') return 'pending-remove';
  if (stato === 'libero') return 'free';
  return null;
}

const STAG_MONTHS_SHORT = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];

function renderStagStats() {
  const freeEl = document.getElementById('stag-stat-free');
  const subEl = document.getElementById('stag-stat-sub');
  if (!freeEl || !subEl) return;

  const today = todayStr();
  const inizio = stagStagione?.inizio;
  const fine = stagStagione?.fine;

  const dates = new Set([...Object.keys(currentDispMap), ...Object.keys(pendingDispChanges)]);
  let free = 0, sub = 0;
  dates.forEach(d => {
    if (d < today) return;
    if (inizio && fine && (d < inizio || d > fine)) return;
    const stato = stagEffectiveDayStato(d);
    if (stato === 'free' || stato === 'pending-add') free++;
    else if (stato === 'sub') sub++;
  });
  freeEl.textContent = free;
  subEl.textContent = sub;
}

function stagSwitchTab(tab, btn) {
  document.querySelectorAll('#view-stagionale .stag-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const t = document.querySelector(`#view-stagionale .stag-tab[data-stag-tab="${tab}"]`);
    if (t) t.classList.add('active');
  }
  document.querySelectorAll('#view-stagionale .stag-tab-content').forEach(c => c.style.display = 'none');
  const target = document.getElementById('stag-tab-' + tab);
  if (target) target.style.display = '';
}

function stagToggleHowto() {
  const body = document.getElementById('stag-howto-body');
  const btn = document.getElementById('stag-howto-btn');
  const arrow = document.getElementById('stag-howto-arrow');
  if (!body || !btn || !arrow) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  btn.classList.toggle('open', !open);
  arrow.textContent = open ? '▼' : '▲';
}

// Categorie di transazione per il render mobile-first.
// 'earn' = coin in entrata (verde), 'spend' = coin in uscita (rosso),
// 'info' = evento informativo senza impatto sul saldo (grigio, importo nascosto).
// Nota: sub_affitto e sub_affitto_annullato sono 'info' perché ogni sub-affitto
// genera SEMPRE una transazione credito_ricevuto (o credito_revocato) gemella
// che è la vera fonte del movimento di credito. Mostrarli entrambi come earn/spend
// raddoppierebbe visivamente il movimento sulla lista cliente (anche se il saldo
// è gestito a parte tramite UPDATE su clienti_stagionali.credito_saldo).
function stagTxCategory(t) {
  switch (t.tipo) {
    case 'credito_ricevuto':
      return 'earn';
    case 'credito_usato':
    case 'credito_revocato':
      return 'spend';
    default:
      return 'info';
  }
}

function stagTxDescription(t) {
  const map = {
    credito_ricevuto: 'Crediti accreditati dal sub-affitto del tuo ombrellone.',
    credito_usato: 'Crediti spesi al bar o al ristorante.',
    credito_revocato: 'Sub-affitto annullato: i crediti sono stati revocati.',
    sub_affitto: 'Il tuo ombrellone è stato sub-affittato a un cliente giornaliero.',
    sub_affitto_annullato: 'Il sub-affitto del tuo ombrellone è stato annullato.',
    disponibilita_aggiunta: 'Hai reso il giorno disponibile al sub-affitto.',
    disponibilita_rimossa: 'Hai rimosso la disponibilità al sub-affitto.',
    regola_forzata_aggiunta: 'Lo stabilimento ha modificato il calendario.',
    regola_forzata_rimossa: 'Lo stabilimento ha rimosso una regola dal calendario.',
  };
  return map[t.tipo] || '';
}

function stagTxLabel(t) {
  if (t.tipo === 'comunicazione_ricevuta') {
    const oggetto = (t.nota || '').split('\n')[0].trim();
    return oggetto ? `📣 Comunicazione: ${oggetto}` : '📣 Comunicazione ricevuta';
  }
  const map = {
    disponibilita_aggiunta: 'Disponibilità dichiarata',
    disponibilita_rimossa: 'Disponibilità rimossa',
    sub_affitto: 'Sub-affitto confermato',
    sub_affitto_annullato: 'Sub-affitto annullato',
    credito_ricevuto: 'Credito ricevuto',
    credito_usato: 'Credito utilizzato',
    credito_revocato: 'Credito revocato',
    regola_forzata_aggiunta: 'Regola del gestore impostata',
    regola_forzata_rimossa: 'Regola del gestore revocata',
  };
  return map[t.tipo] || t.tipo;
}

function stagTxDate(t) {
  if (!t.created_at) return '';
  const d = new Date(t.created_at);
  return `${d.getDate()} ${STAG_MONTHS_SHORT[d.getMonth()]}`;
}

function renderStagTxList(txs, stab) {
  if (!txs || !txs.length) return '<div class="tx-empty">Nessuna transazione</div>';
  return txs.map(t => {
    const cat = stagTxCategory(t);
    const icon = cat === 'earn' ? '+' : cat === 'spend' ? '−' : '•';
    const showAmt = t.importo != null && Number(t.importo) !== 0 && cat !== 'info';
    let amtHtml = '';
    if (showAmt) {
      const sign = cat === 'earn' ? '+' : cat === 'spend' ? '−' : '';
      const abs = Math.abs(Number(t.importo));
      amtHtml = `<div class="stag-tx-amt ${cat}">${sign}${formatCoin(abs, stab)}</div>`;
    }
    const desc = stagTxDescription(t);
    const descHtml = desc ? `<div class="stag-tx-desc">${desc}</div>` : '';
    return `<div class="stag-tx-row">
      <div class="stag-tx-icon ${cat}">${icon}</div>
      <div class="stag-tx-info">
        <div class="stag-tx-label">${stagTxLabel(t)}</div>
        ${descHtml}
        <div class="stag-tx-date">${stagTxDate(t)}</div>
      </div>
      ${amtHtml}
    </div>`;
  }).join('');
}

function renderCalendar() {
  const el = document.getElementById('stag-calendar');
  const label = document.getElementById('cal-label');
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  label.textContent = months[calMonth] + ' ' + calYear;
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  el.innerHTML = '';
  for (let i = 0; i < offset; i++) {
    const d = document.createElement('div'); d.className = 'cal-day empty'; el.appendChild(d);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(calYear, calMonth, d);
    const isToday = cellDate.toDateString() === today.toDateString();
    const isPast = cellDate < today && !isToday;
    const stato = currentDispMap[dateStr];
    const pending = pendingDispChanges[dateStr];
    const restr = (stagOmbrellone && stagOmbrellone.attivo === false)
      ? { state: 'mai_libero', label: 'Ombrellone non attivo' }
      : regolaStatoPerData(dateStr);
    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else if (isToday) cls += ' today';
    if (restr) {
      cls += ' restricted restricted-' + restr.state;
    } else {
      if (stato === 'libero') cls += ' free';
      else if (stato === 'sub_affittato') cls += ' subleased';
      else if (!isPast && !isToday) cls += ' occupied';
      if (pending === 'add') cls += ' pending-add';
      if (pending === 'remove') cls += ' pending-remove';
    }
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = d;
    if (restr) {
      const baseStato = stato === 'sub_affittato' ? ' (sub-affittato)' : '';
      div.title = restr.label + baseStato;
    } else if (pending === 'add') {
      div.title = 'Da salvare: aggiunta disponibilità';
    } else if (pending === 'remove') {
      div.title = 'Da salvare: rimozione disponibilità';
    }
    // Click consentito solo se non è passato, c'è un ombrellone, e nessuna regola
    // restrittiva è attiva sul giorno. (sempre_libero, mai_libero e chiusura_speciale
    // bloccano tutti il toggle del cliente.)
    if (!isPast && stagOmbrelloneId && !restr) {
      div.onclick = () => toggleDay(dateStr, stato);
    }
    el.appendChild(div);
  }
  renderStagStats();
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
}

function toggleDay(dateStr, currentStato) {
  if (!stagOmbrelloneId) return;
  if (currentStato === 'sub_affittato') { showAlert('stag-alert', 'Questo giorno è già sub-affittato, non puoi modificarlo', 'error'); return; }
  showAlert('stag-alert', '', '');
  const isFree = currentStato === 'libero';
  const existing = pendingDispChanges[dateStr];
  if (existing) {
    delete pendingDispChanges[dateStr];
  } else {
    pendingDispChanges[dateStr] = isFree ? 'remove' : 'add';
  }
  renderCalendar();
  renderPendingBar();
}

function annullaModifichePending() {
  pendingDispChanges = {};
  renderCalendar();
  renderPendingBar();
  showAlert('stag-alert', '', '');
}

function renderPendingBar() {
  const bar = document.getElementById('stag-pending-bar');
  if (!bar) return;
  const entries = Object.entries(pendingDispChanges);
  if (!entries.length) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const adds = entries.filter(([, op]) => op === 'add').length;
  const removes = entries.filter(([, op]) => op === 'remove').length;
  const parts = [];
  if (adds) parts.push(`<strong>${adds}</strong> ${adds === 1 ? 'giorno da aggiungere' : 'giorni da aggiungere'}`);
  if (removes) parts.push(`<strong>${removes}</strong> ${removes === 1 ? 'giorno da rimuovere' : 'giorni da rimuovere'}`);
  bar.style.display = '';
  bar.innerHTML = `
    <div class="stag-pending-info">${parts.join(' · ')}</div>
    <div class="stag-pending-actions">
      <button class="btn btn-outline btn-sm" onclick="annullaModifichePending()">Annulla</button>
      <button class="btn btn-primary btn-sm" onclick="salvaModifichePending()">Salva modifiche</button>
    </div>`;
}

async function salvaModifichePending() {
  const entries = Object.entries(pendingDispChanges);
  if (!entries.length) return;
  if (!stagOmbrelloneId) { showAlert('stag-alert', 'Nessun ombrellone associato', 'error'); return; }
  showAlert('stag-alert', '', '');
  showLoading();
  const { data: cliente, error: clienteErr } = await sb.from('clienti_stagionali').select('stabilimento_id').eq('id', stagClienteId).single();
  if (clienteErr || !cliente) {
    hideLoading();
    showAlert('stag-alert', 'Impossibile leggere i dati cliente: ' + (clienteErr?.message || 'dati mancanti'), 'error');
    return;
  }
  const succeededAdds = [];
  const succeededRemoves = [];
  const failed = [];
  for (const [dateStr, op] of entries) {
    const isFreeing = op === 'add';
    const dispRes = isFreeing
      ? await sb.from('disponibilita').upsert({ ombrellone_id: stagOmbrelloneId, cliente_id: stagClienteId, data: dateStr, stato: 'libero' }, { onConflict: 'ombrellone_id,data' })
      : await sb.from('disponibilita').delete().eq('ombrellone_id', stagOmbrelloneId).eq('data', dateStr);
    if (dispRes.error) {
      failed.push({ dateStr, op, msg: dispRes.error.message });
      continue;
    }
    const { error: txErr } = await sb.from('transazioni').insert({
      stabilimento_id: cliente.stabilimento_id,
      ombrellone_id: stagOmbrelloneId,
      cliente_id: stagClienteId,
      tipo: isFreeing ? 'disponibilita_aggiunta' : 'disponibilita_rimossa',
      importo: null,
      nota: isFreeing ? `Disponibilità dichiarata per ${formatDate(dateStr)}` : `Disponibilità rimossa per ${formatDate(dateStr)}`,
    });
    if (txErr) {
      if (isFreeing) {
        await sb.from('disponibilita').delete().eq('ombrellone_id', stagOmbrelloneId).eq('data', dateStr);
      } else {
        await sb.from('disponibilita').upsert({ ombrellone_id: stagOmbrelloneId, cliente_id: stagClienteId, data: dateStr, stato: 'libero' }, { onConflict: 'ombrellone_id,data' });
      }
      failed.push({ dateStr, op, msg: txErr.message });
      continue;
    }
    if (isFreeing) succeededAdds.push(dateStr);
    else succeededRemoves.push(dateStr);
  }
  // Notifica push al proprietario (canale parallelo; non blocca la UI).
  if (succeededAdds.length || succeededRemoves.length) {
    inviaPush({
      stabilimento_id: cliente.stabilimento_id,
      cliente_id: stagClienteId,
      ombrellone_id: stagOmbrelloneId,
      giorni_aggiunti: succeededAdds,
      giorni_rimossi: succeededRemoves,
    }).catch(() => {});
  }
  pendingDispChanges = {};
  hideLoading();
  await loadStagionaleData();
  if (failed.length) {
    const sample = failed.slice(0, 3).map(f => `${formatDate(f.dateStr)}: ${f.msg}`).join(' · ');
    showAlert('stag-alert', `Alcune modifiche non sono state salvate (${failed.length}). ${sample}`, 'error');
  }
  if (succeededAdds.length || succeededRemoves.length) {
    showSavedConfirmModal(succeededAdds.length, succeededRemoves.length);
  }
}

function showSavedConfirmModal(adds, removes) {
  const titleEl = document.getElementById('stag-saved-confirm-title');
  const bodyEl = document.getElementById('stag-saved-confirm-body');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = 'Modifiche salvate ✓';
  const lines = [];
  if (adds) lines.push(`<strong>${adds}</strong> ${adds === 1 ? 'giorno aggiunto' : 'giorni aggiunti'} alla disponibilità.`);
  if (removes) lines.push(`<strong>${removes}</strong> ${removes === 1 ? 'giorno rimosso' : 'giorni rimossi'} dalla disponibilità.`);
  bodyEl.innerHTML = lines.join('<br>');
  document.getElementById('modal-stag-saved').classList.remove('hidden');
}

function normalizzaTelefonoIT(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return s;
  if (s.startsWith('3')) return '+39' + s;
  if (s.startsWith('0')) return '+39' + s;
  return '+' + s;
}

async function salvaNotificheWhatsapp() {
  const telEl = document.getElementById('stag-wa-telefono');
  const consEl = document.getElementById('stag-wa-consenso');
  if (!stagClienteId) { showAlert('stag-wa-alert', 'Nessun cliente associato', 'error'); return; }
  const consenso = !!(consEl && consEl.checked);
  const tel = ((telEl && telEl.value) || '').trim();
  if (consenso && !tel) {
    showAlert('stag-wa-alert', 'Inserisci il numero di cellulare per attivare le notifiche WhatsApp', 'error');
    return;
  }
  const telNorm = tel ? normalizzaTelefonoIT(tel) : null;
  if (telNorm && !/^\+[1-9]\d{7,14}$/.test(telNorm)) {
    showAlert('stag-wa-alert', 'Numero non valido. Controlla e riprova.', 'error');
    return;
  }
  showLoading();
  const update = {
    telefono: telNorm,
    whatsapp_consenso: consenso,
    whatsapp_consenso_at: consenso ? new Date().toISOString() : null,
  };
  const { error } = await sb.from('clienti_stagionali').update(update).eq('id', stagClienteId);
  hideLoading();
  if (error) { showAlert('stag-wa-alert', 'Errore nel salvataggio: ' + error.message, 'error'); return; }
  if (telEl) telEl.value = telNorm || '';
  showAlert('stag-wa-alert', 'Preferenze salvate ✓', 'success');
}
