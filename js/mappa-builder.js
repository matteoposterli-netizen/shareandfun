// ===== MAPPA BUILDER =====
// Visual builder for beach umbrella layout during onboarding

const MAPPA_COLS = 20;
const MAPPA_ROWS = 20;
const CELL_TIPO = { OMBRELLONE: 'ombrellone', PASSERELLA: 'passerella', VUOTO: 'vuoto' };

let mappaState = {
  grid: [],
  codici: {},
  modalita: CELL_TIPO.OMBRELLONE,
  step: 1,
  selectedCell: null
};

let _mappaStabilimentoId = null;

// Inietta CSS per stati errore e counter (evita modifica a styles.css e index.html)
(function _injectMappaStyles() {
  if (document.getElementById('mappa-builder-styles')) return;
  const s = document.createElement('style');
  s.id = 'mappa-builder-styles';
  s.textContent = `
    .codice-row-error { background: #FDEBEA !important; border-color: #D9534F !important; }
    .codice-input-error { border-color: #D9534F !important; box-shadow: 0 0 0 2px rgba(217,83,79,0.2) !important; }
    .mappa-missing-counter {
      font-size: 12px; font-weight: 600; padding: 4px 10px;
      border-radius: 6px; display: inline-block; margin-right: 8px;
    }
    .mappa-missing-counter.has-missing { color: var(--red); background: var(--red-light); }
    .mappa-missing-counter.all-done { color: var(--green); background: var(--green-light); }
  `;
  document.head.appendChild(s);
})();

function initGrid() {
  mappaState.grid = Array.from({ length: MAPPA_ROWS }, () =>
    Array(MAPPA_COLS).fill(CELL_TIPO.VUOTO)
  );
  mappaState.codici = {};
  mappaState.selectedCell = null;
  mappaState.step = 1;
}

function getOmbrelloniCount() {
  return mappaState.grid.flat().filter(t => t === CELL_TIPO.OMBRELLONE).length;
}

function setModalita(tipo) {
  mappaState.modalita = tipo;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btnId = tipo === CELL_TIPO.OMBRELLONE ? 'btn-mode-ombrellone'
              : tipo === CELL_TIPO.PASSERELLA ? 'btn-mode-passerella'
              : 'btn-mode-vuoto';
  document.getElementById(btnId)?.classList.add('active');
}

function updateCell(r, c) {
  const stepEl = mappaState.step === 2 ? document.getElementById('mappa-grid-step2') : document.getElementById('mappa-grid-step1');
  const el = stepEl ? stepEl.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null;
  if (!el) return;
  const tipo = mappaState.grid[r][c];
  el.className = `mappa-cell tipo-${tipo}`;
  if (tipo === CELL_TIPO.OMBRELLONE) {
    const cod = mappaState.codici[`${r}_${c}`];
    el.textContent = cod || '';
  } else {
    el.textContent = '';
  }
}

function updateCounter() {
  const n = getOmbrelloniCount();
  const counter = document.getElementById('mappa-counter');
  if (counter) counter.textContent = `${n} ombrelloni`;
  const btn = document.getElementById('btn-mappa-avanti');
  if (btn) btn.disabled = n === 0;
}

function setCellTipo(r, c, tipo) {
  mappaState.grid[r][c] = tipo;
  if (tipo !== CELL_TIPO.OMBRELLONE) {
    delete mappaState.codici[`${r}_${c}`];
  }
  updateCell(r, c);
  updateCounter();
}

let _mappaDragging = false;

function _addBarMareLabels(gridEl) {
  if (!gridEl || !gridEl.parentElement) return;
  const parent = gridEl.parentElement;
  parent.querySelectorAll('.mappa-bar-label, .mappa-mare-label').forEach(el => el.remove());
  const bar = document.createElement('div');
  bar.className = 'mappa-bar-label';
  bar.textContent = '— BAR —';
  parent.insertBefore(bar, gridEl);
  const mare = document.createElement('div');
  mare.className = 'mappa-mare-label';
  mare.textContent = '— MARE —';
  gridEl.insertAdjacentElement('afterend', mare);
}

// Assicura che il counter "N senza nome" esista accanto al bottone Salva
function _ensureMissingCounter() {
  if (document.getElementById('mappa-missing-counter')) return;
  const btn = document.getElementById('btn-mappa-salva');
  if (!btn || !btn.parentElement) return;
  const span = document.createElement('span');
  span.id = 'mappa-missing-counter';
  span.className = 'mappa-missing-counter';
  btn.parentElement.insertBefore(span, btn);
}

