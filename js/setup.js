function goSetupStep(step) {
  document.querySelectorAll('.setup-step').forEach(s => s.classList.remove('active'));
  document.getElementById('setup-' + step).classList.add('active');
  for (let i = 1; i <= 2; i++) document.getElementById('sp' + i).classList.toggle('done', i <= step);
}

async function saveStabilimento() {
  const nome = document.getElementById('stab-nome').value.trim();
  const citta = document.getElementById('stab-citta').value.trim();
  const indirizzo = document.getElementById('stab-indirizzo').value.trim();
  const telefono = document.getElementById('stab-telefono').value.trim();
  if (!nome || !citta) { showAlert('setup1-alert', 'Nome e città sono obbligatori', 'error'); return; }
  const emailStab = document.getElementById('stab-email').value.trim();
  const { data, error } = await sb.from('stabilimenti').insert({ proprietario_id: currentUser.id, nome, citta, indirizzo, telefono, email: emailStab || null }).select().single();
  if (error) { showAlert('setup1-alert', error.message, 'error'); return; }
  currentStabilimento = data;
  goSetupStep(2);
}

function addOmbrellone() {
  const fila = document.getElementById('omb-fila').value.trim().toUpperCase();
  const numero = parseInt(document.getElementById('omb-numero').value);
  const credito = parseFloat(document.getElementById('omb-credito').value) || 10;
  if (!fila || !numero) { showAlert('setup2-alert', 'Fila e numero sono obbligatori', 'error'); return; }
  setupOmbrelloni.push({ fila, numero, credito_giornaliero: credito });
  renderSetupOmbrelloni();
  document.getElementById('omb-fila').value = '';
  document.getElementById('omb-numero').value = '';
  document.getElementById('omb-credito').value = '';
}

function renderSetupOmbrelloni() {
  const el = document.getElementById('ombrelloni-list');
  if (!setupOmbrelloni.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card"><div class="card-body" style="padding:12px 16px">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">Ombrelloni da aggiungere (${setupOmbrelloni.length})</div>
    ${setupOmbrelloni.map((o,i) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span>☂️ Fila ${o.fila} — N° ${o.numero} — € ${o.credito_giornaliero.toFixed(2)}/giorno</span>
      <button onclick="removeSetupOmb(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">✕</button>
    </div>`).join('')}
  </div></div>`;
}

function removeSetupOmb(i) { setupOmbrelloni.splice(i, 1); renderSetupOmbrelloni(); }

function loadCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let rows = parseCSV(ev.target.result);
    if (rows.length && isHeaderRow(rows[0], 1)) rows = rows.slice(1);
    const existing = new Set(setupOmbrelloni.map(o => `${o.fila}|${o.numero}`));
    let added = 0, skippedDup = 0, skippedInvalid = 0;
    rows.forEach(parts => {
      if (parts.length < 2) { skippedInvalid++; return; }
      const fila = (parts[0] || '').toUpperCase();
      const numero = parseInt(parts[1]);
      const credito = parseFloat(parts[2]) || 10;
      if (!fila || !numero) { skippedInvalid++; return; }
      const key = `${fila}|${numero}`;
      if (existing.has(key)) { skippedDup++; return; }
      existing.add(key);
      setupOmbrelloni.push({ fila, numero, credito_giornaliero: credito });
      added++;
    });
    renderSetupOmbrelloni();
    const extra = [];
    if (skippedDup) extra.push(`${skippedDup} duplicati`);
    if (skippedInvalid) extra.push(`${skippedInvalid} righe non valide`);
    const suffix = extra.length ? ` (saltati: ${extra.join(', ')})` : '';
    showAlert('setup2-alert', `${added} ombrelloni aggiunti dal CSV${suffix}`, added ? 'success' : 'error');
    e.target.value = '';
  };
  reader.readAsText(file);
}

async function finishSetup() {
  if (setupOmbrelloni.length === 0) { showAlert('setup2-alert', 'Aggiungi almeno un ombrellone per continuare', 'error'); return; }
  showLoading();
  const rows = setupOmbrelloni.map(o => ({ ...o, stabilimento_id: currentStabilimento.id }));
  const { error } = await sb.from('ombrelloni').insert(rows);
  hideLoading();
  if (error) { showAlert('setup2-alert', error.message, 'error'); return; }
  await loadManagerData();
  showView('manager');
}
