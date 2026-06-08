// js/crediti-stagionali.js — Sotto-tab "Crediti degli Stagionali" in Gestione Credito

/* ─── Sotto-tab switcher ─── */
function switchCreditiSubtab(name, btn) {
  document.querySelectorAll('.crediti-subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.crediti-subpanel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const el = document.querySelector(`.crediti-subtab[data-crediti-subtab="${name}"]`);
    if (el) el.classList.add('active');
  }
  const pane = document.getElementById('crediti-sub-' + name);
  if (pane) pane.classList.add('active');
  if (name === 'stagionali') loadCreditiStagionali();
}

/* ─── Dati ─── */
let creditiStagData = [];

async function loadCreditiStagionali() {
  const listEl = document.getElementById('crediti-stag-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="tx-empty">Caricamento...</div>';

  if (!currentStabilimento) return;

  const ombs = ombrelloniList || [];
  const clienti = clientiList || [];

  const ombIds = ombs.map(o => o.id);
  if (!ombIds.length) { creditiStagData = []; renderCreditiStagionali(); return; }

  const { data: txAll, error } = await sb
    .from('transazioni')
    .select('*')
    .in('ombrellone_id', ombIds)
    .in('tipo', ['credito_ricevuto', 'credito_usato', 'credito_revocato'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    listEl.innerHTML = '<div class="tx-empty">Errore nel caricamento</div>';
    return;
  }

  const txByOmb = {};
  (txAll || []).forEach(t => {
    if (!txByOmb[t.ombrellone_id]) txByOmb[t.ombrellone_id] = [];
    txByOmb[t.ombrellone_id].push(t);
  });

  creditiStagData = ombs.map(o => {
    const cliente = clienti.find(c => !c.rifiutato && c.ombrellone_id === o.id) || null;
    const txs = txByOmb[o.id] || [];
    const acquisiti = txs.filter(t => t.tipo === 'credito_ricevuto').reduce((s, t) => s + (t.importo || 0), 0);
    const spesi    = txs.filter(t => t.tipo === 'credito_usato').reduce((s, t) => s + (t.importo || 0), 0);
    const revocati = txs.filter(t => t.tipo === 'credito_revocato').reduce((s, t) => s + (t.importo || 0), 0);
    const disponibili = cliente ? parseFloat(cliente.credito_saldo || 0) : 0;
    return { ombrellone: o, cliente, txs, acquisiti, spesi, revocati, disponibili };
  });

  renderCreditiStagionali();
}

function renderCreditiStagionali() {
  const listEl = document.getElementById('crediti-stag-list');
  if (!listEl) return;

  const qNome = (document.getElementById('crediti-stag-search-nome')?.value || '').trim().toLowerCase();
  const qOmb  = (document.getElementById('crediti-stag-search-omb')?.value || '').trim().toLowerCase();

  let rows = creditiStagData;

  if (qNome) {
    rows = rows.filter(r => {
      if (!r.cliente) return false;
      const full = ((r.cliente.nome || '') + ' ' + (r.cliente.cognome || '')).toLowerCase();
      return full.includes(qNome);
    });
  }
  if (qOmb) {
    rows = rows.filter(r => {
      const cod = (r.ombrellone.codice || '').toLowerCase();
      return cod.includes(qOmb.replace(/\s/g, ''));
    });
  }

  if (!rows.length) {
    listEl.innerHTML = '<div class="tx-empty">Nessun risultato</div>';
    return;
  }

  const n = v => parseFloat(v || 0).toFixed(2);
  const body = rows.map(r => {
    const nomeCliente = r.cliente
      ? escapeHtml(((r.cliente.nome || '') + ' ' + (r.cliente.cognome || '')).trim())
      : '<span class="cst-nessun">Nessun cliente</span>';
    const ombLabel = escapeHtml(r.ombrellone.codice || '');
    return `
      <tr>
        <td class="cst-omb">${ombLabel}</td>
        <td class="cst-nome">${nomeCliente}</td>
        <td class="cst-num disponibili">${n(r.disponibili)}</td>
        <td class="cst-num spesi">${n(r.spesi)}</td>
        <td class="cst-action"><button type="button" class="crediti-stag-card-btn" onclick="openCreditiStagModal('${r.ombrellone.id}')" aria-label="Vedi transazioni" title="Vedi transazioni">📋</button></td>
      </tr>`;
  }).join('');

  listEl.innerHTML = `
    <table class="crediti-stag-table">
      <thead>
        <tr>
          <th class="cst-omb">Ombrellone</th>
          <th class="cst-nome">Stagionale</th>
          <th class="cst-num">Disp</th>
          <th class="cst-num">Spesi</th>
          <th class="cst-action"></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

/* ─── Modal dettaglio ─── */
function openCreditiStagModal(ombId) {
  const row = creditiStagData.find(r => r.ombrellone.id === ombId);
  if (!row) return;

  const stab = currentStabilimento;
  const ombLabel = escapeHtml(row.ombrellone.codice || '');
  const nomeCliente = row.cliente
    ? escapeHtml(((row.cliente.nome || '') + ' ' + (row.cliente.cognome || '')).trim())
    : 'Nessun cliente';

  document.getElementById('crediti-stag-modal-title').textContent = `${ombLabel} — ${nomeCliente}`;

  const summaryEl = document.getElementById('crediti-stag-modal-summary');
  summaryEl.innerHTML = `
    <div class="crediti-stag-modal-sum-row">
      <div class="crediti-stag-modal-sum-item">
        <div class="crediti-stag-modal-sum-label">Disponibili</div>
        <div class="crediti-stag-modal-sum-val disponibili">${formatCoin(row.disponibili, stab)}</div>
      </div>
      <div class="crediti-stag-modal-sum-item">
        <div class="crediti-stag-modal-sum-label">Acquisiti</div>
        <div class="crediti-stag-modal-sum-val acquisiti">${formatCoin(row.acquisiti, stab)}</div>
      </div>
      <div class="crediti-stag-modal-sum-item">
        <div class="crediti-stag-modal-sum-label">Spesi</div>
        <div class="crediti-stag-modal-sum-val spesi">${formatCoin(row.spesi, stab)}</div>
      </div>
    </div>`;

  const txEl = document.getElementById('crediti-stag-modal-tx-list');
  if (!row.txs.length) {
    txEl.innerHTML = '<div class="tx-empty" style="padding:20px">Nessuna transazione coin</div>';
  } else {
    const typeLabels = {
      credito_ricevuto: '💰 Coin ricevuti',
      credito_usato:    '🛍️ Coin utilizzati',
      credito_revocato: '↩️ Coin revocati',
    };
    const typeClass = {
      credito_ricevuto: 'acquisiti',
      credito_usato:    'spesi',
      credito_revocato: 'revocati',
    };
    txEl.innerHTML = row.txs.map(t => `
      <div class="crediti-stag-modal-tx-row">
        <div class="crediti-stag-modal-tx-info">
          <div class="crediti-stag-modal-tx-tipo">${typeLabels[t.tipo] || t.tipo}</div>
          <div class="crediti-stag-modal-tx-nota">${escapeHtml(t.nota || '—')}</div>
          <div class="crediti-stag-modal-tx-data">${formatDateShort(t.created_at)}</div>
        </div>
        <div class="crediti-stag-modal-tx-importo ${typeClass[t.tipo] || ''}">
          ${t.tipo === 'credito_ricevuto' ? '+' : '-'}${formatCoin(t.importo || 0, stab)}
        </div>
      </div>`).join('');
  }

  document.getElementById('modal-crediti-stag-dettaglio').classList.remove('hidden');
}

function closeCreditiStagModal() {
  document.getElementById('modal-crediti-stag-dettaglio').classList.add('hidden');
}