function _aggiornaCounterMancanti() {
  _ensureMissingCounter();
  let missing = 0;
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        const val = (mappaState.codici[`${r}_${c}`] || '').trim();
        if (!val) missing++;
      }
    }
  }
  const el = document.getElementById('mappa-missing-counter');
  if (!el) return;
  if (missing > 0) {
    el.className = 'mappa-missing-counter has-missing';
    el.textContent = `${missing} ombrelon${missing > 1 ? 'i' : 'e'} senza nome`;
  } else {
    el.className = 'mappa-missing-counter all-done';
    el.textContent = '✓ Tutti compilati';
  }
}

function renderMappaStep1() {
  const grid = document.getElementById('mappa-grid-step1');
  if (!grid) return;
  grid.innerHTML = '';
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      const cell = document.createElement('div');
      const tipo = mappaState.grid[r][c];
      cell.className = `mappa-cell tipo-${tipo}`;
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (tipo === CELL_TIPO.OMBRELLONE) {
        const cod = mappaState.codici[`${r}_${c}`];
        cell.textContent = cod || '';
      }
      cell.addEventListener('mousedown', (e) => {
        _mappaDragging = true;
        setCellTipo(r, c, mappaState.modalita);
        e.preventDefault();
      });
      cell.addEventListener('mouseenter', () => {
        if (_mappaDragging) setCellTipo(r, c, mappaState.modalita);
      });
      grid.appendChild(cell);
    }
  }
  grid.addEventListener('mouseup', () => { _mappaDragging = false; });
  document.addEventListener('mouseup', () => { _mappaDragging = false; }, { once: false });
  updateCounter();
  _addBarMareLabels(grid);
}

