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

async function loadCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  showAlert('setup2-alert', '', '');
  const parsed = await readCSVFile(file, 1);
  const rows = [];
  let invalid = 0;
  parsed.forEach(parts => {
    if (parts.length < 2) { invalid++; return; }
    const fila = (parts[0] || '').toUpperCase();
    const numero = parseInt(parts[1]);
    const credito = parseFloat(parts[2]) || 10;
    if (!fila || !numero) { invalid++; return; }
    rows.push({ fila, numero, credito_giornaliero: credito });
  });
  if (!rows.length) {
    showAlert('setup2-alert', 'Nessuna riga valida trovata nel CSV', 'error');
    e.target.value = '';
    return;
  }
  csvOmbrelloniRows = rows;
  renderCSVOmbrelloniPreview(rows);
  const suffix = invalid ? ` (${invalid} righe non valide saltate)` : '';
  showAlert('setup2-alert', `${rows.length} ombrelloni letti dal CSV${suffix}. Seleziona quelli da aggiungere.`, 'success');
  e.target.value = '';
}

function renderCSVOmbrelloniPreview(rows) {
  const wrap = document.getElementById('csv-omb-preview');
  const actions = document.getElementById('csv-omb-actions');
  const existing = new Set(setupOmbrelloni.map(o => `${o.fila}|${o.numero}`));
  const seen = new Set();
  wrap.innerHTML = `
    <div class="csv-preview-wrap" style="margin-top:12px">
      <div class="csv-check-all">
        <input type="checkbox" id="csv-omb-check-all" onchange="toggleAllCSVOmb(this.checked)" checked>
        <label for="csv-omb-check-all">Seleziona tutti</label>
      </div>
      <div class="csv-row ombrelloni header"><div></div><div>Fila</div><div>Numero</div><div>Credito</div><div>Stato</div></div>
      ${rows.map((r, i) => {
        const key = `${r.fila}|${r.numero}`;
        let flag = '<span style="color:var(--green);font-size:11px;font-weight:600">nuovo</span>';
        let dup = false;
        if (existing.has(key)) { flag = '<span class="omb-missing">già aggiunto</span>'; dup = true; }
        else if (seen.has(key)) { flag = '<span class="omb-missing">duplicato nel CSV</span>'; dup = true; }
        else seen.add(key);
        const attrs = dup ? 'disabled' : 'checked';
        return `
        <div class="csv-row ombrelloni">
          <input type="checkbox" class="csv-omb-check" data-idx="${i}" ${attrs} onchange="updateCSVOmbCount()">
          <div>${escapeHtml(r.fila)}</div>
          <div>${r.numero}</div>
          <div>€ ${r.credito_giornaliero.toFixed(2)}</div>
          <div>${flag}</div>
        </div>`;
      }).join('')}
    </div>`;
  actions.classList.remove('hidden');
  actions.style.display = 'flex';
  updateCSVOmbCount();
}

function toggleAllCSVOmb(checked) {
  document.querySelectorAll('.csv-omb-check:not(:disabled)').forEach(cb => cb.checked = checked);
  updateCSVOmbCount();
}

function updateCSVOmbCount() {
  const total = document.querySelectorAll('.csv-omb-check:checked').length;
  const el = document.getElementById('csv-omb-count');
  if (el) el.textContent = `${total} selezionati`;
}

function confermaCSVOmbrelloni() {
  const toAdd = [];
  document.querySelectorAll('.csv-omb-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (!isNaN(idx)) toAdd.push(csvOmbrelloniRows[idx]);
  });
  if (!toAdd.length) { showAlert('setup2-alert', 'Nessun ombrellone selezionato', 'error'); return; }
  const existing = new Set(setupOmbrelloni.map(o => `${o.fila}|${o.numero}`));
  let added = 0;
  toAdd.forEach(r => {
    const k = `${r.fila}|${r.numero}`;
    if (existing.has(k)) return;
    existing.add(k);
    setupOmbrelloni.push(r);
    added++;
  });
  annullaCSVOmbrelloni();
  renderSetupOmbrelloni();
  showAlert('setup2-alert', `✅ ${added} ombrelloni aggiunti`, 'success');
}

function annullaCSVOmbrelloni() {
  csvOmbrelloniRows = [];
  document.getElementById('csv-omb-preview').innerHTML = '';
  const actions = document.getElementById('csv-omb-actions');
  actions.classList.add('hidden');
  actions.style.display = '';
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
