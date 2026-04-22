function loadCSVClienti(e) {
  const file = e.target.files[0];
  if (!file) return;
  showAlert('csv-clienti-alert', '', '');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const lines = ev.target.result.split('\n').map(l => l.trim()).filter(l => l);
    const dataLines = lines[0].toLowerCase().includes('nome') || lines[0].toLowerCase().includes('ombrellone') ? lines.slice(1) : lines;
    if (dataLines.length > 1000) {
      showAlert('csv-clienti-alert', `❌ Il file contiene ${dataLines.length} righe. Il limite massimo è 1000 righe. Riduci il file e riprova.`, 'error');
      e.target.value = '';
      return;
    }
    const rows = [];
    dataLines.forEach((line, i) => {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 3) return;
      const numero = parseInt(parts[0]);
      const nome = parts[1] || '';
      const cognome = parts[2] || '';
      const telefono = parts[3] || '';
      const email = parts[4] || '';
      if (!numero || !nome) return;
      rows.push({ numero, nome, cognome, telefono, email, _idx: i });
    });
    if (!rows.length) { showAlert('csv-clienti-alert', 'Nessuna riga valida trovata nel CSV', 'error'); return; }
    csvClientiRows = rows;
    renderCSVAnteprima(rows);
    showAlert('csv-clienti-alert', `✅ ${rows.length} clienti caricati dal CSV`, 'success');
  };
  reader.readAsText(file);
}

function renderCSVAnteprima(rows) {
  const wrap = document.getElementById('csv-clienti-preview');
  const actions = document.getElementById('csv-invito-actions');
  wrap.innerHTML = `
    <div class="csv-preview-wrap">
      <div class="csv-check-all">
        <input type="checkbox" id="csv-check-all" onchange="toggleAllCSV(this.checked)" checked>
        <label for="csv-check-all">Seleziona tutti (${rows.length})</label>
      </div>
      <div class="csv-row header"><div></div><div>Nome</div><div>Cognome</div><div>Telefono</div><div>Email</div></div>
      ${rows.map((r, i) => `
        <div class="csv-row">
          <input type="checkbox" class="csv-check" data-idx="${i}" checked onchange="updateCSVCount()">
          <div>${r.nome}</div>
          <div>${r.cognome}</div>
          <div>${r.telefono || '–'}</div>
          <div>${r.email || '<span style="color:var(--red)">mancante</span>'}</div>
        </div>`).join('')}
    </div>`;
  actions.classList.remove('hidden');
  actions.style.display = 'flex';
  updateCSVCount();
}

function toggleAllCSV(checked) {
  document.querySelectorAll('.csv-check').forEach(cb => cb.checked = checked);
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
  const withoutEmail = selected.filter(r => !r.email);
  if (withoutEmail.length) { showAlert('csv-clienti-alert', `⚠️ ${withoutEmail.length} clienti non hanno email e verranno saltati`, 'error'); }
  const withEmail = selected.filter(r => r.email);
  if (!withEmail.length) { showAlert('csv-clienti-alert', 'Nessun cliente con email valida selezionato', 'error'); return; }

  showLoading();
  const ombByNumero = {};
  ombrelloniList.forEach(o => { ombByNumero[o.numero] = o; });

  let inviati = 0;
  for (const row of withEmail) {
    const omb = ombByNumero[row.numero];
    const { data: existing } = await sb.from('clienti_stagionali')
      .select('id,invito_token,invitato_at')
      .eq('stabilimento_id', currentStabilimento.id)
      .eq('email', row.email)
      .maybeSingle();
    let clienteId, token;
    if (existing) {
      clienteId = existing.id;
      token = existing.invito_token;
      await sb.from('clienti_stagionali').update({ nome: row.nome, cognome: row.cognome, telefono: row.telefono, ombrellone_id: omb?.id || null, invitato_at: new Date().toISOString() }).eq('id', clienteId);
    } else {
      const { data: ins } = await sb.from('clienti_stagionali').insert({
        stabilimento_id: currentStabilimento.id, ombrellone_id: omb?.id || null,
        nome: row.nome, cognome: row.cognome, email: row.email, telefono: row.telefono,
        fonte: 'csv', approvato: false, invitato_at: new Date().toISOString()
      }).select('id,invito_token').single();
      clienteId = ins?.id;
      token = ins?.invito_token;
    }
    if (token) {
      const inviteLink = `${window.location.origin}/?invito=${token}`;
      await inviaEmail('invito', { email: row.email, nome: row.nome, cognome: row.cognome, invite_link: inviteLink }, currentStabilimento);
      inviati++;
    }
  }
  hideLoading();
  await loadManagerData();
  showAlert('csv-clienti-alert', `✅ Inviti inviati a ${inviati} clienti`, 'success');
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
