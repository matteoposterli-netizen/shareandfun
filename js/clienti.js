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

function renderPendingRequests(pending, csvRecords, ombs) {
  const container = document.getElementById('pending-container');
  if (!pending.length) { container.innerHTML = '<div class="pending-empty">Nessuna richiesta in attesa ✓</div>'; return; }
  const ombById = {};
  ombs.forEach(o => ombById[o.id] = o);
  container.innerHTML = pending.map(p => {
    const match = calcolaMatch(p, csvRecords, ombById);
    const ombPLabel = p.ombrellone_id ? ombById[p.ombrellone_id] : null;
    return `<div class="match-card">
      <div class="match-card-header">
        <div>
          <strong>${p.nome} ${p.cognome}</strong>
          <span style="font-size:12px;color:var(--text-light);margin-left:8px">${p.email}</span>
        </div>
        <span class="match-badge ${match.tipo === 'completo' ? 'match-100' : match.tipo === 'parziale' ? 'match-parziale' : 'match-nessuno'}">
          ${match.tipo === 'completo' ? '✓ Corrispondenza trovata' : match.tipo === 'parziale' ? '⚠ Match parziale' : '✗ Non nel CSV'}
        </span>
      </div>
      ${match.tipo !== 'nessuno' ? renderMatchFields(p, match.record, ombById) : ''}
      ${match.tipo === 'nessuno' ? `<div style="padding:12px 18px;font-size:13px;color:var(--text-light)">
        Il cliente non è presente nella lista pre-caricata via CSV. Puoi approvarlo manualmente.
      </div>` : ''}
      <div class="match-actions">
        ${match.tipo === 'completo' ? `<button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">✓ Approva subito</button>` : ''}
        ${match.tipo === 'parziale' ? `
          <button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">Approva</button>
          ${match.record ? `<button class="btn btn-outline btn-sm" onclick="approvaConMerge('${p.id}','${match.record.id}')">Approva e aggiorna dati CSV</button>` : ''}` : ''}
        ${match.tipo === 'nessuno' ? `<button class="btn btn-green btn-sm" onclick="approvaCliente('${p.id}')">Approva comunque</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="rifiutaCliente('${p.id}')">Rifiuta</button>
        <span style="font-size:11px;color:var(--text-light);margin-left:auto">
          Ombrellone richiesto: ${ombPLabel ? 'Fila ' + ombPLabel.fila + ' N°' + ombPLabel.numero : '–'}
        </span>
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
      <div>Dati del cliente</div><div>Dati nel CSV</div>
    </div>
    <div class="match-fields">
      ${fields.map(f => {
        const ok = f.pVal?.toLowerCase() === f.cVal?.toLowerCase();
        return `<div class="match-field ${ok ? 'ok' : 'diff'}">
          <div class="match-field-label">${f.label}</div>
          <div class="match-field-val">👤 ${f.pVal}</div>
        </div>
        <div class="match-field ${ok ? 'ok' : 'diff'}">
          <div class="match-field-label">${f.label} CSV</div>
          <div class="match-field-val">📋 ${f.cVal}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function calcolaMatch(diretta, csvRecords, ombById) {
  if (!csvRecords.length) return { tipo: 'nessuno', record: null };
  const exact = csvRecords.find(c =>
    c.email?.toLowerCase() === diretta.email?.toLowerCase() &&
    (c.ombrellone_id === diretta.ombrellone_id || !c.ombrellone_id)
  );
  if (exact) return { tipo: 'completo', record: exact };
  const partial = csvRecords.find(c =>
    c.ombrellone_id === diretta.ombrellone_id ||
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
