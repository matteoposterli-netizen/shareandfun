// js/configurazioni.js — Configurazioni manager (subtab Stagione + Email)
//
// Estratto dal vecchio js/panoramica.js per separare la logica della tab
// Configurazioni (mtab-config) dalla nuova Panoramica (mtab-panoramica).
//
// Esporta globals: switchConfigSubtab, loadStagione, saveStagione

/* ---------- Configurazioni → subtab switcher ---------- */
function switchConfigSubtab(sub, btn) {
  document.querySelectorAll('#mtab-config > .config-subpanel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('config-sub-' + sub);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('#mtab-config > .config-subtabs .config-subtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (sub === 'stagione') {
    loadStagione();
    if (typeof loadRegoleStato === 'function') loadRegoleStato();
    if (typeof loadBackupList === 'function') loadBackupList();
  }
  if (sub === 'avanzate' && typeof avanzateInit === 'function') avanzateInit();
}

/* ---------- Stagione: load/save ---------- */
function loadStagione() {
  if (!currentStabilimento) return;
  const year = new Date().getFullYear();
  const rawI = currentStabilimento.data_inizio_stagione;
  const rawF = currentStabilimento.data_fine_stagione;
  const inizio = (rawI ? String(rawI).slice(0, 10) : '') || `${year}-04-01`;
  const fine   = (rawF ? String(rawF).slice(0, 10) : '') || `${year}-09-30`;
  const elI = document.getElementById('stagione-inizio');
  const elF = document.getElementById('stagione-fine');
  setDateInputValue(elI, inizio);
  setDateInputValue(elF, fine);
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

/* ---------- Regole forzate (chiusura_speciale / sempre_libero / mai_libero) ---------- */

let regoleStatoList = [];

const REGOLA_LABELS = {
  chiusura_speciale: { label: 'Chiusura speciale', emoji: '🚫', color: 'var(--coral)', bg: 'var(--coral-light)' },
  sempre_libero:     { label: 'Sempre subaffittabile', emoji: '✅', color: 'var(--green)', bg: 'var(--green-light)' },
  mai_libero:        { label: 'Mai subaffittabile', emoji: '🔒', color: '#9C7A1F', bg: 'var(--yellow-light)' },
};

async function loadRegoleStato() {
  if (!currentStabilimento) return;
  const { data, error } = await sb.from('regole_stato_ombrelloni')
    .select('*')
    .eq('stabilimento_id', currentStabilimento.id)
    .order('data_da', { ascending: false });
  if (error) {
    regoleStatoList = [];
    const el = document.getElementById('regole-list');
    if (el) el.innerHTML = `<div class="alert alert-coral">Errore caricamento regole: ${escapeHtml(error.message)}</div>`;
    return;
  }
  regoleStatoList = data || [];
  renderRegoleList();
}

function renderRegoleList() {
  const el = document.getElementById('regole-list');
  if (!el) return;
  const showHist = document.getElementById('regole-show-history')?.checked;
  const today = todayStr();
  const items = regoleStatoList.filter(r => showHist || r.data_a >= today);
  if (!items.length) {
    el.innerHTML = `<div style="color:var(--text-light);font-size:13px;padding:8px 0">${
      showHist ? 'Nessuna regola registrata.' : 'Nessuna regola attiva o futura. Spunta "Mostra anche le regole passate" per vederle tutte.'
    }</div>`;
    return;
  }
  el.innerHTML = items.map(r => {
    const meta = REGOLA_LABELS[r.tipo] || { label: r.tipo, emoji: '•', color: 'var(--text-mid)', bg: 'var(--sand)' };
    const range = r.data_da === r.data_a
      ? formatDate(r.data_da)
      : `${formatDate(r.data_da)} → ${formatDate(r.data_a)}`;
    const isPast = r.data_a < today;
    const nota = r.nota && r.nota.trim()
      ? `<div style="font-size:12px;color:var(--text-mid);margin-top:4px">${escapeHtml(r.nota)}</div>`
      : '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;${isPast ? 'opacity:0.6;' : ''}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="background:${meta.bg};color:${meta.color};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600">${meta.emoji} ${escapeHtml(meta.label)}</span>
            <span style="font-size:13px;color:var(--text-strong);font-weight:600">${escapeHtml(range)}</span>
            ${isPast ? '<span style="font-size:11px;color:var(--text-light)">(passata)</span>' : ''}
          </div>
          ${nota}
        </div>
        <button class="btn btn-outline btn-sm" onclick="eliminaRegolaStato('${r.id}')">Rimuovi</button>
      </div>`;
  }).join('');
}

async function creaRegolaStato() {
  if (!currentStabilimento) return;
  const alert = document.getElementById('regole-save-alert');
  const tipo  = document.getElementById('regola-tipo').value;
  const dDa   = document.getElementById('regola-data-da').value;
  const dA    = document.getElementById('regola-data-a').value;
  const nota  = (document.getElementById('regola-nota').value || '').trim();
  if (!tipo || !dDa || !dA) {
    alert.innerHTML = '<div class="alert alert-coral">Seleziona tipo e date.</div>';
    return;
  }
  if (dA < dDa) {
    alert.innerHTML = '<div class="alert alert-coral">La data di fine deve essere uguale o successiva a quella di inizio.</div>';
    return;
  }

  // Conferma esplicita per chiusura_speciale con sub-affitti nel range.
  if (tipo === 'chiusura_speciale') {
    const { data: ombs } = await sb.from('ombrelloni')
      .select('id').eq('stabilimento_id', currentStabilimento.id);
    const ombIds = (ombs || []).map(o => o.id);
    let nBookings = 0;
    if (ombIds.length) {
      const { count } = await sb.from('disponibilita')
        .select('id', { count: 'exact', head: true })
        .in('ombrellone_id', ombIds)
        .gte('data', dDa).lte('data', dA)
        .eq('stato', 'sub_affittato');
      nBookings = count || 0;
    }
    if (nBookings > 0) {
      const ok = confirm(
        `Ci sono ${nBookings} sub-affitt${nBookings === 1 ? 'o' : 'i'} nel range scelto.\n\n` +
        `Verranno annullati automaticamente e il credito verrà rimborsato ai clienti.\n\n` +
        `Continuare?`
      );
      if (!ok) return;
    }
  }

  showLoading();
  const { error } = await sb.rpc('crea_regola_stato', {
    p_stabilimento_id: currentStabilimento.id,
    p_tipo: tipo,
    p_data_da: dDa,
    p_data_a: dA,
    p_nota: nota || null,
  });
  hideLoading();
  if (error) {
    alert.innerHTML = `<div class="alert alert-coral">Errore: ${escapeHtml(error.message)}</div>`;
    return;
  }
  alert.innerHTML = '<div class="alert alert-info">✓ Regola creata.</div>';
  document.getElementById('regola-data-da').value = '';
  document.getElementById('regola-data-a').value = '';
  document.getElementById('regola-nota').value = '';
  await loadRegoleStato();
  setTimeout(() => { if (alert) alert.innerHTML = ''; }, 3000);
}

async function eliminaRegolaStato(id) {
  if (!id) return;
  const r = regoleStatoList.find(x => x.id === id);
  if (!r) return;
  const meta = REGOLA_LABELS[r.tipo] || { label: r.tipo };
  const range = r.data_da === r.data_a ? formatDate(r.data_da) : `${formatDate(r.data_da)} → ${formatDate(r.data_a)}`;
  if (!confirm(`Rimuovere la regola "${meta.label}" del ${range}?\n\nI clienti stagionali riceveranno una notifica nel proprio storico.`)) return;
  showLoading();
  const { error } = await sb.rpc('elimina_regola_stato', { p_regola_id: id });
  hideLoading();
  const alert = document.getElementById('regole-save-alert');
  if (error) {
    if (alert) alert.innerHTML = `<div class="alert alert-coral">Errore: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (alert) alert.innerHTML = '<div class="alert alert-info">✓ Regola rimossa.</div>';
  await loadRegoleStato();
  setTimeout(() => { if (alert) alert.innerHTML = ''; }, 3000);
}

/* Esponi funzioni globali usate dall'HTML */
window.switchConfigSubtab = switchConfigSubtab;
window.loadStagione = loadStagione;
window.saveStagione = saveStagione;
window.loadRegoleStato = loadRegoleStato;
window.renderRegoleList = renderRegoleList;
window.creaRegolaStato = creaRegolaStato;
window.eliminaRegolaStato = eliminaRegolaStato;
