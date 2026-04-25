// js/configurazioni.js — Configurazioni manager (subtab Stagione + Email)
//
// Estratto dal vecchio js/panoramica.js per separare la logica della tab
// Configurazioni (mtab-config) dalla nuova Panoramica (mtab-panoramica).
//
// Esporta globals: switchConfigSubtab, loadStagione, saveStagione

/* ---------- Configurazioni → subtab switcher ---------- */
function switchConfigSubtab(sub, btn) {
  document.querySelectorAll('.config-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('config-sub-' + sub);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.config-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'stagione') loadStagione();
}

/* ---------- Stagione: load/save ---------- */
function loadStagione() {
  if (!currentStabilimento) return;
  const inizio = currentStabilimento.data_inizio_stagione || '';
  const fine = currentStabilimento.data_fine_stagione || '';
  const elI = document.getElementById('stagione-inizio');
  const elF = document.getElementById('stagione-fine');
  if (elI) elI.value = inizio;
  if (elF) elF.value = fine;
  renderStagioneSummary(inizio, fine);
  const alert = document.getElementById('stagione-save-alert');
  if (alert) alert.innerHTML = '';
}

function renderStagioneSummary(inizio, fine) {
  const el = document.getElementById('stagione-summary');
  if (!el) return;
  if (!inizio || !fine) {
    el.innerHTML = '<span style="color:var(--text-light)">Imposta entrambe le date per vedere la progressione.</span>';
    return;
  }
  const from = new Date(inizio + 'T00:00:00');
  const to = new Date(fine + 'T00:00:00');
  const today = new Date(todayStr() + 'T00:00:00');
  const totale = Math.round((to - from) / 86400000) + 1;
  if (totale <= 0) {
    el.innerHTML = '<span style="color:var(--coral)">La data di fine deve essere successiva a quella di inizio.</span>';
    return;
  }
  let progress = 0, statoTxt = '';
  if (today < from) {
    const gg = Math.round((from - today) / 86400000);
    statoTxt = `La stagione inizia fra <strong>${gg}</strong> ${gg === 1 ? 'giorno' : 'giorni'}`;
    progress = 0;
  } else if (today > to) {
    statoTxt = `Stagione conclusa · durata totale <strong>${totale}</strong> giorni`;
    progress = 100;
  } else {
    const fatti = Math.round((today - from) / 86400000) + 1;
    const rest = totale - fatti;
    statoTxt = `Giorno <strong>${fatti}</strong> di <strong>${totale}</strong> · mancano <strong>${rest}</strong> ${rest === 1 ? 'giorno' : 'giorni'}`;
    progress = Math.round((fatti / totale) * 100);
  }
  el.innerHTML = `
    <div style="font-size:13px;color:var(--text-mid);margin-bottom:10px">${statoTxt}</div>
    <div style="background:#EEE9DF;border-radius:999px;height:10px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#4EA66E 0%,#E3B04B 100%);height:100%;width:${progress}%;transition:width .4s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);margin-top:6px">
      <span>${formatDate(inizio)}</span>
      <span>${formatDate(fine)}</span>
    </div>`;
}

async function saveStagione() {
  if (!currentStabilimento) return;
  const alert = document.getElementById('stagione-save-alert');
  const elI = document.getElementById('stagione-inizio');
  const elF = document.getElementById('stagione-fine');
  const inizio = elI ? elI.value : '';
  const fine = elF ? elF.value : '';
  if (!inizio || !fine) {
    if (alert) alert.innerHTML = '<div class="alert alert-coral">Inserisci entrambe le date.</div>';
    return;
  }
  if (fine < inizio) {
    if (alert) alert.innerHTML = '<div class="alert alert-coral">La fine deve essere uguale o successiva all\'inizio.</div>';
    return;
  }
  const { error } = await sb.from('stabilimenti')
    .update({ data_inizio_stagione: inizio, data_fine_stagione: fine })
    .eq('id', currentStabilimento.id);
  if (error) {
    if (alert) alert.innerHTML = `<div class="alert alert-coral">Errore: ${escapeHtml(error.message)}</div>`;
    return;
  }
  currentStabilimento.data_inizio_stagione = inizio;
  currentStabilimento.data_fine_stagione = fine;
  if (alert) alert.innerHTML = '<div class="alert alert-info">✓ Date stagione salvate.</div>';
  renderStagioneSummary(inizio, fine);
  setTimeout(() => { if (alert) alert.innerHTML = ''; }, 3000);
}

/* Esponi funzioni globali usate dall'HTML */
window.switchConfigSubtab = switchConfigSubtab;
window.loadStagione = loadStagione;
window.saveStagione = saveStagione;
