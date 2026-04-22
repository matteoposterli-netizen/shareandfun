async function loadStagionaleData() {
  const { data: cliente } = await sb.from('clienti_stagionali').select('*, ombrelloni(*, stabilimenti(*))').eq('user_id', currentUser.id).single();
  const oldBanner = document.getElementById('stag-pending-banner');
  if (oldBanner) oldBanner.remove();

  if (!cliente) {
    document.getElementById('stag-nome').textContent = currentProfile?.nome || '';
    document.getElementById('stag-ombrellone').textContent = 'Nessun ombrellone associato. Contatta il tuo stabilimento.';
    document.getElementById('stag-credito').textContent = '€ 0.00';
    document.getElementById('stag-tx-list').innerHTML = '<div class="tx-empty">Nessuna transazione</div>';
    buildCalendar([],[]);
    return;
  }

  if (!cliente.approvato) {
    const omb = cliente.ombrelloni;
    const stab = omb?.stabilimenti;
    document.getElementById('stag-nome').textContent = `${currentProfile?.nome || cliente.nome} ${currentProfile?.cognome || cliente.cognome}`;
    document.getElementById('stag-ombrellone').textContent = stab ? `${stab.nome}${stab.citta ? ' — ' + stab.citta : ''}` : '';
    document.getElementById('stag-credito').textContent = '€ –';
    const banner = document.createElement('div');
    banner.id = 'stag-pending-banner';
    banner.className = 'alert alert-info';
    banner.style.cssText = 'margin:0 0 20px;font-size:14px;line-height:1.7';
    banner.innerHTML = `⏳ <strong>Iscrizione in attesa di approvazione.</strong><br>
      Il proprietario di <strong>${stab?.nome || 'questo stabilimento'}</strong> deve confermare la tua registrazione.
      Riceverai un'email non appena sarà approvata. Per urgenze contatta direttamente lo stabilimento.`;
    const heroEl = document.getElementById('stag-ombrellone')?.closest('.user-hero');
    if (heroEl) heroEl.insertAdjacentElement('afterend', banner);
    else document.getElementById('view-stagionale').querySelector('.main-content')?.prepend(banner);
    document.getElementById('stag-tx-list').innerHTML = '<div class="tx-empty">Disponibile dopo l\'approvazione</div>';
    buildCalendar([],[]);
    return;
  }

  stagClienteId = cliente.id;
  stagOmbrelloneId = cliente.ombrellone_id;
  const omb = cliente.ombrelloni;
  const stab = omb?.stabilimenti;
  document.getElementById('stag-nome').textContent = `${currentProfile?.nome || cliente.nome} ${currentProfile?.cognome || cliente.cognome}`;
  document.getElementById('stag-ombrellone').textContent = omb ? `☂️ Ombrellone ${omb.fila}${omb.numero} · ${stab?.nome || ''} · ${stab?.citta || ''}` : 'Nessun ombrellone';
  document.getElementById('stag-credito').textContent = `€ ${parseFloat(cliente.credito_saldo || 0).toFixed(2)}`;

  const { data: disp } = await sb.from('disponibilita').select('*').eq('ombrellone_id', stagOmbrelloneId);
  const dispMap = {};
  (disp || []).forEach(d => { dispMap[d.data] = d.stato; });
  buildCalendar(dispMap, disp || []);

  const { data: txs } = await sb.from('transazioni').select('*').eq('cliente_id', stagClienteId).order('created_at', { ascending: false }).limit(20);
  document.getElementById('stag-tx-list').innerHTML = renderTxList(txs || []);
}

function buildCalendar(dispMap, dispList) {
  currentDispMap = dispMap;
  renderCalendar();
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
    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else if (isToday) cls += ' today';
    if (stato === 'libero') cls += ' free';
    if (stato === 'sub_affittato') cls += ' subleased';
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = d;
    if (!isPast && stagOmbrelloneId) {
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

async function toggleDay(dateStr, currentStato) {
  if (!stagOmbrelloneId) return;
  if (currentStato === 'sub_affittato') { showAlert('stag-alert', 'Questo giorno è già sub-affittato, non puoi modificarlo', 'error'); return; }
  showLoading();
  if (currentStato === 'libero') {
    await sb.from('disponibilita').delete().eq('ombrellone_id', stagOmbrelloneId).eq('data', dateStr);
    const { data: cliente } = await sb.from('clienti_stagionali').select('stabilimento_id').eq('id', stagClienteId).single();
    await sb.from('transazioni').insert({ stabilimento_id: cliente.stabilimento_id, ombrellone_id: stagOmbrelloneId, cliente_id: stagClienteId, tipo: 'disponibilita_rimossa', nota: `Disponibilità rimossa per ${formatDate(dateStr)}` });
    delete currentDispMap[dateStr];
  } else {
    await sb.from('disponibilita').upsert({ ombrellone_id: stagOmbrelloneId, cliente_id: stagClienteId, data: dateStr, stato: 'libero' }, { onConflict: 'ombrellone_id,data' });
    const { data: cliente } = await sb.from('clienti_stagionali').select('stabilimento_id').eq('id', stagClienteId).single();
    await sb.from('transazioni').insert({ stabilimento_id: cliente.stabilimento_id, ombrellone_id: stagOmbrelloneId, cliente_id: stagClienteId, tipo: 'disponibilita_aggiunta', nota: `Disponibilità dichiarata per ${formatDate(dateStr)}` });
    currentDispMap[dateStr] = 'libero';
  }
  hideLoading();
  renderCalendar();
  await loadStagionaleData();
}

async function toggleTodayFree() {
  const today = todayStr();
  await toggleDay(today, currentDispMap[today]);
}