function renderMappaStep2() {
  const gridEl = document.getElementById('mappa-grid-step2');
  if (gridEl) {
    gridEl.innerHTML = '';
    for (let r = 0; r < MAPPA_ROWS; r++) {
      for (let c = 0; c < MAPPA_COLS; c++) {
        const cell = document.createElement('div');
        const tipo = mappaState.grid[r][c];
        const cod = tipo === CELL_TIPO.OMBRELLONE ? (mappaState.codici[`${r}_${c}`] || '?') : '';
        const hasCode = tipo === CELL_TIPO.OMBRELLONE && mappaState.codici[`${r}_${c}`];
        cell.className = `mappa-cell tipo-${tipo}${tipo === CELL_TIPO.OMBRELLONE ? (hasCode ? ' has-codice' : ' missing-codice') : ''}`;
        cell.textContent = cod;
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (tipo === CELL_TIPO.OMBRELLONE) {
          cell.addEventListener('click', () => selectCellStep2(r, c));
        }
        if (mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c) {
          cell.classList.add('selected');
        }
        gridEl.appendChild(cell);
      }
    }
    _addBarMareLabels(gridEl);
  }

  const table = document.getElementById('mappa-codici-table');
  if (table) {
    table.innerHTML = '';
    let idx = 0;
    for (let r = 0; r < MAPPA_ROWS; r++) {
      for (let c = 0; c < MAPPA_COLS; c++) {
        if (mappaState.grid[r][c] !== CELL_TIPO.OMBRELLONE) continue;
        idx++;
        const row = document.createElement('div');
        const isSelected = mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c;
        row.className = `codice-row${isSelected ? ' selected-row' : ''}`;
        row.id = `codice-row-${r}-${c}`;
        const pos = document.createElement('span');
        pos.className = 'codice-pos';
        pos.textContent = `${idx}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'codice-input';
        input.id = `codice-input-${r}-${c}`;
        input.placeholder = `es. A${idx}`;
        input.value = mappaState.codici[`${r}_${c}`] || '';
        input.addEventListener('input', () => {
          mappaState.codici[`${r}_${c}`] = input.value;
          _aggiornaCounterMancanti();
          row.classList.remove('codice-row-error');
          input.classList.remove('codice-input-error');
          const cellEl = document.querySelector(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
          if (cellEl) {
            const cod = input.value.trim();
            cellEl.textContent = cod || '?';
            cellEl.className = `mappa-cell tipo-ombrellone ${cod ? 'has-codice' : 'missing-codice'}`;
            if (mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c) {
              cellEl.classList.add('selected');
            }
          }
        });
        row.appendChild(pos);
        row.appendChild(input);
        table.appendChild(row);
      }
    }
  }
  _aggiornaCounterMancanti();
}

function selectCellStep2(r, c) {
  mappaState.selectedCell = { r, c };
  document.querySelectorAll('#mappa-grid-step2 .mappa-cell').forEach(el => el.classList.remove('selected'));
  const cellEl = document.querySelector(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
  if (cellEl) cellEl.classList.add('selected');
  document.querySelectorAll('.codice-row').forEach(el => el.classList.remove('selected-row'));
  const rowEl = document.getElementById(`codice-row-${r}-${c}`);
  if (rowEl) rowEl.classList.add('selected-row');
  const input = document.getElementById(`codice-input-${r}-${c}`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function goToStep2() {
  if (getOmbrelloniCount() === 0) return;
  mappaState.step = 2;
  document.getElementById('mappa-step1-content').style.display = 'none';
  document.getElementById('mappa-step2-content').style.display = '';
  document.getElementById('mappa-step-1-label').classList.remove('active');
  document.getElementById('mappa-step-2-label').classList.add('active');
  renderMappaStep2();
}

function goToStep1() {
  mappaState.step = 1;
  document.getElementById('mappa-step2-content').style.display = 'none';
  document.getElementById('mappa-step1-content').style.display = '';
  document.getElementById('mappa-step-1-label').classList.add('active');
  document.getElementById('mappa-step-2-label').classList.remove('active');
  renderMappaStep1();
}

function showMappaError(msg) {
  const el = document.getElementById('mappa-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function validateCodici() {
  const ombrelloni = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        // Leggi dal DOM se disponibile (fonte più affidabile del valore attuale)
        const inputEl = document.getElementById(`codice-input-${r}-${c}`);
        const val = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '').trim();
        if (val) mappaState.codici[`${r}_${c}`] = val; // sincronizza
        ombrelloni.push({ r, c, codice: val });
      }
    }
  }
  const errors = [];
  const vuoti = ombrelloni.filter(o => !o.codice);
  if (vuoti.length) {
    errors.push(`${vuoti.length} ombrelon${vuoti.length > 1 ? 'i' : 'e'} senza nome`);
    // Evidenzia in rosso + scrolla al primo mancante
    vuoti.forEach((o, idx) => {
      const rowEl = document.getElementById(`codice-row-${o.r}-${o.c}`);
      const inputEl = document.getElementById(`codice-input-${o.r}-${o.c}`);
      if (rowEl) rowEl.classList.add('codice-row-error');
      if (inputEl) inputEl.classList.add('codice-input-error');
      if (idx === 0 && inputEl) {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => inputEl.focus(), 300);
      }
    });
  }
  const codiciList = ombrelloni.map(o => o.codice).filter(Boolean);
  const duplicati = codiciList.filter((v, i) => codiciList.indexOf(v) !== i);
  if (duplicati.length) errors.push(`Nomi duplicati: ${[...new Set(duplicati)].join(', ')}`);
  return errors;
}

async function salvaMappaStabilimento(stabilimentoId) {
  const errors = validateCodici();
  if (errors.length) { showMappaError(errors.join(' · ')); return; }

  const btn = document.getElementById('btn-mappa-salva');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  showMappaError('');

  const ombrelloniData = [];
  const passerelleData = [];

  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        const inputEl = document.getElementById(`codice-input-${r}-${c}`);
        const codice = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '').trim();
        ombrelloniData.push({
          stabilimento_id: stabilimentoId,
          codice,
          pos_x: c,
          pos_y: r,
          credito_giornaliero: 10.00
        });
      }
      if (mappaState.grid[r][c] === CELL_TIPO.PASSERELLA) {
        passerelleData.push({ x: c, y: r });
      }
    }
  }

  const { error: errOmb } = await sb.from('ombrelloni').insert(ombrelloniData);
  if (errOmb) {
    showMappaError(errOmb.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salva mappa'; }
    return;
  }

  const { error: errStab } = await sb
    .from('stabilimenti')
    .update({ mappa_passerelle: passerelleData })
    .eq('id', stabilimentoId);
  if (errStab) {
    showMappaError(errStab.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salva mappa'; }
    return;
  }

  chiudiMappaBuilder();
  await loadManagerData();
  showView('manager');
}

function mostraMappaBuilder(stabilimentoId) {
  _mappaStabilimentoId = stabilimentoId;
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = '';
  });
  document.body.className = document.body.className.replace(/\bview-[a-z0-9-]+\b/g, '').trim();
  document.body.classList.add('view-mappa-builder');
  const el = document.getElementById('view-mappa-builder');
  el.style.display = 'block';
  el.classList.add('active');
  goToStep1();
}

function chiudiMappaBuilder() {
  const el = document.getElementById('view-mappa-builder');
  el.classList.remove('active');
  el.style.display = 'none';
  document.body.classList.remove('view-mappa-builder');
  _mappaStabilimentoId = null;
}

async function checkOnboardingMappa(stabilimentoId) {
  const { count } = await sb
    .from('ombrelloni')
    .select('id', { count: 'exact', head: true })
    .eq('stabilimento_id', stabilimentoId);

  if (count === 0) {
    initGrid();
    mostraMappaBuilder(stabilimentoId);
    return true;
  }
  return false;
}

// ============================================================
// OVERRIDE renderManagerMap — layout griglia pos_x/pos_y
// ============================================================
function renderManagerMap(ombs, dispMap) {
  const el = document.getElementById('manager-map');
  el.innerHTML = '';
  if (!ombs.length) return;

  const uniquePos = new Set(ombs.map(o => `${o.pos_x || 0}_${o.pos_y || 0}`));
  const hasGrid = uniquePos.size > 1 || ombs.length === 1;

  const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

  const buildOmbrelloneCell = (o) => {
    const stato = dispMap[o.id] || 'occupied';
    const cell = document.createElement('div');
    const cls = stato === 'libero' ? 'free'
      : stato === 'combinazione' ? 'combo'
      : stato === 'parziale' ? 'partial'
      : stato === 'sub_affittato' ? 'subleased'
      : 'occupied';
    const isSelected = bookingSelection.has(o.id);
    const hasCliente = (clientiList || []).some(c => !c.rifiutato && c.ombrellone_id === o.id);
    const noClienteCls = !hasCliente ? ' no-cliente' : '';
    cell.className = 'ombrellone ' + cls + noClienteCls + (isSelected ? ' selected' : '');
    cell.textContent = '☂️';
    let hint = '';
    const freeDays = (currentMapRange?.dates || []).filter(d => (currentMapRange?.dispByOmbDate?.[o.id] || {})[d] === 'libero');
    const selectSuffix = isSelected
      ? ' — selezionato, clicca per rimuoverlo dalla prenotazione'
      : ' — clicca per aggiungerlo alla prenotazione';
    if (stato === 'libero') hint = ' — libero per tutto il periodo' + selectSuffix;
    else if (stato === 'combinazione') {
      const covers = (currentMapRange?.combinationCovers || {})[o.id] || [];
      const days = covers.map(fmtDay).join(', ');
      const extra = freeDays.filter(d => !covers.includes(d));
      const extraTxt = extra.length ? ` (libero anche ${extra.map(fmtDay).join(', ')})` : '';
      hint = ` — copre ${covers.length} giorn${covers.length === 1 ? 'o' : 'i'}: ${days}${extraTxt}` + selectSuffix;
    } else if (stato === 'parziale') {
      const days = freeDays.map(fmtDay).join(', ');
      hint = ` — libero ${freeDays.length} giorn${freeDays.length === 1 ? 'o' : 'i'}: ${days}` + selectSuffix;
    } else if (stato === 'sub_affittato') hint = ' — sub-affittato';
    cell.title = `${o.codice} — ${formatCoin(o.credito_giornaliero)}/gg${hint}`;
    cell.onclick = () => toggleMapOmbSelection(o, stato);
    return cell;
  };

  if (hasGrid) {
    const byPos = {};
    ombs.forEach(o => { byPos[`${o.pos_x || 0}_${o.pos_y || 0}`] = o; });
    const passerelle = (currentStabilimento?.mappa_passerelle || []);
    const passerelleSet = new Set(passerelle.map(p => `${p.x}_${p.y}`));
    const xs = ombs.map(o => o.pos_x || 0).concat(passerelle.map(p => p.x || 0));
    const ys = ombs.map(o => o.pos_y || 0).concat(passerelle.map(p => p.y || 0));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    for (let y = minY; y <= maxY; y++) {
      const row = document.createElement('div');
      row.className = 'map-row';
      for (let x = minX; x <= maxX; x++) {
        const key = `${x}_${y}`;
        const o = byPos[key];
        if (o) {
          row.appendChild(buildOmbrelloneCell(o));
        } else if (passerelleSet.has(key)) {
          const cell = document.createElement('div');
          cell.className = 'map-passerella';
          row.appendChild(cell);
        } else {
          const cell = document.createElement('div');
          cell.className = 'map-empty';
          row.appendChild(cell);
        }
      }
      el.appendChild(row);
    }
  } else {
    const sorted = ombs.slice().sort((a, b) => (a.codice || '').localeCompare(b.codice || '', 'it', { numeric: true }));
    const mapRows = document.createElement('div');
    mapRows.className = 'map-rows';
    const row = document.createElement('div');
    row.className = 'map-row';
    sorted.forEach(o => row.appendChild(buildOmbrelloneCell(o)));
    mapRows.appendChild(row);
    el.appendChild(mapRows);
  }
}
