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
  refreshCoinLabels(currentStabilimento);
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
      <span>☂️ Fila ${o.fila} — N° ${o.numero} — ${formatCoin(o.credito_giornaliero)}/giorno</span>
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
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    lines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const fila = parts[0].trim().toUpperCase();
        const numero = parseInt(parts[1].trim());
        const credito = parseFloat(parts[2]?.trim()) || 10;
        if (fila && numero) setupOmbrelloni.push({ fila, numero, credito_giornaliero: credito });
      }
    });
    renderSetupOmbrelloni();
    showAlert('setup2-alert', `${setupOmbrelloni.length} ombrelloni caricati dal CSV`, 'success');
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
