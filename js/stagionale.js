async function loadStagionaleData() {
  const { data: cliente } = await sb.from('clienti_stagionali').select('*, ombrelloni(*, stabilimenti(*))').eq('user_id', currentUser.id).single();

  if (!cliente) {
    document.getElementById('stag-nome').textContent = currentProfile?.nome || '';
    document.getElementById('stag-ombrellone').textContent = 'Nessun ombrellone associato. Contatta il tuo stabilimento.';
    document.getElementById('stag-credito').textContent = formatCoin(0);
    document.getElementById('stag-tx-list').innerHTML = '<div class="tx-empty">Nessuna transazione</div>';
    stagStagione = null;
    stagRegole = [];
    buildCalendar([],[]);
    return;
  }

  stagClienteId = cliente.id;
  stagOmbrelloneId = cliente.ombrellone_id;
  const omb = cliente.ombrelloni;
  const stab = omb?.stabilimenti;
  stagStabilimentoId = stab?.id || cliente.stabilimento_id;
  stagStagione = stab
    ? { inizio: stab.data_inizio_stagione || null, fine: stab.data_fine_stagione || null }
    : null;
  document.getElementById('stag-nome').textContent = `${currentProfile?.nome || cliente.nome} ${currentProfile?.cognome || cliente.cognome}`;
  document.getElementById('stag-ombrellone').textContent = omb ? `☂️ Ombrellone ${omb.fila}${omb.numero} · ${stab?.nome || ''} · ${stab?.citta || ''}` : 'Nessun ombrellone';
  document.getElementById('stag-credito').textContent = formatCoin(cliente.credito_saldo, stab);

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

  buildCalendar(dispMap, disp || []);
  renderStagioneBanner();

  const { data: txs } = await sb.from('transazioni').select('*').eq('cliente_id', stagClienteId).order('created_at', { ascending: false }).limit(20);
  document.getElementById('stag-tx-list').innerHTML = renderTxList(txs || [], stab);
}

function renderStagioneBanner() {
  const el = document.getElementById('stag-stagione-banner');
  if (!el) return;
  if (!stagStagione || !stagStagione.inizio || !stagStagione.fine) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.innerHTML = `Stagione <strong>${formatDate(stagStagione.inizio)} → ${formatDate(stagStagione.fine)}</strong>. I giorni fuori da queste date non sono modificabili.`;
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
    const restr = regolaStatoPerData(dateStr);
    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else if (isToday) cls += ' today';
    if (stato === 'libero') cls += ' free';
    if (stato === 'sub_affittato') cls += ' subleased';
    if (pending === 'add') cls += ' pending-add';
    if (pending === 'remove') cls += ' pending-remove';
    if (!isPast && restr) cls += ' restricted restricted-' + restr.state;
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

function toggleTodayFree() {
  const today = todayStr();
  toggleDay(today, currentDispMap[today]);
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
